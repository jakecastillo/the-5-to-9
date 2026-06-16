# The 5 to 9 — Design

> The shift that works while you're off the clock.
> A Claude Code plugin that clocks in a full night-shift crew of AI role-agents,
> works a beads backlog in parallel, and ralph-loops your repo to done —
> hands-off, with hard gates only on irreversible actions.

- **Status:** Superseded — historical v1 design (kept as the record of the 2026-06-14 direction). The current design is [`2026-06-15-the-5-to-9-sdk-redesign-design.md`](2026-06-15-the-5-to-9-sdk-redesign-design.md). The diner-crew names below (Floor Manager, The Regular, Line Cook, Health Inspector, Bouncer, Janitor) are **retired**; the live crew is **The Card Room** (The Owner, The Pit Boss, The Cage Cashier, The Dealers, The Floor Auditor, The Eye in the Sky, The Floorman).
- **Author:** jakecastillo (dogfooded — The 5 to 9 helped build itself)
- **Spec date:** 2026-06-14

---

## 1. Vision

Most "AI dev team" projects fail the same way: they spin up a cast of chatty
role-agents that narrate a standup, duplicate each other's work, burn ~15× the
tokens of a single agent, loop forever, and can't tell when they're done. The
research is blunt about it — *more agents do not reliably help*; wins come from
crisp role specs, hard task boundaries, external shared memory, isolated writes,
and a mandatory independent verifier.

**The 5 to 9** is the opposite of role theater. It is a *thin* orchestration
layer that:

1. **Refines the objective** from the repo's own intent + docs (a real read pass).
2. **Studies prior art** for whatever is being built (a focused, isolated read).
3. **Aligns to the repo's existing guardrails** (CLAUDE.md, AGENTS.md, CONTRIBUTING,
   lint/test/CI) — read and obeyed, never overwritten.
4. **Runs a crew of role-agents in an orchestrator-worker pattern**, fanning out
   reads and serializing writes through git worktrees + a merge gate.
5. **Uses beads (`bd`) as the single source of truth** — backlog, dependency DAG,
   ready-work queue, atomic claim, coordination gates, and durable memory.
6. **Ralph-loops** until the goal's backlog is closed and acceptance is met, then
   refines scope and starts the next loop — no human in the loop unless a hard
   gate trips.

It does all of this without bloating context: minimal init, just-in-time loading,
heavy reading done by ephemeral subagents that return distilled briefs, and state
kept in beads rather than the conversation.

## 2. Locked decisions (from the owner)

| Decision | Choice |
|---|---|
| Substrate | **Plugin-first** — native Claude Code plugin (subagents + hooks + beads + scripts). A TUI dashboard is a later, optional read-only view over beads/state. |
| v1 runtime | **Claude Code CLI first.** Portable core (AGENTS.md + scripts + beads) underneath; Codex CLI next; App-store `interface` manifests last. |
| Autonomy | **Autonomous, hard-gate irreversibles only.** Code/tests/commits/branches/PRs proceed unattended. Pauses only for prod deploy, publishing a release, force-push, or deleting remote data. |
| Crew theme | **Night shift.** The Owner, Floor Manager, The Regular, Line Cook, Health Inspector, Bouncer, Janitor. Funny on the outside, rigorous on the inside. |

## 3. Architecture

```
              "clock in"  (phrase)        /clock-in (command)
                    │                           │
                    ▼                           ▼
        UserPromptSubmit hook  ──────►  Shift bootstrap (loaded ONCE)
        (additive context inject)        reads docs+guardrails via subagents
                    │                           │
                    ▼                           ▼
         ┌──────────────────────────────────────────────┐
         │   THE FLOOR MANAGER  (orchestrator / lead)    │
         │   decompose → bd epics/tasks → dispatch       │
         └──────────────────────────────────────────────┘
            │ fan-out READS        │ serialize WRITES
            ▼ (parallel subagents) ▼ (worktree + merge-slot)
   [Regular] [Bouncer] [Health Insp.]   [Line Cook] … [Line Cook]
        │  acceptance / risk / tests        │ implement (TDD)
        └──────────────┬────────────────────┘
                       ▼
                 BEADS (bd)  ── single source of truth ──
        backlog · DAG · `bd ready --claim` · gates · memory · preflight
                       │
                       ▼
              Stop hook  (the shift loop)
   active shift + ready work?  → re-inject "advance the shift"
   backlog closed + acceptance met + green? → clock out
   irreversible action pending? → HARD GATE (stop, ask human)
```

