# Research App — Git Workflow

## Branch Hierarchy

```
session branch (claude/* / sunny / gleb / evgeniy / kd)
        │
        ▼
   engineering    ← team integration branch
        │
        ▼
      main        ← production
```

- `main` = production. **NEVER push directly to `main`**.
- `engineering` = team integration branch. PRs target this, not main.
- `engineering` must always be kept in sync with `main`. Before any PR, fast-forward `engineering` up to `main` if main is ahead.

## Pre-Push Sync (mandatory)

Before opening ANY PR, sync `engineering` with `main`:

```bash
git fetch origin main engineering
# check if main has commits engineering doesn't
git log --oneline origin/engineering..origin/main
# if non-empty AND engineering is ancestor of main, fast-forward push:
git push origin origin/main:engineering
# if engineering has its own commits, merge main into engineering instead:
#   git checkout engineering && git merge origin/main && git push origin engineering
```

This is the FIRST step of every push session. Never PR while `engineering` is behind `main`.

## Push Workflow

When asked to "push", "commit and push", or "push to git":

1. **Sync first** (see Pre-Push Sync above)
2. Commit changes on the session branch (`claude/*` for worktree sessions, or a dev branch)
3. Merge latest `origin/main` into the session branch if you haven't already
4. Push the session branch: `git push origin <branch-name>`
5. Open a PR targeting `engineering` (NOT main): `gh pr create --base engineering --head <branch-name>`

## Update Workflow

When asked to "update" or "pull latest":
1. `git fetch origin main && git merge origin/main`
2. Run `npm install` if package.json changed
