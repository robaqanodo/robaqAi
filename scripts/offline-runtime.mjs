import {mkdir, copyFile} from 'node:fs/promises'
await mkdir('public/offline-runtime', {recursive:true})
await copyFile('node_modules/@wllama/wllama/esm/wasm/wllama.wasm','public/offline-runtime/wllama.wasm')
await copyFile('node_modules/@wllama/wllama-compat/wasm/wllama.wasm','public/offline-runtime/compat.wasm')
