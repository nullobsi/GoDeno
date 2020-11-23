# GoDeno
A simple port of Golang's JS/WASM glue code to Deno in TypeScript.
Credit to the Go team for their amazing work on getting Go working in WASM!

Requires `--unstable` flag. Permissions flags are also required for filesystem usage.

## Usage
1. Create a new `Go` class
2. Create a new WASM instance with the `importObject` on the new `Go` object.
3. Run `go.run(wasmInstance)` with your WASM instance.

The `go` instance has an exports object for any objects that Go exposed on the `js.Global()` object.

Example Code:

```go
package main

import "syscall/js"

func main() {
    js.Global().Set("export1", "Hello!");
    <- make(chan bool)
}
```

```ts
import Go from "mod.ts"

let go = new Go();
let inst = await WebAssembly.instantiate(Deno.readFileSync("code.wasm"), go.importObject);
let promise = go.run(inst);

let value = go.exports.export1;
console.log("Go says: " + value); //Go says: Hello!
```

### Go FS implementation
- [x] fs.open      
- [x] fs.close     
- [x] fs.mkdir     
- [x] fs.readdir   
- [x] fs.stat      
- [x] fs.lstat     
- [x] fs.fstat      (Unstable API)
- [x] fs.unlink     (Uses `Deno.remove()`)
- [x] fs.rmdir     
- [x] fs.chmod     
- [x] fs.fchmod     (Not native API)
- [x] fs.chown     
- [x] fs.fchown     (Not native API)
- [ ] fs.lchown     (Deno does not support lchown.)
- [x] fs.utimes     (Unstable API)
- [x] fs.rename    
- [x] fs.truncate  
- [x] fs.ftruncate 
- [x] fs.readlink  
- [x] fs.link       (Unstable API)
- [x] fs.symlink    (Unstable API)
- [x] fs.fsync     
- [x] fs.read       (`position` not implemented)
- [x] fs.write      (`position` not implemented)

### Go Process implementation
As of now, Deno does not have ways to get the UID/GID or umask.
- [ ] process.getuid
- [ ] process.getgid
- [ ] process.geteuid
- [ ] process.getegid
- [ ] process.getgroups
- [x] process.pid
- [x] process.ppid       (Unstable API)
- [ ] process.umask
- [x] process.cwd
- [x] process.chdir