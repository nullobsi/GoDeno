import process from "./compat/process.ts";
import fs from "./compat/fs.ts";


let encoder = new TextEncoder()
let decoder = new TextDecoder();

class Go {
    public argv = ["js"];
    public exports: {[x:string]: any} = {};
    public env: {[x:string]:string} = {};
    public importObject = {
        go: {
            "runtime.wasmExit": (sp:number) => {
                if (!this.mem) throw Error("Memory not initialized!");
                const code = this.mem.getInt32(sp + 8,true);
                this.exited = true;
                delete this.instance;
                delete this._values;
                delete this.goRefCounts;
                delete this.ids;
                delete this.idPool;
                this.exports = {};
                this.exit(code);
            },

            //p = space in WASM memory where data resides
            //n = length of data
            // func wasmWrite(fd uintptr, p unsafe.Pointer, n int32)
            "runtime.wasmWrite":(sp:number) => {
                sp >>>= 0
                // get parameters from wasm memory
                const fd = this.getInt64(sp + 8);
                const p = this.getInt64(sp + 16);
                //TODO: type this properly
                //@ts-ignore
                const n = this.mem.getInt32(sp + 24, true);
                //TODO: type this properly
                //@ts-ignore
                Deno.writeSync(fd, new Uint8Array(this.instance.exports.mem.buffer, p, n))
            },

            //not sure what this is for, but it reinitializes the memory view
            // func resetMemoryDataView()
            "runtime.resetMemoryDataView": (sp:number) => {
                //TODO: type this properly
                //@ts-ignore
                this.mem = new DataView(this.instance.exports.mem.buffer);
            },

            // performance stuffs
            // func nanotime1() int64
            "runtime.nanotime1": (sp: number) => {
                sp >>>= 0
                if (this.timeOrigin === undefined) throw new Error("Memory not initialized!");
                this.setInt64(sp + 8, (this.timeOrigin + performance.now()) * 1000000);
            },

            // func walltime1() (sec int64, nsec int32)
            "runtime.walltime1": (sp: number) => {
                sp >>>= 0
                if (this.mem === undefined) throw new Error("Memory not initialized!");

                const msec = (new Date).getTime();
                this.setInt64(sp + 8, msec / 1000);
                this.mem.setInt32(sp + 16, (msec % 1000) * 1000000, true);
            },

            //in Deno, seems to be an issue with the timeouts,
            //seems to be an upstream bug. happens on my friend's
            //mac but i haven't reproduced it on Windows.
            //not sure how to workaround? or if it has to be upstream change

            //schedules the running of the WASM code

            // func scheduleTimeoutEvent(delay int64) int32
            "runtime.scheduleTimeoutEvent": (sp: number) => {
                sp >>>= 0
                if (this.mem === undefined) throw new Error("Memory not initialized!");

                const id = this.nextCBID;
                this.nextCBID++;
                //track timeout
                this.scheduledTimeouts.set(id, setTimeout(
                    () => {
                        this.resume();
                        while (this.scheduledTimeouts.has(id)) {
                            // for some reason Go failed to register the timeout event, log and try again
                            // (temporary workaround for https://github.com/golang/go/issues/28975)
                            console.warn("scheduleTimeoutEvent: missed timeout event");
                            this.resume();
                        }
                    },
                    this.getInt64(sp + 8) + 1, // setTimeout has been seen to fire up to 1 millisecond early
                ));
                //return callback id to Go
                this.mem.setInt32(sp + 16, id, true);
            },

            //bug happens from this func.
            // func clearTimeoutEvent(id int32)
            "runtime.clearTimeoutEvent": (sp: number) => {
                sp >>>= 0
                if (this.mem === undefined) throw new Error("Memory not initialized!");

                const id = this.mem.getInt32(sp + 8, true);
                clearTimeout(this.scheduledTimeouts.get(id));
                this.scheduledTimeouts.delete(id);
            },

            // func getRandomData(r []byte)
            "runtime.getRandomData": (sp:number) => {
                sp >>>= 0
                crypto.getRandomValues(this.loadSlice(sp + 8));
            },

            //i think this gets rid of a reference in Go

            // func finalizeRef(v ref)
            "syscall/js.finalizeRef": (sp: number) => {
                sp >>>= 0
                if (this.mem === undefined) throw new Error("Memory not initialized!");
                if (this.goRefCounts === undefined) throw new Error("Memory not initialized!");
                if (this._values === undefined) throw new Error("Memory not initialized!");
                if (this.ids === undefined) throw new Error("Memory not initialized!");
                if (this.idPool === undefined) throw new Error("Memory not initialized!");

                const id = this.mem.getUint32(sp + 8, true);
                this.goRefCounts[id]--;
                if (this.goRefCounts[id] === 0) {
                    const v = this._values[id];
                    this._values[id] = null;
                    this.ids.delete(v);
                    this.idPool.push(id);
                }
            },

            //load string to Go
            // func stringVal(value string) ref
            "syscall/js.stringVal": (sp:number) => {
                sp >>>= 0
                this.storeValue(sp + 24, this.loadString(sp + 8));
            },

            //according to Go maintainers:

            // Go's SP does not change as long as no Go code is running. Some operations (e.g. calls, getters and setters)
            // may synchronously trigger a Go event handler. This makes Go code get executed in the middle of the imported
            // function. A goroutine can switch to a new stack if the current stack is too small (see morestack function).
            // This changes the SP, thus we have to update the SP used by the imported function.

            // func valueGet(v ref, p string) ref
            "syscall/js.valueGet": (sp: number) => {
                sp >>>= 0
                // get value from object referenced by Go, string index
                let obj = this.loadValue(sp + 8);
                let ind = this.loadString(sp + 16);
                let result = Reflect.get(obj, ind);

                if (result === undefined) {
                    if (this.exports === undefined) {
                        throw new Error("Memory not initialized!");
                    }
                    if (obj == window) {
                        if (ind == "fs") result = fs;
                        else if (ind == "performance") result = performance;
                        else if (ind == "process") result = process;
                        else if (ind == "crypto") result = crypto;
                        else result = Reflect.get(this.exports, ind);
                    }
                }

                //TODO: type this properly
                //@ts-ignore
                sp = this.instance.exports.getsp(); // see comment above
                sp >>>= 0
                this.storeValue(sp + 32, result);
            },

            // func valueSet(v ref, p string, x ref)
            "syscall/js.valueSet": (sp: number) => {
                sp >>>= 0
                //set values on object referenced by Go
                let target = this.loadValue(sp + 8);
                let name = this.loadString(sp + 16);
                let value = this.loadValue(sp + 32);
                if (target == window) target = this.exports;
                Reflect.set(target, name, value);
            },

            // func valueDelete(v ref, p string)
            "syscall/js.valueDelete": (sp: number) => {
                sp >>>= 0
                //delete the prop
                Reflect.deleteProperty(this.loadValue(sp + 8), this.loadString(sp + 16));
            },

            // func valueIndex(v ref, i int) ref
            "syscall/js.valueIndex": (sp: number) => {
                sp >>>= 0
                //index array
                this.storeValue(sp + 24, Reflect.get(this.loadValue(sp + 8), this.getInt64(sp + 16)));
            },

            // valueSetIndex(v ref, i int, x ref)
            "syscall/js.valueSetIndex": (sp: number) => {
                sp >>>= 0
                //store at index
                Reflect.set(this.loadValue(sp + 8), this.getInt64(sp + 16), this.loadValue(sp + 24));
            },

            // func valueCall(v ref, m string, args []ref) (ref, bool)
            "syscall/js.valueCall": (sp: number) => {
                sp >>>= 0
                if (this.mem === undefined) throw new Error("Memory not initialized!");
                try {
                    // obtain "this" object from Go ref
                    const v = this.loadValue(sp + 8);
                    // obtain method reference from Go ref
                    const m = Reflect.get(v, this.loadString(sp + 16));
                    // obtain array of arguments (js.Value)
                    const args = this.loadSliceOfValues(sp + 32);
                    //run method
                    const result = Reflect.apply(m, v, args);

                    //TODO: type this properly
                    //@ts-ignore
                    sp = this.instance.exports.getsp(); // see comment above
                    sp >>>= 0
                    this.storeValue(sp + 56, result);
                    this.mem.setUint8(sp + 64, 1);
                } catch (err) {
                    this.storeValue(sp + 56, err);
                    this.mem.setUint8(sp + 64, 0);
                }
            },

            // func valueInvoke(v ref, args []ref) (ref, bool)
            "syscall/js.valueInvoke": (sp:number) => {
                sp >>>= 0
                if (this.mem === undefined) throw new Error("Memory not initialized!");

                try {
                    // obtain method reference from go ref
                    const v = this.loadValue(sp + 8);
                    // obtain array of arguments (js.Value)
                    const args = this.loadSliceOfValues(sp + 16);
                    // run method
                    const result = Reflect.apply(v, undefined, args);

                    //TODO: type this properly
                    //@ts-ignore
                    sp = this.instance.exports.getsp(); // see comment above
                    sp >>>= 0
                    // store result
                    this.storeValue(sp + 40, result);
                    this.mem.setUint8(sp + 48, 1);
                } catch (err) {
                    // store error
                    this.storeValue(sp + 40, err);
                    this.mem.setUint8(sp + 48, 0);
                }
            },

            //create new object from function
            // func valueNew(v ref, args []ref) (ref, bool)
            "syscall/js.valueNew": (sp: number) => {
                sp >>>= 0
                if (this.mem === undefined) throw new Error("Memory not initialized!");

                try {
                    // obtain method reference from go ref
                    const v = this.loadValue(sp + 8);
                    // obtain array of arguments (js.Value)
                    const args = this.loadSliceOfValues(sp + 16);
                    // create new object
                    const result = Reflect.construct(v, args);

                    //TODO: type this properly
                    //@ts-ignore
                    sp = this.instance.exports.getsp(); // see comment above
                    sp >>>= 0
                    // store new object
                    this.storeValue(sp + 40, result);
                    this.mem.setUint8(sp + 48, 1);
                } catch (err) {
                    // store error
                    this.storeValue(sp + 40, err);
                    this.mem.setUint8(sp + 48, 0);
                }
            },

            //get array length
            // func valueLength(v ref) int
            "syscall/js.valueLength": (sp: number) => {
                sp >>>= 0
                let arr: Array<any> = this.loadValue(sp + 8);
                if (typeof arr !== "object") {
                    throw new Error("Call of .Length() on non object!");
                }
                this.setInt64(sp + 16, Math.round(arr.length));
            },

            // valuePrepareString(v ref) (ref, int)
            "syscall/js.valuePrepareString": (sp: number) => {
                sp >>>= 0
                //encode string to UTF-8
                const str = encoder.encode(String(this.loadValue(sp + 8)));
                //store string ref into Go
                this.storeValue(sp + 16, str);
                this.setInt64(sp + 24, str.length);
            },

            // valueLoadString(v ref, b []byte)
            "syscall/js.valueLoadString": (sp: number) => {
                sp >>>= 0
                //load string value into Go memory
                const str = this.loadValue(sp + 8);
                this.loadSlice(sp + 16).set(str);
            },

            // func valueInstanceOf(v ref, t ref) bool
            "syscall/js.valueInstanceOf": (sp: number) => {
                sp >>>= 0
                if (this.mem === undefined) throw new Error("Memory not initialized!");
                let obj = this.loadValue(sp + 8);
                let parent = this.loadValue(sp + 16);
                this.mem.setUint8(sp + 24, (obj instanceof parent) ? 1 : 0);
            },

            //load uint8 to Go
            // func copyBytesToGo(dst []byte, src ref) (int, bool)
            "syscall/js.copyBytesToGo": (sp: number) => {
                sp >>>= 0
                if (this.mem === undefined) throw new Error("Memory not initialized!");

                //load buffers
                const dst = this.loadSlice(sp + 8);
                const src = this.loadValue(sp + 32);
                //ensure uint8 array
                if (!(src instanceof Uint8Array || src instanceof Uint8ClampedArray)) {
                    this.mem.setUint8(sp + 48, 0);
                    return;
                }
                //copy into Go
                const toCopy = src.subarray(0, dst.length);
                dst.set(toCopy);
                //return bytes written
                this.setInt64(sp + 40, toCopy.length);
                this.mem.setUint8(sp + 48, 1);
            },

            // load from Go to uint8
            // func copyBytesToJS(dst ref, src []byte) (int, bool)
            "syscall/js.copyBytesToJS": (sp: number) => {
                sp >>>= 0
                if (this.mem === undefined) throw new Error("Memory not initialized!");

                //load buffers
                const dst = this.loadValue(sp + 8);
                const src = this.loadSlice(sp + 16);
                //ensure uint8 array
                if (!(dst instanceof Uint8Array || dst instanceof Uint8ClampedArray)) {
                    this.mem.setUint8(sp + 48, 0);
                    return;
                }
                //copy to JS
                const toCopy = src.subarray(0, dst.length);
                dst.set(toCopy);
                //return bytes written
                this.setInt64(sp + 40, toCopy.length);
                this.mem.setUint8(sp + 48, 1);
            },

            "debug": (value: any) => {
                console.log("[Go]",value);
            },
        }
    }

