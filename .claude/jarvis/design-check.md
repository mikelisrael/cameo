# The design check

Asked every time, for every new or changed piece of UI, just before the round up (Israel, 21 October 2026: "create a checklist of questions to ensure you did this for every new ui element you design … just before the final round up and if anything does not meet the requirements, you quickly retouch them").

Look at the screenshots: one desktop width and one phone width (390px), light and dark split between them. Answer each question about what you see, not about what the code says. A "no" is retouched there and then (Build, then this check again), not written down as left over. Write the answers, one line each, in the run file under Review.

The rules behind the questions live in `docs/design/DESIGN_SYSTEM.md` and `frontend_memory.md`; where a question and those files disagree, the files win.

## Balance

1. Does each row have a clear left and right, with nothing floating in the middle of it? A chip or a label goes with the thing it describes (under a title, or at a row's end), never midway.
2. Is there one primary action in view, where the eye lands first?
3. Do the figures line up? Same tile sizes, an odd last one the whole row.
4. Does any word or phrase break onto a line by itself? Keep facts whole (`whitespace-nowrap`), or shorten the words.
5. Is the spacing even, 16 to 24px between sections, with nothing cramped against an edge or another piece?

## Brand (the design system)

6. Is it the right volume? Check against what `DESIGN_SYSTEM.md` says a working surface and a moment each get.
7. Tokens only? No hex, no raw Tailwind colour, no new radius or font that the design system doesn't list.
8. Does it reuse what exists in this repo, rather than drawing a second one of the same thing?
9. Does the screen still read as Cutout with the wordmark covered?

## Narrow widths

10. Nothing sideways at 390px: no page scroll?
11. Is nothing reachable only on hover?
12. Long and awkward content: a long file name, many files at once, a huge image, an empty queue, a failed image, the model still downloading. Does each still look right?

## States, words and access

13. Does each state that matters here look right: the model downloading (first visit), the model failed to load or the browser unsupported (no WebGPU falls back to WASM, slower, and says so), processing, an image that is huge, a non-image file dropped?
14. Are the words plain, Israel's own where he wrote them, and naming real things (the image, the file name)?
15. Does each icon-only control have a name, and does every text and control pair keep its contrast in light and dark?

## The empty list (Israel, 1 November 2026: a list shipped with no way to make the first record)

16. Does an empty state carry the page's own add actions? When it fills the page and hides the header, every button the header has (same words) must be in it too, or the first item can't be made. For Cutout the first item is a dropped or chosen image.
17. Is its picture its own? An empty state shows the thing it keeps, never another screen's drawing.

## Proof

18. Did `npm run check` pass?
19. Was it looked at in the running app, at both widths, light and dark?
