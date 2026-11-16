# Stage 4: Build

Write it, following the plan in order. Who writes it (you or a worker, and on which rung) is in `PROCESS.md`, "Who does each stage"; a worker's brief carries the rules below and the type-check command.

## While building

- **Match the file.** Its comment density, naming and idiom, and its line endings (keep whichever a file has). Comments here say why something is the way it is, in plain words, and name Israel's decisions with their date.
- **Reuse before writing.** If you're about to write something that feels like it should already exist, search for it first, in `src/components` and `src/lib`.
- **Stay inside the rule.** Nothing that sends an image, or anything made from one, off the device. A dependency that phones home is a network call too.
- **Type-check as you go,** not only at the end: `pnpm typecheck`.
- **Scripts with quotes in them go in files.** Inline shell scripts containing apostrophes or backticks break in this shell. Write the script to the scratchpad with the Write tool and run it from there.

## When the plan is wrong

It will be, sometimes. If a step can't be done as written, or building shows a better way, stop building, correct the plan in the run file first (log the move back to Plan and why), then carry on. A plan that no longer matches the code is worse than no plan, because Review checks against it.

If what's wrong is the design itself, that goes back to The look, not into a workaround.

## Done when

The type check passes and each step of the plan is done or has been changed in the plan with a reason. Go to Review.
