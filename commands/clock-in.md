---
name: clock-in
description: Clock in the night-shift crew on this repo and start a shift toward a goal. Bootstraps shift state on a dedicated branch, seeds a beads backlog, and runs the service loop hands-off with hard gates only on irreversible actions.
argument-hint: "[goal — what the crew should get done tonight]"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Task
---

# Clock in 🌙

The crew is showing up for the night shift on **this** repo. The goal for tonight:

> $ARGUMENTS

## 1. Open the shift (state + branch)

Run the setup script — it writes gitignored shift state and moves you to a dedicated
shift branch (never `main`/prod):

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup-shift.sh" "$ARGUMENTS"
```

If no goal was given above, infer the smallest defensible goal from the repo's own intent
(README / docs / open issues) and state the assumption out loud before proceeding.

## 2. Load the protocol

Invoke the **`running-the-shift`** skill and follow it exactly. It defines the crew, the
service loop, the test gate, read-parallel/write-serial, the iteration cap, no-clobber, and
the irreversible-action gate. For backlog/memory conventions use **`shift-memory-beads`**;
for model assignment use **`right-sizing-the-crew`**.

**The target repo wins.** Read its `CLAUDE.md`/`AGENTS.md`/`CONTRIBUTING` and obey them
first. Never modify them. Instruction priority: target repo > The 5 to 9 > defaults.

## 3. Stand-up

- **The Owner** shapes tonight's goal into one beads epic with crisp `--acceptance`.
- **The Pit Boss** sharpens it into testable criteria and cuts gold-plating.
- **The Pit Boss** decomposes it into a dependency-ordered backlog (`blocks` /
  parent-child edges only where work must wait).

## 4. Work the loop (capped)

Run the service loop from the skill until `bd ready` is empty or the iteration cap is hit
(default 30): `bd ready --claim` → Dealer implements one bead TDD → mechanical gate →
Floor Auditor verifies independently → commit on the shift branch → `bd close` → repeat.

Reversible work proceeds. **Stop at the gate** for any irreversible outward action
(deploy/publish/force-push/remote-delete/secret-destroy) and surface it for a human.

## 5. Long runs

This in-session engine is for **short, watched** shifts (context accumulates). For a long
hands-off backlog, two engines are available — pick one:

**Default (bash loop):** fresh process per iteration, no Node/pnpm required.

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/night-shift.sh" --max-iterations 30
```

**SDK driver (`--driver` flag):** deterministic TypeScript runtime, K=1 concurrency
for subscription backends (claude, codex). K>=2 requires `--backend api` (metered API
only — spec §2.1). Requires Node ≥ 20 and `pnpm install` in `driver/`.

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/clock-in-dispatch.sh" --driver --backend claude --max-iterations 30
```

The dispatch script (`scripts/clock-in-dispatch.sh`) routes: `--driver` → SDK driver
(`launch-driver.sh`); no flag → bash loop (`night-shift.sh`). The two engines never
share code — the dispatch is the only junction.

When the backlog is clear or the cap is hit, run `/clock-out` for the shift report.
