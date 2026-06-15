#!/usr/bin/env bash
# The 5 to 9 — read the room. Scan the TARGET repo's guardrails + test signals and
# print a compact brief for clock-in. Read-only; never writes the user's files.
set -uo pipefail

F9_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$F9_HERE/lib/common.sh"

root="$(f9_repo_root)"
cd "$root" 2>/dev/null || true

echo "── Reading the room: $root ──"

echo "Guardrail docs (read and OBEY these — never modify them):"
found=0
for f in CLAUDE.md AGENTS.md GEMINI.md CONTRIBUTING.md README.md CODE_OF_CONDUCT.md SECURITY.md; do
  [[ -f "$root/$f" ]] && { echo "  • $f"; found=1; }
done
[[ "$found" -eq 0 ]] && echo "  (none found — proceed from the repo's code + README intent)"

echo "Test / build signals (find the real 'green' before closing any bead):"
sig=0
[[ -f "$root/package.json" ]]      && { echo "  • package.json — try: npm test / npm run lint / npm run build"; sig=1; }
[[ -f "$root/Makefile" ]]          && { echo "  • Makefile — try: make test / make check"; sig=1; }
[[ -f "$root/pyproject.toml" || -f "$root/setup.cfg" ]] && { echo "  • python — try: pytest / ruff / tox"; sig=1; }
[[ -f "$root/Cargo.toml" ]]        && { echo "  • Cargo.toml — try: cargo test / cargo clippy"; sig=1; }
[[ -f "$root/go.mod" ]]            && { echo "  • go.mod — try: go test ./... / go vet ./..."; sig=1; }
[[ -f "$root/tests/validate-plugin.sh" ]] && { echo "  • tests/validate-plugin.sh — the gate is: bash tests/validate-plugin.sh"; sig=1; }
[[ -d "$root/.github/workflows" ]] && { echo "  • .github/workflows — CI defines the authoritative gate"; sig=1; }
[[ "$sig" -eq 0 ]] && echo "  (no obvious test config — ask the repo/owner what proves 'done')"

echo "Reminders:"
echo "  • Instruction priority: TARGET REPO > The 5 to 9 > defaults."
echo "  • Work a dedicated shift branch; main/prod are off-limits without the gate."
echo "  • No-clobber: inject context additively; do not edit the repo's CLAUDE.md/AGENTS.md."