    private exitPromise: Promise<void>;
    private resolveExitPromise!: () => void;

    //go requires underscore
    private _pendingEvent?: { args: IArguments; this: any; id: number };
    private scheduledTimeouts = new Map<number, number>()
    private nextCBID = 1;

    private instance?: WebAssembly.Instance;
    private mem?: DataView;

    private _values?: any[];
    private goRefCounts?: number[];
    private ids?: Map<any,number>;
    private idPool?: number[];

    private exited = false;

    private timeOrigin?: number;

    constructor(argv?: string[], env?: {[x:string]: string}) {
        if (argv) {
            this.argv = argv;
        }
        if (env) {
            this.env = env;
        }
        this.exitPromise = new Promise<void>(res => {
            this.resolveExitPromise = res;
        });


    }

    public async run(i: WebAssembly.Instance) {

        this.instance = i;
        // TODO: type this properly
        // @ts-ignore
        this.mem = new DataView(i.exports.mem.buffer);
        //initialize initial reference values:
        this._values = [
            NaN,
            0,
            null,
            true,
            false,
            window,
            this,
        ];
        this.goRefCounts = new Array(this._values.length).fill(Infinity); //number of refs that go has to a value
        this.ids = new Map(<[any,number][]>[ // mapping from JS values to reference ids
            [0, 1],
            [null, 2],
            [true, 3],
            [false, 4],
            [window, 5],
            [this, 6],
        ]);
        this.idPool = [];

        // Pass command line arguments and environment variables to WebAssembly by writing them to the linear memory.
        let offset = 4096;
        const strPtr = (str: string) => {
            const ptr = offset;
            const bytes = encoder.encode(str + "\0");
            //yes, technically it *could* be undefined but this is literally used nowhere else shut the fuck up
            // @ts-ignore
            new Uint8Array(this.mem.buffer, offset, bytes.length).set(bytes);
            offset += bytes.length;
            if (offset % 8 !== 0) {
                offset += 8 - (offset % 8);
            }
            return ptr;
        };

        //load argv
        const argc = this.argv.length;


        const argvPtrs:number[] = [];
        this.argv.forEach((arg) => {
            argvPtrs.push(strPtr(arg));
        });
        argvPtrs.push(0);

        //load env
        const keys = Object.keys(this.env).sort();
        keys.forEach((key) => {
            argvPtrs.push(strPtr(`${key}=${this.env[key]}`));
        });
        argvPtrs.push(0);

        const argv = offset;
        argvPtrs.forEach((ptr) => {
            // no undefs here:)
            // @ts-ignore
            this.mem.setUint32(offset, ptr, true);
            // @ts-ignore
            this.mem.setUint32(offset + 4, 0, true);
            offset += 8;
        });

        this.timeOrigin = Date.now() - performance.now();
        //run go code
        //@ts-ignore
        this.instance.exports.run(argc, argv)

        if (this.exited) {
            this.resolveExitPromise();
        }

        await this.exitPromise;
    }

