#!/usr/bin/env bash
# The 5 to 9 — the test gate. Structure + JSON + frontmatter + `bash -n` + secret scan.
# Exit 0 = green (the only "done"). Non-zero = something's off. Git-Bash + Linux CI.
# No build step, no network. jq is used when present; shellcheck is optional (CI-only).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || { echo "cannot cd to repo root: $ROOT" >&2; exit 1; }

fail=0
pass_n=0
note()  { printf '   %s\n' "$*"; }
ok()    { pass_n=$((pass_n + 1)); printf '✅ %s\n' "$*"; }
bad()   { fail=$((fail + 1));     printf '❌ %s\n' "$*"; }
head_() { printf '\n── %s ──\n' "$*"; }

have() { command -v "$1" >/dev/null 2>&1; }

# ── 1. Required structure ────────────────────────────────────────────────────
head_ "structure"
required=(
  ".claude-plugin/plugin.json" ".claude-plugin/marketplace.json"
  ".codex-plugin/plugin.json" ".cursor-plugin/plugin.json"
  "agents/the-owner.md" "agents/the-floor-manager.md" "agents/the-regular.md"
  "agents/the-line-cook.md" "agents/the-health-inspector.md" "agents/the-bouncer.md"
  "agents/the-janitor.md"
  "commands/clock-in.md" "commands/clock-out.md" "commands/shift-status.md" "commands/the-5-to-9.md"
  "skills/running-the-shift/SKILL.md" "skills/shift-memory-beads/SKILL.md"
  "skills/right-sizing-the-crew/SKILL.md"
  "hooks/hooks.json" "hooks/session-start.sh" "hooks/user-prompt-submit.sh"
  "hooks/shift-loop.sh" "hooks/irreversible-gate.sh" "hooks/pre-compact.sh"
  "scripts/lib/common.sh" "scripts/beads-helpers.sh" "scripts/setup-shift.sh"
  "scripts/clock-out.sh" "scripts/guardrail-scan.sh" "scripts/night-shift.sh"
  "tests/run.sh" "tests/gate-test.sh" "tests/gate-cases.txt" "tests/smoke-shift.sh"
  "AGENTS.md" "CLAUDE.md" "README.md" "CONTRIBUTING.md" "CHANGELOG.md"
  "SECURITY.md" "CODE_OF_CONDUCT.md" "LICENSE" ".gitignore"
  "docs/superpowers/specs/2026-06-14-the-5-to-9-design.md"
  "docs/superpowers/plans/2026-06-14-the-5-to-9-plan.md"
)
missing=0
for f in "${required[@]}"; do
  [[ -e "$ROOT/$f" ]] || { bad "missing required file: $f"; missing=1; }
done
[[ "$missing" -eq 0 ]] && ok "all ${#required[@]} required files present"

# ── 2. JSON validity ─────────────────────────────────────────────────────────
head_ "JSON"
if have jq; then
  json_bad=0
  while IFS= read -r jf; do
    if jq empty "$jf" >/dev/null 2>&1; then :; else bad "invalid JSON: ${jf#./}"; json_bad=1; fi
  done < <(find . -type f -name '*.json' -not -path './.git/*' -not -path './node_modules/*')
  [[ "$json_bad" -eq 0 ]] && ok "all JSON files parse"
  # hooks.json must declare the five events.
  for ev in SessionStart UserPromptSubmit PreToolUse Stop PreCompact; do
    if jq -e --arg e "$ev" '.hooks[$e]' hooks/hooks.json >/dev/null 2>&1; then :; else
      bad "hooks.json missing event: $ev"
    fi
  done
  jq -e '.hooks.SessionStart' hooks/hooks.json >/dev/null 2>&1 && ok "hooks.json declares the five events"
else
  note "jq not found — skipping JSON validation (CI installs jq)"
fi

# ── 3. Frontmatter (name + description) ──────────────────────────────────────
head_ "frontmatter"
check_fm() {
  local f="$1"
  [[ "$(head -n1 "$f")" == "---" ]] || { bad "frontmatter: $f does not start with '---'"; return; }
  local fm; fm="$(awk 'NR==1{next} /^---[[:space:]]*$/{exit} {print}' "$f")"
  printf '%s\n' "$fm" | grep -qE '^name:[[:space:]]*\S'        || { bad "frontmatter: $f missing 'name:'"; return; }
  printf '%s\n' "$fm" | grep -qE '^description:[[:space:]]*\S' || { bad "frontmatter: $f missing 'description:'"; return; }
}
fm_files=()
while IFS= read -r f; do fm_files+=("$f"); done < <(
  find agents commands -type f -name '*.md' 2>/dev/null
  find skills -type f -name 'SKILL.md' 2>/dev/null
)
for f in "${fm_files[@]}"; do check_fm "$f"; done
ok "frontmatter checked on ${#fm_files[@]} component(s)"

