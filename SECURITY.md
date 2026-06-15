# Security Policy

The 5 to 9 runs a crew of autonomous agents that can read, write, run, and commit
code in your repository — by design, often under Claude Code **bypass-permissions**.
That power is the whole point, and it is also the threat model. Please read this
before running it on anything you care about.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅ (active development) |
| < 0.1   | ❌ |

This is early, experimental software. Treat it accordingly.

## What the crew can do (threat model)

When a shift is active, the agents may: edit files, create branches, run shell
commands and tests, install dependencies, and make commits on a dedicated **shift
branch**. They operate from your machine with your credentials and your tools.

The crew is built **not** to take irreversible outward actions on its own.

## Built-in guardrails

- **Shift branch isolation** — work happens on a dedicated branch, never directly on
  `main`/`master` or a production branch.
- **Irreversible-action hard gate** — a `PreToolUse` classifier blocks and asks for a
  human decision before: production/remote deploys, publishing a release or package,
  `git push --force`, deleting remote data (branches, releases, databases), and
  destroying or rotating secrets. It splits the command on shell separators and
  classifies each part, so a force-push or deploy can't sneak through inside a compound
  command. It is a best-effort **deny-list, not a sandbox**: it covers the named outward
  actions across common tools but can't be exhaustive, and purely *local* destruction
  (`rm -rf`, `dd`) is intentionally out of scope — the crew works a deletable shift
  branch, and your review of that branch is the real backstop.
- **No-clobber** — the crew never modifies your `CLAUDE.md`/`AGENTS.md`; it injects
  context additively and obeys your repo's existing guardrails first.
- **Capped iterations** — loops always run with a maximum iteration count.
- **Local secrets stay local** — `.beads` databases and `.env*` files are gitignored;
  a secret scan runs in the test gate.

## Running it safely

- Run it on a repository **you control** and can roll back (it commits to a branch you
  can delete).
- **Review the shift branch** before merging or releasing anything.
- Keep real secrets **out of the repo** — use environment variables or a secrets
  manager, never committed files.
- Start with a small, well-scoped goal and a low `--max-iterations` before trusting it
  with larger runs.
- Do not point it at infrastructure you cannot afford to have changed.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for a
vulnerability.

1. Preferred: open a private report via **GitHub Security Advisories**
   (the repository's *Security → Report a vulnerability* tab).
2. Include: a description, reproduction steps, affected version, and potential impact.

We aim to acknowledge reports within a few days and will coordinate a fix and
disclosure timeline with you. Thank you for helping keep the night shift honest.
