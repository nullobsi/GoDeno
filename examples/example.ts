import { Go } from "../mod.ts"

let go = new Go();
let inst = await WebAssembly.instantiate(Deno.readFileSync("code.wasm"), go.importObject);

let promise = go.run(inst.instance);

let value = go.exports.export1;
console.log("Go says: " + value);

