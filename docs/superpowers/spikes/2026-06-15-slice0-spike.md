# Slice 0 Spike — live mechanics (owner-run) — 2026-06-15

Goal: pin the exact flags/auth the adapters will use, and confirm the gate fires under bypass.
Fill each result in. "PIN:" lines become constants in `driver/src/adapters/*.ts`.

> Why this can't be automated: it needs YOUR authenticated `claude`/`codex` CLIs and spends
> your subscription budget. The deterministic core (Slice 1) is already built + tested with
> mocks; this spike validates the live edges before they're wired into the loop (Slice 2+).

## A. Claude on Max (subscription, ToS-safe)
- [ ] `claude setup-token` → generates a long-lived OAuth token. Record the env var name (expected `CLAUDE_CODE_OAUTH_TOKEN`) and expiry. RESULT:
- [ ] `claude -p "say hi" --output-format json` with that token (no `ANTHROPIC_API_KEY` in env) → confirm JSON shape (fields: `result` / `total_cost_usd` / `usage`). PIN the field paths. RESULT:
- [ ] Worker model + role: `claude -p --model sonnet --append-system-prompt "<role charter>" --output-format json`. PIN flag names. RESULT:
- [ ] Structured output: does `--output-format json` reliably wrap the final message as JSON? Note any schema/partial flags. RESULT:

## B. Codex on the ChatGPT plan (subscription)
- [ ] `codex login --device-auth` (or seed `~/.codex/auth.json`) → confirm plan auth (not API key). RESULT:
- [ ] `codex exec --json --output-schema <schema.json> --sandbox workspace-write --cd <repo> "<task>"` → confirm NDJSON event stream + final structured result. PIN flags. RESULT:
- [ ] ToS reality: do NOT run two `codex exec` concurrently on one login. Note observed behavior. RESULT:

## C. The gate under bypass (CRITICAL — run `scripts/spike-gate-smoke.sh`)
- [ ] In a throwaway repo with this plugin installed, a worker under `--dangerously-skip-permissions` attempting `git push --force` is BLOCKED by `hooks/irreversible-gate.mjs`. RESULT:
- [ ] A `disallowedTools` deny-rule (e.g. `--disallowedTools "Bash(bd create*)"`) blocks a `bd create` attempt under bypass. PIN the exact deny-rule syntax. RESULT:

## D. Overnight auth stability
- [ ] Leave a token-authed `claude -p` smoke loop running ~6–8h (or re-run after a long gap) → confirm the token did not expire/log out mid-run. RESULT:

## Decisions captured (the PINs the adapters will use)
- Claude worker invocation: PIN: `claude -p ...`
- Codex worker invocation: PIN: `codex exec ...`
- Deny-rule syntax: PIN:
- JSON result field paths (cost/usage/result): PIN:
