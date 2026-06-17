---
name: the-5-to-9
description: What The 5 to 9 is and how to use it — the crew, the commands, the run engines, the safety gate, and where to read more. Start here.
allowed-tools: Read, Grep, Glob
---

# The 5 to 9 🌙 — the shift that works while you're off the clock

A night-shift crew of AI role-agents that works a [beads](https://github.com/steveyegge/beads)
backlog in parallel and ralph-loops your repo to done — hands-off, with hard gates only on
irreversible actions. Funny on the surface, rigorous underneath.

## Commands

- **`/clock-in [goal]`** — start a shift. The crew reads the room, seeds a beads backlog,
  and works the loop on a dedicated shift branch.
- **`/clock-out`** — end the shift and print the report (shipped / blocked / gate / next).
- **`/shift-status`** — peek at the loop mid-run (read-only).
- **`/the-5-to-9`** — this overview.

## The crew

| Name | Role | Model |
|------|------|-------|
| The Owner | strategy & goal-setting | `opus` |
| The Pit Boss | orchestrator / lead | `sonnet` |
| The Cage Cashier | integration / merge gate | `sonnet` |
| The Dealer | developer (TDD, isolated worktree) | `sonnet` |
| The Floor Auditor | QA / independent verifier | `sonnet` |
| The Eye in the Sky | security | `opus` |
| The Floorman | devops / CI-CD | `haiku` |

## Ways to run

- **Watched — `/clock-in`** (in-session): the loop self-advances and runs continuously by
  default until the backlog drains or a guard trips. Context accumulates, so babysit it.
- **Hands-off — `scripts/night-shift.sh`**: the fresh-process loop, clean context per
  iteration, no rot. `--max-iterations N` caps it; omit to run to empty/stall.
- **SDK driver — `scripts/clock-in-dispatch.sh --driver`**: a deterministic TypeScript
  runtime (K=1 on subscription backends; K≥2 needs `--backend api`).

Watch any run read-only with `/shift-status` or the live TUI:
`bash scripts/shift-dashboard.sh --watch`.

## Safety (small on purpose)

Everything **reversible** proceeds — edits, commits, branches, PRs, pushes to the shift
branch. Everything **irreversible and outward** stops and asks: prod/remote deploy,
publishing a release/package, `git push --force`, deleting remote data, destroying/rotating
secrets. The crew works a dedicated shift branch; `main`/prod are never touched without the
gate. It **never** edits your `CLAUDE.md`/`AGENTS.md` — context is additive, and your repo's
rules win.

## Read more

The protocol is the **`running-the-shift`** skill; backlog/memory is **`shift-memory-beads`**;
model assignment is **`right-sizing-the-crew`**. Design and plan live under
`docs/superpowers/`. Ready? `/clock-in [goal]`.