    private exit(code: number) {
        if (code !== 0) {
            console.warn("exit code:",code)
        }
    }

    private setInt64(addr: number, value: number) {
        if (!this.mem) throw Error("Memory not initialized!");
        this.mem.setUint32(addr+0, value,true);
        this.mem.setUint32(addr+4, Math.floor(value / 4294967296), true);
    }
    private getInt64(addr: number) {
        if (!this.mem) throw Error("Memory not initialized!");
        const low  = this.mem.getUint32(addr+0,true);
        const high = this.mem.getUint32(addr+4,true);

        return low + high * 4294967296;
    }

    private loadValue(addr: number) {
        if (!this.mem) throw Error("Memory not initialized!");
        if (!this._values) throw Error("Memory not initialized!");
        const f = this.mem.getFloat64(addr, true);
        if (f === 0) {
            return undefined;
        }
        if (!isNaN(f)) {
            return f;
        }

        const id = this.mem.getUint32(addr, true);
        return this._values[id];
    }
    private storeValue(addr: number, v: any) {
        if (this.mem === undefined) throw Error("Memory not initialized!");
        if (this._values === undefined) throw Error("Memory not initialized!");
        if (this.ids === undefined) throw Error("Memory not initialized!");
        if (this.idPool === undefined) throw Error("Memory not initialized!");
        if (this.goRefCounts === undefined) throw Error("Memory not initialized!");
        const nanHead = 0x7FF80000;

        if (typeof v === "number" && v !== 0) {
            if (isNaN(v)) {
                this.mem.setUint32(addr + 4, nanHead, true);
                this.mem.setUint32(addr, 0, true);
                return;
            }
            this.mem.setFloat64(addr, v, true);
            return;
        }

        if (v === undefined) {
            this.mem.setFloat64(addr, 0, true);
            return;
        }

        let id = this.ids.get(v);
        if (id === undefined) {
            id = this.idPool.pop();
            if (id === undefined) {
                id = this._values.length;
            }
            this._values[id] = v;
            this.goRefCounts[id] = 0;
            this.ids.set(v, id);
        }
        this.goRefCounts[id]++;
        let typeFlag = 0;
        switch (typeof v) {
            case "object":
                if (v !== null) {
                    typeFlag = 1;
                }
                break;
            case "string":
                typeFlag = 2;
                break;
            case "symbol":
                typeFlag = 3;
                break;
            case "function":
                typeFlag = 4;
                break;
        }
        this.mem.setUint32(addr + 4, nanHead | typeFlag, true);
        this.mem.setUint32(addr, id, true);
    }

