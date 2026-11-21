# Contributing to Cameo

Thanks for wanting to help. Cameo is a small project with one owner, so a short, clear change is the easiest kind to review.

## The one rule

Images never leave the device. No uploads, and no analytics that send image data. A change that breaks this will not be merged.

## Filing issues

Use the forms: one for bugs, one for feature requests.

- Say which browser and device you use, and paste what **About this device** shows.
- Never attach a photo you would not want to be public. Issues are public, and Cameo never sees your photos, so a description of what you saw is enough.

## Reporting security issues

Do not open a public issue. Report it privately: see [SECURITY.md](../SECURITY.md).

## Contributing code

### Local setup

You need Node 20+ and [pnpm](https://pnpm.io).

```sh
git clone https://github.com/mikelisrael/cameo.git
cd cameo
pnpm install
pnpm dev
```

Open the URL Vite prints (usually http://localhost:5173).

### Before you open a pull request

- Run `pnpm check`. It must pass: typecheck, formatting, build and the first-screen size budget.
- Run `pnpm e2e` if you changed the core flow (drop, cut out, background, download).
- Look at your change at phone width, about 390 px, and in both light and dark themes.
- Follow [docs/design/DESIGN_SYSTEM.md](../docs/design/DESIGN_SYSTEM.md) for colours, type and motion.
- Keep to one topic per pull request, and branch off `main`.

### What makes a change easy to merge

- It is small, and the description says what changed and why.
- It comes with a screenshot for anything visible.
- A new model loads only when its feature is first used, never on open, and its licence is recorded next to it in `public/models/`. People should not download models for tools they never use.
- It adds a line under Unreleased in [CHANGELOG.md](../CHANGELOG.md) if a user would notice it.

## Thanks

Every issue, fix and kind word helps. Thank you.
