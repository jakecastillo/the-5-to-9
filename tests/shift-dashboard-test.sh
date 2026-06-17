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
  "count --status closed")
    printf '5\n'
    ;;
  "count --status in_progress")
    printf '1\n'
    ;;
  "count --status blocked")
    printf '1\n'
    ;;
  "count --status ready")
    # Bogus sentinel: "ready" is NOT a real bd status. The summary must derive ready from
    # `bd ready --json` (2 beads above), NOT this. If the code regresses to count --status
    # ready, the summary shows 99 and the ready=2 assertion below fails (catches bead 4ab).
    printf '99\n'
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

# ── 11. --watch --refreshes N: bounded loop renders each panel N times ────────
# Each refresh emits the READY header; N refreshes → N occurrences.
watch_n=3
watch_out="$(bash "$DASH" --watch --refreshes "$watch_n" 2>&1)"
watch_rc=$?
[[ "$watch_rc" -eq 0 ]] \
  && ok "--watch --refreshes $watch_n exits 0" \
  || no "--watch --refreshes $watch_n exited $watch_rc (must be 0)"

# Count occurrences of the READY header (one per refresh cycle).
ready_count="$(printf '%s\n' "$watch_out" | grep -ci '^── READY ──' || true)"
[[ "$ready_count" -eq "$watch_n" ]] \
  && ok "--watch renders READY header exactly $watch_n times" \
  || no "--watch rendered READY header $ready_count times (expected $watch_n)"

# FIVE_TO_NINE_DASH_MAX_REFRESHES env var is an alternative bounding mechanism.
env_out="$(FIVE_TO_NINE_DASH_MAX_REFRESHES=2 bash "$DASH" --watch 2>&1)"
env_rc=$?
[[ "$env_rc" -eq 0 ]] \
  && ok "FIVE_TO_NINE_DASH_MAX_REFRESHES=2 --watch exits 0" \
  || no "FIVE_TO_NINE_DASH_MAX_REFRESHES=2 --watch exited $env_rc (must be 0)"
env_ready="$(printf '%s\n' "$env_out" | grep -ci '^── READY ──' || true)"
[[ "$env_ready" -eq 2 ]] \
  && ok "FIVE_TO_NINE_DASH_MAX_REFRESHES=2 renders READY header exactly 2 times" \
  || no "FIVE_TO_NINE_DASH_MAX_REFRESHES=2 rendered READY header $env_ready times (expected 2)"

# ── 12. --watch --refreshes 1: single-refresh still produces full output ──────
one_out="$(bash "$DASH" --watch --refreshes 1 2>&1)"
one_rc=$?
[[ "$one_rc" -eq 0 ]] \
  && ok "--watch --refreshes 1 exits 0" \
  || no "--watch --refreshes 1 exited $one_rc (must be 0)"
printf '%s\n' "$one_out" | grep -q 'test-r1' \
  && ok "--watch single-refresh contains ready bead test-r1" \
  || no "--watch single-refresh missing ready bead test-r1"

# ── 13. SIGTERM exits cleanly (exit 0 or 143) ────────────────────────────────
# Spin --watch with a long interval; send SIGTERM after the first render.
# The process must exit within a few seconds and not hang.
# Note: background jobs in non-interactive bash ignore SIGINT (SIG_IGN) so we
# test with SIGTERM which is always delivered to background processes.
bash "$DASH" --watch --interval 10 &
BGPID=$!
( sleep 0.5; kill -TERM "$BGPID" 2>/dev/null || true ) &
WATCHER_KILLER=$!
# Give it a generous timeout; if still alive after 5s, kill it and fail.
wait_deadline=10
sig_rc=0
for _w in $(seq 1 "$wait_deadline"); do
  if ! kill -0 "$BGPID" 2>/dev/null; then
    break
  fi
  sleep 1
done
if kill -0 "$BGPID" 2>/dev/null; then
  kill -KILL "$BGPID" 2>/dev/null || true
  no "SIGTERM: process still alive after ${wait_deadline}s (hung?)"
  sig_rc=255
else
  wait "$BGPID" 2>/dev/null; sig_rc=$?
fi
wait "$WATCHER_KILLER" 2>/dev/null || true
# Accept 0 (trap-clean) or 143 (SIGTERM default)
[[ "$sig_rc" -eq 0 || "$sig_rc" -eq 143 ]] \
  && ok "SIGTERM exits cleanly (rc=$sig_rc)" \
  || no "SIGTERM exited with unexpected rc=$sig_rc (expected 0 or 143)"

# ── 14. --watch is strictly read-only: no bd writes in loop ──────────────────
loop_writes="$(bash "$DASH" --watch --refreshes 2 2>&1 | grep -c 'WRITE_ATTEMPT' || true)"
[[ "$loop_writes" -eq 0 ]] \
  && ok "--watch loop made no bd write calls" \
  || no "--watch loop attempted a bd write (WRITE_ATTEMPT seen)"

