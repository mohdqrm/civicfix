# Contributing to CivicFix

CivicFix is built by a four-person team. This page describes how we work in this repository, so the history shows who did what and every change on `main` is working code.

## Branches

- `main` holds **released, working code**. Every push to `main` redeploys the live site, so nobody pushes to it directly.
- Do each piece of work on its own branch, named after what it does:
  - `feature/<name>`: new functionality, for example `feature/email-notifications`
  - `fix/<name>`: bug fixes, for example `fix/map-tiles-referrer`
  - `docs/<name>`: documentation only

```bash
git checkout main
git pull
git checkout -b feature/my-change
```

## Commits

- Commit small, working steps, and commit regularly.
- Write the message in the imperative, under about 70 characters, for example: `Add rejection reason to status history`.
- If the reason isn't obvious, add a blank line and explain *why* in the body.
- Never commit `server/.env`, passwords or connection strings. `.gitignore` already excludes `.env`.

## Pull requests

1. Before opening one, run `npm test`. If you changed pages, also run `npm run test:e2e`.
2. Push your branch and open a pull request into `main`. Say what changed, how you tested it, and add screenshots for any change to the interface.
3. Another team member reviews it. Fix anything they raise with new commits on the same branch.
4. Merge it once it is approved and the tests pass.

## Where things go

| Change | Folder |
|---|---|
| A page or UI component | `client/src/pages`, `client/src/components` |
| An API endpoint | `server/src/routes` (HTTP) + `server/src/services` (logic) + `server/src/validation` (Zod schema) |
| A database change | a new numbered file in `server/src/db/migrations` (never edit an applied migration) |
| Tests | `server/tests/api`, `client/src/test`, `e2e` |
| Documentation | `docs/` and the README |
