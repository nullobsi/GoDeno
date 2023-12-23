import process from "./compat/process.ts";
import fs from "./compat/fs.ts";


const encoder = new TextEncoder()
const decoder = new TextDecoder();

class Go {
    public argv = ["js"];
    public exports: { [x: string]: unknown } = {};
    public env: { [x: string]: string } = {};
    public importObject = {
		_gotest: {
			add: (a:number, b:number) => a + b,
		},
        gojs: {
            "runtime.wasmExit": (sp: number) => {
                if (!this.mem) throw Error("Memory not initialized!");
				sp >>>= 0;

                const code = this.mem.getInt32(sp + 8, true);
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
            "runtime.wasmWrite": (sp: number) => {
                if (!this.mem || !this.instance) throw Error("Memory not initialized!");

                sp >>>= 0
                // get parameters from wasm memory
                const fd = this.getInt64(sp + 8);
                const p = this.getInt64(sp + 16);
                const n = this.mem.getInt32(sp + 24, true);

				const myMem = this.instance.exports.mem as WebAssembly.Memory;
                Deno.writeSync(fd, new Uint8Array(myMem.buffer, p, n))
            },

            //not sure what this is for, but it reinitializes the memory view
            // func resetMemoryDataView()
            "runtime.resetMemoryDataView": (sp: number) => {
				if (!this.instance) throw Error("Instance not ready!");
				sp >>>= 0;

				const myMem = this.instance.exports.mem as WebAssembly.Memory;
                this.mem = new DataView(myMem.buffer);
            },

            // performance stuffs
            // func nanotime1() int64
            "runtime.nanotime1": (sp: number) => {
                sp >>>= 0
                if (this.timeOrigin === undefined) throw new Error("Memory not initialized!");
                this.setInt64(sp + 8, (this.timeOrigin + performance.now()) * 1000000);
            },

            // func walltime() (sec int64, nsec int32)
            "runtime.walltime": (sp: number) => {
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

                const id = this.nextCallbackTimeoutID;
                this.nextCallbackTimeoutID++;

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
                try {
                    clearTimeout(this.scheduledTimeouts.get(id));
                } catch(e) {
                    console.debug("Timeout failed to remove; already gone?");
                    console.debug(e);
                }
                this.scheduledTimeouts.delete(id);
            },

            // func getRandomData(r []byte)
            "runtime.getRandomData": (sp: number) => {
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
            "syscall/js.stringVal": (sp: number) => {
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
				if (!this.instance) throw new Error("Not initialized!");
                sp >>>= 0
                // get value from object referenced by Go, string index
                const obj = this.loadValue(sp + 8);
                const ind = this.loadString(sp + 16);
				if (typeof obj !== "object" || obj === null) throw new Error("Get called on non-object!");

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

				const getSp = this.instance.exports.getsp as () => number;
                sp = getSp() >>> 0; // see comment above

                this.storeValue(sp + 32, result);
            },

            // func valueSet(v ref, p string, x ref)
            "syscall/js.valueSet": (sp: number) => {
                sp >>>= 0
                //set values on object referenced by Go
                let target = this.loadValue(sp + 8);
                const name = this.loadString(sp + 16);
                const value = this.loadValue(sp + 32);
                if (target == window) target = this.exports;

				if (typeof target !== "object" || target === null) throw new Error("Set called on non-object!");

                Reflect.set(target, name, value);
            },

            // func valueDelete(v ref, p string)
            "syscall/js.valueDelete": (sp: number) => {
                sp >>>= 0
                //delete the prop
				const obj = this.loadValue(sp + 8);
				if (typeof obj !== "object" || obj === null) throw new Error("Delete called on non-object!");
                Reflect.deleteProperty(obj, this.loadString(sp + 16));
            },

            // func valueIndex(v ref, i int) ref
            "syscall/js.valueIndex": (sp: number) => {
                sp >>>= 0
                //index array
				const obj = this.loadValue(sp + 8);
				if (typeof obj !== "object" || obj === null) throw new Error("Index called on non-object!");

                this.storeValue(sp + 24, Reflect.get(obj, this.getInt64(sp + 16)));
            },

            // valueSetIndex(v ref, i int, x ref)
            "syscall/js.valueSetIndex": (sp: number) => {
                sp >>>= 0
				const obj = this.loadValue(sp + 8);
				if (typeof obj !== "object" || obj === null) throw new Error("SetIndex called on non-object!");
                //store at index
                Reflect.set(obj, this.getInt64(sp + 16), this.loadValue(sp + 24));
            },

            // func valueCall(v ref, m string, args []ref) (ref, bool)
            "syscall/js.valueCall": (sp: number) => {
                if (this.mem === undefined) throw new Error("Memory not initialized!");
				if (this.instance === undefined) throw new Error("Instance undefined!");

                sp >>>= 0;
				const getSp = this.instance.exports.getsp as () => number;

                try {
                    // obtain "this" object from Go ref
                    const v = this.loadValue(sp + 8);
					if (typeof v !== "object" || v === null) throw new Error("valueCall called on non-object!");

                    // obtain method reference from Go ref
                    const m = Reflect.get(v, this.loadString(sp + 16));
                    // obtain array of arguments (js.Value)
                    const args = this.loadSliceOfValues(sp + 32);
                    //run method
                    const result = Reflect.apply(m, v, args);

                	sp = getSp() >>> 0; // see comment above

                    this.storeValue(sp + 56, result);
                    this.mem.setUint8(sp + 64, 1);
                } catch (err) {
                    sp = getSp() >>> 0;
                    this.storeValue(sp + 56, err);
                    this.mem.setUint8(sp + 64, 0);
                }
            },

            // func valueInvoke(v ref, args []ref) (ref, bool)
            "syscall/js.valueInvoke": (sp: number) => {
                if (this.mem === undefined) throw new Error("Memory not initialized!");
				if (this.instance === undefined) throw new Error("Instance undefined!");
                sp >>>= 0;

				const getSp = this.instance.exports.getsp as () => number;

                try {
                    // obtain method reference from go ref
                    const v = this.loadValue(sp + 8);
					if (typeof v !== "function" || v === null) throw new Error("valueInvoke called on non-function!");

                    // obtain array of arguments (js.Value)
                    const args = this.loadSliceOfValues(sp + 16);
                    // run method
                    const result = Reflect.apply(v, undefined, args);

                    sp = getSp() >>> 0; // see comment above

                    // store result
                    this.storeValue(sp + 40, result);
                    this.mem.setUint8(sp + 48, 1);
                } catch (err) {
                    sp = getSp() >>> 0; // see comment above
                    // store error
                    this.storeValue(sp + 40, err);
                    this.mem.setUint8(sp + 48, 0);
                }
            },

            //create new object from function
            // func valueNew(v ref, args []ref) (ref, bool)
            "syscall/js.valueNew": (sp: number) => {
                if (this.mem === undefined) throw new Error("Memory not initialized!");
				if (this.instance === undefined) throw new Error("Instance undefined!");
                sp >>>= 0;

				const getSp = this.instance.exports.getsp as () => number;

                try {
                    // obtain method reference from go ref
                    const v = this.loadValue(sp + 8);
					if (typeof v !== "function" || v === null) throw new Error("valueNew called on non-function!");

                    // obtain array of arguments (js.Value)
                    const args = this.loadSliceOfValues(sp + 16);
                    // create new object
                    const result = Reflect.construct(v, args);

					sp = getSp() >>> 0;

                    // store new object
                    this.storeValue(sp + 40, result);
                    this.mem.setUint8(sp + 48, 1);
                } catch (err) {
					sp = getSp() >>> 0;

                    // store error
                    this.storeValue(sp + 40, err);
                    this.mem.setUint8(sp + 48, 0);
                }
            },

            //get array length
            // func valueLength(v ref) int
            "syscall/js.valueLength": (sp: number) => {
                sp >>>= 0
                const arr = this.loadValue(sp + 8);

				if (!Array.isArray(arr)) {
                    throw new Error("Call of .Length() on non array!");
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
				if (typeof str !== "string") throw new Error("valueLoadString called on non-string!");

				const e = new TextEncoder();
				e.encodeInto(str, this.loadSlice(sp + 16));
            },

            // func valueInstanceOf(v ref, t ref) bool
            "syscall/js.valueInstanceOf": (sp: number) => {
                sp >>>= 0
                if (this.mem === undefined) throw new Error("Memory not initialized!");
                const obj = this.loadValue(sp + 8);
				// no proper type checking needed here
                const parent = this.loadValue(sp + 16) as () => void;

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

            "debug": (value: unknown) => {
                console.log("[Go]", value);
            },
        }
    }

    private exitPromise: Promise<void>;
    private resolveExitPromise!: () => void;

    //go requires underscore
    private _pendingEvent?: { args: IArguments; this: unknown; id: number };
    private scheduledTimeouts = new Map<number, number>()
    private nextCallbackTimeoutID = 1;

    private instance?: WebAssembly.Instance;
    private mem?: DataView;

    private _values?: unknown[];
    private goRefCounts?: number[];
    private ids?: Map<unknown, number>;
    private idPool?: number[];

    private exited = false;

    private timeOrigin?: number;

    constructor(argv?: string[], env?: { [x: string]: string }) {
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
		if (!(i instanceof WebAssembly.Instance)) {
			throw new Error("Go.run: WebAssembly.Instance expected");
		}

        this.instance = i;

		const myMem = i.exports.mem as WebAssembly.Memory;
		const myDataView = new DataView(myMem.buffer);

        this.mem = myDataView;
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
        this.ids = new Map(<[unknown, number][]>[ // mapping from JS values to reference ids
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
			if (this.mem === undefined) throw new Error("Memory not initialized!");
            const ptr = offset;
            const bytes = encoder.encode(str + "\0");
            new Uint8Array(this.mem.buffer, offset, bytes.length).set(bytes);
            offset += bytes.length;
            if (offset % 8 !== 0) {
                offset += 8 - (offset % 8);
            }
            return ptr;
        };

        //load argv
        const argc = this.argv.length;


        const argvPtrs: number[] = [];
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
            myDataView.setUint32(offset, ptr, true);
            myDataView.setUint32(offset + 4, 0, true);
            offset += 8;
        });

        this.timeOrigin = Date.now() - performance.now();
        //run go code
		const goRun = this.instance.exports.run as (argc: number, argv: number) => void;
        goRun(argc, argv)

        if (this.exited) {
            this.resolveExitPromise();
        }

        await this.exitPromise;
    }

    private exit(code: number) {
        if (code !== 0) {
            console.warn("exit code:", code)
        }
    }

    private setInt64(addr: number, value: number) {
        if (!this.mem) throw Error("Memory not initialized!");
        this.mem.setUint32(addr + 0, value, true);
        this.mem.setUint32(addr + 4, Math.floor(value / 4294967296), true);
    }

	private setInt32(addr: number, value: number) {
        if (!this.mem) throw Error("Memory not initialized!");
		this.mem.setUint32(addr + 0, value, true);
	}

    private getInt64(addr: number) {
        if (!this.mem) throw Error("Memory not initialized!");
        const low = this.mem.getUint32(addr + 0, true);
        const high = this.mem.getUint32(addr + 4, true);

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

    private storeValue(addr: number, v: unknown) {
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

    private loadSlice(addr: number) {
        if (this.instance === undefined) throw new Error("Memory not initialized!");
		if (this.mem === undefined) throw new Error("Memory not initialized!");
        const array = this.getInt64(addr + 0);
        const len = this.getInt64(addr + 8);

		const myMem = this.instance.exports.mem as WebAssembly.Memory;
        return new Uint8Array(myMem.buffer, array, len);
    }

    private loadSliceOfValues(addr: number) {
        const array = this.getInt64(addr + 0);
        const len = this.getInt64(addr + 8);
        const a = new Array(len);
        for (let i = 0; i < len; i++) {
            a[i] = this.loadValue(array + i * 8);
        }
        return a;
    }

    private loadString(addr: number) {
        if (this.instance === undefined) throw new Error("Memory not initialized!");

        const saddr = this.getInt64(addr + 0);
        const len = this.getInt64(addr + 8);
		const myMem = this.instance.exports.mem as WebAssembly.Memory;

        return decoder.decode(new DataView(myMem.buffer, saddr, len));
    }

    private resume() {
        if (this.exited) {
            throw new Error("Go program has already exited");
        }
        if (this.instance === undefined) throw new Error("Memory not initialized!");

		const resume = this.instance.exports.resume as () => void;
		resume();

        //if program exited, notify promise
        if (this.exited) {
            this.resolveExitPromise();
        }
    }

    //underscored for use by Go
    private _makeFuncWrapper(id: number) {
        // deno-lint-ignore no-this-alias
        const go: Go = this;
        return function (this: unknown) {
            const event: { args: IArguments; this: unknown; id: number; result: unknown }
				= {id: id, this: this, args: arguments, result: undefined};
            go._pendingEvent = event;
            go.resume();

            return event.result;
        };
    }
}

export { Go };