    private loadSlice(addr:number) {
        if (this.instance === undefined) throw new Error("Memory not initialized!");
        const array = this.getInt64(addr);
        const len = this.getInt64(addr + 8);
        // i guess go does some funnies?
        //TODO: type this properly
        //@ts-ignore
        return new Uint8Array(this.instance.exports.mem.buffer, array, len);
    }
    private loadSliceOfValues(addr:number) {
        const array = this.getInt64(addr);
        const len = this.getInt64(addr + 8);
        const a = new Array(len);
        for (let i = 0; i < len; i++) {
            a[i] = this.loadValue(array + i * 8);
        }
        return a;
    }

    private loadString(addr:number) {
        const saddr = this.getInt64(addr + 0);
        const len = this.getInt64(addr + 8);
        //TODO: type this properly
        //@ts-ignore
        return decoder.decode(new DataView(this.instance.exports.mem.buffer, saddr, len));
    }

    private resume() {
        if (this.exited) {
            throw new Error("Go program has already exited");
        }
        if (this.instance === undefined) throw new Error("Memory not initialized!");
        //TODO: type this properly
        //@ts-ignore
        this.instance.exports.resume();

        //if program exited, notify promise
        if (this.exited) {
            this.resolveExitPromise();
        }
    }

    //underscored for use by Go
    private _makeFuncWrapper(id: number) {
        const go = this;
        return function () {
            let event: { args: IArguments; this: any; id: number };
            //i know `this` is shadowed that's the point
            // @ts-ignore
            event = {id: id, this: this, args: arguments};
            go._pendingEvent = event;
            go.resume();
            //@ts-ignore
            return event.result;
        };
    }
}

export default Go;