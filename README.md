# Cutout

Remove image backgrounds entirely in your browser. Images never leave your device: the model runs locally in a Web Worker (WebGPU when available, otherwise WASM).

The model (`onnx-community/BiRefNet_lite-ONNX`, MIT; roughly 100 to 220 MB depending on fp16 on WebGPU or fp32 on WASM) downloads once from Hugging Face on first visit and is cached by the browser.

## Develop

```
npm install
npm run dev
```

## Build and deploy

```
npm run build   # static files in dist/
npx vercel      # or connect the GitHub repo to Vercel
```

No server and no special headers are needed.
