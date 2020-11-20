interface Stats {
    dev: number;
    ino: number;
    mode: number;
    nlink: number;
    uid: number;
    gid: number;
    rdev:number;
    size: number;
    blksize:number
    blocks:number
    atimeMs:number;
    mtimeMs:number;
    ctimeMs:number;
    birthtimeMs:number;
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;

    isBlockDevice: () => boolean;
    isCharacterDevice: () => boolean;
    isDirectory: () => boolean;
    isFIFO: () => boolean;
    isFile: () => boolean;
    isSocket: () => boolean;
    isSymbolicLink: () => boolean;

}


//create FS for Go

//TODO? rest of the fucking interface?
//go probably does not use it all but Deno's std node
//interface is not directly compatible with fs
let fdMappings:{[x:number]:string} = {}
const fs = {
    constants: {
        O_RDONLY   : 0,
        O_WRONLY   : 1,
        O_RDWR     : 2,

        O_CREAT    : 0o100,
        O_CREATE   : 0o100,
        O_TRUNC    : 0o1000,
        O_APPEND   : 0o2000,
        O_EXCL     : 0o200,
        O_SYNC     : 0o10000,
        O_CLOEXEC  : 0,

    },

    //TODO: buffer length, offset, etc
    //use Deno.File? (i don't think go even uses them)
    write: function(fd: number, buf: Uint8Array, offset: number, length: number, position: number, callback: (err: Error|null, written: number, buf: Uint8Array) => void) {
        let written = Deno.writeSync(fd, buf);
        callback(null, written, buf);
    },
    writeSync(fd: number, buf: Uint8Array) {
        return Deno.writeSync(fd, buf);
    },
    open(path: string, flags: number, mode: number, cb: (err: Error | null, fd: number) => void) {
        let fd = this.openSync(path, flags, mode)
        cb(null, fd);
    },

    openSync (path:string, flags: number, mode: number) {
        let options: Deno.OpenOptions = {};
        if (typeof flags == "number") {
            let rw = flags & 1;
            if (rw == 0) {
                options.read = true;
            } else {
                options.write = true;
            }
            let rnw = (flags >> 1) & 1;
            if (rnw == 1) {
                options.read = true;
                options.write = true;
            }
            let create = (flags >> 6) & 1;
            if (create) {
                options.create = true;
            }
            let excl = (flags >> 7) & 1;
            if (excl == 1) {
                options.createNew = true;
            }
            let trunc = (flags >> 9) & 1;
            let append = (flags >> 10) & 1;
            if (trunc == 1) options.truncate = true;
            if (create == 1) options.create = true;
            if (append) options.append = true;

        }
        options.mode = mode;
        //console.log(options)
        let fd =  Deno.openSync(path, options).rid;
        fdMappings[fd] = path;
        return fd;
    },
    fstatSync(fd: number) {
        //require("fs").stat
        let status = Deno.statSync(fdMappings[fd]);
        let nStat: Stats = {
            atime: new Date(0),
            atimeMs: 0,
            birthtime: new Date(0),
            birthtimeMs: 0,
            blksize: 0,
            blocks: 0,
            ctime: new Date(0),
            ctimeMs: 0,
            dev: 0,
            gid: 0,
            ino: 0,
            isBlockDevice(): boolean {
                return false;
            },
            isCharacterDevice(): boolean {
                return false;
            },
            isDirectory(): boolean {
                return status.isDirectory;
            },
            isFIFO(): boolean {
                return false;
            },
            isFile(): boolean {
                return status.isFile;
            },
            isSocket(): boolean {
                return false;
            },
            isSymbolicLink(): boolean {
                return status.isSymlink;
            },
            mode: 0,
            mtime: new Date(0),
            mtimeMs: 0,
            nlink: 0,
            rdev: 0,
            size: 0,
            uid: 0
        }

        if (status.atime) {
            nStat.atimeMs = status.atime.getTime();
            nStat.atime = status.atime;
        }

        if (status.mtime) {
            nStat.mtimeMs = status.mtime.getTime();
            nStat.mtime = status.mtime;
        }

        if (status.birthtime) {
            nStat.birthtime = status.birthtime;
            nStat.birthtimeMs = status.birthtime.getTime();
        }


        if (status.dev !== null) {
            nStat.dev = status.dev;
        }

        if (status.ino !== null) {
            nStat.ino = status.ino;
        }

        if (status.mode !== null) {
            nStat.mode = status.mode;
        }

        if (status.nlink !== null) {
            nStat.nlink = status.nlink
        }

        if (status.uid !== null) {
            nStat.uid = status.uid;
        }

        if (status.gid !== null) {
            nStat.gid = status.gid;
        }

        if (status.rdev !== null) {
            nStat.rdev = status.rdev;
        }

        if (status.blksize !== null) {
            nStat.blksize = status.blksize;
        }

        if (status.blocks !== null) {
            nStat.blocks = status.blocks;
        }

        return nStat;
    },
    fstat(fd: number, cb: (err: Error | null, stats: Stats) => void) {
        let status = this.fstatSync(fd);
        cb(null, status);
    },
    close(fd: number, cb: (err: Error | null) => void) {
        this.closeSync(fd);
        cb(null);
    },
    closeSync(fd: number) {
        Deno.close(fd);
        return null;
    },
    readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number) {
        let res = Deno.readSync(fd, buffer);
        //deno returns null when file is done while Node returns 0
        if (res == null) res = 0;
        return res;
    },
    read(fd: number, buffer: Uint8Array, offset: number, length: number, position: number, cb: (err: Error | null, len: number, buffer: Uint8Array) => void) {
        let res = this.readSync(fd, buffer, offset, length, position);
        cb(null, res, buffer);
    }
}

export default fs;