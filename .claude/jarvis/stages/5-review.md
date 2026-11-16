# Stage 5: Review

Read the work as someone who didn't write it and wants to find what's wrong with it. A verifier does the diff read and the scoped checks (`PROCESS.md`, "Who does each stage"): brief it with the plan, the diff and the "done when" list, not your opinion of it. Its findings are routed below like your own. This is the stage that protects Israel's time: everything caught here is something he doesn't have to find, describe and wait for.

## Read the diff

All of it: `git diff main...` plus what's uncommitted. Look for:

- Behaviour that changed by accident, especially in shared components other screens use.
- Things removed that something still uses.
- Leftovers: unused imports and code, preview files, scratch scripts, stale comments, a flag left the wrong way.
- House rules missed. `frontend_memory.md` is the list.
- Anything that sends an image, or data made from one, off the device.
- Each "done when" item: is it true now? Check each against the code, not from memory of having written it.

## Run the checks

Every time:

- `pnpm check` (typecheck, `prettier --check src` and build). Gate on its exit code, not on reading its output. Run `pnpm typecheck; echo $?` on its own if you need the type check's exit code: piping it through `tail` hides it.

If something here has a test, run it too; there is no test suite or e2e suite yet.

## Look at it

Checks don't see a cramped row or a name that wraps. For anything with new UI, render it and look:

- `pnpm dev --port 3013` on a port of its own, so Israel's running one isn't disturbed. Screenshots with headless Edge, or Playwright if it is installed (don't add it as a dependency).
- One desktop width and 390px, light and dark split between them.
- Real-looking content, including the awkward cases: a long file name, many files at once, a huge image, a non-image file dropped, the model still downloading, a failed load.
- Read each screenshot and ask what Israel would say about it. Spacing, truncation, alignment, a block of colour that's too loud, a label that wraps.
- **Where a piece lands is seen, not read.** Which layout, frame or wrapper something renders in (an error fallback, a portal, a layout slot) is confirmed by a screenshot. A PASS on placement from reading code alone isn't one.

Then delete the preview files and stop the server you started (check the process is `node` on your port before stopping anything).

If it can't be rendered (it needs the real model and the machine can't run it), say so in the report. Don't imply it was seen.

## Send each finding to the stage that owns it

Don't fix everything in place. Ask what kind of problem each finding is:

| The finding is | Goes to |
|---|---|
| It looks wrong, feels crowded, or breaks a brand rule | The look, then forward again |
| A case nobody planned for, or a place it should also show | Plan |
| An assumption about the model, a library or an existing component was wrong | Research |
| A bug, a typo, a leftover | Build (fix it now, then re-run the checks) |

Write each finding and where it went into the run file, and log the move. Small Build findings can be fixed in one pass. After anything goes back, Review runs again in full when the work returns.

Mind the bounce limit in `PROCESS.md`: the same stage sent back twice for the same reason means stop and ask Israel.

## Done when

No finding is open, every check passed on the final code, and the preview files are gone. Go to the gate.
