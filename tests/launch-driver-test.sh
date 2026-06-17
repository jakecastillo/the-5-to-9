#!/usr/bin/env bash
# Tests that clock-in-dispatch.sh routes correctly:
#   --driver flag  → scripts/launch-driver.sh (SDK driver, K=1 for subscription backends)
#   no --driver    → scripts/night-shift.sh   (bash loop, default)
# These are bash-level dispatch assertions — no Node/pnpm/bd required.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DISPATCH="$ROOT/scripts/clock-in-dispatch.sh"
LAUNCH_DRIVER="$ROOT/scripts/launch-driver.sh"
# (the no-driver path routes to scripts/night-shift.sh — stubbed per-test below)

fail=0
ok() { printf '  OK %s\n' "$*"; }
no() { printf '  FAIL %s\n' "$*"; fail=1; }

# ── Test 1: --driver flag routes to launch-driver.sh ──────────────────────────
# Stub both engines: capture which one was invoked.
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP" 2>/dev/null || true; }
trap cleanup EXIT

INVOKED="$TMP/invoked.txt"

# Temporarily override launch-driver.sh and night-shift.sh via env-injected
# CLAUDE_PLUGIN_ROOT pointing to a stub tree.
stub_root="$TMP/stub"
mkdir -p "$stub_root/scripts"

cat >"$stub_root/scripts/launch-driver.sh" <<'EOF'
#!/usr/bin/env bash
printf 'launch-driver\n' >> "$INVOKED"
EOF

cat >"$stub_root/scripts/night-shift.sh" <<'EOF'
#!/usr/bin/env bash
printf 'night-shift\n' >> "$INVOKED"
EOF

# clock-in-dispatch.sh reads F9_HERE from its own location — we must use the
# real dispatch script but with a stub F9_ROOT. We do this by temporarily setting
# CLAUDE_PLUGIN_ROOT and calling the dispatch with the stub scripts dir in PATH.
# Since clock-in-dispatch.sh builds F9_HERE from BASH_SOURCE[0], the simplest
# approach is to copy it to the stub tree and run from there.
cp "$DISPATCH" "$stub_root/scripts/clock-in-dispatch.sh"
export INVOKED

# Run with --driver: should invoke launch-driver.sh stub
(cd "$stub_root" && bash scripts/clock-in-dispatch.sh --driver) 2>/dev/null || true
invoked_val="$(cat "$INVOKED" 2>/dev/null || true)"
if [[ "$invoked_val" == "launch-driver" ]]; then
  ok "--driver flag routes to launch-driver.sh"
else
  no "--driver flag did not route to launch-driver.sh (got: '${invoked_val}')"
fi

# Reset
: > "$INVOKED"

# Run without --driver: should invoke night-shift.sh stub
(cd "$stub_root" && bash scripts/clock-in-dispatch.sh) 2>/dev/null || true
invoked_val="$(cat "$INVOKED" 2>/dev/null || true)"
if [[ "$invoked_val" == "night-shift" ]]; then
  ok "no --driver flag routes to night-shift.sh (default)"
else
  no "no --driver flag did not route to night-shift.sh (got: '${invoked_val}')"
fi

# Reset
: > "$INVOKED"

# ── Test 2: --driver flag is stripped; remaining args pass through ─────────────
cat >"$stub_root/scripts/launch-driver.sh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >> "$INVOKED"
EOF

(cd "$stub_root" && bash scripts/clock-in-dispatch.sh --driver --backend claude --max-iterations 5) 2>/dev/null || true
passthrough_val="$(cat "$INVOKED" 2>/dev/null || true)"
if printf '%s\n' "$passthrough_val" | grep -q '\-\-backend' && \
   printf '%s\n' "$passthrough_val" | grep -q 'claude' && \
   printf '%s\n' "$passthrough_val" | grep -q '\-\-max-iterations' && \
   printf '%s\n' "$passthrough_val" | grep -q '5' && \
   ! printf '%s\n' "$passthrough_val" | grep -q '\-\-driver'; then
  ok "--driver stripped; remaining args forwarded to launch-driver.sh"
else
  no "passthrough args not forwarded correctly (got: '${passthrough_val}')"
fi

# ── Test 3: launch-driver.sh exists and has correct structure ─────────────────
if [[ -f "$LAUNCH_DRIVER" ]]; then
  ok "launch-driver.sh exists"
else
  no "launch-driver.sh missing at $LAUNCH_DRIVER"
fi

if grep -q 'K=1' "$LAUNCH_DRIVER" && grep -q 'subscription' "$LAUNCH_DRIVER"; then
  ok "launch-driver.sh documents K=1 default for subscription backends"
else
  no "launch-driver.sh missing K=1/subscription documentation"
fi

if grep -q 'K>=2' "$LAUNCH_DRIVER" && grep -q 'api' "$LAUNCH_DRIVER"; then
  ok "launch-driver.sh documents K>=2 requires metered-api backend"
else
  no "launch-driver.sh missing K>=2 metered-api documentation"
fi

# ── Test 4: dispatch script exists and passes bash -n ────────────────────────
if [[ -f "$DISPATCH" ]]; then
  ok "clock-in-dispatch.sh exists"
else
  no "clock-in-dispatch.sh missing at $DISPATCH"
fi

if bash -n "$DISPATCH" 2>/dev/null; then
  ok "clock-in-dispatch.sh passes bash -n"
else
  no "clock-in-dispatch.sh fails bash -n"
fi

if [[ "$fail" -eq 0 ]]; then
  echo "launch-driver-test: GREEN"
  exit 0
else
  echo "launch-driver-test: RED"
  exit 1
fi
