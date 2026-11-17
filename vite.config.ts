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

// Same headers as vercel.json, so dev matches production: ORT only runs WASM on several threads when cross-origin isolated.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dropOrtWasm()],
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es', plugins: () => [dropOrtWasm()] },
})
