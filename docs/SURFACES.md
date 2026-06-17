# Surface support — The 5 to 9

Where the crew runs today, and what each surface gets. The 5 to 9 ships as a Claude
Code plugin over a **portable core** (`AGENTS.md` + skills + POSIX bash scripts/hooks +
[beads](https://github.com/steveyegge/beads) + MCP) — see
[ARCHITECTURE.md](ARCHITECTURE.md). The core is tool-agnostic; only the _plugin wiring_
(packaged slash commands, subagent fan-out, manifest-driven hooks) differs per surface.

Status legend: ✅ works · ◐ partial / in progress · ✗ not yet (phase-2)

## Matrix

| Capability                                  | Claude CLI | Claude App (desktop/web) |  Codex CLI   |  Codex App   |
| ------------------------------------------- | :--------: | :----------------------: | :----------: | :----------: |
| **Overall**                                 | ✅ shipped |         ◐ verify         | ◐ groundwork | ◐ groundwork |
| Slash commands (`/clock-in` …)              |     ✅     |           ✅¹            |      ✗²      |      ✗²      |
| Skills (the protocol)                       |     ✅     |           ✅¹            |      ◐³      |      ◐³      |
| Hooks (gate, shift loop, context)           |     ✅     |           ✅¹            |      ◐⁴      |      ◐⁴      |
| Subagent fan-out (7 roles)                  |     ✅     |           ✅¹            |      ✗⁵      |      ✗⁵      |
| MCP servers                                 |     ✅     |            ✅            |      ✅      |      ✅      |
| Portable core (AGENTS.md + scripts + beads) |     ✅     |            ✅            |      ✅      |      ✅      |

¹ **Claude App** shares one plugin config with the CLI, so a marketplace install should
surface in the desktop/web app after a reload. Not yet independently verified — tracked
by **`phu.6`**.

² **Codex slash commands** aren't part of Codex's plugin model; use the manual entrypoint
`codex/prompts/clock-in.md` instead.

³ **Codex skills** install via Codex's plugin marketplace (`codex plugin add`). The
manifest groundwork is in place (`.agents/plugins/marketplace.json` + a `skills`
declaration), but native install is currently **blocked** — Codex only resolves a plugin
in a _subdirectory_, not at the marketplace root. Tracked by **`ap8`**. Until then the
skill _bodies_ are fully portable: Codex reads them directly.

⁴ **Codex hooks** map onto the same handler scripts but are wired in `config.toml`
(`[hooks]`), not a plugin manifest. Documented path; native wiring is **`phu.1`**.

⁵ **Subagent fan-out** is Claude-native. Under Codex, run the crew as one driver and
serialize through beads; true parallel subagents are phase-2.

## How to run, per surface

- **Claude CLI** — `claude --plugin-dir "$PWD"` (dev) or `claude plugin install
the-5-to-9@the-5-to-9` (persistent), then `/clock-in`. See [INSTALL.md](INSTALL.md).
- **Claude App** — same marketplace install; the plugin should appear after a reload.
  (Verification pending — `phu.6`.)
- **Codex CLI** — today: set full-auto in `~/.codex/config.toml` and paste
  `codex/prompts/clock-in.md`; the portable core runs the shift. Native `codex plugin
add` is pending `ap8`.
- **Codex App** — shares the Codex plugin system; unblocks with Codex CLI (`ap8`).

## The honest line

**Claude CLI is the only fully-shipped surface today.** The other three run the _portable
core_ (AGENTS.md + skills + scripts + beads + MCP) but not yet the full packaged
experience. The remaining wiring is tracked under the `phu` epic (`phu.1`, `phu.5`,
`phu.6`) and the `ap8` blocker. Three run engines apply everywhere the core runs:
watched (`/clock-in`), hands-off bash loop (`scripts/night-shift.sh`), and the
off-loop SDK driver (`scripts/clock-in-dispatch.sh --driver`, K=1 for subscription
backends, K>=2 metered-api only — spec §2.1).
