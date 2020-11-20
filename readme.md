# GoDeno
A simple port of Golang's JS/WASM glue code to Deno in TypeScript.
Credit to the Go team for their amazing work on getting Go working in WASM!

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