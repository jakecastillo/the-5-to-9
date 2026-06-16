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

## B. Codex on the ChatGPT plan (subscription) — ✅ VERIFIED 2026-06-15 (codex-cli 0.140.0)
- [x] **Auth = plan, not API.** This version has **no `--device-auth`**; bare `codex login` → browser "Sign in with ChatGPT" = plan auth. `codex login status` → **"Logged in using ChatGPT"**. Ran with an isolated `CODEX_HOME="$HOME/.codex-f9-slice0"` so the real `~/.codex` (a heavily-populated, different/extended Codex install) was untouched. Env had no `OPENAI_API_KEY`/`OPENAI_BASE_URL`; runs use `env -u OPENAI_API_KEY` as belt-and-suspenders. RESULT: ✅ plan auth confirmed.
- [x] **Structured-output worker contract works.** `env -u OPENAI_API_KEY codex exec --json --output-schema schema.json -C <dir> -s read-only --skip-git-repo-check --ephemeral -o last.json "<task>"` → exit 0; JSONL events `thread.started → turn.started → item.completed(agent_message) → turn.completed`; `turn.completed.usage = {input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens}`; `last.json` schema-valid `{"status":"done","summary":"…"}`. RESULT: ✅ end-to-end.
- [x] **ToS reality:** NOT exercised concurrently (OpenAI forbids sharing one login across concurrent execs) → Codex stays **serialized, K=1** per the design.
- Note for the adapter: redirect **stdin from /dev/null** (else codex prints "Reading additional input from stdin…"); `--cd` is `-C` in this version; `--json` / `--output-schema` / `-o` / `-s` / `--ephemeral` / `--ignore-user-config` / `--skip-git-repo-check` all confirmed.

## C. The gate under bypass (CRITICAL — run `scripts/spike-gate-smoke.sh`)
- [ ] In a throwaway repo with this plugin installed, a worker under `--dangerously-skip-permissions` attempting `git push --force` is BLOCKED by `hooks/irreversible-gate.mjs`. RESULT:
- [ ] A `disallowedTools` deny-rule (e.g. `--disallowedTools "Bash(bd create*)"`) blocks a `bd create` attempt under bypass. PIN the exact deny-rule syntax. RESULT:

## D. Overnight auth stability
- [ ] Leave a token-authed `claude -p` smoke loop running ~6–8h (or re-run after a long gap) → confirm the token did not expire/log out mid-run. RESULT:

## Decisions captured (the PINs the adapters will use)
- Claude worker invocation: PIN: `claude -p ...` (Section A — pending `setup-token`)
- Codex worker invocation: PIN ✅: `env -u OPENAI_API_KEY CODEX_HOME=<home> codex exec --json --output-schema <schema> -C <worktree> -s workspace-write --skip-git-repo-check --ephemeral --ignore-user-config -o <out> "<task>" </dev/null` → parse `<out>` (or the final `item.completed.item.text`) as the WorkerOutcome; read `turn.completed.usage` for token budgeting.
- Deny-rule syntax: PIN: (Claude — Section A pending; Codex sandboxes instead via `-s read-only|workspace-write` + no bd-write path)
- JSON result field paths: Codex ✅ — final structured msg in `-o <file>`; tokens in `turn.completed.usage.{input_tokens,output_tokens,cached_input_tokens,reasoning_output_tokens}`. Claude — Section A pending.
