#!/usr/bin/env bash
# The 5 to 9 — open a shift: write gitignored state and move to a dedicated branch.
# Invoked by /clock-in. Git-Bash-compatible (Windows). Reversible only.
set -uo pipefail

F9_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$F9_HERE/lib/common.sh"
# shellcheck source=beads-helpers.sh
. "$F9_HERE/beads-helpers.sh"

usage() {
  cat >&2 <<'EOF'
usage: setup-shift.sh [--status] [--no-branch] [goal...]
  --status      print the current shift state and exit (read-only)
  --no-branch   don't create/switch the shift branch (state only)
  goal...       the goal for this shift (free text)
EOF
}

# --- --status: read-only peek -------------------------------------------------
if [[ "${1:-}" == "--status" ]]; then
  if f9_shift_active; then
    cat "$(f9_state_file)"
  else
    echo "No active shift. Run /clock-in [goal] to start one."
  fi
  exit 0
fi

no_branch=0
if [[ "${1:-}" == "--no-branch" ]]; then no_branch=1; shift; fi
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then usage; exit 0; fi
[[ "${FIVE_TO_NINE_NO_BRANCH:-0}" == "1" ]] && no_branch=1

goal="$*"
[[ -z "$goal" ]] && goal="(infer the smallest defensible goal from the repo's own intent)"

state_dir="$(f9_state_dir)"
mkdir -p "$state_dir" || { f9_err "cannot create state dir: $state_dir"; exit 1; }

started="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
max_iter="${FIVE_TO_NINE_MAX_ITER:-uncapped}"   # default: continuous in-session loop (drain + no-progress still stop it); set a number to cap

# --- dedicated shift branch (reversible; never main/prod) ---------------------
branch="(current)"
if [[ "$no_branch" -eq 0 ]] && f9_have git && git rev-parse --git-dir >/dev/null 2>&1; then
  current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
  case "$current" in
    the-5-to-9/shift-*) branch="$current" ;;  # already on a shift branch — keep it
    *)
      branch="the-5-to-9/shift-$(date +%Y%m%d 2>/dev/null || echo run)"
      if git show-ref --verify --quiet "refs/heads/$branch"; then
        git checkout "$branch" >/dev/null 2>&1 || { f9_warn "couldn't switch to $branch; staying on $current"; branch="$current"; }
      else
        git checkout -b "$branch" >/dev/null 2>&1 || { f9_warn "couldn't create $branch; staying on $current"; branch="$current"; }
      fi
      ;;
  esac
fi

# --- write the shift state (frontmatter + goal body) -------------------------
state_file="$(f9_state_file)"
{
  printf -- '---\n'
  printf 'goal: "%s"\n' "$(printf '%s' "$goal" | sed 's/"/\\"/g')"
  printf 'branch: %s\n' "$branch"
  printf 'started: %s\n' "$started"
  printf 'engine: in-session\n'
  printf 'status: active\n'
  printf 'max_iterations: %s\n' "$max_iter"
  printf -- '---\n'
  printf '%s\n' "$goal"
} > "$state_file"

# Reset the Stop-loop counters for a clean shift.
printf '0\n' > "$state_dir/iteration.count"
rm -f "$state_dir/closed.snapshot" 2>/dev/null || true

# --- beads ready (best-effort; the crew can still run if bd is absent) --------
f9_bd_ensure_init || true

f9_log "clocked in — goal: $goal"
f9_log "branch: $branch · state: $state_file · iterations: $max_iter (drain + no-progress guarded)"
echo "Shift open. Goal recorded. Branch: $branch. Iterations: $max_iter (uncapped = runs continuously until the backlog drains or progress stalls)."
