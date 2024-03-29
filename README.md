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
let wasm = await WebAssembly.instantiate(Deno.readFileSync("code.wasm"), go.importObject);
let promise = go.run(wasm.instance);

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
- [x] fs.fstat
- [x] fs.unlink     (Uses `Deno.remove()`)
- [x] fs.rmdir     
- [x] fs.chmod     
- [x] fs.fchmod     (Not native API)
- [x] fs.chown     
- [x] fs.fchown     (Not native API)
- [ ] fs.lchown     (Deno does not support lchown.)
- [x] fs.utimes
- [x] fs.rename    
- [x] fs.truncate  
- [x] fs.ftruncate 
- [x] fs.readlink  
- [x] fs.link
- [x] fs.symlink
- [x] fs.fsync     
- [x] fs.read
- [x] fs.write

### Go Process implementation
As of now, Deno does not have ways to get the GID or umask.
- [x] process.getuid
- [x] process.getgid
- [ ] process.geteuid
- [ ] process.getegid
- [ ] process.getgroups
- [x] process.pid
- [x] process.ppid
- [x] process.umask (Unstable API)
- [x] process.cwd
- [x] process.chdir
