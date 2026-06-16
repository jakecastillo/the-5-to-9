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
- **Logic-heavy hooks run on zero-dep Node (`.mjs`), behind a bash launcher.** The
  irreversible gate is `hooks/irreversible-gate.mjs` (Node 18+); its `.sh` is a thin
  launcher that execs node and **falls back to the bash classifier if node is absent**
  (fail closed — never silent-allow). Orchestration scripts (`night-shift`, `setup-shift`,
  `clock-out`, `guardrail-scan`) stay POSIX bash by design. `node --test hooks/*.test.mjs`
  covers the ported logic; the `tests/gate-cases.txt` corpus pins behaviour across both.
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

Opus → strategy/critic/security (Owner, Eye in the Sky). Sonnet → coordination/coding/QA
(Pit Boss, Dealer, Floor Auditor, Cage Cashier). Haiku → routine scans/ops (Floorman).

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
