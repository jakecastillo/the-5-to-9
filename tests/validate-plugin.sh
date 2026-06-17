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
  ".agents/plugins/marketplace.json"
  ".agents/plugins/the-5-to-9/.codex-plugin/plugin.json"
  "agents/the-owner.md" "agents/the-pit-boss.md" "agents/the-dealer.md"
  "agents/the-floor-auditor.md" "agents/the-eye-in-the-sky.md" "agents/the-cage-cashier.md"
  "agents/the-floorman.md"
  "commands/clock-in.md" "commands/clock-out.md" "commands/shift-status.md" "commands/the-5-to-9.md"
  "skills/running-the-shift/SKILL.md" "skills/shift-memory-beads/SKILL.md"
  "skills/right-sizing-the-crew/SKILL.md"
  "hooks/hooks.json" "hooks/session-start.sh" "hooks/user-prompt-submit.sh"
  "hooks/shift-loop.sh" "hooks/irreversible-gate.sh" "hooks/pre-compact.sh"
  "hooks/irreversible-gate.mjs" "hooks/gate.test.mjs"
  "scripts/lib/common.sh" "scripts/beads-helpers.sh" "scripts/setup-shift.sh"
  "scripts/clock-out.sh" "scripts/guardrail-scan.sh" "scripts/night-shift.sh"
  "scripts/launch-driver.sh" "scripts/clock-in-dispatch.sh" "scripts/demo-shift.sh"
  "tests/run.sh" "tests/gate-test.sh" "tests/gate-cases.txt" "tests/smoke-shift.sh"
  "tests/launch-driver-test.sh" "tests/demo-shift-test.sh" "tests/shift-dashboard-test.sh"
  "tests/check-version-consistency.sh" "tests/version-consistency-test.sh"
  "scripts/shift-dashboard.sh"
  "AGENTS.md" "CLAUDE.md" "README.md" "CONTRIBUTING.md" "CHANGELOG.md"
  "SECURITY.md" "CODE_OF_CONDUCT.md" "LICENSE" ".gitignore" "docs/INSTALL.md"
  "docs/ARCHITECTURE.md" "docs/SURFACES.md" "docs/BRANDING.md"
  "docs/superpowers/specs/2026-06-14-the-5-to-9-design.md"
  "docs/superpowers/plans/2026-06-14-the-5-to-9-plan.md"
  "docs/sample-shift-report.md"
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

# ── 2b. Codex native plugin (`codex plugin add`) ─────────────────────────────
# Codex (0.140.0+) reads its marketplace from .agents/plugins/marketplace.json and COPIES
# the plugin's subdir into a cache on install — so the plugin must live in a SUBDIR (not the
# repo root, which doesn't resolve) and its skills must live INSIDE that subdir (external
# paths don't survive the copy). The subdir skills are kept byte-in-sync with canonical
# skills/ (drift = RED).
head_ "Codex native plugin"
cxdir=".agents/plugins/the-5-to-9"
if have jq; then
  cmf=".agents/plugins/marketplace.json"
  if jq -e '.plugins[] | select(.name=="the-5-to-9") | select(.source.path | test("the-5-to-9$"))' "$cmf" >/dev/null 2>&1; then
    ok "Codex marketplace lists the-5-to-9 → its plugin subdir"
  else
    bad "Codex marketplace ($cmf) must list the-5-to-9 with source.path → $cxdir (a subdir, not the repo root)"
  fi
  if jq -e '.skills' "$cxdir/.codex-plugin/plugin.json" >/dev/null 2>&1; then
    ok "Codex plugin manifest declares skills"
  else
    bad "$cxdir/.codex-plugin/plugin.json missing or does not declare \"skills\""
  fi
else
  note "jq not found — skipping Codex manifest checks (CI installs jq)"
fi
# Skills inside the subdir must match canonical skills/ byte-for-byte (no drift).
# Exclude .DS_Store: a macOS Finder artifact (gitignored, never committed) must not
# flake this raw dir-vs-dir comparison.
if [[ -d "$cxdir/skills" ]] && diff -r -x '.DS_Store' skills "$cxdir/skills" >/dev/null 2>&1; then
  ok "Codex plugin skills are in sync with canonical skills/"
else
  bad "Codex plugin skills out of sync — run: rm -rf $cxdir/skills && cp -R skills $cxdir/skills"
fi

# ── 2c. Version consistency (manifests + README badge + CITATION must agree) ──
# A release bump that misses a manifest is silent drift; this makes it loud (RED).
head_ "version consistency"
vc_out="$(bash "$ROOT/tests/version-consistency-test.sh" 2>&1)"; vc_rc=$?
if [[ "$vc_rc" -eq 0 ]]; then
  ok "$(printf '%s' "$vc_out" | tail -n1)"
