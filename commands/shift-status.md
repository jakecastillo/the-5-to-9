---
name: shift-status
description: Peek at the shift mid-run — whether a shift is active, the goal, the branch, iteration count, what's ready vs blocked in the beads backlog, and the latest test-gate result. Read-only.
allowed-tools: Bash, Read, Grep, Glob
---

# Shift status 📋

A quick read on where the night shift stands. Read-only — this changes nothing.

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup-shift.sh" --status 2>/dev/null \
  || cat "$(git rev-parse --show-toplevel 2>/dev/null || echo .)/.claude/five-to-nine/shift.local.md" 2>/dev/null \
  || echo "No active shift. Run /clock-in [goal] to start one."
```

Then surface the backlog state from beads (the source of truth, not memory):

```bash
bd status        2>/dev/null || echo "beads not initialized"
bd ready --json  2>/dev/null | jq 'length as $n | "ready beads: \($n)"' 2>/dev/null || true
```

Summarize in a few lines: **active?** · **goal** · **branch** · **iteration / cap** ·
**ready vs blocked** · **last gate result**. If a bead is stuck or the loop shows
no-progress, flag it. Don't start or advance work here — `/clock-in` does that.
