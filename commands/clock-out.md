---
name: clock-out
description: End the current shift and print the shift report — what shipped, what's blocked, the test-gate result, and any gated irreversible actions left for a human. Then refine scope for the next shift.
allowed-tools: Bash, Read, Grep, Glob, Task
---

# Clock out 🧹

Last call. Wrap the shift cleanly and leave a report for whoever reads it in the morning.

## 1. Close the shift

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/clock-out.sh"
```

This archives the gitignored shift state and prints the run summary.

## 2. Write the shift report

Pull the real numbers from beads and git — do not summarize from memory:

```bash
bd status
bd ready --json
git log --oneline "$(git merge-base HEAD main 2>/dev/null || echo HEAD)"..HEAD 2>/dev/null
```

Report, briefly:

- **Shipped** — beads closed this shift and the commits that closed them.
- **Still open** — what's ready, what's blocked, and on what.
- **Gate** — the repo's real test-gate result (green/red, with the command).
- **Held at the gate** — any irreversible outward action the crew deliberately left for a
  human (and the exact command waiting).
- **Next** — the smallest sensible next epic to open when scope is refined.

## 3. Independent sign-off

Completion is not self-graded. Confirm the **Health Inspector** verified the closed work
against acceptance, the **Bouncer** has no open `security` block, and the mechanical gate is
genuinely green. If any of those is missing, say so plainly — the shift is *paused*, not done.

Leave the kitchen clean: shift branch committed, JSONL export updated, nothing half-plated.
