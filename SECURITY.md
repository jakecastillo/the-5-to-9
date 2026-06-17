# Security Policy

The 5 to 9 runs a crew of autonomous agents that can read, write, run, and commit
code in your repository — by design, often under Claude Code **bypass-permissions**.
That power is the whole point, and it is also the threat model. Please read this
before running it on anything you care about.

## Supported versions

| Version | Supported               |
| ------- | ----------------------- |
| 0.1.x   | ✅ (active development) |
| < 0.1   | ❌                      |

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
  actions across common tools but can't be exhaustive, and purely _local_ destruction
  (`rm -rf`, `dd`) is intentionally out of scope — the crew works a deletable shift
  branch, and your review of that branch is the real backstop. The gate runs on
  **Node 18+** behind a bash launcher; if `node` is absent it falls back to the bash
  classifier (and a SessionStart preflight warns you), so a missing runtime never
  silently disables it.
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

1. **Preferred:** open a private report via **GitHub Security Advisories**
   (the repository's _Security → Report a vulnerability_ tab).
2. **Fallback:** if you can't use Advisories, email **jakecast@hawaii.edu** with
   `[the-5-to-9 security]` in the subject.
3. Include: a description, reproduction steps, affected version, and potential impact.

We aim to **acknowledge reports within 3 business days** and will coordinate a fix and
a disclosure timeline with you (target: a fix or mitigation plan within 30 days for
confirmed issues, faster for anything actively exploitable). Please give us a reasonable
window to ship a fix before any public disclosure. Thank you for helping keep the night
shift honest.