# ── 15. usage / help header visible in script ────────────────────────────────
# Check that the script contains a usage line (entrypoint documentation).
grep -q -i 'usage\|--watch\|shift-dashboard' "$DASH" \
  && ok "script contains usage/entrypoint documentation" \
  || no "script missing usage/entrypoint documentation"

# ── 16. summary header: f9_dash_summary emits closed/ready/in_progress/blocked + progress ──
# Source the dashboard and call f9_dash_summary directly with the stub bd on PATH.
sum_out="$(bash -c ". '$DASH' --source-only 2>/dev/null; f9_dash_summary" 2>&1)"
sum_rc=$?
[[ "$sum_rc" -eq 0 ]] \
  && ok "f9_dash_summary exits 0" \
  || no "f9_dash_summary exited $sum_rc (must be 0)"

# Must contain closed count (5)
printf '%s' "$sum_out" | grep -qE 'closed.*5|5.*closed' \
  && ok "summary shows closed count 5" \
  || no "summary missing closed count 5 (got: $sum_out)"

# Must contain ready count (2)
printf '%s' "$sum_out" | grep -qE 'ready.*2|2.*ready' \
  && ok "summary shows ready count 2" \
  || no "summary missing ready count 2 (got: $sum_out)"

# Must contain in_progress count (1)
printf '%s' "$sum_out" | grep -qEi 'in.progress.*1|1.*in.progress|in_progress.*1|1.*in_progress' \
  && ok "summary shows in_progress count 1" \
  || no "summary missing in_progress count 1 (got: $sum_out)"

# Must contain blocked count (1)
printf '%s' "$sum_out" | grep -qE 'blocked.*1|1.*blocked' \
  && ok "summary shows blocked count 1" \
  || no "summary missing blocked count 1 (got: $sum_out)"

# Must contain a progress indicator (e.g. "5/9" or "56%" — closed/total or percent)
printf '%s' "$sum_out" | grep -qE '[0-9]+/[0-9]+|[0-9]+%' \
  && ok "summary shows a progress indicator (closed/total or %)" \
  || no "summary missing progress indicator (got: $sum_out)"

# ── 17. summary header: f9_dash_render emits summary BEFORE status panel ─────
sum_render_out="$(bash "$DASH" 2>&1)"
# Summary line must appear; grep for progress indicator which is unique to summary.
printf '%s' "$sum_render_out" | grep -qE '[0-9]+/[0-9]+|[0-9]+%' \
  && ok "f9_dash_render output contains summary progress indicator" \
  || no "f9_dash_render output missing summary progress indicator (got: $sum_render_out)"

# Summary must appear before the SHIFT STATUS section.
summary_line="$(printf '%s\n' "$sum_render_out" | grep -n -E '[0-9]+/[0-9]+|[0-9]+%' | head -1 | cut -d: -f1)"
status_line="$(printf '%s\n' "$sum_render_out" | grep -n -i 'SHIFT STATUS' | head -1 | cut -d: -f1)"
if [[ -n "$summary_line" && -n "$status_line" ]]; then
  [[ "$summary_line" -lt "$status_line" ]] \
    && ok "summary appears before SHIFT STATUS panel" \
    || no "summary appears AFTER SHIFT STATUS panel (summary=$summary_line status=$status_line)"
else
  no "could not locate summary or SHIFT STATUS line in render output"
fi

# ── 18. summary header: no-bd fallback exits 0 with clear message ────────────
sum_nobd_out="$(PATH="$TMP/nobin:/bin:/usr/bin" bash -c ". '$DASH' --source-only 2>/dev/null; f9_dash_summary" 2>&1)"
sum_nobd_rc=0
PATH="$TMP/nobin:/bin:/usr/bin" bash -c ". '$DASH' --source-only 2>/dev/null; f9_dash_summary" >/dev/null 2>&1 || sum_nobd_rc=$?
[[ "$sum_nobd_rc" -eq 0 ]] \
  && ok "summary no-bd fallback exits 0" \
  || no "summary no-bd fallback exited $sum_nobd_rc (must be 0)"
printf '%s' "$sum_nobd_out" | grep -qi 'bd not available\|not available\|bd.*not.*found' \
  && ok "summary no-bd fallback prints clear unavailable message" \
  || no "summary no-bd fallback missing clear message (got: $sum_nobd_out)"

# ── 19. summary is strictly read-only: no bd writes ──────────────────────────
sum_writes="$(bash -c ". '$DASH' --source-only 2>&1; f9_dash_summary" 2>&1 | grep -c 'WRITE_ATTEMPT' || true)"
[[ "$sum_writes" -eq 0 ]] \
  && ok "f9_dash_summary made no bd write calls" \
  || no "f9_dash_summary attempted a bd write (WRITE_ATTEMPT seen)"

if [[ "$fail" -eq 0 ]]; then
  echo "shift-dashboard-test: GREEN"
  exit 0
else
  echo "shift-dashboard-test: RED"
  exit 1
fi
