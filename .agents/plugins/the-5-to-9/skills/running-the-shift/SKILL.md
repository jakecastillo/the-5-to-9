---
name: running-the-shift
description: "Use when running a The 5 to 9 night shift on a target repo — clocking in a crew to work a beads backlog and ralph-loop the repo to done. Defines the crew, the service loop, the test gate, read-parallel/write-serial, the iteration cap, no-clobber, and the irreversible-action gate."
---

# Running the Shift

This is the protocol. The crew clocks in, refines a goal into a beads backlog, and
works a tight service loop until the backlog is clear and the test gate is green —
hands-off, with hard stops only on irreversible outward actions. It is portable: it
reads under Claude Code, Codex, and any AGENTS.md-aware agent. The target repo's own
docs win over this skill (see [No-clobber](#no-clobber-the-repo-wins)).

If you are running on Claude Code, the entrypoint is `/clock-in [goal]`. Under Codex,
paste `codex/prompts/clock-in.md`. Either way, the loop below is the same.

## The crew (dispatch only when a bead needs them)

Seven roles, each a subagent with one job and a real boundary. Wear the hat the bead
calls for; do **not** convene a standup — work lives in beads, not in chatter.

- **The Owner** — sets the one goal + acceptance. Rare, decisive. (`opus`)
- **The Pit Boss** — orchestrator/lead: decompose → wire deps → dispatch → integrate. (`sonnet`)
- **The Cage Cashier** — integration: the single-writer merge gate; reconciles one bead at a time. (`sonnet`)
- **The Dealer** — developer: one bead, TDD, isolated worktree. (`sonnet`)
- **The Floor Auditor** — QA: independent verification against the rubric. (`sonnet`)
- **The Eye in the Sky** — security: secrets/deps/authz scan; owns the release block. (`opus`)
- **The Floorman** — devops/CI: keep the gate green, preflight, release prep. (`haiku`)

Models are defaults — see the `right-sizing-the-crew` skill to escalate/override.

## Clock in (minimal bootstrap)

1. **Read the room, cheaply.** One ephemeral pass reads the repo's intent + guardrails
   (`README`, `CLAUDE.md`/`AGENTS.md`, `CONTRIBUTING`, test/lint/CI config) and returns
   a ≤1-page brief. Do not front-load everything; load just-in-time.
2. **Branch.** Work on a dedicated shift branch (`the-5-to-9/shift-<date>`), never `main`
   or prod. Create it if absent.
3. **Beads is the brain.** Ensure `bd` is initialized (`bd doctor` / `bd init`). See the
   `shift-memory-beads` skill for conventions.
4. **Find the test gate.** Discover how this repo proves "green" — its real test/lint/build
   command. **No task is done on red.**

## Stand-up (shape the work, once)

The Owner turns intent into **one goal** with crisp `--acceptance`. The Owner sharpens
it into testable criteria and cuts gold-plating. The Pit Boss builds the bead graph:
epics → features → tasks, wired with real `blocks` / parent-child edges (only those gate
`bd ready`; `discovered-from` is provenance, not a blocker).

## The service loop (always guarded)

A dumb, honest heartbeat over a smart backlog. Repeat until `bd ready` is empty, progress
stalls, or an **optional** iteration cap (`--max-iterations N`) is hit — the loop is
**uncapped by default** and self-advances to empty/stall (see the guards below):

1. **Claim** atomically: `bd ready --claim --json`. No two workers grab the same bead.
2. **Plan** (Pit Boss) → **confirm scope** with the Owner if fuzzy.
3. **Implement** (Dealer) — **one** bead, **test first**. Write a failing test that
   encodes the acceptance criteria and fails on a *stub* (no placeholder cheating). Then
   make it pass; refactor. Work in an isolated worktree when assigned (`git worktree add`; export
   `BEADS_DIR` so the worktree finds the main DB). **Serialize writes** — beads' store is
   single-writer; never write the DB from two places at once.
4. **Mechanical gate** — run the repo's real typecheck/lint/test/build. Green or it doesn't
   close. This is non-fakeable backpressure: no green, no close.
5. **Independent QA** (Floor Auditor) — verify against the bead's acceptance with a fixed
   rubric. **The author never grades their own homework.** On fail, file a `bug` bead that
   `blocks` the feature and re-queue; don't quietly fix.
6. **Security pass** (Eye in the Sky) when the bead touches secrets/deps/authz/outward actions.
7. **Commit** to the shift branch (message says *why*) → `bd close <id>` → record durable
   notes in beads (memory lives in beads, not this conversation).
8. **Record discovered work** as fresh beads with `discovered-from` edges.

**Read-parallel, write-serial.** Fan out independent reads/analysis (prior-art research,
Eye in the Sky scan, Floor Auditor test design) together. Serialize all code writes; isolate
only genuinely-independent edits in worktrees. Spawning a role costs ~15× the tokens of
doing the read inline — right-size and reserve it.

## Don't run forever (degenerate-loop guards)

- **Guard the loop, always.** QUEUE-EMPTY + the no-progress stall are the terminators; an
  explicit iteration ceiling (`--max-iterations`) is optional (omit = uncapped, runs to
  empty/stall). Never run *unguarded*.
- **No-progress detection.** If N iterations (default 3) close/create no beads and the open
  count doesn't move, **stop and report** — the loop is stuck, not working.
- **Stuck-bead escalation.** A bead that fails its gate repeatedly gets escalated a model
  tier (see `right-sizing-the-crew`) or surfaced to a human, not retried blindly.

## The irreversible-action gate (hard stop — non-negotiable)

The 5 to 9 is built to run under bypass-permissions, so the crew must self-restrain.
Everything **reversible** proceeds without asking — file edits, commits, branches, PRs,
and normal pushes to the **shift branch**. **Hard-stop and require explicit human approval
before any irreversible OUTWARD action:**

- deploying to prod or any remote environment;
- publishing a release, tag, or package;
- `git push --force` / force-updating a shared ref;
- deleting remote data — remote branches, prod DB, releases;
- destroying or rotating secrets.

On Claude Code a `PreToolUse` hook (`hooks/irreversible-gate.sh`) classifies the pending
command and blocks the deny-list. Under Codex, **you** enforce it: if the only way forward
needs a gated action, **stop and surface it in the shift report** — never perform it. The
crew touches the shift branch; main/prod are off-limits without the gate.

## No-clobber (the repo wins)

Never modify the target repo's `CLAUDE.md` / `AGENTS.md`. Inject context additively (hooks,
skills) and obey the repo's existing guardrails first. **Instruction priority: target repo
> The 5 to 9 > defaults.** If the repo says "no TDD," the crew obeys the repo.

## Run engines

- **Watched — `/clock-in`** (in-session). Self-advances and runs continuously until the
  backlog drains or a guard trips. Context accumulates, so it's the one you babysit.
- **Hands-off — `scripts/night-shift.sh`** (external **fresh-process** loop). Each
  iteration starts with clean context, works one bead, exits. No context rot — the real
  night-shift engine for a long backlog. `--max-iterations N` caps it; omit to run to
  empty/stall.
- **SDK driver — `scripts/clock-in-dispatch.sh --driver`** (deterministic TypeScript
  runtime). K=1 on subscription backends; K≥2 requires `--backend api`. The dispatch
  script is the only junction — the bash loop and the driver never share code.

Never run two engines on the same goal at once. Watch any run read-only with
`/shift-status` or the live TUI: `bash scripts/shift-dashboard.sh --watch`.

## Clock out

When `bd ready` is empty or the cap is hit: stop and produce a **shift report** — what was
claimed/closed, what's still ready or blocked, the test-gate result, and any gated
irreversible actions deliberately left for a human. Then **refine scope**: open the next
epic and run the next shift, or hand back. Leave the kitchen clean.
