#!/usr/bin/env bash
# Focused tests for the fresh-process night-shift driver. These stub bd and the
# agent command so the loop mechanics are tested without mutating the real repo.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

fail=0
ok() { printf '  OK %s\n' "$*"; }
no() { printf '  FAIL %s\n' "$*"; fail=1; }

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP" 2>/dev/null || true; }
trap cleanup EXIT

mkdir -p "$TMP/bin"
cat >"$TMP/bin/bd" <<'BDSTUB'
#!/usr/bin/env bash
state() {
  if [[ -n "${F9_BD_STATE:-}" && -f "$F9_BD_STATE" ]]; then
    cat "$F9_BD_STATE"
  else
    printf 'env'
  fi
}

ready_json() {
  case "$(state)" in
    ready) printf '[{"id":"stuck-1","title":"stuck bead"}]\n' ;;
    in_progress) printf '[]\n' ;;
    *) printf '%s\n' "${F9_BD_READY_JSON:-[]}" ;;
  esac
}

case "$1 ${2:-} ${3:-}" in
  "ready --json ")
    ready_json
    ;;
  "ready --claim --json")
    ready_json
    if [[ -n "${F9_BD_STATE:-}" && "$(state)" == "ready" ]]; then
      printf 'in_progress\n' > "$F9_BD_STATE"
    fi
    ;;
  "count --status closed")
    printf '%s\n' "${F9_BD_CLOSED_COUNT:-0}"
    ;;
  "count --status open")
    case "$(state)" in
      ready) printf '1\n' ;;
      in_progress) printf '0\n' ;;
      *) printf '%s\n' "${F9_BD_OPEN_COUNT:-1}" ;;
    esac
    ;;
  *)
    printf 'bd stub: unsupported args: %s\n' "$*" >&2
    exit 9
    ;;
esac
BDSTUB
chmod +x "$TMP/bin/bd" 2>/dev/null || true

PATH="$TMP/bin:$PATH"
export PATH
export F9_BD_READY_JSON='[{"id":"stuck-1","title":"stuck bead"}]'
export F9_BD_CLOSED_COUNT=0
export F9_BD_OPEN_COUNT=1

# No-progress remains the outer guard for a live ready queue that is not moving.
ns_out="$((
  cd "$TMP" &&
    FIVE_TO_NINE_NOPROGRESS=2 \
    bash "$ROOT/scripts/night-shift.sh" --max-iterations 6 --dry-run
) 2>&1)"
printf '%s' "$ns_out" | grep -q 'no-progress: .*stopping' \
  && ok "night-shift stops on no-progress before the cap" \
  || no "night-shift did not report a no-progress stop"
printf '%s' "$ns_out" | grep -q 'Night shift complete: 2 iteration(s)' \
  && ok "no-progress stop reports the actual completed iteration count" \
  || no "no-progress stop reported the wrong iteration count"

# The generated one-iteration prompt must carry the irreversible-action gate.
prompt_file="$TMP/prompt.txt"
gate_out="$(F9_CAPTURE_PROMPT="$prompt_file" \
FIVE_TO_NINE_AGENT_CMD='printf "%s" "$FIVE_TO_NINE_PROMPT" > "$F9_CAPTURE_PROMPT"' \
  bash "$ROOT/scripts/night-shift.sh" --max-iterations 1 2>&1 || true)"
if grep -q 'Hard-stop and SURFACE' "$prompt_file" \
   && grep -q 'git push --force' "$prompt_file" \
   && grep -q 'destroying/rotating secrets' "$prompt_file"; then
  ok "night-shift prompt carries the irreversible-action gate"
else
  no "night-shift prompt is missing irreversible-action gate language"
fi
if grep -q 'Impactful bead check' "$prompt_file" \
   && grep -q 'self-rating vs the goal' "$prompt_file" \
   && grep -q 'well-formed child beads' "$prompt_file" \
   && grep -q 'If the claimed bead is too broad' "$prompt_file"; then
  ok "night-shift prompt carries the autonomous-run quality rubric"
else
  no "night-shift prompt is missing autonomous-run quality rubric"
fi
printf '%s' "$gate_out" | grep -q 'irreversible gate self-check passed' \
  && ok "night-shift verifies the irreversible gate before launching a worker" \
  || no "night-shift did not verify the irreversible gate before launching a worker"

# A bead that keeps failing should get one escalated retry, then surface instead
# of spinning until the generic no-progress guard or max-iteration cap.
attempts="$TMP/attempts.txt"
state_file="$TMP/bd-state.txt"
printf 'ready\n' > "$state_file"
stuck_out="$((
  cd "$TMP" &&
    F9_ATTEMPTS="$attempts" \
    F9_BD_STATE="$state_file" \
    FIVE_TO_NINE_NOPROGRESS=9 \
    FIVE_TO_NINE_AGENT_CMD='case "$FIVE_TO_NINE_PROMPT" in *"Stuck-bead escalation"*) printf "PROMPT_ESC=1\n" >> "$F9_ATTEMPTS" ;; *) bd ready --claim --json >/dev/null; printf "PROMPT_ESC=0\n" >> "$F9_ATTEMPTS" ;; esac; printf "MODEL=%s\n" "${CLAUDE_CODE_SUBAGENT_MODEL:-}" >> "$F9_ATTEMPTS"; exit 42' \
    bash "$ROOT/scripts/night-shift.sh" --max-iterations 4
) 2>&1)" || true
attempt_n="$(grep -c '^MODEL=' "$attempts" 2>/dev/null || true)"
attempt_n="${attempt_n:-0}"
[[ "$attempt_n" == "2" ]] \
  && ok "stuck bead gets one normal attempt and one escalated retry" \
  || no "expected 2 stuck-bead attempts, got ${attempt_n:-0}"
grep -q '^MODEL=opus$' "$attempts" \
  && ok "stuck-bead retry bumps the subagent model tier" \
  || no "stuck-bead retry did not set CLAUDE_CODE_SUBAGENT_MODEL=opus"
grep -q '^PROMPT_ESC=1$' "$attempts" \
  && ok "stuck-bead retry prompt explains the escalation" \
  || no "stuck-bead retry prompt did not include escalation context"
grep -q 'failed after escalation' <<<"$stuck_out" \
  && ok "stuck bead surfaces after the escalated retry fails" \
  || no "stuck bead did not surface after the escalated retry failed"

if [[ "$fail" -eq 0 ]]; then
  echo "night-shift-test: GREEN"
  exit 0
else
  echo "night-shift-test: RED"
  exit 1
fi
