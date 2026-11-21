<p align="center">
  <img src="public/og.png" alt="Cameo: lift anything off its background" width="720" />
</p>

<h1 align="center">Cameo</h1>

<p align="center">
  A free, open-source background remover that runs entirely in your browser.<br />
  Your photos never leave your device: no uploads, no accounts, no watermarks.
</p>

<p align="center"><a href="https://cameoapp.vercel.app"><strong>Open Cameo → cameoapp.vercel.app</strong></a></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/mikelisrael/cameo?style=flat-square" alt="MIT licence" /></a>
  <a href="https://github.com/mikelisrael/cameo/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/mikelisrael/cameo/ci.yml?branch=main&style=flat-square&label=checks" alt="Checks" /></a>
  <a href="https://github.com/mikelisrael/cameo/stargazers"><img src="https://img.shields.io/github/stars/mikelisrael/cameo?style=flat-square" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/runs-in%20your%20browser-c2410c?style=flat-square" alt="Runs in your browser" />
</p>
<p align="center">
  <a href="https://cameoapp.vercel.app">Open the app</a> ·
  <a href="https://cameoapp.vercel.app/how-it-works">How it works</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="docs/todo.md">Roadmap</a> ·
  <a href=".github/CONTRIBUTING.md">Contributing</a>
</p>

---

## Features

