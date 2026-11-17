import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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

// Headroom over the largest precached file (the workers, ~540 KiB).
const MAX_PRECACHE_BYTES = 2 * 1024 * 1024

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    dropOrtWasm(),
    // Precaches the app shell so Cameo opens offline; a new deploy waits until every tab is closed.
    // The models are not cached here: transformers.js keeps them in its own cache.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false, // registered in code: see main.tsx
      manifest: false, // keep public/manifest.webmanifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Lazy chunks nobody needs up front (HEIC decoder, dev bench page): cached at runtime once used.
        globIgnores: ['**/heic-to-*.js', '**/Bench-*.js', '**/og.png'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: MAX_PRECACHE_BYTES,
        runtimeCaching: [
          {
            // Lazy chunks left out of the precache; hashed names make CacheFirst safe.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-chunks',
              expiration: { maxEntries: 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // The 4.6 MB first-look model, self-hosted; the big model is cached by transformers.js.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/models/'),
            handler: 'CacheFirst',
            options: { cacheName: 'draft-model', cacheableResponse: { statuses: [200] } },
          },
          {
            // ORT's JS glue only: transformers.js caches the ~20 MB WASM itself.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web.*\.mjs$/,
            handler: 'CacheFirst',
            options: { cacheName: 'ort-runtime', cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es', plugins: () => [dropOrtWasm()] },
})
