# Contributing to The 5 to 9

> The shift that works while you're off the clock.

Thanks for picking up a shift. The 5 to 9 is an early, experimental (`v0.1.0`)
cross-tool AI night-shift crew — a Claude Code plugin today, over a portable core that
also runs under Codex full-auto — that clocks in a crew of AI role-agents to work a
[beads](https://github.com/steveyegge/beads) backlog in parallel and ralph-loop a
repo to done — hands-off, with hard gates only on irreversible actions. This guide
covers how to get set up, the one test gate that matters, the house conventions, and
how to land a change.

This repo is **partly self-hosting**: its own roadmap is tracked in beads, and the
crew can (and does) work the backlog. If you'd rather hand a task to the night crew
than do it by hand, that's a legitimate way to contribute — just review the shift
branch like you would any PR (see [SECURITY.md](SECURITY.md)).

---

## Dev setup

There is **no build step**. The project is markdown + JSON + POSIX bash. Clone it and
you're working:

```bash
git clone https://github.com/jakecastillo/the-5-to-9
cd the-5-to-9
```

To run the plugin locally against Claude Code without going through a marketplace
(you're already inside the repo after `cd the-5-to-9` above, and the manifest is at
`./.claude-plugin/plugin.json`):

```bash
claude --plugin-dir .
```

Or install via the marketplace:

```text
/plugin marketplace add jakecastillo/the-5-to-9
/plugin install the-5-to-9@the-5-to-9
```

Entrypoints once installed: `/clock-in [goal]`, `/clock-out`, `/shift-status`,
`/the-5-to-9`.

### Prerequisites

- **Git Bash** (on Windows) or any POSIX `sh`. This project is developed on Windows;
  every script must run under Git Bash.
- **Claude Code** for actually exercising the plugin.
- **beads (`bd`)** if you're touching backlog/memory behavior — see the
  `shift-memory-beads` skill.

---

## The test gate (the only "green" that counts)

```bash
bash tests/validate-plugin.sh   # structure + JSON + frontmatter + `bash -n` checks
```

It **must exit 0.** CI runs it on every push
(`.github/workflows/validate.yml`). Do not mark a task done — or open a PR — on red.
There's a convenience alias:

```bash
bash tests/run.sh               # same gate, CI entrypoint
```

If you add a component (agent, command, skill, hook, script), the validator should
cover it. If it doesn't, extend the validator in the same change.

### Definition of Done

A change is done — and only done — when all of these are true:

- [ ] **The gate is green.** `bash tests/validate-plugin.sh` exits 0.
- [ ] **The validator covers new components.** New agent/command/skill/hook/script? The
      validator was extended in the same change.
- [ ] **Scripts pass `bash -n`** and are Git-Bash-compatible (LF endings — see
      `.editorconfig`); ported `.mjs` hooks pass `node --test`.
- [ ] **Docs and specs are in sync.** `docs/superpowers/`, skill charters, and `AGENTS.md`
      match the new behavior. Spec/code drift is a bug.
- [ ] **`CHANGELOG.md` is updated** under `[Unreleased]` if behavior changed.
- [ ] **No-clobber and the safety gate are respected.** Nothing writes a user repo's
      `CLAUDE.md`/`AGENTS.md`; no new path lets an irreversible outward action slip the
      hard gate.
- [ ] **No secrets** in the diff or in any pasted logs.

### Tests & TDD

The test gate is the floor, not the ceiling. When you fix a bug or add behavior, add the
test that would have caught it — a deny/allow case in `tests/gate-cases.txt`, a
`node --test` case for ported hook logic, or an assertion in `tests/smoke-shift.sh`.
Test-first is welcome and is how the gate corpus was built (it caught a real gap on day one).

---

## Conventions (non-negotiable)

These mirror `AGENTS.md`; read that file too — it's the canonical guide for working
*on* this repo. For *how the crew operates on a target repo*, see the
`running-the-shift` skill.

- **POSIX bash, Git-Bash-compatible.** Hooks and scripts are POSIX `sh`, must run under
  Git Bash on Windows. Quote `"${CLAUDE_PLUGIN_ROOT}"`. Don't rely on the executable
  bit — `chmod +x` is unreliable on Windows checkouts, so invoke scripts as
  `bash "${CLAUDE_PLUGIN_ROOT}/path/x.sh"`. Every script must pass `bash -n`.
- **Plugin layout.** The manifest lives only in `.claude-plugin/`; all components
  (`agents/ commands/ skills/ hooks/`) sit at the repo root. Paths in manifests start
  with `./`.
- **Short agent charters.** Agents, skills, and commands are markdown with YAML
  frontmatter; `name` and `description` are required. Keep charters short — every line
  is permanent context cost that the crew pays on every run.
- **State, not history.** Durable state lives in **beads** and under
  `.claude/five-to-nine/` (gitignored), never in conversation history. Keep
  `.beads/*.db` local; commit only the JSONL export.
- **No-clobber.** Never write to a *user* repo's `CLAUDE.md` / `AGENTS.md`. Inject
  context additively via hooks/skills only. Instruction priority is
  **user repo > The 5 to 9 > defaults.** This rule applies to the crew's behavior and
  to your changes — don't add anything that would stomp a target repo's files.
- **Cap the loop.** Never ship an uncapped loop. The default cap is 30 iterations;
  `scripts/night-shift.sh --max-iterations N` is the fresh-process engine for long
  hands-off runs (`/clock-in` is the in-session engine for short, watched shifts).
- **Safety gate is sacred.** Anything reversible (edits, commits, branches, PRs, normal
  pushes to the shift branch) proceeds. Anything **irreversible and outward** —
  prod/remote deploy, publishing a release or package, `git push --force`, deleting
  remote data, destroying or rotating secrets — must hard-gate. Don't add a code path
  that lets an irreversible outward action slip past the `PreToolUse` gate.
- **Night-shift voice.** Diner crew: wry, a little tired, competent. Funny on the
  surface, rigorous underneath. Jokes never cost correctness or clarity. Keep it in
  user-facing copy, not in code comments that need to be precise.

---

## Where the specs live

Design and plan documents are under `docs/superpowers/`:

- `docs/superpowers/specs/` — design specs (e.g. the dated design doc).
- `docs/superpowers/plans/` — implementation plans (e.g. the dated build plan).

Read the relevant spec before reworking a subsystem. If your change alters intended
behavior, update the spec in the same PR — drift between spec and code is a bug.

---

## Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(hooks): add irreversible-action gate for remote deletes
fix(night-shift): cap iterations when --max-iterations is unset
docs(contributing): document the test gate
chore(ci): run validate-plugin.sh on push
test(validate): cover skill frontmatter
```

Common types: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `ci`. Keep the
subject imperative and under ~72 chars. Explain the *why* in the body when it isn't
obvious.

---

## AI-assisted contributions

This project is partly self-hosting — the night crew works its own backlog — so
AI-authored PRs are welcome and expected. Two rules keep them honest:

1. **Disclose it.** If a shift (or any AI tool) wrote a meaningful part of the change,
   say so in the PR description, or add an `Assisted-by:` trailer to the commit. No shame
   in it; we just don't pretend a bot is a human.
2. **A human reviews the diff.** Crew output gets read line-by-line before merge, same as
   any human PR. The author — human or crew — doesn't grade their own homework. You are
   responsible for everything in a PR you open, including the parts a model wrote.

## Pull request process

1. **Branch.** Never commit directly to `main`. Work on a topic branch (or let the crew
   work a dedicated shift branch).
2. **Stay scoped.** One logical change per PR. If you found three things, that's three
   PRs.
3. **Green the gate.** `bash tests/validate-plugin.sh` must exit 0 locally before you
   push. CI enforces it.
4. **Update docs/specs** that your change affects (`docs/superpowers/`, skill charters,
   `AGENTS.md`).
5. **Respect no-clobber and the safety gate** in anything you add.
6. **Open the PR** with a clear title (Conventional-Commits-style is fine), a short
   description of what and why, and a note on how you tested it. If a beads issue
   tracks the work, reference it.
7. **Review the shift branch** if the crew did the work — read the diff before merging,
   same as any human PR.

Maintainer review may take a bit — it's a night shift, after all. Be patient, and
keep PRs small enough to review at 3 a.m.

---

## Reporting bugs & proposing features

Open a GitHub issue at
<https://github.com/jakecastillo/the-5-to-9/issues>. For bugs, include your OS/shell
(Git Bash?), Claude Code version, the command you ran, and the actual vs. expected
behavior. For security issues, **do not** open a public issue — see
[SECURITY.md](SECURITY.md).

## Code of Conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Credits

The 5 to 9 complements and builds on — it does not replace — these projects:

- **beads** (the `bd` issue tracker / agent memory) by Steve Yegge.
- **superpowers** (agentic skills framework) by Jesse Vincent (GitHub: obra).
- the **"Ralph" loop** technique by Geoffrey Huntley.

Licensed under [MIT](LICENSE).