### 3.1 Activation (no clobbering)

Three additive entry points; none touch the user's files:

- **`/clock-in [goal]`** (slash command) — explicit start. Writes shift state to
  `.claude/five-to-nine/shift.local.md` (gitignored), bootstraps the crew.
- **`UserPromptSubmit` hook** — detects a trigger phrase (default: `clock in`,
  `5 to 9`, `night shift`) and injects the shift bootstrap as
  `hookSpecificOutput.additionalContext`. Purely additive — the user's CLAUDE.md /
  AGENTS.md are read and respected, never modified.
- **`SessionStart` hook** — injects a *one-line* awareness note only
  ("The 5 to 9 is installed; say 'clock in' to start a shift"). Deliberately tiny
  to avoid permanent context cost.

Instruction priority is explicit and documented: **user repo docs > The 5 to 9 >
defaults.** If the repo's AGENTS.md says "no TDD," the crew obeys the repo.

### 3.2 The crew (roles)

Seven roles. Each is a Claude Code subagent (`agents/*.md`) with a crisp charter,
explicit task boundaries, a default right-sized model, and the beads verbs it owns.
Charters are short — every line is permanent context cost.

| Role (name) | Job | Default model | Owns in beads |
|---|---|---|---|
| **The Owner** (exec) | Sets/approves the top-level goal & acceptance. The only role that may authorize a gated irreversible action (and even then defers to the human gate). Rare, high-stakes. | `opus` | top epic + acceptance |
| **The Floor Manager** (PM) | Orchestrator. Decomposes goals into beads, wires the DAG, dispatches ready work, runs the shift loop, integrates results. | `sonnet` | epics/features/tasks, deps, dispatch |
| **The Regular** (business analyst) | Voice of the user/market. Refines requirements, writes acceptance criteria, sanity-checks scope against real need. | `sonnet` | `--acceptance`, feature refinement |
| **The Line Cook** (developer) | Implements. TDD. Works in an isolated worktree; claims one bead at a time. Escalates genuinely hard architecture to `opus`. | `sonnet` | `bd ready --claim`, close tasks |
| **The Health Inspector** (QA) | Independent verifier. Designs & runs tests, validates acceptance, files bug beads. Cannot pass its own cooking — it only checks others'. | `haiku` (scans), `sonnet` (design) | files `bug`, verifies close |
| **The Bouncer** (security) | Secrets scan, dependency/CVE check, authz/input-validation review. Can block a release bead. | `sonnet`, `opus` (deep review) | `security`-labeled beads, release blocks |
| **The Janitor** (devops/CI-CD) | Keeps the pipes running: CI, builds, `bd preflight`, merge-slot, release prep. Owns the irreversible-action gate machinery. | `haiku` (routine), `sonnet` (pipeline design) | preflight, merge-slot, release gate |

**Right-sizing rule:** start cheap, escalate on signal. Routine scans/ops →
Haiku; implementation/coordination → Sonnet; strategy/security-judgment/hard
architecture → Opus. Models are defaults in frontmatter and overridable via config.

### 3.3 Memory = beads (`bd`)

Beads is the substrate, not a sidecar. It already provides everything the
multi-agent research said we'd otherwise have to build:

- **Backlog & DAG:** `bd create --type epic|feature|task|bug --parent --acceptance -p Pn`,
  `bd dep <blocker> --blocks <blocked>`, `bd dep cycles`.
- **Ready-work queue + atomic claim (the blackboard):**
  `bd ready --json`, **`bd ready --claim --json`** (atomically claims the first
  ready issue → no two agents grab the same work), `bd update <id> --claim`.
- **Parallel-write safety:** **`bd worktree`** (isolated worktrees per Line Cook)
  + **`bd merge-slot`** (serialized conflict resolution gate). This is precisely
  the "isolate writes, gate the merge" pattern that prevents the #1 multi-agent
  failure (two agents editing shared files).
