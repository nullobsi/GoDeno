# GoDeno
A simple port of Golang's JS/WASM glue code to Deno in TypeScript.
Credit to the Go team for their amazing work on getting Go working in WASM!

Requires `--unstable` flag. Permissions flags are also required for filesystem usage.

## Usage
1. Create a new `Go` class
2. Create a new WASM instance with the `importObject` on the new `Go` object.
3. Run `go.run(wasmInstance)` with your WASM instance.

Example Code:
```ts
import Go from "mod.ts"

let go = new Go();
let inst = await WebAssembly.instantiate(Deno.readFileSync("code.wasm"), go.importObject);
let promise = go.run(inst);

let value = go.exports.coolFunction();
console.log("Go returned: " + value);
```

The `exports` object is whatever the Go program set on the global scope.

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