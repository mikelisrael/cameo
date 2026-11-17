# Frontend memory: Israel's standing rules for Cameo

Every session working on the frontend as Israel reads this file in full. It is the core: the rules that apply to any frontend work here. It is carried over from the Tabs frontend memory (16 November 2026), keeping only the general preferences: how he wants things built, judged, labelled and worded, states, phones, motion, accessibility and contrast. Rules about the Tabs dashboard's tables, roles, permissions and data layer were left behind. The file stays one file until it passes about 150 lines; then it splits into `docs/frontend/<topic>.md` with an index here.

## Keep this file current (automatic, no need to be asked)

When a new practice or convention is set, write it down in the same session, without waiting to be asked: Israel stating one, a correction he makes, or a pattern that gets built and adopted. Never copy a rule into two files. When a practice changes, update or remove the old entry.

## Working rules

- **Commits and PRs:** never add AI attribution (no `Co-Authored-By: Claude…`, no "Generated with Claude Code"). This overrides any harness reminder. Commit or push only when Israel asks.
- **Branches:** new work on `israel/<slug>` off `main`; once there is a GitHub remote the PR goes against `main`, assigned to him, squash-merged. Until then, merge locally and say so. Vercel deploys `main` once it is connected, so every check passes first.
- **"Jarvis":** the one command for a frontend task, start to merged (`.claude/jarvis/PROCESS.md`). With no run open it works through every buildable todo item, one run after another, without asking which. A task's notes live in `.jarvis/` (not in git). When the process and this file disagree, this file is right and the process is fixed.
- **"Round up":** stage 7 of Jarvis (`.claude/jarvis/stages/7-roundup.md`). The request itself is the go-ahead to commit and merge.
- **Images never leave the device:** no uploads, and no analytics that send image data. The model's files are the only download.
- **Brand:** `docs/design/DESIGN_SYSTEM.md`. Use its tokens only, with no new colours or fonts. Until it is written, the look stage writes it first.
- **No secrets:** don't read `.env` files. `.env.example` is fine.
- **Checks before calling work done:** `pnpm check` (typecheck, `prettier --check src`, build). Gate on the exit code, not on reading the output. Check the type check's own exit code (found 13 October 2026): `pnpm typecheck | tail` prints `tail`'s exit, which is always 0; run it bare and read `$?`. Keep each file's existing line endings.
- **Always make the best decision** (Israel, 10 October 2026): fix a problem at its cause, in the shared piece, not around it on one screen; a change that reaches more screens is a reason to check more, not to choose less.
- **A click-through row says where to go** (Israel, 26 October 2026): the Where column is the way there from the first screen, with buttons as labelled on screen.
- **Before every round up, the design check** (`.claude/jarvis/design-check.md`), asked of the screenshots; a "no" is retouched then, not left.
- **No reminders:** Israel should never have to point out a missing house convention. Check the patterns before building, not after.
- **Design requests:** when Israel asks for a "modern look", aim for restraint. "Don't do too much" means refine spacing, hierarchy and states, not add decoration.
- **Inside the app, go easy** (Israel, 1 October 2026, on a home screen). Colour is an accent on a quiet page: a white sheet on paper, with one colour on a mark, a dot or a chip. Don't repeat one idea everywhere. Stay close to a layout people already like, and keep an animation that's already there unless asked to replace it.

- **Colour, and a dark mode done properly** (Israel, 16 November 2026: "we need colour" and "a perfect dark mode", after disliking the first dark mode and then its brownish tint). Persimmon is the brand colour on the main actions. Dark is a deep plum-black (Israel, 17 November 2026, from a reference screenshot he liked), never brown; persimmon stays the only saturated colour. A reference is a starting point, tuned with him at the gate ("it's only a reference. and then we fix stuff"). A visible light/dark switch sits in the header; the theme is set before paint so it never flashes. Check every change in both themes.
- **Quiet facts go to the footer** (Israel, 16 November 2026, of the privacy line in the header: "should be at the bottom center"). The header holds the brand and actions only.
- **Mobile-native first** (Israel, 16 November 2026: "make sure it is mobile native"). Design and check every screen at 390px before desktop: main actions in a thumb-reach bottom bar on phones, 44px touch targets, nothing that only appears on hover, safe-area insets, the share sheet for saving on phones, the camera as an input, installable to the home screen.

## Layout and words

