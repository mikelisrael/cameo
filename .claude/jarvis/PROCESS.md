# Jarvis

Jarvis is how Israel's frontend work gets done in this repo, Cutout (an in-browser background remover): one command that takes a task from "here's what I want" to a merged branch, through research, the look, a plan, the build, a review and his click-through. It is a fork of the Tabs Jarvis (the one in the Tabs admin repo), carried over on 16 November 2026 and fitted to this project: its branches, checks and its one hard rule about images never leaving the device. You are the session that runs the process. Who does each piece of a stage (you, a scout, a worker, a verifier) is set by his global pipeline; see "Who does each stage".

The point of the process is that Israel stops having to steer. He used to say "use the design skill", "stay on brand", "write the notes", "round up" on every task. Those are now steps, and the only time he is asked to do anything is the click-through, which only he can do.

## The rules already written win

Jarvis adds an order of work. It does not add rules. The rules live in these files, and where this process and they disagree, they are right:

- `~/.claude/CLAUDE.md` (his global rules: no AI attribution, PRs assigned to him, worktrees under `.worktrees/`, the pipeline of scouts, workers and verifiers, the implementation standards and when a test is worth writing). Its hard rules win over everything below; where it and the repo's `CLAUDE.md` both speak, the repo's rule is the more specific and holds for this repo.
- `CLAUDE.md` (this repo's rules: what it is, the check, the privacy rule)
- `frontend_memory.md` (the core: how Israel wants things built; read it in full at the door, every run)
- `docs/design/DESIGN_SYSTEM.md` (the brand; its checklist section is for anything new)
- `docs/todo.md` (what the app should still have)

Point at them. Never copy their content into a run file or a stage file, because a copy goes stale and then two things disagree.

## What Israel types

| He types | Do this |
|---|---|
| `jarvis` or `/jarvis`, nothing else | Look in `.jarvis/` for open runs, and in `git worktree list` for parked ones under `.worktrees/israel-*`. If one is at the gate, resume it: show the click-through table again and ask for his notes. If one is mid-stage, carry on from its log. If none is open, read `docs/todo.md`, list what can be built now in the order you'll take them, and start on the first without asking which. When a run reaches the gate, start the next, until nothing buildable is left (Israel, 9 October 2026: "you are supposed to always work recursively"). See "Working through the list". |
| `/jarvis <a task, a screenshot, a complaint>` | If no run is open, or this is clearly different work, start a run. If a run is open and this is about it, it is a note: route it (see "His notes"). |
| `/jarvis status` | For each open run: its name, size, stage, and the last line of its log. If none, say so and list the buildable todo items. |
| "round up", `/jarvis roundup` | Stage 7. From the gate, or from anywhere if he says it. |

The bare word "jarvis" in a message means the command, with the rest of the message as its argument.

Anything he says while a run is open is addressed to that run unless it is plainly something else. A screenshot with one line under it is a note.

## The run file

Every run has one file, `.jarvis/<yyyy-mm-dd>-<slug>.md`, made from `.claude/jarvis/run-template.md`. The folder is git-ignored. Update it as you go, not at the end: it is what lets you (or a later session, after a compaction) pick the run up without Israel repeating himself. If you are ever unsure where a run stands, the file is the answer; read it before acting.

Keep it short. It holds decisions and findings, not transcripts.

## Size it first

Most of what Israel asks is small. Sending "switch these two buttons" through seven stages wastes his time, and skipping stages on a new screen is what causes rework. So the door sizes every run:

- **Tweak:** a move, a rename, a spacing or truncation fix, a reorder. Go to Build, then Review, then report. No research or look notes. No gate, unless the tweak changes how something works rather than how it looks.
- **Fix:** something is broken. Research is "find the cause and show it"; skip The look unless the fix changes what he sees. Then Plan (one paragraph), Build, Review, gate.
- **Feature:** a new screen, flow or component, or a change to how an existing one works. Every stage.

If a tweak turns out to be bigger once you're in it, resize it, log why, and go to the stage it now needs.

**The design skill comes first, whatever the size** (Israel, 21 October 2026: "always remember not to ignore it jarvis … at the fore front of implementation"). A tweak or a fix skips The look as a stage, but anything it changes that Israel will see is still designed: load the `frontend-design` skill and read the sections of `docs/design/DESIGN_SYSTEM.md` it touches (its checklist section at least) before the first line of code, and run `pnpm check` before the round up. So does every run in a batch. And every round up starts with the design check (`.claude/jarvis/design-check.md`, Israel 21 October 2026): its questions asked of the screenshots, and anything that fails retouched before the commit.

## The stages

Read only the file for the stage you are in. Each one says what to read, what to produce, how to know you're done, and where to send the work if you're not.

| # | Stage | File | Ends when |
|---|---|---|---|
| 0 | Door | (below) | The run file has a size and a "done when" list |
| 1 | Research | `stages/1-research.md` | Reuse list, gap list and a recommendation are written |
| 2 | The look | `stages/2-look.md` | One direction is chosen and passes the brand checks |
| 3 | Plan | `stages/3-plan.md` | Every "done when" item maps to a step and a click-through row |
| 4 | Build | `stages/4-build.md` | It type-checks and does what the plan says |
| 5 | Review | `stages/5-review.md` | No open finding |
| 6 | Click-through gate | `stages/6-gate.md` | Israel says it's good |
| 7 | Round up | `stages/7-roundup.md` | The work is merged into `main` and you're on an up-to-date `main` |

### The door

1. Read `frontend_memory.md` (the core) in full, then the todo entry for this work if there is one, and the sections of `DESIGN_SYSTEM.md` the work touches. A run is for Israel, so there's no need to ask who he is.
2. Check the branch. New work goes on a new branch off an up-to-date `main`, named `israel/<slug>`. If a branch is already open for related, unmerged work, stay on it and say so.
3. Size it.
4. Write **done when**: three to six things Israel will be able to see or do when this is finished, in his words. "Dropping three photos shows three thumbnails, each with its own progress", not "add a Queue component". This list is what Plan maps to steps and what Review checks, so a vague item here costs every later stage.
5. If the ask has two readings that would lead to different builds, ask him which, once. Otherwise pick the reading that fits what he has asked for before and say which you picked.

## Who does each stage

His global `~/.claude/CLAUDE.md` ("Pipeline") staffs the stages; this table is where its roles land in a run. Read the session model from the system prompt at the door and write it in the run file, because the staffing depends on it.

| Stage | On a Sonnet session | On an Opus or Fable session |
|---|---|---|
| 0 Door | You. | You. |
| 1 Research | `🔍 Scout · haiku low` for the sweep (reuse, the todo), one bounded question each, up to 7 in one message. A targeted grep is yours. | Scouts for all of it, even a one-grep lookup. You read only what he named and the lines a decision rests on. |
| 2 The look | Needs craft (a new screen, a new visual pattern or motion, or he asked for it to look good): `🎨 Worker · opus medium` takes it whole. Routine UI: you set the direction in the brief, naming the exemplar and the tokens. | Needs craft: you write the look yourself. Routine UI: as on Sonnet. |
| 3 Plan | You, with the global gate 3 run on the open questions; the advisor when a trigger fires. | You; gate 3 is n/a. |
| 4 Build | Within ~2 files and ~50 lines: you. Larger: the `🔧 Worker` ladder, one surface per brief, each brief opening with its `Gate 3:` and `Rung:` lines. Plumbing first, the look on top. | Workers do every edit, except a crafted look, which is yours. |
| 5 Review | `🔎 Verifier`, foreground, on the rung the plan set. It runs the scoped checks. You run `pnpm check` once on the final code, and the screenshots and design check stay yours. | Same. |
| A fix whose cause no one can find | `🩺 Analyst · opus high`, which changes nothing and reports the cause. | Same. |
| 6 Gate, 7 Round up | You. | You. |

- **Stakes here:** anything that sends an image, or data made from one, off the device (a network call, an upload, analytics) is `critical`; that is the project's one hard rule. Changes to how the model is loaded or cached, or to the worker's message protocol (`src/lib/protocol.ts`), are `sensitive`. The rest is `routine`.
- **The design skill still comes first.** Whoever writes the look loads `frontend-design` and the `DESIGN_SYSTEM.md` sections it touches; a worker brief that touches visible UI names those sections and tells it to load the skill. A worker has no Skill tool and often skips the reading, so the brief itself carries the look: the exemplar, the tokens, the labels and the states, and the design check on the screenshots is what proves it.
- **Send-backs.** Inside Build and Review a failed attempt follows the global "Escalate" (the cause decides whether the rung, the effort or the brief moves). The bounce limit below still holds across stages, and the global "comes to me" means Israel.
- **Tokens.** The pipeline is how tokens are saved: cheaper tiers read and build so the session's tokens go to decisions. Write an agent's report into the run file condensed, never pasted, and log each worker and verifier with its rung.

## Switching

Three kinds of switch, each handled the same way every time.

**Between stages** of one run: "Moving forward, and back" below. Each move is a log line, and the staffing changes with the stage, per the table above.

**Between tasks**, when he interrupts ("switch"), stacks something on top, or brings something more urgent than the run in hand (see "Working through the list"). First park the run in hand: wait for any agent you're waiting on to finish (never leave a worker mid-edit), then write into its run file the stage, the next step in one line, and the files changed and not yet committed. Then:

- **Stacked, or small work for the batch:** same branch, a new run file, as in "Working through the list".
- **Unrelated work while the parked run has uncommitted changes:** don't stash and don't mix the two. Start the new run in a worktree at `.worktrees/israel-<slug>`, on `israel/<slug>` off `main` (his global worktree rule), with its own `pnpm install`, and write the path in the new run file. Going back is reading the parked run file and working in the main tree again. Remove the worktree when its branch merges.
- **A large task:** still alone; see "Batching, clearing and tokens".

**Between sessions.** On Opus or Fable the global rule is one task per session. When a run closes there, don't start the next one in the same thread: close the run file as "Between runs" says and tell him "Run closed: <name>. Start a fresh session; `jarvis` picks up from `.jarvis/`." A batch of tweaks and small fixes counts as one task. On Sonnet, carry on through the list.

## Working through the list

A bare `jarvis` with nothing open is a request for all of it, not for one item. Take the buildable items **most urgent first**, not in the order they were written or asked (Israel, 25 October 2026: "instead of FIFO … unless i interrupt or superimpose, determine the most urgent"), a run each, and don't stop between them to ask. Urgent means: something broken first, then what he called urgent, then the rest. Whatever he brings in the middle of a run is weighed the same way: it goes first only when it is more urgent than the run in hand, unless he says to switch (that is the interrupt), or adds it on top of the open work (do both).

Nothing is committed without "round up", so these runs share one branch: each keeps its own run file and click-through table and parks at its gate, and the next starts on top of it. When the list is done, report once: every run, what was and wasn't verified for each, and the tables to click. One "round up" then ships them as one merge, described run by run. If he has waived the gate, round each run up as it finishes instead, on a branch of its own.

A run that hits something only he can decide is parked with the question written in its run file, and the next one starts; ask at the end, with the report.

## Between runs: start the next one light

Israel wants the conversation compacted after every finished task, so a long night of runs doesn't drag the first one's detail through the last (9 October 2026). Compacting is the harness's own command (`/compact`): Claude cannot run it. So a run is closed in a way that makes compaction lose nothing, and he is told when to press it.

When a run is done (merged, or parked at the gate):

1. **Close the run file so it stands alone.** Stage, merge commit (and PR number once there is a remote), the decisions made without him, what was and wasn't verified, and what is owed (the click-through). Anything worth knowing that is only in the conversation goes into the run file, `docs/todo.md`, or `frontend_memory.md` now. After this, nothing about the run should need the conversation.
2. **Say so in one line:** "Run closed: <name>. Safe to `/compact`." If he is there, that is his cue. If he isn't (an unattended night), carry on. On an Opus or Fable session the line asks for a fresh session instead (see "Switching").
3. **Start the next run from the files, not from memory:** read `PROCESS.md`'s table, the todo entry and the code again, as a new session would. Don't lean on what an earlier run in the same conversation read; it may have been summarised away, and a file may have changed since.

If the harness compacts on its own mid-run, the run file is what to read first on the other side.

## Moving forward, and back

Move to the next stage as soon as the current one's exit check passes. Don't stop to report between stages; a one-line note that you've moved on is enough.

When something is wrong, send the work to the **earliest stage that could have prevented it**, then let it flow forward again through every stage after that. A layout that feels cramped is a look problem, so it goes to The look and then through Plan, Build and Review again; patching it in Build is how a design ends up as a pile of local fixes. A wrong assumption about the model's behaviour or a library goes to Research.

Log every move in the run file, forward or back, as one line: from, to, why.

**The bounce limit.** If the same stage has been sent back to twice for the same reason, don't try a third time. Stop, tell Israel what was tried and why it didn't hold, and give him the choice in plain terms. Three attempts at the same thing means the frame is wrong, and that's his call.

## His notes

Notes arrive at the gate, and sometimes mid-run. Take each one separately, decide where it goes, and tell him where each went in a line before you start, so he can correct the routing.

| The note sounds like | Goes to |
|---|---|
| "cramped", "I don't like this", "off brand", "should feel like…", "too much" | The look |
| "it should also…", "that's not how it works", "drop this", a changed rule | Plan. Research first if it needs something the model or a library doesn't do |
| "nothing happens", "wrong result", an error, a screenshot of something broken | Build, as a Fix: find the cause before changing anything |
| A small visual change: move, rename, reorder, swap | Fast lane: Build, Review, back to the gate |
| "why does it…?" | Answer it. No stage change. If the answer shows a gap, say so and offer it as a note |

If a note is a standing preference and not just about this screen ("a name should never be cut where the card can grow"), also write it into `frontend_memory.md` in the same turn. That file is why he doesn't have to say it twice.

When the notes are done, come back to the gate with the table updated and only the rows that changed marked to re-click.

## Batching, clearing and tokens (Israel, 25 October 2026)

- **Tokens are spent with care.** He hits the session and weekly limits fast. Read only the part of a file the step needs (an offset, a grep), never a whole long file twice in a session; don't re-read what's already in the conversation; keep tool output short (`tail`, `head`, `--stat`); no screenshots or previews beyond what the design check needs (one desktop and one phone width, light and dark split between them); on a Sonnet session no subagent where a grep or one read does (on Opus or Fable reads go to scouts; see "Who does each stage"); reports are short.
- **Small tasks go together in one batch:** tweaks and small fixes share a branch, a preview pass and one round up.
- **A large task goes alone.** It isn't started on top of open work, nor open work on top of it. When one finishes, or before one starts, say plainly: "Time to round up and `/clear` before the next one", and wait for that.
- **Most urgent first** (see "Working through the list"), unless he interrupts or stacks something on top.

## Learning as it goes (Israel, 1 November 2026)

"I want you to constantly learn and update yourself from working with me and you may even decide what goes to global md and always share this updates with the jarvises you have reproduced."

- **Ask at the close of every run,** and at once when he corrects something mid-run: what did this run teach about how he wants things done, or about how this process works or fails? A correction, a preference he stated, a send-back, a check that missed something, a tool or machine quirk that cost time. Most runs teach nothing new; say so and move on.
- **Write each lesson where it belongs,** in the same round up, without asking him:
  - how this repo's work is built: `frontend_memory.md`, or `CLAUDE.md` for a repo rule;
  - how Jarvis itself runs (a stage, a check, who does what, the round up): this file or the stage file;
  - true for every project he works in (how he works, what he wants from any session, how a tool behaves on his machines): his global `~/.claude/CLAUDE.md`, short, in the section it fits;
  - only about this conversation: nowhere.

  One place per rule. A lesson that changes an older rule replaces it rather than sitting beside it.
- **This Jarvis is a fork.** It was copied from the Tabs Jarvis for a personal project, and the copies are separate. A lesson about how Jarvis works that isn't about one repo may be worth offering to the Tabs Jarvis copies, but only with Israel's say-so, and never by editing those repos from here: tell him the lesson and let him decide where it goes.
- **Say it in the run's report,** one line per lesson: what was learned and where it went.

## What holds at every stage

- **Stop only for what is his.** Before the gate, the only reasons to stop are: a decision only he can make, anything destructive or that leaves the machine (commits and merges wait for "round up"), or the bounce limit.
- **Images never leave the device.** The model runs in a Web Worker in the browser; a picture is read, processed and exported on the device. No uploads, no analytics or logging that carries image data, no third-party service that receives a picture or anything derived from one. The one network use is downloading the model's files, once, from Hugging Face. When a design would be better with a server, that is not a gap to file; it is the rule working.
- **No version number to set.** Vercel deploys `main` once the repo is connected; there is no release step to run.
- **Say what was checked.** Every report states what was run or looked at and what wasn't. "Type-checked and built; seen in a preview with a sample image; not run on a phone" is a complete, honest status. "Done" is not.
- **Nothing invented about the model or a library.** Build from what `src/lib/protocol.ts`, `src/lib/useRemover.ts` and the worker actually do, and from the library's own docs. What the model can't do yet is a note for Israel, not a flag.
- **No secrets.** Don't read `.env` files.
- **Leave nothing behind.** Preview files, scratch scripts and debug lines are gone before Review ends.
- **One run per branch,** except when working through the list (above), where the runs stack. A second, unrelated task he brings while a run is open gets its own run and branch, after the open one reaches the gate or he says to switch; then "Switching" says how.
