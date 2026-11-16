# Stage 6: The click-through gate

This is the one planned stop. Israel clicks through what was built in the running app and tells you what to update, add or correct. Nothing is committed yet.

## Before you ask him

Finish the click-through table in the run file: a heading that says what was built and when, a line on the branch and on what was and wasn't verified, the two-column table, then any known limits. Each row's Where is the way there from the first screen, with the buttons as labelled on screen ("Drop a photo, then **Download** on the thumbnail", not "the export path"), and the browser or width to use when it matters. Tick off the `docs/todo.md` items this work completes.

**Use the app he already has running** (Israel, 16 November 2026: "we could have just let me see changes on this branch … currently working on port 3002"). Before starting a server, look for his own (`netstat -ano | grep LISTEN`). If the run's changes are in the tree it serves, point him there; start one only for a worktree his server doesn't serve.

## What to tell him

Write it for someone coming back from other work. Lead with what he can do now:

1. One or two sentences: what was built, and where to find it in the app.
2. Anything he must do first for it to work (the first visit downloads the model, so it needs a connection and takes a moment).
3. What was verified and how, and what wasn't. Be exact: "typecheck, format and build pass; seen in a preview, dark and light, desktop and 390px; not run on a phone or without WebGPU".
4. The click-through table, with the three or four rows most worth his attention called out.
5. Any note for him that the plan raised, in a line each.
6. Then ask: what should be updated, added or corrected? And tell him he can say "round up" when it's good.

Keep it short.

## When his notes come back

Route each note as `PROCESS.md` describes under "His notes": say where each one is going, in a line each, then start on the earliest stage any of them needs. Work flows forward from there through Review and back here.

When you return to the gate, show only what changed: which rows to re-click, and what was done about each note. If a note couldn't be done (it needs a server, or it conflicts with the privacy rule), say that plainly beside it.

A note that is a standing preference also goes into `frontend_memory.md` in the same turn.

## Done when

He says it's good, or says "round up". Go to stage 7.

If he goes quiet or moves to another task, the run stays at the gate. Its file says so, and a later `jarvis` picks it up.