- **Fan-out/join:** `bd swarm`, `bd mol --mol-type swarm`,
  `bd gate --waits-for-gate all-children|any-children`.
- **Durable memory:** `bd remember`/`bd recall`/`bd memories`, `bd kv`.
- **Low-bloat onboarding:** `bd onboard` (minimal agent snippet), `bd prime`
  (AI-optimized workflow context) — loaded just-in-time, not front-loaded.
- **Ship hygiene:** `bd preflight` (PR readiness), `bd github`, `bd doctor`.
- **Git-native source of truth:** the JSONL export is committed; the local DB is
  gitignored. Survives sessions; that's how the loop "remembers" across iterations
  without dragging conversation history.

The 5 to 9 ships thin **wrappers/conventions** over `bd` (label taxonomy, a
`five-to-nine` molecule template, helper scripts), not a reimplementation.

### 3.4 The loop (ralph mechanic, beads-aware)

Modeled on the proven ralph-loop Stop-hook mechanic (a Stop hook returns
`{"decision":"block","reason":<prompt>}` to refuse exit and feed the next step
back), but **data-driven** instead of blindly re-injecting the same prompt:

- State lives in `.claude/five-to-nine/shift.local.md` (own namespace; coexists
  with ralph-loop's state file, each a no-op when its own state is absent).
- **Continue** while the active goal has open/ready beads AND iteration/wall-clock
  budget remains: re-inject "advance the shift — pull the next ready bead."
- **Clock out** when `bd ready` for the goal is empty, all beads closed, acceptance
  met, and tests green. Completion is gated behind a genuine, non-fakeable signal
  (beads state + test exit code), echoing ralph's "don't lie to exit the loop."
- **Hard gate** when an irreversible outward action is pending (see 3.6): the hook
  stops the loop and surfaces a clear approval request instead of proceeding.
- Each iteration recovers state from **files + git + beads**, never from a bloated
  transcript. Degenerate-loop guards: max-iterations, no-progress detection
  (N iterations with no bead closed/created → stop and report), and a stuck-bead
  escalation.

### 3.5 Lifecycle of one shift

1. **Clock in** — minimal bootstrap. An ephemeral subagent reads project docs +
   guardrails and returns a ≤1-page brief; `bd doctor`/`bd init` ensures beads is
   ready. Cheap.
2. **Stand-up** — The Floor Manager + The Regular refine the objective from intent
   + docs, reconcile with guardrails, and (re)build the goal's bead graph with
   acceptance criteria.
3. **Service** — the loop: `bd ready --claim` → dispatch the right role(s);
   parallelize independent reads/analysis; serialize writes via worktrees;
   Line Cook implements TDD; Health Inspector verifies; Bouncer reviews; Janitor
   integrates through the merge-slot; close beads. Repeat.
4. **Last call / close** — backlog done + acceptance met + green → Janitor runs
   `bd preflight`, preps release (gated), writes a shift report, clocks out.
5. **Refine scope** — between loops, re-evaluate goals, open the next epic,
   continue. (The owner's explicit "once a loop finishes, refine scope, test and
   continue iterating.")

### 3.6 Safety: hard gates on irreversibles

Default posture is full autonomy with a small, explicit deny-list of *irreversible
outward actions* that require a human OK:

- prod/remote deploy, publishing a release/package, `git push --force`,
  deleting remote data (branches, prod DB, releases), rotating/destroying secrets.

Mechanism: a `PreToolUse` hook + an `irreversible-gate.sh` helper that classifies
the pending command; if it matches the deny-list it blocks and emits an approval
request. Everything reversible (local edits, commits, normal pushes to the shift
branch, PRs) proceeds. The crew always works on a dedicated shift branch; `main`
and prod are never touched without the gate.

### 3.7 Portability (Claude CLI now, Codex/Apps later)

- **Portable core:** `AGENTS.md` (crew protocol + guardrail rules, readable by
  Codex and other AGENTS.md-aware tools) + shell scripts + beads + MCP. No
  Claude-only assumptions in the core.
- **Claude adapter:** the plugin (skills/agents/commands/hooks) — this is v1.
- **Codex adapter:** `codex/` with custom-prompt files + `config.toml` notes
  (full-auto/approval modes, MCP); a `.codex-plugin/` manifest mirroring the
  superpowers cross-tool pattern.
- **App surfaces:** `.codex-plugin` / `.cursor-plugin` manifests carry an
  `interface` block (displayName, capabilities, defaultPrompt) for the app stores.
  Marked phase-2 because unattended loops need CLI hooks the apps don't yet expose.

### 3.8 Plays well with others

- **Superpowers:** the crew may invoke superpowers skills (TDD, systematic
  debugging, requesting-code-review, brainstorming) when a task warrants — they're
  complementary, not replaced.
- **Ralph-loop:** coexists; The 5 to 9 ships its own beads-aware loop, but never
  runs both loops on the same goal simultaneously (documented).
- **The user's repo:** read and obeyed; never overwritten.

## 4. Component inventory (v1)

```
the-5-to-9/
  .claude-plugin/        plugin.json, marketplace.json
  .codex-plugin/         plugin.json (interface block; phase-2 runtime)
  .cursor-plugin/        plugin.json (interface block; phase-2 runtime)
  agents/                the-owner, the-floor-manager, the-regular,
                         the-line-cook, the-health-inspector, the-bouncer,
                         the-janitor  (*.md, crisp charters, model right-sized)
  commands/              clock-in, clock-out, shift-status, the-5-to-9 (help)
  skills/                running-the-shift/      (the shift protocol)
                         shift-memory-beads/     (beads conventions + verbs)
                         right-sizing-the-crew/  (model/role sizing reference)
  hooks/                 hooks.json, session-start.sh, user-prompt-submit.sh,
                         shift-loop.sh (Stop), irreversible-gate.sh (PreToolUse)
  scripts/               setup-shift.sh, clock-out.sh, guardrail-scan.sh,
                         beads-helpers.sh, lib/common.sh
  tests/                 validate-plugin.sh, run.sh  (structure/JSON/shell lint)
  codex/                 README.md (adapter notes), prompts/clock-in.md
  docs/superpowers/      specs/ (this doc), plans/ (impl plan)
  .github/workflows/     validate.yml (the Janitor's CI)
  AGENTS.md  README.md  CONTRIBUTING.md  CHANGELOG.md  LICENSE  .gitignore
```

## 5. Anti-patterns we deliberately avoid (from the research)

1. **Role theater** — agents narrating a meeting. Mitigation: roles are dispatched
   only when a bead needs them; no standup chatter, work is in beads.
2. **More-agents-is-better** — fan-out only for genuinely parallel reads; writes
   serialized. Spawning a role costs ~15× tokens; we right-size and reserve it.
3. **Infinite / degenerate loops** — max-iterations + no-progress detection +
   non-fakeable completion signal.
4. **Self-graded completion** — an independent Health Inspector verifies; agents
   never declare their own work done.
5. **Duplicate work** — `bd ready --claim` (atomic) + crisp task boundaries, not
   runtime negotiation.
6. **Shared-file write collisions** — worktree isolation + merge-slot gate.
7. **Context bloat over long runs** — minimal init, subagent isolation, beads as
   external memory, just-in-time `bd prime`.
8. **Clobbering the user's setup** — additive hooks only; read-and-obey their docs.

## 6. v1 success criteria

- Installs as a Claude Code plugin; `/clock-in`, `/clock-out`, `/shift-status`,
  `/the-5-to-9` work; trigger phrase activates additively without touching user files.
- A clock-in on a sample repo: reads docs+guardrails, seeds a beads backlog with
  acceptance, runs ≥1 full loop (claim→implement→test→verify→close), respects the
  irreversible gate, and clocks out with a shift report.
- All seven role charters present, model-right-sized, with clear boundaries.
- `tests/validate-plugin.sh` green (valid JSON manifests, valid hooks.json, valid
  agent frontmatter, `bash -n` on all scripts) and wired into CI.
- Beads holds The 5 to 9's *own* roadmap (it dogfoods itself).
- AGENTS.md portable core present; `.codex-plugin`/`.cursor-plugin` manifests stubbed.

## 7. Out of scope for v1 (tracked in beads)

- Live TUI dashboard (read-only view over beads/state).
- Fully functional Codex CLI / App runtimes (manifests + adapter notes only).
- MCP server packaging, federation across repos, multi-repo swarms.
