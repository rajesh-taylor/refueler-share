import * as wasm from "./blake3_wasm_bg.wasm";
import { __wbg_set_wasm } from "./blake3_wasm_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    hash
} from "./blake3_wasm_bg.js";