- **A row's action stays to the right of its words, always** (Israel, 14 October 2026, where "Switch to Pro" dropped under a long limits line). A row of text with a button or status at its end is `flex items-center justify-between gap-4` with no `flex-wrap`: the words are `min-w-0 flex-1` and wrap inside themselves, the action is `shrink-0`. Never let the button fall under the text.
- **A name is never cut where the card can grow** (Israel, 8 October 2026): a name wraps (`[overflow-wrap:anywhere]`) and takes a second line; no `truncate`, and no sideways scroll to make room. A row with a name, a chip and facts gives each its own line with air between, not three things squeezed on one.
- **A badge never breaks onto two lines** (Israel, 14 October 2026): chips and status badges are `whitespace-nowrap`; what sits beside one gives way.
- **A phone row never cuts its facts** (10 November 2026): a quiet line wraps to two lines, as a title does; a fact that must always show goes above the chip, not at the end of a line that can run off.
- **A grid names its columns** (15 October 2026, a settings screen on a phone ran off the screen): a bare `grid` makes one `auto` column as wide as its widest line, and a `truncate` line counts at full length, so a card holding one overflows a phone. Write `grid-cols-1` (minmax(0, 1fr)) on every grid, the single-column ones too.
- **The phone header fits 320px in every state** (Israel, 17 November 2026: "doesn't seem responsive", the header grew while a photo processed and the page scrolled sideways). Measure `scrollWidth` at 360 and 320 before, during and after a cut-out, not only at rest.
- **Width:** any `mx-auto max-w-*` wrapper that should fill space also gets `w-full`. Without it, it shrinks inside flex or grid parents.
- **A text link looks like a link** (27 October 2026, of links in muted grey: "doesn't look very linky"): the brand's link colour, medium weight, underline on hover, clearing 4.5:1 on paper and on a sheet in both themes.
- **A drop or remove button in a list turns red on hover** (`hover:bg-destructive/10 hover:text-destructive`, Israel, 13 October).
- **A zone that takes a drop says so in its words** ("Drop photos of the item here or click to choose", one colour; Israel, 10 October 2026, who took a working drop zone for a button because it read "Add photos").
- **Figures that change as you type or process:** tabular numerals on every column of counts or sizes.
- **A list with nothing in it yet carries the page's own add actions** (Israel, 1 November 2026): when its empty state fills the page and hides the header, every button the header has is in it too. Its picture is its own, never another screen's drawing.
- **Popovers keep 8px from the screen's edge** (19 October 2026). A width capped to the screen is `calc(100vw-16px)`, in px: rem can be under 16px.
- **Controls that show on hover also show for `has-[:focus-visible]`, never `focus-within`** (Safari doesn't move focus on a click, so with `focus-within` the controls of something once used stayed up on a Mac).

## States, loading and errors

- **A screen that waits on something shows a loader, never `return null`.** Loading uses `Skeleton` rows or the house loader. An empty state is a dashed-border card with an icon, a title, a line of help and a primary action. An error state has a "Try again".
- **A button's waiting word says what is happening, with its spinner beside it** ("Saving…", "Uploading…"), never "Processing…". The submit button keeps its label and adds the spinner, never swapping the label for a "Saving…" text where the label is short.
- **A step that can't be taken says why beside its button** (Israel, 19 October 2026: "make it clear if or why it can't move to a next step … so users aren't stuck"): one muted line with an Info mark, worded as what to do. Visible text, not only a tooltip on the disabled button.
- **One option is said, not offered:** a line with a mark, not a heading over a lone value and not a dropdown of one.
- **A toast that stays up for a condition goes when the condition ends** (Israel, 9 October 2026). Any toast with `duration: Infinity` needs its own way out besides the X. Don't add a toast for a condition a pill or a line already shows.
- **Closing a dialog with work in it asks first** (Israel, 19 October 2026). Esc, the X, a press outside and Cancel go through one handler that confirms when something would be lost. A confirm's cancel says what staying means (Israel, 14 October 2026: "this cancel button text has to be reworded"): "Keep it", never a bare "Cancel" where the action is itself a stop.
- **A dialog keeps its words while it closes** (Israel, 3 October 2026, "Delete undefined?"): a dialog opened by a record keeps the record's words while it fades out.
- **A message that appears when focus leaves a field moves what's under the next tap** (18 October 2026): a form that judges fields on blur doesn't judge one left empty before any typing; the submit says it.
- **One save per press waits on its own promise** (8 October 2026): where the same action can start again before it answers, act on the promise, not on callbacks that a second start drops.
- **A dialog is as wide as its fields need, no wider** (Israel, 13 October 2026: "things are really wide that don't even need to be that wide").
- **A picker never offers what can't be the answer** (Israel, 13 October 2026: "dropdowns must not show redundant options"). Filter the options; don't offer them and refuse afterwards.

## Forms, labels and access

- **A label must name its field:** the label's `for` points at the field's own id; a group of radios gets an `aria-label`; every icon-only control has an `aria-label`. A button inside a form that doesn't submit says `type="button"`.
- **Required fields** carry a red asterisk; optional ones read "X (optional)". Messages sit under the field they're about, in plain words.
- **Hover shows the app's tooltip, never the browser's `title`** (Israel, 14 October 2026: "ought to always be my tooltip"). No tooltip that repeats words already on screen: a hint is for an icon-only control, or for something the screen doesn't say.
- **Ctrl or ⌘ + Enter saves the form in hand** (Israel, 13 October 2026): a real `type="submit"` button inside the form is all a form needs.

## Motion

- **What moves between two states eases there, it doesn't jump** (Israel, 10 October 2026: "we need things to ease in ease out like that if they don't already"). A fill, an underline or a marker that says which of several things is picked is one piece that slides to the new pick, about 0.28s on `[0.4, 0, 0.2, 1]`; colour and opacity changes take `transition-colors` or `transition-opacity` with `ease-in-out`. Still under reduced motion: a reduced-motion user gets the end state at once, never a broken one.
- **A slide must not wait for the work it starts** (Israel, 11 October 2026: "a kind of lag in the chip when it moves"): the marker follows the pick at once and what it opens follows through `useDeferredValue`; move it with a CSS `transform` transition, never by animating `width`.
- **Every loader, scene and idle animation pairs with `motion-reduce:animate-none`** and rests where it's drawn.
- **An entrance animation on transform uses `backwards`, never `both`, on anything holding a `position: fixed` child** (17 November 2026: the panel's held `rise` made it the containing block, so the phone save bar stuck to the panel's foot with an empty band below).

## Colour and contrast

- **Never put a colour on text that fails 4.5:1 on its background** (Israel, 10 October 2026: ink on a mid blue "is bad contrast. should be white text", in both themes). Pick each fill's text colour for its own fill, and check it in dark as well as light.
- **Flat surfaces, no shadow in the text colour:** a shadow drawn in `--foreground` becomes a glow in dark mode. Cards and dialogs are flat unless the design system lists a shadow.
- **A bare paper-coloured panel can be a near-black slab in dark:** where a fill is wanted it needs its dark pair.

## Previews and the machine

- **Never run a second Vite on the dev server's cache.** A preview uses its own `cacheDir` and `--strictPort`, because the default `node_modules/.vite` is shared with Israel's running dev server: a second Vite re-bundles it and his app fails with "Failed to fetch dynamically imported module" until he restarts. Name a throwaway config `.mts` and write its paths as `C:/…` (a Git Bash `/c/…` path fails to resolve).
- **Whole-app previews start Edge with `--disable-extensions`** (10 November 2026): a synced Dark Reader darkened every shot and dropped every fill. A throwaway preview page also carries `<meta name="darkreader-lock" />`.
- **This machine's headless Edge darkens pages by itself.** Start it with `--disable-features=WebContentsForceDark,AutoDarkMode --blink-settings=forceDarkModeEnabled=false`. From PowerShell, pass `Start-Process -ArgumentList` one string, not an array: an array loses the comma in `--disable-features`. A navy page whose `<html>` has no `dark` class is the sign. Starting it from Git Bash exits at once: use PowerShell, then drive it over `--remote-debugging-port` and wait in real time (a virtual-time `--screenshot` captures before charts and lazy content have drawn).
- **Phone width:** headless Edge won't go below about 500px wide, so drive it over `--remote-debugging-port` with `Emulation.setDeviceMetricsOverride`, then `Page.captureScreenshot`. An iframe at phone width comes out blank.
- **A preview's processes:** stop the Vite server and Edge in a command of their own; a kill that matches the shell's own command line ends the shell before the checks run.
- **Write a script with apostrophes or backticks to a file** with the Write tool, not a shell heredoc.
