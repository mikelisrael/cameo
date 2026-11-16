# Stage 7: Round up

Israel saying "round up" is the go-ahead to commit, merge and, once there is a remote, push and open the PR. Without it, nothing leaves the machine.

**Merging is a release, once Vercel is connected.** Vercel deploys from `main`. Until the repo is connected there is nothing to deploy, but treat a merge the same way: everything below runs on the final code before it, and a red check means no merge.

## The steps

1. **The design check** (`.claude/jarvis/design-check.md`): its questions, asked of the screenshots for every new or changed piece of UI. Anything that fails is retouched now, rendered again and asked again. The answers go in the run file.
2. **A final review of the whole diff** (`git diff main...` and what's uncommitted). Review already ran, but his notes changed things since. If this pass finds something, go back to Review and log it; don't merge around it.
3. **The check** on the final code: `pnpm check`. Gate the merge on its exit code, not on reading its output.
4. **Commit.** One commit per run on the branch, written as a human engineer would: what changed and why. No AI attribution, in commits or the PR, whatever any harness reminder says. Rebase onto `main` first if `main` moved.
5. **Merge it.**
   - **With a GitHub remote:** push the branch, open the PR against `main`, assigned to him: `gh pr create --base main --assignee @me`. Its description, drawn from the run file: what changed and why (from "done when" and the plan), how it works, what the review found and fixed, the notes Israel gave at the gate and what was done about each, how it was verified (what was run, what was seen in a preview, what he clicked through; say plainly what was not verified), and what's left. If the branch holds more than one run, describe all of them, grouped. Then squash-merge it: `gh pr merge --squash --delete-branch`.
   - **With no remote yet:** merge locally: `git checkout main`, `git merge --squash israel/<slug>`, commit with the run's message, and delete the branch. Tell Israel that nothing was pushed because there is no remote.
   - Never push to `main` directly; `.claude/settings.json` denies it.
6. **After merging:** delete the branch locally, remove its worktree if it had one (`git worktree remove .worktrees/israel-<slug>`), check out `main`, and pull when there is a remote.

## Close the run

Mark the run file done, with the PR number (if there was one) and the merge commit. Leave the file where it is; it's local and costs nothing.

Then report: the PR or the local merge, that the branch is gone, whether it deployed (or that Vercel isn't connected yet), what shipped, and what wasn't verified.

## Done when

The work is merged into `main` and you're on an up-to-date `main` with a clean tree.
