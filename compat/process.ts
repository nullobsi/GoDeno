import enosys from "./enosys.ts";

const process = {
    getuid() {
        const uid = Deno.uid();
        if (uid === null) return -1;
        return uid;
    },
    getgid() {
        const gid = Deno.gid();
        if (gid === null) return -1;
        return gid;
    },
    geteuid() {
        return -1;
    },
    getegid() {
        return -1;
    },
    getgroups() {
        throw enosys();
    },
    pid: Deno.pid,
    ppid: Deno.ppid,
    umask() {
        const umask = Deno.umask();
        if (umask == null) throw enosys();
        return umask;
    },
    cwd() {
        return Deno.cwd()
    },
    chdir(dir: string) {
        Deno.chdir(dir);
    },
}


export default process;
