# To do

The roadmap to a state-of-the-art Cameo, written 16 November 2026 from an analysis of the first look (branch `israel/first-look`) and of what the leading tools do. Jarvis takes items top to bottom. Each phase is shippable on its own; don't start a phase before the one above it is merged and deployed.

## Where it stands

**Strong:** private by design (nothing uploaded), no running cost, a calm UI with every state drawn, full-resolution export, batch queue, background colours, reset/remove.

**Weak, in order of how much it hurts:**
1. **Edge quality on big photos.** The mask is predicted at 1024px (512px on the CPU path) and stretched to the photo's size, so a 3200×4000 portrait gets soft hair and halo edges. This is the gap between us and Photoroom/remove.bg. Better since 18 Nov 2026 (mask rounded so the inside is solid, edge band tightened after colour clean-up: a ~25 px blur became a crisp line), and since #31 the outline is hard where subject and background are alike. Going further (an on-demand HD pass on edge crops: too slow by default on the CPU path, and it punched holes in hair) needs Israel's call.
2. **Many machines land on the slow CPU path** (Israel's did), with the 512px model: slower and blurrier. We don't know why, because nothing records it.
3. **No way to fix a mistake.** Every serious tool has erase/restore brushes (Adobe Express, remove.bg's Magic Brush, Photoroom).
4. **iPhone photos (HEIC) are rejected,** which is most of what friends will drop.
5. **Not deployed:** no GitHub remote, no Vercel, and a 27 MB WASM file in the bundle.
6. **Output stops at a PNG.** No shadow, no sizes for where the picture is going, no sticker/WebP, no ZIP for a batch.

## Standing rule: mobile-native, every phase

Israel, 16 Nov 2026: "make sure it is mobile native". Most friends will use it on a phone, so every item below is designed and checked at phone width first: thumb-reach actions in a bottom bar, 44px touch targets, no hover-only controls, safe-area insets, the system share sheet for saving, the camera as an input, and an installable home-screen app. A screen isn't done until it has been seen at 390px.

## Phase 0: ship it (foundation)

- [x] Mobile-native basics: sticky bottom save bar on phones, share-sheet save, take-a-photo input, web app manifest + icons + iOS meta, 44px targets, safe areas, no tap flash or double-tap zoom.
- [x] Make `og:image` an absolute URL once the Vercel domain is known (some apps ignore a relative one).

- [x] GitHub repo (github.com/mikelisrael/cameo), open source under MIT.
- [x] Vercel connected to `main`.
- [x] Load ONNX Runtime's WASM from the CDN instead of bundling it (`env.backends.onnx.wasm.wasmPaths`), so the deploy is small.
- [x] Device diagnostics: a small "About this device" line or popover (GPU name, limits, which path and why, model in use), and a "Try graphics acceleration again" action that clears `cutout:force-wasm`. No image data, ever.
- [x] (Cause: ONNX Runtime opened the device without `maxStorageBuffersPerShaderStage`, so it got WebGPU's default; we now pass our own device with the adapter's limits through the WebGPU EP option.) Find out why Israel's GPU failed: request the adapter's real limits when creating the WebGPU device (ONNX Runtime may be asking for defaults), and try fp32 on WebGPU before falling back to CPU.
- [x] HEIC/HEIF input (decode in the worker with a WASM decoder; check its licence). Also AVIF.
- [x] Very large images: cap the working size (e.g. 24 MP) with a clear note, so phones don't crash.
- [x] (Done better: no reload any more; a fresh CPU worker picks up the queue.) After a GPU fallback reload, say so ("Switched to the slower mode, add your images again") instead of an empty screen.
- [x] Brand colour (persimmon) and a neutral dark mode with a header switch, no flash on load.

## Phase 1: edges as good as the best (quality)

- [x] **A benchmark page:** `?bench` shows original | model only | refined over a chosen background, with an edge zoom and sliders for the refinement. It takes Israel's own folder of photos (products on clutter, hair, fur, glass, jewellery, people at night, low light, flat lays) rather than 30 bundled stock photos: no licences to track, and his real photos are the test that matters. Still owed: collect the folder once and judge the defaults on it.
- [x] **Full-resolution edge refinement:** fast colour guided filter (He et al.) in the worker, in plain JS (`src/lib/refine.ts`). On a synthetic hair test, edge error drops 12% (GPU 1024 mask) and 16% (CPU 512 mask). Costs about 2–3.5 s on a 12 MP photo. A luma-only guide made things worse (it can't see a red subject on a green wall); keep the colour guide.
- [x] **Colour decontamination:** blur-fusion foreground estimation (Forte & Pitié 2021), as pymatting does it. On the synthetic test the green bleed in edge pixels goes from G 124 to 61 (true 60).
- [ ] ~~Tiled high-resolution inference~~ Not built (2026-11-16): a salient-object model on crops loses the whole-picture context and mislabels tiles, and the full-res refinement gives the edge resolution tiling was for. BiRefNet_HR has no public ONNX. Revisit if one appears.
- [ ] ~~Model by subject~~ Not built (2026-11-16): no BiRefNet-matting or HR in ONNX; portrait/full are 467 MB fp16 downloads (4x lite) under MIT. Revisit with the bench if a matting ONNX appears.
- [ ] CPU path: still 512 lite (the refinement recovers much of what 512 loses). 1024 on WASM needs measuring on a real phone first.
- [x] (Done: pass 1 always at least 2× coarse, its buffers freed before pass 2; same edges within 1 level.) Optional from review: decontaminate's pass 1 isn't downsampled for photos under 2048 px (`d = floor(long/1024)`), so it holds ~18 full-size arrays there; use `d = max(2, ceil(long/1024))` and free pass-1 temporaries.

## Phase 2: fix what the model got wrong (control)

- [x] Zoom and pan in Edit (wheel, pinch, + / −, Fit; double-click fits with Move). Compare keeps its slider and doesn't zoom.
- [x] **Erase / Restore brushes** with size and softness on the mask (`src/lib/brush.ts`, `src/components/Editor.tsx`). "Smart edges" snaps a stroke to the photo: colours under the stroke's centre vs. the kept/removed colours around it, then a colour guided filter; erase never adds, restore never removes.
- [x] **Click to keep / click to remove:** the Select tool (Keep | Remove) taps an object; SlimSAM (`Xenova/slimsam-77-uniform`, q8, ~14 MB, CPU) runs in its own lazy worker (`src/worker/segment.worker.ts`, `src/lib/useSegmenter.ts`), the mask is snapped to the photo with the Phase 1 guided filter, one undo step per tap.
- [x] A tap racing the eviction of its own image's embedding (3+ images, quick switching) now re-embeds and retries once (`useSegmenter.ts`).
- [x] The editor refits on resize or rotation while the view is at Fit (a tap no longer counts as moving the view).
- [x] Undo/redo for every brush stroke, background change and Reset (`src/lib/history.ts`, per image, capped at 60 steps / 150 MB). Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl+Y.
- [x] Hold Space, or press and hold Before, to see the original in Edit. Keys in Edit: E erase, R restore, V/H move, [ ] size, + − 0 zoom.
- [x] iOS canvas limits: the working size is capped at 16.7 MP on Apple devices (`decode.ts`, since Phase 0; iOS 18 allows 67 MP, kept low for older iOS), and temporary full-size canvases are released as soon as they're used (iOS also caps total canvas memory).
- [x] Edit → Compare never shows the previous cut-out: Compare waits for the current version, and the editor (inert) stays up meanwhile.

## How it works (Israel, 17 November 2026: "intuitive and responsive, alive and not ai slop")

- [x] (Done: `/how-it-works`, opened in-app so photos are kept; one drawn persimmon in five scroll-driven frames.) A "How it works" page, reached from the header and the footer: what happens to a photo, step by step (it opens on your device, the model finds the subject, the edges are cleaned, you fix with brushes, you download), shown with the app's own drawing, not stock icons. Says plainly what's stored (the model, two settings) and what never leaves the device. Alive means it moves as you scroll or tap, at phone width first; reduced motion rests at the end state. No feature grid, no "AI-powered ✨".

## Speed (Israel, 17 November 2026: do 1 and 5 now, keep the rest)

- [x] (Done: `require-corp`, not `credentialless`, which Safari lacks; every cross-origin load here is CORS. 4 threads seen in a preview.) **Multithreaded WASM:** send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy` (try `credentialless` first, so the Hugging Face and CDN downloads keep working) from a `vercel.json`, so the page is cross-origin isolated and ONNX Runtime's CPU path uses several threads instead of one (today there is no `vercel.json`, so it runs single-threaded). Check `crossOriginIsolated` and the thread count in "About this device"; expect 2–4× on the CPU path.
- [x] (Already in place: the worker loads on mount and the GPU path runs a warm-up.) **Warm start:** begin the model download and session setup while the drop screen shows, so the first photo doesn't wait for it.
- Saved for later, best first:
  - [ ] ~~An int8 (quantized) CPU model~~ Not built (2026-11-19): measured on the 512 CPU model with onnxruntime-web WASM (Node, 4 threads; fp32 21.8 s). The only accurate int8 (dynamic, MatMul + Conv, QInt8 weights, IoU ≥ 0.975 on 8 photos) ran 3.4× slower (75 s). The faster ones broke: dynamic MatMul-only QUInt8 (−12%) and static QDQ (−37%) gave near-empty masks on some photos (IoU 0). Nobody publishes an int8 of this model. Revisit if ORT-web gains fast int8 conv kernels, or try the existing fp16 file (98.5 MB, half the download) if download size is the pain rather than speed.
  - [x] (Done 2026-11-19: `src/lib/gpu/`, own GPU device, JS as the silent fallback; 12 MP clean-up ~1 s vs 3–5 s on an Iris Xe that runs the model on the CPU; About this device says "on the GPU" / "on the CPU".) Run the Phase 1 edge refinement as WebGPU compute (saves ~2–3 s on 12 MP).
  - [ ] ~~ORT `allow_spinning = '0'` on the WASM path~~ Not built (2026-11-19): measured in the app on this laptop (12 MP, model on WASM with 4 threads, clean-up on the GPU, 5 runs each). A second clean-up run straight after the first takes as long as the first (A 732 vs 817 ms), so nothing left over from inference slows it. Spinning off: clean-up 636 ms, cut-out 12.1 s vs 12.8 s, inside the noise. The cut-out ran at 10–14 s, far above normal, so the machine was busy, and the in-app vs alone gap is most likely that load rather than the app. Revisit only with a profile on a quiet machine.
  - [x] (Done 2026-11-19: the page opens the next queued photo while the current one is in the worker, one ahead at most, in `useRemover.ts`; ~0.5 s per 27 MP JPEG, more for HEIC.) Batch overlap: decode the next photo while the model runs on the current one (lower value now that drafts show at once).
  - [x] (Done 2026-11-19: the next photo's first look is made while the current one is in the model, in `useRemover.ts`; at its turn it shows at once and the sharp model starts without the head start.) In a batch, each photo after the first waits up to 2.5 s (`DRAFT_HEAD_START_MS`) for its first look before the sharp model starts, so on the CPU path the model idles ~2.5 s per photo (measured 2026-11-19, 3 × 27 MP on WASM). Israel's call (2026-11-19): make the next photo's first look while the current one is in the model.
  - [x] (Done 2026-11-17: "About this device" shows start-up and each photo's prep / cut-out / clean-up; a rough U-2-Netp cut-out (4.6 MB, self-hosted) shows first and crossfades to the sharp one; clean-up runs only near the edges, exactly; the model download retries and resumes, with Try again.) Lightning cut-outs.
  - [ ] More machines on the GPU path: GPUs with under 33 storage buffers (Intel Iris Xe class) can't run BiRefNet on WebGPU (ORT's Split kernel binds 1+32 outputs). A graph rewrite runs but was slower than WASM on Intel gen-12lp, and fp16 WebGPU gave a wrong mask there: check fp16 on other GPUs before trusting it.

## Phase 3: a picture ready for where it's going (output)

- [x] **Shadows:** Contact (soft oval under the base) and Drop (the subject's own shape, with angle), strength slider; in Compare, the size preview and every saved file; renders wait 200 ms so sliders don't stutter.
- [x] **More backgrounds:** blurred photo (portrait-mode look), Studio / Sky / Sunset gradients, your own image (kept in memory only), all through undo like a colour (`src/lib/background.ts`).
- [x] Optional from review: the background image picker uses `accept="image/*"`; use `ACCEPT_ATTR` so HEIC/AVIF files without a MIME type aren't greyed out on Windows. A pick that finishes after Start over should be dropped.
- [x] **Crop and size presets:** Whole · Fit (trimmed to the subject with room) · 1:1 (1080, shops) · 4:5 (1080×1350, Instagram post) · 9:16 (1080×1920, story/status), subject centred on the chosen background, a preview in the panel; download, share and ZIP use it.
- [x] Passport photo preset. Israel (2026-11-19): "full auto pilot", so Jarvis picks the rules (leaning: 35×45 mm, the most common, and 2×2 in). Done: Size → ID, 35×45 mm or 2×2 in, one photo or a 10×15 cm sheet, framed from an on-device face finder (YuNet), saved at 300 dpi with why-lines.
- [x] **Sticker export:** "Download as sticker": 512×512 WebP (PNG where WebP can't be made), 16 px margin, ≤100 KB; shares on phones. (outline dropped 2026-11-17 at Israel's request)
- [x] Formats: PNG, WebP (where the browser can encode it), JPG (white when the background is clear); **download all as ZIP** (fflate, stored); the current background and format apply to the whole batch, each image with its own edits.
- [x] Share straight to apps (Web Share API) on phones: "Save or share" since Phase 0, now in every format.

## Phase 4: feels like an app (polish)

- [x] Works offline once the model is cached (vite-plugin-pwa: app shell precached, fonts and the ORT runtime cached on use; a new version waits until every Cameo tab is closed, never swapped under an open one).
- [x] Workers now handle `onerror`: a worker that fails to start shows the error banner (Reload) or Select's Try again, and pending images go to their error state.
- [x] Pinch-zoom on the stage, swipe between images, haptic tick on Android when a cut-out finishes. (Haptic tick done. Swipe and pinch on the stage not built: Compare's slider drags across the whole stage, and Compare deliberately doesn't zoom; Edit already pinches.)
- [x] Keyboard shortcuts (paste, download, next/previous image, brush keys) with a cheat sheet.
- [x] Accessibility audit (screen reader pass through the whole flow, focus order, reduced motion). Done 2026-11-17: one polite announcer, named slider and canvas, workspace h1, axe clean in both themes. The Edit brush stays pointer-only (freehand painting).
- [x] (Done: `pnpm e2e`, CI on every PR, #25.) Playwright e2e for the core flow (drop → cut-out → background → download) running on the CPU path, so CI needs no GPU.
- [x] (Done 2026-11-17: first screen 90.6 kB gzip, guarded by `scripts/check-budget.mjs` in `pnpm check`; the Editor loads on demand, prefetched after the first cut-out; the download bar weighs only model weights and never moves back; "Start-up" counts from opening the page.) Performance budget: first screen under 100 KB of JS, model download progress honest, warm start under 3 s.
- [ ] Counting usage without images (page views and "cut-out made" counts only), Israel (2026-11-19): "as long as it doesn't cost me do the best": a free, cookieless counter with no image data, checked against the privacy rule first.

## Phase 5: beyond the others (state of the art)

Each of these needs a decision from Israel first, because they cost download size or break "nothing is uploaded".

- [ ] **Object removal / clean-up** (erase a stray thing from the photo) with an on-device inpainting model (LaMa in ONNX).
- [ ] **Upscaling** small product photos (Swin2SR in transformers.js). Israel chose this as the next Phase 5 item (2026-11-19).
- [ ] **AI backgrounds** (product in a generated scene, Photoroom's headline feature): on-device diffusion is heavy; a server would break the privacy promise. Decide the trade-off before any work.
- [ ] Relighting the subject to match a new background.
- [ ] Video background removal (short clips, on-device).

## Notes from the research

- Photoroom's 2026 headline features: batch editing, instant shadows that follow the light, AI backgrounds, retouch, resize presets for marketplaces.
- remove.bg's strength is hair, plus a Magic Brush to paint edges back; its standalone site is reported to close on 1 December 2026 as it moves into Canva/Leonardo (not verified on remove.bg itself). A good moment for a free, private alternative among friends.
- Adobe Express: restore/erase brushes after removal. Canva: convenient, rougher on hair.
- Browser tools mostly use RMBG-1.4 (non-commercial licence) or BiRefNet (~200 MB) on WebGPU with a WASM fallback; ONNX Runtime WebGPU is reported up to 20× faster than multi-threaded WASM (img.ly).
