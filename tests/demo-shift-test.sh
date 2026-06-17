#!/usr/bin/env bash
# The 5 to 9 — test that demo-shift.sh exits 0 and writes the sample report.
# This is a reproducibility gate: the demo must run offline with a scripted cook.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

fail=0
ok() { printf '  OK %s\n' "$*"; }
no() { printf '  FAIL %s\n' "$*"; fail=1; }

if ! command -v bd >/dev/null 2>&1; then
  echo "demo-shift-test: bd not installed — skipped (CI mode)"
  exit 0
fi

# Run demo-shift.sh; it should exit 0 and write docs/sample-shift-report.md.
TMP_REPORT="$(mktemp)"
cleanup() { rm -f "$TMP_REPORT" 2>/dev/null || true; }
trap cleanup EXIT

bash "$ROOT/scripts/demo-shift.sh" >/dev/null 2>&1
rc=$?
[[ "$rc" -eq 0 ]] && ok "demo-shift.sh exited 0" \
                  || no "demo-shift.sh exited $rc (must be 0)"

report="$ROOT/docs/sample-shift-report.md"
[[ -f "$report" ]] && ok "docs/sample-shift-report.md exists" \
                    || no "docs/sample-shift-report.md not found after demo-shift.sh"

if [[ -f "$report" ]]; then
  grep -q 'QUEUE-EMPTY' "$report" && ok "report contains QUEUE-EMPTY" \
                                  || no "report missing QUEUE-EMPTY"
  grep -q 'Shift closed' "$report" && ok "report contains clock-out summary" \
                                    || no "report missing clock-out summary"
  grep -q 'scripted cook' "$report" && ok "report is honest — labels it a scripted-cook demo" \
                                     || no "report does not label it a scripted-cook demo (must be honest)"
  grep -q 'MECHANICS DEMO' "$report" && ok "report has MECHANICS DEMO header" \
                                      || no "report missing MECHANICS DEMO header"
fi

if [[ "$fail" -eq 0 ]]; then
  echo "demo-shift-test: GREEN"
  exit 0
else
  echo "demo-shift-test: RED"
  exit 1
fi
