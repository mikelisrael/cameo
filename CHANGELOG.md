# Changelog

All notable changes to Cameo are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-21

The first public version.

### Added

- Remove a background in the browser, on your own device, from dropped, pasted, picked or camera photos, with a batch queue ([#1](https://github.com/mikelisrael/cameo/pull/1)).
- iPhone (HEIC) and AVIF photos, a smaller site, and a GPU path that uses the graphics card's real limits ([#3](https://github.com/mikelisrael/cameo/pull/3)).
- Sharper edges at full size and no colour fringe, plus a `?bench` page for judging edges ([#5](https://github.com/mikelisrael/cameo/pull/5)).
- Erase and Restore brushes with smart edges, zoom and undo ([#6](https://github.com/mikelisrael/cameo/pull/6)).
- Tap an object to keep or remove it with the Select tool ([#7](https://github.com/mikelisrael/cameo/pull/7)).
- A How it works page ([#11](https://github.com/mikelisrael/cameo/pull/11)).
- Save as PNG, WebP or JPG, and download every cut-out as a ZIP ([#13](https://github.com/mikelisrael/cameo/pull/13)).
- Size presets: whole, fit to subject, square, 4:5 and 9:16 ([#14](https://github.com/mikelisrael/cameo/pull/14)).
- More backgrounds: a blurred copy of the photo, gradients and your own image ([#15](https://github.com/mikelisrael/cameo/pull/15)).
- Soft contact shadows and drop shadows made from the cut-out ([#16](https://github.com/mikelisrael/cameo/pull/16)).
- Download a cut-out as a WhatsApp sticker ([#17](https://github.com/mikelisrael/cameo/pull/17)).
- Offline use once Cameo has been set up ([#18](https://github.com/mikelisrael/cameo/pull/18)).
- A short haptic tick on Android when a cut-out finishes ([#20](https://github.com/mikelisrael/cameo/pull/20)).
- Keyboard shortcuts with a cheat sheet, opened with `?` ([#21](https://github.com/mikelisrael/cameo/pull/21)).
- An "About this device" popover and a screen-reader and phone-layout pass ([#23](https://github.com/mikelisrael/cameo/pull/23)).
- A rough cut-out shown at once, then the sharp one, with edge clean-up only near the edges ([#26](https://github.com/mikelisrael/cameo/pull/26)).
- Dark mode in a deep plum-black ([#27](https://github.com/mikelisrael/cameo/pull/27)).
- An Appearance popover with accent colours, each with its own palette ([#28](https://github.com/mikelisrael/cameo/pull/28)).
- A passport and ID photo preset ([#38](https://github.com/mikelisrael/cameo/pull/38)).
- Anonymous counts of page views and cut-outs, with no image data ([#39](https://github.com/mikelisrael/cameo/pull/39)).
- Match the subject's light to its new background ([#41](https://github.com/mikelisrael/cameo/pull/41)).
- Upscale small photos 2× on the device ([#42](https://github.com/mikelisrael/cameo/pull/42)).
- Clean up stray things in a photo with an on-device fill ([#43](https://github.com/mikelisrael/cameo/pull/43)).

### Changed

- The project is named Cameo ([#4](https://github.com/mikelisrael/cameo/pull/4)).
- The CPU path runs on several threads ([#10](https://github.com/mikelisrael/cameo/pull/10)).
- Edge clean-up uses far less memory on mid-size photos ([#12](https://github.com/mikelisrael/cameo/pull/12)).
- A smaller first screen, an honest download bar and a warm start from page open ([#29](https://github.com/mikelisrael/cameo/pull/29)).
- Edge clean-up runs on the GPU, with the CPU as a fallback ([#32](https://github.com/mikelisrael/cameo/pull/32)).
- Sharper edges where the subject and background look alike ([#31](https://github.com/mikelisrael/cameo/pull/31)).
- The next photo of a batch gets its first look while the current one is in the model ([#34](https://github.com/mikelisrael/cameo/pull/34), [#37](https://github.com/mikelisrael/cameo/pull/37)).
- Loading thumbnails can be clicked, and the photo stays in the strip ([#36](https://github.com/mikelisrael/cameo/pull/36)).
- A wider layout so the side panel has room ([#45](https://github.com/mikelisrael/cameo/pull/45)).

### Fixed

- Editor zooms glide, a tap refits the view, Compare is never stale and Select can retry ([#8](https://github.com/mikelisrael/cameo/pull/8), [#9](https://github.com/mikelisrael/cameo/pull/9)).
- The background image picker takes HEIC and AVIF, and a pick that lands after Start over is dropped ([#24](https://github.com/mikelisrael/cameo/pull/24)).
- The drop card is centred on phones ([#25](https://github.com/mikelisrael/cameo/pull/25)).
- Cameo says so when a worker cannot start, instead of waiting forever ([#19](https://github.com/mikelisrael/cameo/pull/19)).
- No error flash, a quicker Compare, and the whole window takes a drop ([#30](https://github.com/mikelisrael/cameo/pull/30)).

[Unreleased]: https://github.com/mikelisrael/cameo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mikelisrael/cameo/releases/tag/v0.1.0
