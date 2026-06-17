#!/usr/bin/env bash
# scripts/format.sh — unified format entrypoint for The 5 to 9
#
# Runs:
#   1. Biome (format + organize-imports) on driver/ TypeScript/JavaScript
#   2. Prettier on repo-scoped markdown, YAML, and JSON
#
# Usage: bash scripts/format.sh [--check]
#   --check  Run in check mode (exit non-zero if any file would change).
#
# Tool requirements:
#   - pnpm (for Biome + Prettier, both in driver/devDependencies)
#   - shfmt is run non-blocking if present (see tests/validate-plugin.sh)
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || { echo "cannot cd to repo root: $ROOT" >&2; exit 1; }

CHECK_MODE=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_MODE=1
fi

fail=0

# ── 1. Biome on driver/ TypeScript/JavaScript ────────────────────────────────
if [[ -d "$ROOT/driver" ]]; then
  echo "── Biome (driver/ TS/JS) ──"
  if command -v pnpm >/dev/null 2>&1; then
    (
      cd "$ROOT/driver"
      if [[ "$CHECK_MODE" -eq 1 ]]; then
        pnpm exec biome format . || { echo "Biome: format check found issues in driver/" >&2; exit 1; }
      else
        pnpm exec biome format --write . || pnpm biome format --write .
      fi
    ) || fail=$((fail + 1))
    echo "   Biome: done"
  else
    echo "   pnpm not found — Biome skipped (install pnpm to run Biome)"
  fi
else
  echo "   no driver/ — Biome skipped"
fi

# ── 2. Prettier on repo-scoped md/yaml/json ──────────────────────────────────
echo "── Prettier (repo md/yaml/json) ──"
if command -v pnpm >/dev/null 2>&1 && [[ -f "$ROOT/driver/node_modules/.bin/prettier" ]]; then
  PRETTIER="$ROOT/driver/node_modules/.bin/prettier"
elif command -v prettier >/dev/null 2>&1; then
  PRETTIER="prettier"
else
  echo "   prettier not found — run 'cd driver && pnpm install' first"
  # Not a hard failure — tooling setup issue, not a code issue
  exit "$fail"
fi

# Targets: top-level *.md, docs/**/*.md (excl superpowers/), *.json/*.yml/*.yaml configs.
# .prettierignore handles the exclusions (agents/, commands/, skills/, etc.)
PRETTIER_TARGETS=(
  "README.md"
  "CONTRIBUTING.md"
  "CHANGELOG.md"
  "SECURITY.md"
  "CODE_OF_CONDUCT.md"
  "GOVERNANCE.md"
  "CITATION.cff"
  "docs/ARCHITECTURE.md"
  "docs/SURFACES.md"
  "docs/BRANDING.md"
  "docs/INSTALL.md"
  ".prettierrc"
  "driver/biome.json"
  "driver/tsconfig.json"
)

# Add any *.yml / *.yaml at repo root (but not lockfiles — covered by .prettierignore)
while IFS= read -r f; do
  PRETTIER_TARGETS+=("$f")
done < <(find "$ROOT" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null | sort)

if [[ "$CHECK_MODE" -eq 1 ]]; then
  "$PRETTIER" --check \
    --ignore-path "$ROOT/.prettierignore" \
    "${PRETTIER_TARGETS[@]}" || { echo "Prettier: check found files that need formatting" >&2; fail=$((fail + 1)); }
else
  "$PRETTIER" --write \
    --ignore-path "$ROOT/.prettierignore" \
    "${PRETTIER_TARGETS[@]}" || { echo "Prettier: write encountered errors" >&2; fail=$((fail + 1)); }
fi

# ── verdict ──────────────────────────────────────────────────────────────────
if [[ "$fail" -eq 0 ]]; then
  echo ""
  echo "format.sh: all formatters passed."
  exit 0
else
  echo "" >&2
  echo "format.sh: $fail formatter(s) reported issues." >&2
  exit 1
fi
