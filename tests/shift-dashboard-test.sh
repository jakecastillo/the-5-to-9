#!/usr/bin/env bash
# The 5 to 9 — tests for the shift dashboard bead-list renderer (phu.3.2).
# Stubs bd on PATH returning known ready/in_progress/blocked beads.
# Read-only: the renderer must never write beads or git.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

fail=0
ok() { printf '  OK %s\n' "$*"; }
no() { printf '  FAIL %s\n' "$*"; fail=1; }

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP" 2>/dev/null || true; }
trap cleanup EXIT

# ── stub bd ──────────────────────────────────────────────────────────────────
mkdir -p "$TMP/bin"
cat >"$TMP/bin/bd" <<'BDSTUB'
#!/usr/bin/env bash
# Fake bd for shift-dashboard tests.
case "$*" in
  "ready --json")
    printf '[{"id":"test-r1","title":"Ready bead one"},{"id":"test-r2","title":"Ready bead two"}]\n'
    ;;
  "list --status=in_progress --json")
    printf '[{"id":"test-ip1","title":"In-progress bead one"}]\n'
    ;;
  "list --status=blocked --json")
    printf '[{"id":"test-b1","title":"Blocked bead one"}]\n'
    ;;
  "blocked --json")
    printf '[{"id":"test-b1","title":"Blocked bead one"}]\n'
    ;;
  # Writes must never be called — surface them loudly.
  "create"*|"close"*|"update"*|"import"*|"init"*|"export"*)
    printf 'WRITE_ATTEMPT: %s\n' "$*" >&2
    exit 99
    ;;
  *)
    printf 'bd stub: unsupported args: %s\n' "$*" >&2
    exit 1
    ;;
esac
BDSTUB
chmod +x "$TMP/bin/bd" 2>/dev/null || true

PATH="$TMP/bin:$PATH"
export PATH

DASH="$ROOT/scripts/shift-dashboard.sh"

# ── 1. script exists ──────────────────────────────────────────────────────────
[[ -f "$DASH" ]] \
  && ok "scripts/shift-dashboard.sh exists" \
  || no "scripts/shift-dashboard.sh not found"

# ── 2. exits 0 ───────────────────────────────────────────────────────────────
out="$(bash "$DASH" 2>&1)"
rc=$?
[[ "$rc" -eq 0 ]] \
  && ok "shift-dashboard.sh exits 0" \
  || no "shift-dashboard.sh exited $rc (must be 0)"

# ── 3. ready section present with correct bead IDs ───────────────────────────
printf '%s' "$out" | grep -qi 'ready' \
  && ok "output contains a Ready section" \
  || no "output missing Ready section"

printf '%s' "$out" | grep -q 'test-r1' \
  && ok "output contains ready bead test-r1" \
  || no "output missing ready bead test-r1"

printf '%s' "$out" | grep -q 'test-r2' \
  && ok "output contains ready bead test-r2" \
  || no "output missing ready bead test-r2"

# ── 4. in_progress section present with correct bead ID ──────────────────────
printf '%s' "$out" | grep -qi 'in.progress\|in_progress' \
  && ok "output contains an In-Progress section" \
  || no "output missing In-Progress section"

printf '%s' "$out" | grep -q 'test-ip1' \
  && ok "output contains in-progress bead test-ip1" \
  || no "output missing in-progress bead test-ip1"

# ── 5. blocked section present with correct bead ID ──────────────────────────
printf '%s' "$out" | grep -qi 'blocked' \
  && ok "output contains a Blocked section" \
  || no "output missing Blocked section"

printf '%s' "$out" | grep -q 'test-b1' \
  && ok "output contains blocked bead test-b1" \
  || no "output missing blocked bead test-b1"

# ── 6. no bd/jq fallback exits 0 with clear message ─────────────────────────
# Shadow bd with nothing; keep /bin so bash itself stays reachable.
mkdir -p "$TMP/nobin"
no_bd_out="$(PATH="$TMP/nobin:/bin:/usr/bin" bash "$DASH" 2>&1)"
no_bd_rc=$?
[[ "$no_bd_rc" -eq 0 ]] \
  && ok "no-bd fallback exits 0" \
  || no "no-bd fallback exited $no_bd_rc (must be 0)"
