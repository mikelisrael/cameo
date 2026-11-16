# Stage 1: Research

Find out two things before anyone designs or plans: how this works here today, and what the best version of it looks like anywhere. The look and the plan are only as good as what you learn here, and the commonest cause of rework has been building against a component, a library behaviour or a model limit that turned out to be different from what was assumed.

For a **Fix**, this stage is narrower: find the cause and show it (the line, the message, the state that produces the bug). Don't propose a change until you can say why it happens. If you can't observe the cause and are inferring it from the code, say so in those words.

## How it is today

Read, don't guess:

- **What can be reused.** The components in `src/components`, the hooks and helpers in `src/lib`, and the styles in `src/styles.css`. `frontend_memory.md` names the house rules. A new component that duplicates one is a defect Review will send back.
- **The worker and the model.** `src/lib/protocol.ts` for the messages, `src/lib/useRemover.ts` for what the UI is told (status, progress, device, error), and `src/worker/removeBackground.worker.ts` for what actually runs. A screen that needs something the protocol doesn't carry (a new progress step, a cancel) changes the protocol first.
- **What the browser and the model can't do.** Every capability this work needs and doesn't have: WebGPU missing (the model falls back to WASM, slower), memory limits on a huge image, a format the browser can't decode. Name each, and whether the work can ship without it or is blocked.
- **What it may do.** Check every step against the privacy rule: images never leave the device. No uploads, and no analytics that send image data.
- **What the todo already says** about this work: `docs/todo.md`.

## What the best looks like

Then look outward. For the pattern at hand (a drop zone, a before and after comparison, a batch queue, a download flow), how do the tools that do it best handle it? Search the web for it. You are after the two or three ideas that make theirs good and would survive inside this brand, such as what they put first, what they leave out, or how they handle the awkward case. You are not collecting screenshots to imitate.

Keep this proportionate. A filter chip needs no survey. A new screen deserves a real look.

## Write into the run file

- **Reuse:** what exists and will be used, with paths.
- **Gaps:** what the model, the browser or a library lacks, and whether the work can ship without it or is blocked.
- **Worth borrowing:** the outside ideas, one line each, with where they came from.
- **Recommendation:** the shape you'd build, in a short paragraph, and anything Israel should know before it's designed.

## Done when

Every gap is named, and nothing in the recommendation rests on a behaviour you didn't read. **Worth borrowing names what you found outside this repo, with its sources** (Israel, 16 November 2026: "research should never stop at just my local but even abroad, to check current and best practices"). For a Feature that is a web search every time; an empty Worth borrowing means the stage isn't done. Only a Tweak skips it.

If a gap blocks the whole task, stop and tell Israel: what is missing, and what could be built meanwhile. Otherwise go to The look.