else
  bad "version consistency regressed:"; printf '%s\n' "$vc_out" | sed 's/^/   /'
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

# ── 3b. Agent voice belongs in bodies, not always-on frontmatter ──────────────
head_ "agent voice budget"
voice_bad=0
agent_n=0
for f in agents/*.md; do
  [[ -f "$f" ]] || continue
  agent_n=$((agent_n + 1))
  fm="$(awk 'NR==1{next} /^---[[:space:]]*$/{exit} {print}' "$f")"
  desc="$(printf '%s\n' "$fm" | awk '/^description:[[:space:]]*/{sub(/^description:[[:space:]]*/, ""); print; exit}')"
  desc_words="$(printf '%s\n' "$desc" | wc -w | tr -d ' ')"
  if [[ "$desc_words" -gt 32 ]]; then
    bad "agent description too long (${desc_words} words; keep flavor out of frontmatter): $f"
    voice_bad=1
  fi

  if ! grep -q '^## Voice$' "$f"; then
    bad "agent missing on-invoke voice section: $f"
    voice_bad=1
  fi

  anchor=""
  case "$f" in
    agents/the-owner.md) anchor="holds the license" ;;
    agents/the-pit-boss.md) anchor="whole board" ;;
    agents/the-cage-cashier.md) anchor="one window" ;;
    agents/the-dealer.md) anchor="hand by hand" ;;
    agents/the-floor-auditor.md) anchor="counts twice" ;;
    agents/the-eye-in-the-sky.md) anchor="freezes the room" ;;
    agents/the-floorman.md) anchor="release cart" ;;
  esac
  if [[ -n "$anchor" ]] && ! grep -qiF "$anchor" "$f"; then
    bad "agent voice missing role anchor '$anchor': $f"
    voice_bad=1
  fi
done
[[ "$voice_bad" -eq 0 ]] && ok "agent frontmatter is compact; ${agent_n} body voice section(s) carry role-specific flavor"

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

  # Degenerate environment: PATH emptied (no awk/sed/jq/coreutils reachable).
  # SessionStart fail-opens, but the JSON it emits must still be valid — the
  # no-jq fallback must run on bash builtins ALONE. We re-source common.sh in a
  # subshell with PATH= so command -v finds nothing external, then escape inputs
  # covering: empty string, embedded double-quotes, backslashes, and a control
  # char (a literal TAB). A control char left raw makes the JSON invalid.
  emptypath_ok=1
  tab="$(printf '\t')"
  for s in "" 'has "double" quotes' 'back\slash\here' "ctl${tab}tab"; do
    out="$(
      export PATH=
      . "$ROOT/scripts/lib/common.sh" 2>/dev/null
      printf '%s' "$s" | F9_NO_JQ=1 f9_json_string
    )"
    case "$out" in
      '"'*'"') : ;;
      *) bad "empty-PATH escaper didn't wrap in quotes: input=[$s] output=[$out]"; emptypath_ok=0 ;;
    esac
    if have jq && ! printf '%s' "$out" | jq empty >/dev/null 2>&1; then
      bad "empty-PATH escaper produced invalid JSON for input=[$s]: $out"; emptypath_ok=0
    fi
  done
  [[ "$emptypath_ok" -eq 1 ]] && ok "no-jq JSON escaper survives an emptied PATH (bash builtins only)"
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

# ── 5d. node --test (white-box unit tests for ported hooks; skipped if node absent) ─
head_ "node --test (ported hooks)"
if have node; then
  nt_out="$(node --test hooks/*.test.mjs 2>&1)"; nt_rc=$?
  if [[ "$nt_rc" -eq 0 ]]; then
    ok "node --test passed ($(printf '%s' "$nt_out" | grep -aoE 'pass [0-9]+' | head -n1))"
  else
    bad "node --test failed:"; printf '%s\n' "$nt_out" | grep -aE '^(not ok|# (fail|pass|tests))' | tail -20 | sed 's/^/   /'
  fi
else
  note "node not installed — node --test skipped (CI runs it)"
fi

# ── 5e. night-shift loop mechanics ───────────────────────────────────────────
head_ "night-shift loop"
ns_out="$(bash "$ROOT/tests/night-shift-test.sh" 2>&1)"; ns_rc=$?
if [[ "$ns_rc" -eq 0 ]]; then
  ok "$(printf '%s' "$ns_out" | tail -n1)"
else
  bad "night-shift loop regressed:"; printf '%s\n' "$ns_out" | sed 's/^/   /'
fi

