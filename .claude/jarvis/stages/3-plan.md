# Stage 3: Plan

Turn the research and the look into an ordered list of changes, and write the click-through table now, before building. Writing the table first is deliberate: it is the list of things Israel will check, so it is the clearest statement of what "built" has to mean.

## Write into the run file

- **Steps, in order.** Each names the files it adds or changes and what it reuses. Order them so the thing can be type-checked early: types and `src/lib/protocol.ts` first (when the worker's messages change), then the hooks and helpers, then the components, then `src/App.tsx` and the places that use them.
- **Flags and notes for Israel.** Anything the model, the browser or a library can't do yet goes behind a simple switch, or is detected at run time (WebGPU present or not), so going live later is one line. Say which. Anything he needs to decide goes here as one question.
- **Where else it shows.** A change usually touches more than itself: the queue, the toolbar, the export name. List the places this touches so none is found in click-through.
- **The click-through table.** One row per place, two columns ("Where", "What to check"). Write what he will see, concretely enough that he can tell right from wrong at a glance.

For a **Fix**, the plan is a paragraph: the cause, the change, and how you'll know it's fixed.

## Done when

Every "done when" item from the door maps to at least one step and at least one click-through row. If an item maps to nothing, either the plan is missing a step or the item was wrong; fix whichever it is.

Go to Build. If planning shows the look can't be built as designed, or rests on something Research didn't settle, go back to that stage and log why.
