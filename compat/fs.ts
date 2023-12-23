import enosys from "./enosys.ts";
import SeekMode = Deno.SeekMode;

interface Stats {
    dev: number;
    ino: number;
    mode: number;
    nlink: number;
    uid: number;
    gid: number;
    rdev: number;
    size: number;
    blksize: number
    blocks: number
    atimeMs: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
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
//go uses the following methods:
/*
 * fs.open       [x]
 * fs.close      [x]
 * fs.mkdir      [x]
 * fs.readdir    [x]
 * fs.stat       [x]
 * fs.lstat      [x]
 * fs.fstat      [x]
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
 * fs.link       [x]
 * fs.symlink    [x]
 * fs.fsync      [x]
 * fs.read       [x]
 * fs.write      [x]
 */


//go probably does not use it all but Deno's std node
//interface is not directly compatible with fs
const fdMappings: { [x: number]: string } = {}
const fs = {
    constants: {
        O_RDONLY: 0,
        O_WRONLY: 1,
        O_RDWR: 2,

        O_CREAT: 0o100,
        O_CREATE: 0o100,
        O_TRUNC: 0o1000,
        O_APPEND: 0o2000,
        O_EXCL: 0o200,
        O_SYNC: 0o10000,
        O_CLOEXEC: 0,

    },

    //use Deno.File
    write: function (fd: number, buf: Uint8Array, offset: number, length: number, position: number, callback: (err: Error | null, written: number, buf: Uint8Array) => void) {
        if (offset === undefined || offset === null) {
            offset = 0;
        }
        if (length === undefined || length === null) {
            length = buf.length;
        }
        const file = new Deno.FsFile(fd);
        if (position !== null && position !== undefined) {
            file.seekSync(position, SeekMode.Start);
        }
        const buffer = buf.slice(offset, offset+length);
        const written = file.writeSync(buffer);

        callback(null, written, buf);
    },

    open(path: string, flags: number, mode: number, cb: (err: Error | null, fd: number) => void) {
        const fd = this.openSync(path, flags, mode)
        cb(null, fd);
    },

    openSync(path: string, flags: number, mode: number) {
        const options: Deno.OpenOptions = {};
        if (typeof flags == "number") {
            const rw = flags & 1;
            if (rw == 0) {
                options.read = true;
            } else {
                options.write = true;
            }
            const rnw = (flags >> 1) & 1;
            if (rnw == 1) {
                options.read = true;
                options.write = true;
            }
            const create = (flags >> 6) & 1;
            if (create) {
                options.create = true;
            }
            const excl = (flags >> 7) & 1;
            if (excl == 1) {
                options.createNew = true;
            }
            const trunc = (flags >> 9) & 1;
            const append = (flags >> 10) & 1;
            if (trunc == 1) options.truncate = true;
            if (create == 1) options.create = true;
            if (append) options.append = true;

        }
        options.mode = mode;
        //console.log(options)
        const fd = Deno.openSync(path, options).rid;
        fdMappings[fd] = path;
        return fd;
    },
    //fstat is an unstable API
    fstatSync(fd: number) {
        //require("fs").stat
        const stats = denoStatToNode(Deno.fstatSync(fd));
        return stats;
    },
    fstat(fd: number, cb: (err: Error | null, stats: Stats) => void) {
        const stats = this.fstatSync(fd);
        cb(null, stats);
    },
    statSync(path: string) {
        const status = Deno.statSync(path);
        const nStat = denoStatToNode(status);
        return nStat;
    },
    stat(path: string, cb: (err: Error | null, stats: Stats) => void) {
        const res = this.statSync(path);
        cb(null, res);
    },

    lstat(path: string, cb: (err: Error | null, stats: Stats) => void) {
        const res = this.lstatSync(path);
        cb(null, res);
    },
    lstatSync(path: string) {
        const stat = Deno.lstatSync(path);
        const nStat = denoStatToNode(stat);
        return nStat;
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
        const file = new Deno.FsFile(fd);
        if (position !== null && position !== undefined) {
            file.seekSync(position, SeekMode.Start);
        }
        const buf = new Uint8Array(length);
        let res = file.readSync(buf);
        buffer.set(buf, offset);
        if (res == null) res = 0;
        return res;
    },
    read(fd: number, buffer: Uint8Array, offset: number, length: number, position: number, cb: (err: Error | null, len: number, buffer: Uint8Array) => void) {
        const res = this.readSync(fd, buffer, offset, length, position);
        cb(null, res, buffer);
    },

    mkdir(path: string, mode: number, cb: (err: Error | null) => void) {
        this.mkdirSync(path, mode);
        cb(null);
    },
    mkdirSync(path: string, mode: number) {
        Deno.mkdirSync(path, {
            mode: mode,
        });
    },

    readdir(path: string, cb: (err: Error | null, files: string[]) => void) {
        const res = this.readdirSync(path);
        cb(null, res);
    },
    readdirSync(path: string) {
        const entries = Deno.readDirSync(path);
        const arr = [];
        for (const filename of entries) arr.push(filename.name);
        return arr;
    },

    rmdir(path: string, cb: (err: Error | null) => void) {
        this.rmdirSync(path);
        cb(null);
    },
    rmdirSync(path: string) {
        Deno.removeSync(path);
    },

    chmod(path: string, mode: number, cb: (err: Error | null) => void) {
        this.chmodSync(path, mode);
        cb(null);
    },
    chmodSync(path: string, mode: number) {
        Deno.chmodSync(path, mode);
    },

    fchmod(fd: number, mode: number, cb: (err: Error | null) => void) {
        this.fchmodSync(fd, mode);
        cb(null);
    },
    fchmodSync(fd: number, mode: number) {
        this.chmodSync(fdMappings[fd], mode);
    },

    chown(path: string, uid: number, gid: number, cb: (err: Error | null) => void) {
        this.chownSync(path, uid, gid);
        cb(null);
    },
    chownSync(path: string, uid: number, gid: number) {
        Deno.chownSync(path, uid === -1 ? null : uid, gid === -1 ? null : gid);
    },

    fchown(fd: number, uid: number, gid: number, cb: (err: Error | null) => void) {
        this.fchownSync(fd, uid, gid);
        cb(null);
    },
    fchownSync(fd: number, uid: number, gid: number) {
        this.chownSync(fdMappings[fd], uid, gid);
    },

    //Deno does not support lchown
    lchown(_path: string, _uid: number, _gid: number, cb: (err: Error | null) => void) {
        cb(enosys());
    },

    // Deno utime is unstable
    utimes(path: string, atime: number, mtime: number, cb: (err: Error | null) => void) {
        this.utimesSync(path, atime, mtime);
        cb(null);
    },
    utimesSync(path: string, atime: number, mtime: number) {
        Deno.utimeSync(path, atime, mtime);
    },

    rename(oldPath: string, newPath: string, cb: (err: Error | null) => void) {
        this.renameSync(oldPath, newPath);
        cb(null);
    },
    renameSync(oldPath: string, newPath: string) {
        Deno.renameSync(oldPath, newPath);
    },

    truncate(path: string, len: number, cb: (err: Error | null) => void) {
        this.truncateSync(path, len);
        cb(null);
    },
    truncateSync(path: string, len: number) {
        Deno.truncateSync(path, len);
    },

    //ftruncate is an unstable API
    ftruncate(fd: number, len: number, cb: (err: null | Error) => void) {
        this.ftruncateSync(fd, len);
        cb(null);
    },
    ftruncateSync(fd: number, len: number) {
        Deno.ftruncateSync(fd, len);
    },

    readlink(path: string, cb: (err: Error | null, linkStr: string) => void) {
        const res = this.readlinkSync(path);
        cb(null, res);
    },
    readlinkSync(path: string) {
        return Deno.readLinkSync(path);
    },

    link(oldpath: string, newpath: string, cb: (err: Error | null) => void) {
        this.linkSync(oldpath, newpath);
		cb(null);
    },
    linkSync(oldpath: string, newpath: string) {
        Deno.linkSync(oldpath, newpath);
    },

    unlink(path: string, cb: (err: Error | null) => void) {
        this.unlinkSync(path);
        cb(null);
    },
    unlinkSync(path: string) {
        Deno.removeSync(path);
    },

    //symlink is an unstable API
    symlink(path: string, link: string, cb: (err: Error | null) => void) {
        this.symlinkSync(path, link);
        cb(null);
    },
    symlinkSync(path: string, link: string) {
        Deno.symlinkSync(path, link);
    },

    fsync(fd: number, cb: (err: Error | null) => void) {
        this.fsyncSync(fd);
        cb(null);
    },
    fsyncSync(fd: number) {
        Deno.fsyncSync(fd);
    }


}

function denoStatToNode(status: Deno.FileInfo) {
    const nStat: Stats = {
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
        size: status.size,
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
