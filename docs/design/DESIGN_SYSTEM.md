# Cameo design system

Cameo is a tool people open, use for thirty seconds and close. The look gets out of the way: a quiet, warm page, a white sheet that holds the photo, and one colour used sparingly. The photo is always the most colourful thing on screen.

## 1. Principles

1. **The photo is the hero.** Chrome is neutral so the image reads first. Nothing coloured sits behind or around the photo except the transparency checkerboard and the backgrounds the person picks.
2. **Persimmon is the brand colour.** It fills the main action (Choose images, Download), marks progress, selection and focus, and tints the drop sheet. Text on it uses `--brand-ink`; brand-coloured text uses `--brand-text`.
3. **Opens straight into the tool.** No marketing hero, no feature grid, no "AI-powered ✨". The first screen is the drop sheet.
4. **One delight moment: the reveal.** When a cut-out arrives, the divider sweeps in from the right and the background falls away. Nothing else animates for show.
5. **Privacy is said plainly:** images never leave the device.

## 2. Tokens

All colours are CSS custom properties in `src/styles.css`: light on `:root`, dark on `:root[data-theme='dark']`. The theme is set before first paint by the script in `index.html` (saved choice in `localStorage` `cutout:theme`, else the system's) and changed with the switch in the header (`src/lib/useTheme.ts`). Use these tokens only; no new colours. (The background swatches a person picks for a cut-out are content, not chrome.)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#faf6f1` | `#120b1b` | page background, under a soft `--glow` from the top |
| `--sheet` | `#ffffff` | `#1a1324` | cards: drop sheet, stage, panel |
| `--well` | `#f1ebe3` | `#251d2f` | recessed areas, progress track, hover fills, switch track |
| `--ink` | `#1d1a16` | `#f7f4fa` | text |
| `--ink-2` | `#5c564d` | `#bcb3c8` | secondary text |
| `--ink-3` | `#6b655c` | `#948aa1` | hints, captions (4.5:1 on paper, sheet and well) |
| `--line` / `--line-strong` | `#e8e0d5` / `#d3c9bb` | `#2a2234` / `#3b3147` | hairlines; dashed and control borders |
| `--brand` | `#c2410c` | `#ff7a4d` | persimmon: primary buttons, selected rings, focus, progress |
| `--brand-ink` | `#ffffff` | `#1a0d14` | text on `--brand` (5.2:1 / 7.3:1) |
| `--brand-hover` | `#a8380a` | `#ff9470` | primary hover |
| `--brand-soft` | `#fbe9df` | `#3b1a26` | tinted fills: the drop sheet's glow, the "anything" chip |
| `--brand-text` | `#a8380a` | `#ff7a4d` | brand-coloured text and links (4.5:1+ on paper, sheet, brand-soft) |
| `--danger` | `#b8361f` | `#ff8a76` | errors |
| `--live` / `--live-ring` | `#1f9d55` | `#3ccf7a` | the pulsing "ready" dot under the drop area, nothing else, never text (Israel, 17 Nov 2026: "give the online vibe with the green pulsing circle") |
| `--check-a` / `--check-b` | `#ffffff` / `#efe9e1` | `#2a2234` / `#1f1828` | transparency checkerboard |

Dark is a **deep plum-black** (Israel, 17 Nov 2026, from a reference he liked: page `#120b1b`, lifted surfaces a step lighter, bright near-white type), never brown (16 Nov 2026); persimmon is still the only warm, saturated thing on a dark page. Light is warm paper with a persimmon glow.

## 3. Type

- **Display:** Bricolage Grotesque 600, tracking -0.02em. Only the empty-state headline, the wordmark and a page's title (How it works).
- **UI:** Geist 400/500/600. Body 15px, small 13px.
- **Figures:** Geist Mono with tabular numerals, for pixel sizes and percentages.

Loaded from Google Fonts in `index.html`. Nothing else.

## 4. Shape and depth

- Radius: 20px cards, 12px controls and thumbnails, 999px pills and the knob.
- Borders: 1px `--line` on every card.
- One shadow token, `--lift`, on the sheet and the stage (a deeper, tighter one in dark). The slider knob has its own small shadow because it sits on the photo.

## 5. Motion

- Standard: 180ms `cubic-bezier(0.4, 0, 0.2, 1)` for colour, border and opacity.
- Selection rings: 280ms on the same curve.
- How it works: each step's drawing moves as the step scrolls into view (CSS scroll-driven animations on `view-timeline: --how-step`); resting styles are the end state, so reduced motion and older browsers see each frame finished.
- The reveal: the divider travels from the right edge to the middle in 1s `cubic-bezier(0.65, 0, 0.35, 1)`.
- Processing: a soft light band sweeps over the original, 1.8s, looping.
- `prefers-reduced-motion: reduce`: the reveal lands at its end state, the band and spinners rest.

## 6. Layout

- Max width 1200px, 24px gutters (16px under 600px).
- Empty state: one centred sheet, at most 680px wide.
- Workspace: the stage on the left (fills), a 288px panel on the right; under 900px the panel drops below the stage. The queue strip sits under the stage.
- Once images are in, the whole page takes a drop, with a "Drop to add" veil while dragging.

## 7. Words

- Plain and short: "Drop images here", "Removing background…", "Download PNG".
- The model's first download is explained once: "Setting up · one-time download".
- Errors say what to do next.

## 8. Checklist for anything new

- [ ] Uses only the tokens above, and is checked in light and dark.
- [ ] Text clears 4.5:1 on its own background in both themes.
- [ ] Designed at 390px first: thumb-reach actions, 44px targets, safe areas, nothing hover-only.
- [ ] The accent is a mark, not a fill, and carries no text.
- [ ] Every state is drawn: empty, setting up, ready, processing, done, error, slower device.
- [ ] Works at 360px wide with no sideways scroll.
- [ ] Keyboard: every control reachable, visible focus ring in `--accent`.
- [ ] Reduced motion rests at the end state.
