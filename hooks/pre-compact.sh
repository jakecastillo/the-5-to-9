#!/usr/bin/env bash
# The 5 to 9 — PreCompact hook: preserve memory across a context compaction by
# exporting the beads JSONL and re-priming workflow context. Memory lives in beads,
# so a compaction never loses the shift's state. Always exits 0. Git-Bash-compatible.

F9_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck source=../scripts/lib/common.sh
. "$F9_ROOT/scripts/lib/common.sh" 2>/dev/null || exit 0

cat >/dev/null 2>&1 || true   # drain stdin payload

if f9_shift_active && f9_have bd; then
  f9_export_beads_dir
  bd export >/dev/null 2>&1 || true
  bd prime  >/dev/null 2>&1 || true
  f9_log "pre-compact: exported beads JSONL + re-primed workflow context"
fi
exit 0
