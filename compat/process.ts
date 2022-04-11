import enosys from "./enosys.ts";

// deno doesn't have process? not sure
let process = {
    getuid() {
        let uid = Deno.getUid();
        if (uid === null) throw enosys();
        return uid;
    },
    getgid() {
        return -1;
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
        throw enosys();
    },
    cwd() {
        return Deno.cwd()
    },
    chdir(dir: string) {
        Deno.chdir(dir);
    },
}


export default process;
