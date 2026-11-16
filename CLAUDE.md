# Cameo: project instructions

Cameo is an in-browser background remover: Vite, React and TypeScript, with pnpm. The model (`onnx-community/BiRefNet_lite-ONNX`) runs through `@huggingface/transformers` in a Web Worker.
It is a static site, deployed on Vercel from `main` once connected, to share with friends. Israel is the only owner. There is no backend, API, auth or database.

- **Check:** `pnpm check` (typecheck, `prettier --check src`, build). Run it before calling anything done.
- **Privacy:** images never leave the device. No uploads, and no analytics that send image data.
- **No AI attribution** anywhere: commits, PRs, docs, comments.
- **Frontend work goes through `/jarvis`** (`.claude/jarvis/PROCESS.md`). Read `frontend_memory.md` first, in full.
- **Brand:** `docs/design/DESIGN_SYSTEM.md`. What's still to build: `docs/todo.md`.
- **Branches:** `israel/<slug>` off `main`; worktrees at `.worktrees/<branch-slug>`; never push to `main` directly.
