# The 5 to 9 — TUI-only orchestration surface, Claude-Code command UX

**Status:** shipped (epic `the-5-to-9-200`) · **Date:** 2026-06-25 · **Supersedes** the
CLI-subcommand parts of [2026-06-17-the-5-to-9-cli-tui-design.md](2026-06-17-the-5-to-9-cli-tui-design.md).

## Decision

Kill the standalone commander CLI; make the Ink **TUI the sole surface** for agent
orchestration, realigned to Claude Code's interaction model: an always-on command bar
instead of single-letter hotkeys. The `the-5-to-9` binary boots straight into the TUI.

This came out of a brainstorm that locked four choices: (1) command-driven input is the
primary direction; (2) an always-on, always-focused input box (not a modal command line);
(3) `/` opens a fuzzy command palette, bare text live-filters the backlog; (4) kill the
CLI entirely rather than keep CLI+TUI aligned.

## What shipped

| Area | Change | Bead |
| --- | --- | --- |
| Command core | `commands.ts` (registry: name/aliases/summary/argHint/`run(ctx,parsed)` over an injected `CommandContext` facade seam), `command-parse.ts` (`parseCommandLine`/`resolveCommand` + did-you-mean), `fuzzy.ts` (palette ranking + Levenshtein nearest). Pure, unit-tested. | 200.1 |
| Key router | One `useInput` in `App`; panes presentational; printables → `ui.input`; `Enter` dispatches `resolveCommand`→`spec.run(ctx)`; arrows nav; `Alt+1/2/3` panes; `Esc` clear; `Ctrl+C`/`/quit` teardown that never kills the driver. | 200.2 |
| Palette + filter | `CommandPalette` (fuzzy, summary + argHint, NO_COLOR-safe selection); bare text → live `ui.filter` via the single `backlog-filter.ts` matcher; empty-state placeholder; unknown-command notify. | 200.3 |
| Keymap | `KEYMAP` rewritten to the command model; Footer + HelpOverlay regenerate from the one table (can't drift); `?`-on-empty-buffer disambiguation. | 200.4 |
| Kill the CLI | Removed `buildProgram` + all subcommands + the `commander` dep; `bin → TUI`; off-TTY → `StaticStatusDump`; repointed dead `the-5-to-9 <subcommand>` strings to the TUI. Operations facade + `consent.ts` untouched. | 200.5 |
| Docs | `README` + `cli/README` realigned to the command bar; no AGENTS.md/CLAUDE.md edits (no-clobber). | 200.6 |
| Clock-in wiring | `/clock-in <goal>` actually calls `operations.clockIn` (inline + modal both via the facade). | 200.8 |

## Invariants preserved (from the 2026-06-17 design)

Dashboard, not a chat REPL · color always pairs with a word/glyph (NO_COLOR-safe) ·
single keymap is the source of truth for footer+help · bounded memory · off-TTY degrades
to a non-interactive dump · SEE is side-effect-free and ACT funnels through the operations
facade + the irreversible-action gate (the gate modal still focus-traps).

## Process notes

Every bead was implemented test-first by the Dealer, gated on `bash tests/validate-plugin.sh`,
and independently verified by the Floor Auditor — which rejected three beads on real defects
(missing negative-assertion test, a duplicated filter matcher, leftover dead-CLI instruction
strings, and a lost `gateApprove`/`gateDeny` coverage path) before they could close.

## Deferred (filed, not built)

- `200.9` — Run-Stream arrow / PageUp-Down scroll (P3 polish).
- `200.10` — decision: whether to expose a minimal headless (non-TTY) consent seam for CI,
  now that the scriptable `the-5-to-9 gate` subcommand is gone.
