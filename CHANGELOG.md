# Changelog

All notable changes to **The 5 to 9** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet. The crew is on break._

## [0.1.0] - 2026-06-14

Initial early/experimental release. The shift that works while you're off the clock.

### Added

- **Night-shift crew.** A set of role-agents that clock in to work a backlog in
  parallel, funny on the surface and rigorous underneath:
  - The Owner — executive / strategy & goal-setting (opus)
  - The Floor Manager — project manager / orchestrator, the lead (sonnet)
  - The Regular — business analyst, voice of the user (sonnet)
  - The Line Cook — developer, TDD in an isolated worktree (sonnet)
  - The Health Inspector — QA / independent verifier (sonnet)
  - The Bouncer — security (opus)
  - The Janitor — devops / CI-CD (haiku)
- **Beads-backed orchestration.** Memory is [beads](https://github.com/steveyegge/beads)
  (`bd`): a backlog plus a dependency DAG, atomic `bd ready --claim` so two agents
  never grab the same ticket, and durable cross-session memory. The JSONL export is
  committed; the local `.beads` DB is gitignored.
- **Dual run engines.**
  - `/clock-in [goal]` — in-session, watched run for SHORT shifts (context
    accumulates over long runs).
  - `scripts/night-shift.sh --max-iterations N` — external fresh-process loop, the
    hands-off engine for long runs (fresh context each iteration, no rot).
- **Irreversible-action hard gate.** Autonomous by default, but irreversible OUTWARD
  actions stop for explicit approval: prod/remote deploy, publishing a release or
  package, `git push --force`, deleting remote data (branches / prod DB / releases),
  and destroying or rotating secrets. Everything reversible — edits, commits,
  branches, PRs, normal pushes to the shift branch — proceeds. The crew works on a
  dedicated shift branch; main/prod are never touched without the gate. Designed to
  run under Claude Code bypass-permissions, so the gate and a real SECURITY policy
  carry the weight.
- **Cross-tool portable core.** The role definitions and loop logic are kept portable
  rather than welded to a single host, so the crew can move between tools.
- **OSS guardrails.** No-clobber behavior: never modifies a user repo's
  `CLAUDE.md` / `AGENTS.md`; context is injected additively via hooks and skills only.
  Instruction priority is user repo > The 5 to 9 > defaults. MIT licensed.
- **Commands:** `/clock-in [goal]`, `/clock-out`, `/shift-status`, `/the-5-to-9`.
- **Test gate:** `bash tests/validate-plugin.sh` must exit 0; CI runs it.

### Credits

Built on and complements (does not replace): [beads](https://github.com/steveyegge/beads)
by Steve Yegge, [superpowers](https://github.com/obra/superpowers) by Jesse Vincent,
and the "Ralph" loop technique by Geoffrey Huntley.

[Unreleased]: https://github.com/jakecastillo/the-5-to-9/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jakecastillo/the-5-to-9/releases/tag/v0.1.0