printf '%s' "$no_bd_out" | grep -qi 'bd not available\|bd.*not.*found\|beads.*not.*available\|not available' \
  && ok "no-bd fallback prints a clear unavailable message" \
  || no "no-bd fallback missing clear message (got: $no_bd_out)"

# ── 7. strictly read-only: no bd writes observed ─────────────────────────────
write_hits="$(bash "$DASH" 2>&1 | grep -c 'WRITE_ATTEMPT' || true)"
[[ "$write_hits" -eq 0 ]] \
  && ok "renderer made no bd write calls" \
  || no "renderer attempted a bd write (WRITE_ATTEMPT seen in output)"

# ── 8. status panel: no active shift → exits 0 + "no active shift" ───────────
# Redirect state to a TMP dir that has no shift.local.md.
mkdir -p "$TMP/noshift"
no_shift_out="$(CLAUDE_PROJECT_DIR="$TMP/noshift" bash -c ". '$ROOT/scripts/shift-dashboard.sh' --source-only 2>/dev/null; f9_dash_status_panel" 2>&1 || true)"
# The status panel function must exit 0 and print a "no active shift" message.
no_shift_rc=0
CLAUDE_PROJECT_DIR="$TMP/noshift" bash -c ". '$ROOT/scripts/shift-dashboard.sh' --source-only 2>/dev/null; f9_dash_status_panel" >/dev/null 2>&1 || no_shift_rc=$?
[[ "$no_shift_rc" -eq 0 ]] \
  && ok "status panel exits 0 when no active shift" \
  || no "status panel exited $no_shift_rc when no active shift (must be 0)"
printf '%s' "$no_shift_out" | grep -qi 'no active shift\|no shift' \
  && ok "status panel prints 'no active shift' message when no shift" \
  || no "status panel missing 'no active shift' message (got: $no_shift_out)"

# ── 9. status panel: active shift → renders goal, branch, iteration ──────────
mkdir -p "$TMP/activeshift/.claude/five-to-nine"
cat >"$TMP/activeshift/.claude/five-to-nine/shift.local.md" <<'STATEEOF'
---
goal: "Test goal for dashboard"
branch: feat/test-branch
started: 2026-06-16T00:00:00Z
engine: in-session
status: active
max_iterations: 10
---
Test goal for dashboard
STATEEOF
printf '3\n' >"$TMP/activeshift/.claude/five-to-nine/iteration.count"

active_out="$(CLAUDE_PROJECT_DIR="$TMP/activeshift" bash -c ". '$ROOT/scripts/shift-dashboard.sh' --source-only 2>/dev/null; f9_dash_status_panel" 2>&1)"

printf '%s' "$active_out" | grep -qi 'Test goal for dashboard' \
  && ok "status panel renders the shift goal" \
  || no "status panel missing goal (got: $active_out)"

printf '%s' "$active_out" | grep -q 'feat/test-branch' \
  && ok "status panel renders the branch" \
  || no "status panel missing branch (got: $active_out)"

printf '%s' "$active_out" | grep -qE '3.*/.*10|3[[:space:]]*/[[:space:]]*10' \
  && ok "status panel renders iteration count (3/10)" \
  || no "status panel missing iteration count 3/10 (got: $active_out)"

# ── 10. status panel: uncapped max_iterations → shows ∞ ──────────────────────
mkdir -p "$TMP/uncapped/.claude/five-to-nine"
cat >"$TMP/uncapped/.claude/five-to-nine/shift.local.md" <<'UNCAPEOF'
---
goal: "Uncapped shift goal"
branch: feat/uncapped
started: 2026-06-16T00:00:00Z
engine: in-session
status: active
max_iterations: uncapped
---
Uncapped shift goal
UNCAPEOF
printf '7\n' >"$TMP/uncapped/.claude/five-to-nine/iteration.count"

uncap_out="$(CLAUDE_PROJECT_DIR="$TMP/uncapped" bash -c ". '$ROOT/scripts/shift-dashboard.sh' --source-only 2>/dev/null; f9_dash_status_panel" 2>&1)"

printf '%s' "$uncap_out" | grep -q '∞' \
  && ok "status panel shows ∞ for uncapped max_iterations" \
  || no "status panel missing ∞ for uncapped (got: $uncap_out)"

if [[ "$fail" -eq 0 ]]; then
  echo "shift-dashboard-test: GREEN"
  exit 0
else
  echo "shift-dashboard-test: RED"
  exit 1
fi
