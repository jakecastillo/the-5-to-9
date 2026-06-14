# CLAUDE.md

Claude Code does not yet read `AGENTS.md`, so this thin file imports it. The canonical
guide for working on this repository lives there.

@AGENTS.md

## Quick reference

- Test gate: `bash tests/validate-plugin.sh` (must exit 0 before any task is "done").
- Plugin entrypoints: `/clock-in`, `/clock-out`, `/shift-status`, `/the-5-to-9`.
- Long hands-off runs: `bash scripts/night-shift.sh --max-iterations 30`.
- The crew, the loop, and the beads conventions are defined in `skills/` and `agents/`.
