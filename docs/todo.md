# To do

The roadmap to a state-of-the-art Cutout, written 16 November 2026 from an analysis of the first look (branch `israel/first-look`) and of what the leading tools do. Jarvis takes items top to bottom. Each phase is shippable on its own; don't start a phase before the one above it is merged and deployed.

## Where it stands

**Strong:** private by design (nothing uploaded), no running cost, a calm UI with every state drawn, full-resolution export, batch queue, background colours, reset/remove.

**Weak, in order of how much it hurts:**
1. **Edge quality on big photos.** The mask is predicted at 1024px (512px on the CPU path) and stretched to the photo's size, so a 3200×4000 portrait gets soft hair and halo edges. This is the gap between us and Photoroom/remove.bg.
2. **Many machines land on the slow CPU path** (Israel's did), with the 512px model: slower and blurrier. We don't know why, because nothing records it.
3. **No way to fix a mistake.** Every serious tool has erase/restore brushes (Adobe Express, remove.bg's Magic Brush, Photoroom).
4. **iPhone photos (HEIC) are rejected,** which is most of what friends will drop.
5. **Not deployed:** no GitHub remote, no Vercel, and a 27 MB WASM file in the bundle.
6. **Output stops at a PNG.** No shadow, no sizes for where the picture is going, no sticker/WebP, no ZIP for a batch.

## Standing rule: mobile-native, every phase

Israel, 16 Nov 2026: "make sure it is mobile native". Most friends will use it on a phone, so every item below is designed and checked at phone width first: thumb-reach actions in a bottom bar, 44px touch targets, no hover-only controls, safe-area insets, the system share sheet for saving, the camera as an input, and an installable home-screen app. A screen isn't done until it has been seen at 390px.

## Phase 0: ship it (foundation)

- [x] Mobile-native basics: sticky bottom save bar on phones, share-sheet save, take-a-photo input, web app manifest + icons + iOS meta, 44px targets, safe areas, no tap flash or double-tap zoom.
- [ ] Make `og:image` an absolute URL once the Vercel domain is known (some apps ignore a relative one).

- [x] GitHub repo (github.com/mikelisrael/cutout), open source under MIT.
- [ ] Vercel connected to `main`.
- [ ] Load ONNX Runtime's WASM from the CDN instead of bundling it (`env.backends.onnx.wasm.wasmPaths`), so the deploy is small.
- [ ] Device diagnostics: a small "About this device" line or popover (GPU name, limits, which path and why, model in use), and a "Try graphics acceleration again" action that clears `cutout:force-wasm`. No image data, ever.
- [ ] Find out why Israel's GPU failed: request the adapter's real limits when creating the WebGPU device (ONNX Runtime may be asking for defaults), and try fp32 on WebGPU before falling back to CPU.
- [ ] HEIC/HEIF input (decode in the worker with a WASM decoder; check its licence). Also AVIF.
- [ ] Very large images: cap the working size (e.g. 24 MP) with a clear note, so phones don't crash.
- [ ] After a GPU fallback reload, say so ("Switched to the slower mode, add your images again") instead of an empty screen.
- [x] Brand colour (persimmon) and a neutral dark mode with a header switch, no flash on load.

## Phase 1: edges as good as the best (quality)

- [ ] **A benchmark set first:** ~30 photos (products on clutter, hair, fur, glass, jewellery, people at night, low light, flat lays) with a side-by-side page, so every quality change is judged on the same images, not one portrait.
- [ ] **Full-resolution edge refinement:** a guided-filter (or fast matting) pass that uses the original photo to sharpen the upscaled mask, on the GPU via WebGPU compute or in the worker. Biggest single gain for hair.
- [ ] **Colour decontamination:** remove the old background's colour bleeding into edge pixels (green stage light on a shoulder), so cut-outs sit cleanly on new backgrounds.
- [ ] **Tiled high-resolution inference** for large photos on the GPU path (or BiRefNet_HR at 2048), with the 1024 pass as a guide.
- [ ] **Model by subject:** try BiRefNet-matting (hair, fur) and BiRefNet-portrait against the benchmark set; licence check each (MIT only, no RMBG/ISNet).
- [ ] CPU path: replace 512px BiRefNet with whatever wins on the benchmark within WASM's memory (fp16 1024, or a quantized model).

## Phase 2: fix what the model got wrong (control)

- [ ] Zoom and pan on the stage (wheel/pinch, double-click to fit).
- [ ] **Erase / Restore brushes** with size and softness, painting on the mask, edge-aware "smart brush" mode that snaps to the photo's edges.
- [ ] **Click to keep / click to remove:** point prompts with a small segmentation model (SlimSAM in transformers.js) to add or drop a whole object in one click.
- [ ] Undo/redo for every mask edit and setting.
- [ ] Before/after toggle (hold Space) in addition to the slider.

## Phase 3: a picture ready for where it's going (output)

- [ ] **Shadows:** soft contact shadow and drop shadow, made on-device from the mask, with strength and angle.
- [ ] **More backgrounds:** your own image, the original blurred (portrait-mode look), gradients.
- [ ] **Crop and size presets:** fit to subject with padding; Instagram post/story, WhatsApp status, square 1080 for marketplaces (Jumia, Shopify, Etsy), passport photo.
- [ ] **Sticker export:** white outline + WebP 512×512 for WhatsApp stickers.
- [ ] Formats: PNG, WebP, JPG (with chosen background); **download all as ZIP**; settings apply to the whole batch.
- [ ] Share straight to apps (Web Share API) on phones.

## Phase 4: feels like an app (polish)

- [ ] Works offline once the model is cached (service worker; the installable manifest lands in Phase 0).
- [ ] Pinch-zoom on the stage, swipe between images, haptic tick on Android when a cut-out finishes.
- [ ] Keyboard shortcuts (paste, download, next/previous image, brush keys) with a cheat sheet.
- [ ] Accessibility audit (screen reader pass through the whole flow, focus order, reduced motion).
- [ ] Playwright e2e for the core flow (drop → cut-out → background → download) running on the CPU path, so CI needs no GPU.
- [ ] Performance budget: first screen under 100 KB of JS, model download progress honest, warm start under 3 s.
- [ ] Counting usage without images (page views and "cut-out made" counts only), if Israel wants numbers; check it against the privacy rule first.

## Phase 5: beyond the others (state of the art)

Each of these needs a decision from Israel first, because they cost download size or break "nothing is uploaded".

- [ ] **Object removal / clean-up** (erase a stray thing from the photo) with an on-device inpainting model (LaMa in ONNX).
- [ ] **Upscaling** small product photos (Swin2SR in transformers.js).
- [ ] **AI backgrounds** (product in a generated scene, Photoroom's headline feature): on-device diffusion is heavy; a server would break the privacy promise. Decide the trade-off before any work.
- [ ] Relighting the subject to match a new background.
- [ ] Video background removal (short clips, on-device).

## Notes from the research

- Photoroom's 2026 headline features: batch editing, instant shadows that follow the light, AI backgrounds, retouch, resize presets for marketplaces.
- remove.bg's strength is hair, plus a Magic Brush to paint edges back; its standalone site is reported to close on 1 December 2026 as it moves into Canva/Leonardo (not verified on remove.bg itself). A good moment for a free, private alternative among friends.
- Adobe Express: restore/erase brushes after removal. Canva: convenient, rougher on hair.
- Browser tools mostly use RMBG-1.4 (non-commercial licence) or BiRefNet (~200 MB) on WebGPU with a WASM fallback; ONNX Runtime WebGPU is reported up to 20× faster than multi-threaded WASM (img.ly).
