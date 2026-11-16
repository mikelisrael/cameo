import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// ORT's bundle holds a `new URL('ort-wasm*.wasm', import.meta.url)` that Vite follows and copies (27 MB).
// At runtime transformers.js points ORT at the same files on jsDelivr, so the copy is never used: drop it.
function dropOrtWasm(): Plugin {
  return {
    name: 'drop-ort-wasm',
    generateBundle(_, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/ort-wasm[^/]*\.wasm$/.test(name)) delete bundle[name]
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dropOrtWasm()],
  worker: { format: 'es', plugins: () => [dropOrtWasm()] },
})
