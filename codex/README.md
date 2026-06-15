# The 5 to 9 — Codex CLI adapter

> **Status: phase-2.** A full Codex runtime is not shipped yet. This directory documents
> the path and gives you a working manual entrypoint. The *portable core* of The 5 to 9
> already runs under Codex full-auto today; the *plugin wiring* (hooks/agents) is still
> Claude-Code-native and is what phase-2 ports.

The 5 to 9 is built as a Claude Code plugin over a deliberately portable core. Codex
([OpenAI Codex CLI](https://github.com/openai/codex)) reads `AGENTS.md` natively, so most
of the crew's brain transfers without translation. What does not transfer is the
Claude-specific *wiring* — how hooks and subagents are declared and invoked. This README
maps the seam.

## TL;DR — run a shift under Codex today

1. Install Codex and `bd` (beads), and make sure `git` is available.
2. From the target repo, set Codex to full-auto in `~/.codex/config.toml` (see below).
3. Start Codex and paste the body of [`prompts/clock-in.md`](./prompts/clock-in.md)
   (or point Codex at it). It reads `AGENTS.md`, claims work from beads, and loops.
4. For long hands-off runs, drive the **fresh-process** loop with
   `bash scripts/night-shift.sh --max-iterations 30` — same script, fresh Codex context
   each iteration, no context rot.

## What's portable vs. what's Claude-specific

**Portable (works in Codex and any AGENTS.md-aware agent):**

- **`AGENTS.md`** — the canonical, cross-tool agent guide. Codex reads it directly.
  Claude Code reaches the same file through a thin `CLAUDE.md` that does `@AGENTS.md`
  (already handled in this repo), so both tools share one source of truth.
- **Skills** — the *content* of `skills/` (running-the-shift, shift-memory-beads,
  right-sizing-the-crew) is plain markdown procedure. The body is portable; only the
  install **path** differs (see below).
- **Scripts** — `scripts/night-shift.sh`, `scripts/lib/common.sh`, and the hook handler
  scripts under `hooks/` are POSIX bash. They run under Codex unchanged. The fresh-process
  loop is engine-agnostic: it shells out to the agent CLI per iteration.
- **MCP servers** — both tools speak MCP. The same server configs port; only the config
  file and key names differ (Claude `mcpServers` JSON vs. Codex `[mcp_servers]` TOML).
- **beads (`bd`)** — the backlog, the DAG, `bd ready --claim`, and durable memory are an
  external CLI + DB. Tool-agnostic by construction.

**Claude-specific (phase-2 to port):**

- **Plugin manifest + component discovery** — `.claude-plugin/plugin.json` and the
  auto-discovery of `agents/ commands/ skills/ hooks/` is Claude Code's loader. Codex has
  no drop-in equivalent for slash commands or packaged subagents yet.
- **Hook wiring** — Claude declares hooks in `hooks.json` and injects context via
  `SessionStart`/`UserPromptSubmit` `additionalContext`. Codex fires hook *events* too,
  but wires them in `config.toml`, not a plugin manifest (see below).
- **Subagent fan-out** — the crew's parallel role-agents are Claude subagents. Under Codex
  today, run the crew as one driver following the protocol and serialize through beads;
  true parallel subagents are a phase-2 item.

## Skills path

| Tool        | Skills live in        |
| ----------- | --------------------- |
| Claude Code | `.claude/skills/`     |
| Codex       | `.agents/skills/`     |

The skill **bodies** are identical markdown — copy or symlink the directory; do not rewrite
the procedure. Only the location the runtime scans for them changes.

## Codex config — `~/.codex/config.toml`

Full-auto, hands-off operation needs Codex's approval and sandbox settings relaxed
*deliberately*, exactly as The 5 to 9 expects bypass-permissions on the Claude side. This is
why the irreversible-action **gate** and a real `SECURITY` policy matter — the runtime stops
asking, so the crew must self-restrain.

```toml
# ~/.codex/config.toml

# Don't prompt on every action — the shift is hands-off.
approval_policy = "never"            # or "on-failure" while you build trust

# Let the crew write within the workspace. Use danger-full-access ONLY when you
# accept that the runtime will not sandbox file/network ops — the gate is your guardrail.
sandbox_mode = "workspace-write"     # full-auto long runs: "danger-full-access"

# MCP servers (port your Claude `mcpServers` here, one [mcp_servers.<name>] block each).
[mcp_servers.beads]
command = "bd"
args = ["mcp"]

# Hook events are PascalCase and largely compatible with the Claude handler scripts.
# The handler scripts are portable; only this wiring differs.
[hooks]
SessionStart    = "bash ./hooks/session-start.sh"
UserPromptSubmit = "bash ./hooks/user-prompt-submit.sh"
Stop            = "bash ./hooks/shift-loop.sh"
```

Notes:

- **Approval / sandbox.** `approval_policy = "never"` + `sandbox_mode = "danger-full-access"`
  is the closest analog to Claude Code bypass-permissions. Prefer `workspace-write` until
  the gate is trusted; reserve `danger-full-access` for capped, branch-isolated runs.
- **Hook events are PascalCase** in Codex (`SessionStart`, `UserPromptSubmit`, `Stop`, …)
  and map cleanly onto the same handler scripts this repo already ships under `hooks/`.
  Keep the scripts; change only the wiring (Codex `[hooks]` in `config.toml` vs. Claude
  `hooks.json`).
- **Context injection caveat carries over.** Plugin-distributed `SessionStart` /
  `UserPromptSubmit` injection has known reliability issues on the Claude side; treat the
  Codex prompt in `prompts/clock-in.md` as the guaranteed entrypoint and hooks as an
  enhancement, just as on Claude Code.

## Honest status

This is the *documented path*, not a finished port. Today you get: a shared `AGENTS.md`
brain, portable skills/scripts/MCP, beads as memory, and a manual `clock-in` prompt that
runs a real shift under Codex full-auto. Phase-2 turns the wiring above into a packaged
Codex experience (slash commands, parallel subagents, manifest-driven hooks). Until then,
keep iterations capped, serialize writes through beads, and respect the irreversible-action
gate — the crew works the dedicated shift branch, never main/prod, without it.