# ── 5f. driver/ TypeScript checks (typecheck + lint + tests; skipped if toolchain absent) ─
head_ "driver (TypeScript)"
if [[ -d "$ROOT/driver" ]] && have node && have pnpm; then
  drv_out="$(cd "$ROOT/driver" && pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm run typecheck 2>&1 && pnpm run lint 2>&1 && pnpm test 2>&1)"; drv_rc=$?
  if [[ "$drv_rc" -eq 0 ]]; then
    ok "driver typecheck + lint + tests passed ($(printf '%s' "$drv_out" | grep -aoE '# pass [0-9]+' | head -n1 | sed 's/# //'))"
  else
    bad "driver checks failed:"; printf '%s\n' "$drv_out" | tail -n 20 | sed 's/^/   /'
  fi
elif [[ -d "$ROOT/driver" ]]; then
  note "driver/ present but node/pnpm absent — driver checks skipped (CI should install them)"
else
  note "no driver/ — skipped"
fi

# ── 5f.2 cli/ TypeScript checks (typecheck + lint + tests; skipped if toolchain absent) ─
head_ "cli (the-5-to-9 CLI/TUI)"
if [[ -d "$ROOT/cli" ]] && have node && have pnpm; then
  cli_out="$(cd "$ROOT/cli" && pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm run typecheck 2>&1 && pnpm run lint 2>&1 && pnpm test 2>&1)"; cli_rc=$?
  if [[ "$cli_rc" -eq 0 ]]; then
    ok "cli typecheck + lint + tests passed"
  else
    bad "cli checks failed:"; printf '%s\n' "$cli_out" | tail -n 20 | sed 's/^/   /'
  fi
elif [[ -d "$ROOT/cli" ]]; then
  note "cli/ present but node/pnpm absent — skipped (CI installs them)"
else
  note "no cli/ — skipped"
fi

# ── 5g. clock-in-dispatch routing (--driver flag → SDK driver; absent → bash loop) ──
head_ "clock-in-dispatch routing"
ld_out="$(bash "$ROOT/tests/launch-driver-test.sh" 2>&1)"; ld_rc=$?
if [[ "$ld_rc" -eq 0 ]]; then
  ok "$(printf '%s' "$ld_out" | tail -n1)"
else
  bad "clock-in-dispatch routing regressed:"; printf '%s\n' "$ld_out" | sed 's/^/   /'
fi

# ── 5h. shift dashboard bead-list renderer ───────────────────────────────────
head_ "shift dashboard bead lists (phu.3.2)"
sd_out="$(F9_SKIP_VALIDATE_CALL=1 bash "$ROOT/tests/shift-dashboard-test.sh" 2>&1)"; sd_rc=$?
if [[ "$sd_rc" -eq 0 ]]; then
  ok "$(printf '%s' "$sd_out" | tail -n1)"
else
  bad "shift-dashboard bead lists regressed:"; printf '%s\n' "$sd_out" | sed 's/^/   /'
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

# ── 7. Optional: shfmt (never blocks) ────────────────────────────────────────
head_ "shfmt (optional)"
if have shfmt; then
  shfmt_bad=0
  while IFS= read -r s; do
    if shfmt -d "$s" >/dev/null 2>&1; then :; else shfmt_bad=1; fi
  done < <(find hooks scripts tests -type f -name '*.sh' 2>/dev/null)
  if [[ "$shfmt_bad" -eq 0 ]]; then
    ok "shfmt clean (no diffs)"
  else
    note "shfmt found style diffs (non-blocking) — run 'bash scripts/format.sh' or 'shfmt -l hooks/ scripts/ tests/' to see them"
  fi
else
  note "shfmt not installed — skipped (install shfmt to check bash formatting)"
fi

# ── verdict ──────────────────────────────────────────────────────────────────
printf '\n══════════════════════════════════════════════════════════════\n'
if [[ "$fail" -eq 0 ]]; then
  printf '🌙 The 5 to 9 — GREEN. %d check group(s) passed. Clock out clean.\n' "$pass_n"
  _gate_status="GREEN"
else
  printf '⛔ The 5 to 9 — RED. %d problem(s). No green, no close.\n' "$fail"
  _gate_status="RED"
fi

# ── write last-gate.txt marker (best-effort; never changes exit code) ─────────
# Format: "GREEN|RED <group-count> <UTC-ISO-timestamp>"
# State dir: $CLAUDE_PROJECT_DIR/.claude/five-to-nine/ (or $ROOT/.claude/five-to-nine/)
_gate_state_dir="${CLAUDE_PROJECT_DIR:-$ROOT}/.claude/five-to-nine"
_gate_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf 'unknown')"
if mkdir -p "$_gate_state_dir" 2>/dev/null; then
  printf '%s %s %s\n' "$_gate_status" "$pass_n" "$_gate_ts" >"$_gate_state_dir/last-gate.txt" 2>/dev/null || true
fi

if [[ "$_gate_status" == "GREEN" ]]; then
  exit 0
else
  exit 1
fi
