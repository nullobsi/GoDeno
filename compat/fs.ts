import enosys from "./enosys.ts";
import SeekMode = Deno.SeekMode;

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
//TODO: rest of the fucking interface
//go uses the following methods:
/*
 * fs.open       [x]
 * fs.close      [x]
 * fs.mkdir      [x]
 * fs.readdir    [x]
 * fs.stat       [x]
 * fs.lstat      [x]
 * fs.fstat      [/] Unstable API
 * fs.unlink     [/] Uses Deno.remove()
 * fs.rmdir      [x]
 * fs.chmod      [x]
 * fs.fchmod     [/] Not native API
 * fs.chown      [x]
 * fs.fchown     [/] Not native API
 * fs.lchown     [o] Deno does not support lchown.
 * fs.utimes     [/] Unstable API
 * fs.rename     [x]
 * fs.truncate   [x]
 * fs.ftruncate  [x]
 * fs.readlink   [x]
 * fs.link       [/] Unstable API
 * fs.symlink    [/] Unstable API
 * fs.fsync      [x]
 * fs.read       [/] Position not implemented
 * fs.write      [/] Position not implemented
 */


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

    //TODO: position
    //use Deno.File
    write: function(fd: number, buf: Uint8Array, offset: number, length: number, position: number, callback: (err: Error|null, written: number, buf: Uint8Array) => void) {
        Deno.write(fd, buf)
            .then(written => callback(null, written, buf))
            .catch(err => callback(err, 0, buf));
    },

    open(path: string, flags: number, mode: number, cb: (err: Error | null, fd: number) => void) {
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
        Deno.open(path, options).then(file => {
            fdMappings[file.rid] = path;
            cb(null,file.rid);
        })
            .catch(err => cb(err, 0));
    },

    //fstat is an unstable API
    fstat(fd: number, cb: (err: Error | null, stats: Stats | null) => void) {
        Deno.fstat(fd).then(denostat => {
            let stats = denoStatToNode(denostat);
            cb(null, stats);
        })
            .catch(err => cb(err, null))
    },

    stat(path: string, cb: (err: Error | null, stats: Stats | null) => void) {
        Deno.stat(path).then(denostat => {
            let res = denoStatToNode(denostat);
            cb(null, res);
        })
            .catch(err => cb(err, null))

    },

    lstat(path: string, cb: (err: Error|null, stats: Stats | null) => void) {
        Deno.lstat(path).then(denostat => {
            let res = denoStatToNode(denostat);
            cb(null, res);
        })
            .catch(err => cb(err, null))
    },

    close(fd: number, cb: (err: Error | null) => void) {
        Deno.close(fd);
        cb(null);
    },

    async readAwait(fd: number, buffer: Uint8Array, offset: number, length: number, position?: number | null) {
        let file = new Deno.File(fd);
        if (position !== null && position !== undefined) {
            await file.seek(position, SeekMode.Start)
        }
        let buf = new Uint8Array(length);
        let read = await file.read(buf);
        if (read === null) read = 0;
        buffer.set(buf, offset);
        return read;
    },
    read(fd: number, buffer: Uint8Array, offset: number, length: number, position: number, cb: (err: Error | null, len: number, buffer: Uint8Array) => void) {
        this.readAwait(fd, buffer, offset, length, position)
            .then(written => cb(null, written, buffer))
            .catch(err => cb(err, 0, buffer));
    },

    mkdir(path: string, mode: number, cb: (err:Error|null) => void) {
        Deno.mkdir(path, {mode})
            .then(() => cb(null))
            .catch(cb);
    },

    readdir(path: string, cb: (err: Error | null, files: string[]) => void) {
        this.readdirAwait(path)
            .then(arr => cb(null, arr))
            .catch(err => cb(err, []))
    },
    async readdirAwait(path: string) {
        let iterable = Deno.readDir(path);
        let arr = [];
        for await (let i of iterable) {
            arr.push(i.name);
        }
        return arr;
    },

    rmdir(path: string, cb: (err: Error|null) => void) {
        Deno.remove(path)
            .then(() => cb(null))
            .catch(err => cb(err));
    },

    chmod(path: string, mode: number, cb: (err: Error|null) => void) {
        Deno.chmod(path, mode)
            .then(() => cb(null))
            .catch(err => cb(err));
    },

    fchmod(fd: number, mode: number, cb: (err: Error|null) => void) {
        this.chmod(fdMappings[fd], mode, cb);
    },

    chown(path: string, uid: number, gid: number, cb: (err: Error|null) => void) {
        Deno.chown(path, uid === -1 ? null : uid, gid === -1 ? null : gid)
            .then(() => cb(null))
            .catch(err => cb(err));
    },

    fchown(fd: number, uid: number, gid: number, cb: (err: Error|null) => void) {
        this.chown(fdMappings[fd], uid, gid, cb);
    },

    //Deno does not support lchown
    lchown(path: string, uid:number, gid:number, cb: (err: Error|null) => void) {
        cb(enosys());
    },

    // Deno utime is unstable
    utimes(path: string, atime: number, mtime: number, cb: (err: Error|null) => void) {
        Deno.utime(path, atime, mtime)
            .then(() => cb(null))
            .catch(err => cb(err));
    },

    rename(oldPath: string, newPath: string, cb: (err: Error|null) => void) {
        Deno.rename(oldPath, newPath)
            .then(() => cb(null))
            .catch(err => cb(err));
    },

    truncate(path: string, len: number, cb: (err: Error|null) => void) {
        Deno.truncate(path, len)
            .then(() => cb(null))
            .catch(err => cb(err));
    },

    //ftruncate is an unstable API
    ftruncate(fd: number, len: number, cb: (err: null|Error)=>void) {
        Deno.ftruncate(fd, len)
            .then(() => cb(null))
            .catch(err => cb(err))
    },

    readlink(path: string, cb: (err: Error|null, linkStr: string) => void) {
        Deno.readLink(path)
            .then(str => cb(null, str))
            .catch(err => cb(err, ""))
    },

    //link is an unstable API
    link(oldpath: string, newpath: string, cb: (err: Error|null) => void) {
        Deno.link(oldpath, newpath)
            .then(() => cb(null))
            .catch(err => cb(err))
    },

    unlink(path: string, cb: (err: Error|null) => void) {
        Deno.remove(path);
        cb(null);
    },

    //symlink is an unstable API
    symlink(path: string, link: string, cb: (err: Error|null) => void) {
        Deno.symlink(path, link)
            .then(() => cb(null))
            .catch(err => cb(err));
    },

    fsync(fd: number, cb: (err: Error|null) => void) {
        Deno.fsync(fd)
            .then(() => cb(null))
            .catch(err => cb(err));
    },






}

function denoStatToNode(status: Deno.FileInfo) {
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
    return nStat
}

export default fs;