# ── 4. Shell syntax (bash -n) ────────────────────────────────────────────────
head_ "bash -n"
sh_bad=0; sh_n=0
while IFS= read -r s; do
  sh_n=$((sh_n + 1))
  if bash -n "$s" 2>/dev/null; then :; else bad "bash -n failed: ${s#./}"; sh_bad=1; fi
done < <(find hooks scripts tests -type f -name '*.sh' 2>/dev/null)
[[ "$sh_bad" -eq 0 ]] && ok "bash -n clean on ${sh_n} script(s)"

# ── 5. Secret scan (high-confidence only) ────────────────────────────────────
head_ "secret scan"
secret_re='-----BEGIN ([A-Z ]+)?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}'
secret_hits=0
if have git && git rev-parse --git-dir >/dev/null 2>&1; then
  while IFS= read -r -d '' tf; do
    if LC_ALL=C grep -IqE "$secret_re" "$tf" 2>/dev/null; then bad "possible secret in: $tf"; secret_hits=1; fi
  done < <(git ls-files -z 2>/dev/null)
else
  while IFS= read -r tf; do
    if LC_ALL=C grep -IqE "$secret_re" "$tf" 2>/dev/null; then bad "possible secret in: ${tf#./}"; secret_hits=1; fi
  done < <(find . -type f -not -path './.git/*' -not -path './node_modules/*')
fi
[[ "$secret_hits" -eq 0 ]] && ok "no high-confidence secrets found"

# ── 5b. JSON escaper: the no-jq hook fallback MUST emit valid quoted JSON ─────
# (bash -n can't catch a runtime escaper bug; hooks emit invalid JSON without this.)
head_ "json escaper (no-jq fallback)"
if . "$ROOT/scripts/lib/common.sh" 2>/dev/null && command -v f9_json_string >/dev/null 2>&1; then
  esc_ok=1
  for s in "" "plain note" 'messy "quotes" & \back\'; do
    out="$(printf '%s' "$s" | F9_NO_JQ=1 f9_json_string)"
    case "$out" in
      '"'*'"') : ;;
      *) bad "no-jq escaper didn't wrap in quotes: input=[$s] output=[$out]"; esc_ok=0 ;;
    esac
    if have jq && ! printf '%s' "$out" | jq empty >/dev/null 2>&1; then
      bad "no-jq escaper produced invalid JSON for input=[$s]: $out"; esc_ok=0
    fi
  done
  [[ "$esc_ok" -eq 1 ]] && ok "no-jq JSON escaper emits valid quoted strings"
else
  note "could not source common.sh / f9_json_string — escaper check skipped"
fi

# ── 5c. Irreversible-gate corpus (deny/allow verdicts must not regress) ───────
head_ "irreversible gate corpus"
corpus_out="$(bash "$ROOT/tests/gate-test.sh" 2>&1)"; corpus_rc=$?
if [[ "$corpus_rc" -eq 0 ]]; then
  ok "$(printf '%s' "$corpus_out" | tail -n1)"
else
  bad "gate corpus regressed:"; printf '%s\n' "$corpus_out" | sed 's/^/   /'
fi

# ── 6. Optional: shellcheck (never blocks) ───────────────────────────────────
head_ "shellcheck (optional)"
if have shellcheck; then
  if find hooks scripts tests -name '*.sh' -print0 2>/dev/null | xargs -0 shellcheck -S warning -e SC1091 >/dev/null 2>&1; then
    ok "shellcheck clean (warning+)"
  else
    note "shellcheck reported style notes (non-blocking) — run 'shellcheck hooks/*.sh scripts/*.sh' to see them"
  fi
else
  note "shellcheck not installed — skipped (CI runs it non-blocking)"
fi

# ── verdict ──────────────────────────────────────────────────────────────────
printf '\n══════════════════════════════════════════════════════════════\n'
if [[ "$fail" -eq 0 ]]; then
  printf '🌙 The 5 to 9 — GREEN. %d check group(s) passed. Clock out clean.\n' "$pass_n"
  exit 0
else
  printf '⛔ The 5 to 9 — RED. %d problem(s). No green, no close.\n' "$fail"
  exit 1
fi
