# Stage 2: The look

Decide what it looks like and how it behaves before any of it is built. Israel cares a great deal about this stage: he wants each feature to have the best look it can have, and he wants it to be unmistakably Cameo. Those two pull against each other, and holding both is the job.

## Load the skill, then work inside the brand

Invoke the `frontend-design` skill. It pushes for a clear point of view and against generic output, which is what Israel wants from it. It was written for blank pages, though, and it will suggest new fonts, palettes and atmospheres. `docs/design/DESIGN_SYSTEM.md` wins every time it and the skill disagree. Once that file exists, take the skill's ambition and its insistence on one strong idea, and nothing else that conflicts with it.

Until `DESIGN_SYSTEM.md` is written (today it is a stub), this stage writes it first: the feeling, palette and dark pair, type, shape, motion, voice, the components, and a short checklist for adding something new. Use the skill for it, show Israel the direction at the gate with the first look, and commit it with that run. After that, read the sections the work touches, and the checklist in full.

## Decide, in this order

1. **Which volume.** Is this a brand moment (the first screen, an empty state, the model downloading) or a working surface (the comparison, the toolbar, the queue)? Posters, tilt and scenes belong to moments. Most of Cameo is a working surface: someone drops a photo to get a cutout, often several in a row.
2. **Where the character goes.** A working surface gets one place to be interesting, and the rest stays quiet. Ask what the one real-world thing in this feature is (a cutting mat, a pair of scissors, the before and after slider), and whether drawing it that way would help someone understand it faster. If nothing earns it, a clean, well-spaced surface is the right answer, and saying so is better than decorating.
3. **Two or three directions.** Sketch them in a sentence or two each. Pick one and write why in two lines. The directions you didn't take go in the run file in a line each, so a later "what if" doesn't restart from nothing.
4. **Every state.** Default, hover, focus, disabled, loading, error, empty, selected, and the ones that matter here: the model downloading on first visit (with real progress), the model failed to load or the browser unsupported (no WebGPU means WASM, slower, and it says so), processing, an image that is huge, a non-image file dropped.
5. **The narrow layout,** decided now, not discovered in review. People will open the link from a phone: a page must work at 390px with nothing sideways.
6. **Dark.** Decide the pair for every colour now; a filled panel needs its dark pair.

## Checks before leaving

Go through these against what you've decided. Each one is here because it has gone wrong before:

- Tokens only. No new colours, no new fonts, no gradients and no shadows outside what the design system allows.
- Colour is an accent. Don't repeat a motif across the page.
- Text never uses a colour that fails contrast on its background, in light or in dark.
- A file name is never cut where the container can grow. Wrap it. A row with a name, a state and actions gives each a line with air between.
- Every control is reachable without hover, and every icon-only control has a name.
- The privacy rule holds: nothing on it implies, or does, a picture leaving the device.
- Nothing here contradicts a line in `frontend_memory.md`. If the best design does need to break a house rule, that is a decision for Israel: say what and why, and ask.

## Write into the run file

The chosen direction, why, the directions not taken, the states, the narrow layout, and which existing components carry it.

## Done when

The direction passes the design system's checklist and the checks above. Go to Plan.

If the look needs something the model or the browser can't give, go back to Research to settle whether it can be had, and log the move.
