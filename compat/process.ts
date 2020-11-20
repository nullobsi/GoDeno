import enosys from "./enosys.ts";

// deno doesn't have process? not sure
let process = {
    getuid() { return -1; },
    getgid() { return -1; },
    geteuid() { return -1; },
    getegid() { return -1; },
    getgroups() { throw enosys(); },
    pid:  -1,
    ppid: -1,
    umask() { throw enosys(); },
    cwd() { return Deno.cwd() },
    chdir(dir: string) { Deno.chdir(dir); },
}



export default process;