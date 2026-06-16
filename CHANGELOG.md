# Changelog

All notable changes to **The 5 to 9** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-16

Initial early/experimental release. The shift that works while you're off the clock.

### Added

- **Night-shift crew (the Card Room).** Role-agents that clock in to work a backlog in
  parallel, funny on the surface and rigorous underneath:
  - The Owner — executive / strategy & goal-setting (opus)
  - The Pit Boss — project manager / orchestrator, the lead (sonnet)
  - The Cage Cashier — integration / single-writer merge gate (sonnet)
  - The Dealer — developer, TDD in an isolated worktree (sonnet)
  - The Floor Auditor — QA / independent verifier (sonnet)
  - The Eye in the Sky — security (opus)
  - The Floorman — devops / CI-CD (haiku)
- The executable engine: the four commands, the `running-the-shift` /
  `shift-memory-beads` skills, all hooks (the irreversible-action gate, the Stop-hook
  shift loop, SessionStart/UserPromptSubmit/PreCompact), the scripts, and the
  `tests/validate-plugin.sh` gate (a 90-case gate corpus + an end-to-end smoke test,
  run in CI).
- **Node migration (Phase 0–1):** the irreversible gate runs on zero-dependency Node
  (`hooks/irreversible-gate.mjs`) behind a fail-closed bash launcher, with `node --test`
  unit tests; orchestration scripts stay POSIX bash by design.
- **Beads-backed orchestration.** Memory is [beads](https://github.com/steveyegge/beads)
  (`bd`): a backlog plus a dependency DAG, atomic `bd ready --claim` so two agents never
  grab the same ticket, and durable cross-session memory. The JSONL export is committed;
  the local `.beads` DB is gitignored.
- **Dual run engines.** `/clock-in [goal]` — in-session, watched run for SHORT shifts
  (context accumulates over long runs); and `scripts/night-shift.sh --max-iterations N`
  — external fresh-process loop, the hands-off engine for long runs (fresh context each
  iteration, no rot).
- **Irreversible-action hard gate.** Autonomous by default, but irreversible OUTWARD
  actions stop for explicit approval: prod/remote deploy, publishing a release or package,
  `git push --force`, deleting remote data (branches / prod DB / releases), and destroying
  or rotating secrets. Everything reversible — edits, commits, branches, PRs, normal pushes
  to the shift branch — proceeds. The crew works a dedicated shift branch; main/prod are
  never touched without the gate. Designed to run under Claude Code bypass-permissions, so
  the gate and a real SECURITY policy carry the weight.
- **Cross-tool portable core.** The brain (`AGENTS.md`), the protocol (skills), the loop
  (POSIX bash scripts/hooks), the memory (beads), and MCP servers are tool-agnostic: it
  ships as a Claude Code plugin today and runs under Codex full-auto, with native
  Codex/Cursor plugin wiring flagged phase-2.
- **Architecture documentation.** `docs/ARCHITECTURE.md` with mermaid diagrams (crew
  topology + the author≠grader firewall, the service loop, the irreversible-action gate,
  and cross-tool portability + the two run engines), plus a reworked `docs/INSTALL.md`
  (three labeled install options, the reload-after-install step, prerequisites split into
  core vs driver-only).
- **OSS guardrails.** No-clobber behavior: never modifies a user repo's `CLAUDE.md` /
  `AGENTS.md`; context is injected additively via hooks and skills only. Instruction
  priority is user repo > The 5 to 9 > defaults. MIT licensed.
- **Community health:** `.github/SUPPORT.md`, `.github/CODEOWNERS`, `GOVERNANCE.md`,
  `CITATION.cff` ("Cite this repository"), `.editorconfig` (LF-enforced for the Git-Bash
  POSIX scripts), and `.github/dependabot.yml` (github-actions ecosystem). README badges
  (CI, license, version, Discussions) and a sample shift report. Code of Conduct: a real
  confidential contact and the Contributor Covenant 2.1 enforcement ladder.
- **Commands:** `/clock-in [goal]`, `/clock-out`, `/shift-status`, `/the-5-to-9`.
- **Test gate:** `bash tests/validate-plugin.sh` must exit 0; CI runs it.

### Changed

- Hardened `validate.yml` with a least-privilege `permissions: contents: read` block;
  `shellcheck` is a blocking CI check.
- Security policy: added an email fallback channel and an acknowledgement SLA.
- Bug-report template now asks for the Claude Code version (matching CONTRIBUTING).

### Credits

Built on and complements (does not replace): [beads](https://github.com/steveyegge/beads)
by Steve Yegge, [superpowers](https://github.com/obra/superpowers) by Jesse Vincent,
and the "Ralph" loop technique by Geoffrey Huntley.

[Unreleased]: https://github.com/jakecastillo/the-5-to-9/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jakecastillo/the-5-to-9/releases/tag/v0.1.0
