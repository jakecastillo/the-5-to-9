# The 5 to 9

**The shift that works while you're off the clock.**

[![validate](https://github.com/jakecastillo/the-5-to-9/actions/workflows/validate.yml/badge.svg)](https://github.com/jakecastillo/the-5-to-9/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-orange.svg)](CHANGELOG.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Discussions](https://img.shields.io/badge/Discussions-join-blueviolet.svg)](https://github.com/jakecastillo/the-5-to-9/discussions)

The 5 to 9 is a Claude Code plugin that clocks in a night-shift crew of AI role-agents to work a [beads](https://github.com/steveyegge/beads) backlog in parallel and ralph-loop a repo to done — hands-off, with hard gates only on irreversible actions. You hand it a goal, it runs a tight service loop on a dedicated shift branch, and you read the shift report in the morning. Funny on the surface, rigorous underneath.

> Status: **v0.1.0, early/experimental.** Use with caution and keep an eye on long runs (see [Status](#status)).

---

## Why

More agents don't make better software. Role-theater — a dozen bots cosplaying a corp org chart, CC'ing each other into infinite meetings — burns tokens and ships nothing. The 5 to 9 bets on the opposite:

- **Crisp roles, not headcount.** A small crew, each with one job and a real boundary. No two agents own the same decision.
- **Beads memory, not a chat scrollback.** Work lives in a dependency-aware backlog (`bd`) with atomic claims and durable notes — not in a context window that rots over a long run.
- **Independent QA, not self-grading.** The cook who writes the code never signs off on it. A separate inspector verifies against the bead's acceptance criteria.
- **Hard gates, not vibes.** Reversible work just proceeds. Irreversible, outward-facing actions stop and ask. That's the whole safety model, and it's small on purpose.

If a step doesn't make the code more correct or the loop more honest, it's not in here.

---

## Meet the crew

| Name | Role | Default model |
|------|------|---------------|
| **The Owner** | Executive — strategy & goal-setting | `opus` |
| **The Floor Manager** | Project manager / orchestrator (lead) | `sonnet` |
| **The Regular** | Business analyst (voice of the user) | `sonnet` |
| **The Line Cook** | Developer (TDD, works in an isolated worktree) | `sonnet` |
| **The Health Inspector** | QA / independent verifier | `sonnet` |
| **The Bouncer** | Security | `opus` |
| **The Janitor** | DevOps / CI-CD | `haiku` |

Right-sized models for right-sized jobs: the heavy thinkers (strategy, security) get `opus`, the steady workers get `sonnet`, the chores get `haiku`.

---

## How a shift works

1. **Clock in.** `/clock-in [goal]` — the crew shows up and reads the room.
2. **Stand-up.** The Owner and the Regular refine the goal into real, testable outcomes. The Floor Manager turns those into beads with dependencies.
3. **The service loop** (repeat until the backlog is clear):
   - `bd ready --claim` — a fresh worker atomically claims the next unblocked bead.
   - The Line Cook does **one** bead, TDD, in an isolated worktree.
   - **Mechanical gate** — the build/tests/lint run. No green, no pass.
   - **Independent QA** — the Health Inspector verifies the work against the bead's acceptance criteria. The author doesn't grade their own homework.
   - **Close** the bead, record what happened in beads memory, and go back to `bd ready`.
4. **Clock out.** `/clock-out` ends the shift and prints a report: what shipped, what's blocked, what's next.
5. **Refine scope** and run the next shift.

Other commands: `/shift-status` (peek at the loop mid-run) and `/the-5-to-9` (help / overview).

---

## Two ways to run

**1. Watched — `/clock-in`**
In-session, you're at the wheel. Best for **short shifts**: context accumulates as the run goes, so this is the one to babysit.

**2. Hands-off — `scripts/night-shift.sh --max-iterations N`**
An external **fresh-process** loop — the real night-shift engine. Each iteration starts with clean context (no rot), works one bead, and exits. This is what you point at a long backlog before you go to bed.

```bash
bash scripts/night-shift.sh --max-iterations 25
```

Same crew, same gates, same beads backlog either way — the only difference is how long you want to leave it alone.

---

## Safety

The 5 to 9 is built to run under Claude Code **bypass-permissions** — so the gate and a real security policy aren't decoration, they're the point.

- **Autonomous on everything reversible.** Edits, commits, branches, PRs, and normal pushes to the shift branch just happen.
- **Hard-gated on irreversible, outward actions** — these stop and ask, every time:
  - Deploying to **prod / remote**.
  - **Publishing** a release or a package.
  - `git push --force`.
  - **Deleting remote data** — branches, prod DB, releases.
  - **Destroying or rotating secrets.**
- **Dedicated shift branch.** The crew works on its own branch; `main` / prod are never touched without the gate.
- **No-clobber.** It never edits your repo's `CLAUDE.md` / `AGENTS.md`. Context is injected additively via hooks and skills. Instruction priority is: **your repo > The 5 to 9 > defaults.**

---

## Install

**Local dev:**
```bash
git clone https://github.com/jakecastillo/the-5-to-9
cd the-5-to-9
claude --plugin-dir .
```

**Via marketplace:**
```text
/plugin marketplace add jakecastillo/the-5-to-9
/plugin install the-5-to-9@the-5-to-9
```

Memory is beads: commit the JSONL export, and let the local `.beads` DB stay gitignored.

**Test gate:**
```bash
bash tests/validate-plugin.sh   # must exit 0; CI runs it
```

---

## Status

**v0.1.0 — early and experimental.** It works, but treat it like a new hire on the night shift: capable, worth watching. Use with caution, and **monitor long runs** — the fresh-process loop avoids context rot, but you still want eyes on it before you trust it with a big backlog unattended.

It's built to play nicely with [superpowers](https://github.com/obra/superpowers) (agentic skills) and the Ralph loop technique, and it's being built to be **cross-tool** — Claude CLI today, with Codex CLI and apps to follow.

---

## Credits

The 5 to 9 complements these — it does not replace them:

- **[beads](https://github.com/steveyegge/beads)** — the `bd` issue tracker / agent memory, by Steve Yegge.
- **[superpowers](https://github.com/obra/superpowers)** — the agentic skills framework, by Jesse Vincent (github [obra](https://github.com/obra)).
- **The "Ralph" loop** technique, by Geoffrey Huntley.

---

## License

MIT — © jakecastillo.
