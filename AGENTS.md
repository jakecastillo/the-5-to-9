# AGENTS.md — working on The 5 to 9

> Cross-tool agent guide for **this repository** (Codex, Claude Code via `@AGENTS.md`,
> and other AGENTS.md-aware tools). For *how the crew operates on a target repo*, see
> the `running-the-shift` skill — not this file.

## What this project is

The 5 to 9 is a **Claude Code plugin** (portable core underneath) that clocks in a
night-shift crew of role-agents to work a [beads](https://github.com/steveyegge/beads)
backlog and ralph-loop a repo to done, hands-off, with hard gates only on irreversible
actions. It is mostly **markdown + JSON + bash** — no compiled artifact.

## Build / test / lint

```bash
bash tests/validate-plugin.sh     # full structure + JSON + frontmatter + bash -n gate
bash tests/run.sh                 # alias; CI entrypoint
```

There is no build step. "Green" = `validate-plugin.sh` exits 0. CI runs it on push
(`.github/workflows/validate.yml`). Do not mark a task done on red.

## Conventions (non-negotiable)

- **Hooks/scripts are POSIX bash, Git-Bash-compatible** (this is built on Windows).
  Pin hook commands to Git Bash in `hooks.json`. Quote `"${CLAUDE_PLUGIN_ROOT}"`.
  `chmod +x` is not reliable on Windows checkouts — invoke scripts as
  `bash "${CLAUDE_PLUGIN_ROOT}/hooks/x.sh"`, never rely on the exec bit.
- **Plugin layout:** manifest only in `.claude-plugin/`; all components
  (`agents/ commands/ skills/ hooks/`) at repo root. Paths in manifests start `./`.
- **Agents/skills/commands** are markdown with YAML frontmatter; `name` + `description`
  are required. Keep charters short — every line is permanent context cost.
- **State** lives under `.claude/five-to-nine/` (gitignored) and in **beads**; never in
  conversation history. Keep `.beads/*.db` local; commit only the JSONL export.
- **No-clobber:** never write to a *user* repo's `CLAUDE.md`/`AGENTS.md`. Additive
  context via hooks/skills only. Instruction priority: **user repo > The 5 to 9 > defaults.**
- **Voice:** night-shift / diner crew, funny on the surface, rigorous underneath.
  Jokes never cost correctness.

## Gotchas (learned the hard way)

- Plugin-distributed `SessionStart`/`UserPromptSubmit` `additionalContext` injection
  has reported bugs (claude-code #16538/#27145). **Slash commands are the guaranteed
  entrypoint;** hooks are an enhancement — keep both, test injection before relying on it.
- In-session Stop-hook loops **accumulate context and degrade** (~150K). Long hands-off
  runs use `scripts/night-shift.sh` (**fresh process per iteration**), not `/clock-in`.
- beads embedded Dolt is **single-writer** — serialize writes; isolate independent work
  in worktrees and set `BEADS_DIR` so they find the main DB.
- Only `blocks` / `parent-child` edges gate `bd ready`; `discovered-from` is provenance.
- **Always** cap loop iterations (default 30). Never ship an uncapped loop.

## Right-sizing models (defaults; overridable)

Opus → strategy/critic/security (Owner, Bouncer). Sonnet → coordination/coding/QA
(Floor Manager, Regular, Line Cook, Health Inspector). Haiku → routine scans/ops (Janitor).