- **Cut out.** Drop, paste or pick photos, or take one with your camera. Add a whole batch. A rough cut-out shows at once, then the sharp one. Exports at full resolution. iPhone (HEIC) and AVIF photos open too.
- **Fix.** Erase and Restore brushes with smart edges. Tap an object to keep or remove it. Clean up a stray thing in the photo. Zoom, and undo or redo any step.
- **Finish.** Backgrounds: transparent, colours, gradients, a blurred copy of the photo or your own image. Contact and drop shadows. Match the subject's light to the background. Upscale small photos 2×.
- **Save.** PNG, WebP or JPG, and a ZIP for a batch. Size presets for 1:1, 4:5 and 9:16, passport and ID photos, and a WhatsApp sticker. The share sheet on phones.
- **Everywhere.** Works offline once set up and installs to your home screen. Light and dark themes with accent colours. Keyboard shortcuts (press `?`). Checked with a screen reader.
- **Private by design.** The model runs on your device in a Web Worker. Your photos are never sent to a server; the only thing sent is an anonymous count of visits and cut-outs ([GoatCounter](https://www.goatcounter.com), no cookies).

## How it works

1. **The model downloads once.** The first time you open Cameo, your browser downloads a neural network (BiRefNet, about 115–190 MB) from Hugging Face's CDN and caches it. Later visits load it from your disk.
2. **It runs on your device.** [Transformers.js](https://github.com/huggingface/transformers.js) runs the model with ONNX Runtime Web, on your GPU through WebGPU when the browser and GPU support it, otherwise on the CPU through WebAssembly.
3. **The model draws a mask.** For every pixel it estimates how much of it belongs to the subject. Cameo uses that mask as the image's transparency at full resolution.
4. **Backgrounds are painted on export.** Choosing a colour only fills behind the cut-out; nothing is processed again.

| Path | Model | Used when |
|---|---|---|
| GPU (WebGPU, fp16, else fp32) | [`onnx-community/BiRefNet_lite-ONNX`](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX), 1024 px | the GPU can run it (checked with a warm-up pass) |
| CPU (WebAssembly, fp32) | [`studioludens/birefnet-lite-512`](https://huggingface.co/studioludens/birefnet-lite-512), 512 px | no WebGPU, or the GPU can't run the larger model |

Smaller models load only when their feature is first used: [U-2-Netp](https://github.com/xuebinqin/U-2-Net) for the first rough cut-out, SlimSAM for tap-to-select, MI-GAN for clean up, Swin2SR for upscaling and YuNet for framing ID photos.

Both models are MIT-licensed. Cameo opens the GPU itself with the adapter's real limits (the model needs 17 storage buffers per shader stage, more than WebGPU's default), and tries fp16, then fp32. If the GPU still fails, it switches to the CPU path without reloading, remembers that for later visits, and offers "Try the graphics card again" under **About this device**. ONNX Runtime's WebAssembly files load from jsDelivr, so the site itself stays small.

Photos are decoded on the device too: PNG, JPG, WebP and AVIF by the browser, iPhone photos (HEIC/HEIF) by the browser where it can (Safari) and otherwise by [heic-to](https://github.com/hoppergee/heic-to), loaded only when one arrives. Very large photos are scaled to a working size (16.7 MP on iPhone and iPad, 24 MP elsewhere) so the device doesn't run out of memory.

## Run it locally

Needs Node 20+ and [pnpm](https://pnpm.io).

```sh
git clone https://github.com/mikelisrael/cameo.git
cd cameo
pnpm install
pnpm dev
```

Open the URL Vite prints (usually http://localhost:5173).

| Command | What it does |
|---|---|
| `pnpm dev` | development server |
| `pnpm check` | typecheck, formatting check, production build and the first-screen size budget: run before every pull request |
| `pnpm build` | typecheck, then a static build in `dist/` |
| `pnpm preview` | serve the production build locally |
| `pnpm lint` | lint with oxlint |
| `pnpm e2e` | build, then run the Playwright test of the core flow |
| `pnpm format` | format `src/`, `e2e/` and the Playwright config with Prettier |

## Deploy

It's a static site: no server, no API keys, no special headers.

- **Vercel:** import the repo; the defaults (Vite, `pnpm build`, output `dist`) work as is.
- **Anywhere else:** run `pnpm build` and serve `dist/`.

## Project layout

```
src/
  App.tsx                         the screens and state
  components/                     Editor, Compare slider, Queue, Toolbar, EditBar, How it works, icons
  lib/useRemover.ts               talks to the worker, queues images
  lib/compose.ts                  applies the mask and exports
  lib/decode.ts                   opens photos (HEIC/AVIF too) and caps their size
  lib/refine.ts                   full-resolution edge clean-up
  lib/gpu/                        the same clean-up on WebGPU
  lib/brush.ts, history.ts        Erase/Restore strokes and undo
  lib/background.ts               colours, gradients, blurred and own-image backgrounds
  lib/relight.ts                  match the subject's light to the background
  lib/upscale.ts, yunet.ts        upscaling and the ID-photo face finder
  lib/count.ts                    the anonymous visit and cut-out count
  lib/useTheme.ts, useAccent.ts   light / dark / auto and accent colour
  worker/removeBackground.worker.ts   loads the model, picks GPU or CPU, runs it
  worker/                         the other workers: draft, segment, inpaint, upscale, face
  bench/                          the ?bench page for judging edges
e2e/core-flow.spec.ts             Playwright test: drop, cut out, background, download
scripts/check-budget.mjs          fails the check if the first screen grows past 100 kB
public/models/                    self-hosted models with their licences
docs/
  design/DESIGN_SYSTEM.md         colours, type, motion, the checklist for anything new
  todo.md                         the roadmap
.github/                          contributing guide, issue forms, pull request template, CI
```

## Roadmap

The phases to make Cameo state of the art (sharper edges on large photos, erase/restore brushes, shadows, size presets, stickers, offline support and more) are in [`docs/todo.md`](docs/todo.md).

## Contributing

Issues and pull requests are welcome: see [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) for how to set up, what to check and what makes a change easy to merge.
The one promise to keep: **no feature may upload a user's image** or send image data anywhere.

## Security

To report a vulnerability, read [`SECURITY.md`](SECURITY.md) and report it privately.

## Credits

- [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) by Zheng Peng et al. (MIT)
- [U-2-Net](https://github.com/xuebinqin/U-2-Net) by Xuebin Qin et al. (Apache-2.0), as the U-2-Netp ONNX conversion by [BritishWerewolf](https://huggingface.co/BritishWerewolf/U-2-Netp), for the first rough cut-out
- [MI-GAN](https://github.com/Picsart-AI-Research/MI-GAN) by Picsart AI Research (MIT), for clean up
- [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) from the OpenCV Model Zoo, by Wei Wu and Shiqi Yu (MIT), for ID photo framing
- [SlimSAM](https://huggingface.co/Xenova/slimsam-77-uniform) for tap-to-select and [Swin2SR](https://huggingface.co/Xenova/swin2SR-lightweight-x2-64) for upscaling, both as ONNX conversions by Xenova on Hugging Face
- [fflate](https://github.com/101arrowz/fflate) (MIT) for ZIP downloads
- [GoatCounter](https://www.goatcounter.com) for the anonymous visit and cut-out count
- [Transformers.js](https://github.com/huggingface/transformers.js) and [ONNX Runtime Web](https://onnxruntime.ai)
- [heic-to](https://github.com/hoppergee/heic-to) with [libheif](https://github.com/strukturag/libheif) (LGPL-3.0), loaded as a separate file only when a HEIC photo is opened
- Fonts: [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque) and [Geist](https://vercel.com/font) (SIL Open Font License)

## License

[MIT](LICENSE)
