# The 5 to 9 — Deterministic-Orchestration Redesign — Design

> Keep The 5 to 9 a **Claude Code plugin** (crew, the irreversible gate, the interactive
> entrypoint) and add **one thin deterministic driver** (TypeScript) that runs the hands-off
> loop by shelling out to **pluggable CLI worker-adapters** — `claude -p` (Claude Max) and
> `codex exec` (Codex plan), with metered API as a documented opt-in. Orchestration moves
> from prose a single agent may ignore into **code** that *guarantees* the dispatch graph,
> the independent verifier, write-serialization, durable resumption, and the irreversible
> gate. Crewed as **The Card Room** (a regulated after-hours casino), with a low-bloat
> learning memory.

- **Status:** Approved direction (owner approved 2026-06-15). Hardened by a 4-reviewer verification pass and three research workflows (orchestration best-practice, technology/instrumentation, subscription-plan compatibility).
- **Author:** jakecastillo (dogfooded).
- **Spec date:** 2026-06-15
- **Supersedes:** the prose-/bash-driven loop in `2026-06-14-the-5-to-9-design.md`. The plugin (manifests, hooks, gate, commands) is **kept and extended**, not rebuilt.

> **Volatile-facts caveat (as of 2026-06-15).** Provider auth/billing and CLI flags changed
> 2–3× in 2026 and a major Anthropic change takes effect *today*. **Do not hard-code limits
> or flag names**; confirm each against `--help` / official docs at build time. Slice 0 is a
> spike that pins the load-bearing mechanics before the main build.

---

## 1. Why (the problem this fixes)

The shipped v1 is a Claude Code plugin: markdown crew charters + bash. Its hands-off engine
(`scripts/night-shift.sh`) is a bash `while` loop that each iteration runs one
`claude -p "<one paragraph>"`. That single agent is *told* in prose to play every role. So
the load-bearing multi-agent logic lives in **prose a single agent may or may not honor** —
nothing in code guarantees distinct workers, the author≠grader split, or the DAG.

**This redesign keeps the plugin and replaces the prose paragraph with a deterministic code
driver.** The driver runs the loop; each worker is a CLI agent run that loads the plugin, so
the crew, the gate-hook, and the tools come along for free.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Substrate | **Plugin-first + a thin deterministic driver.** No ground-up engine; no beta Managed-Agents API. |
| Driver / worker dispatch | **TypeScript driver that shells out to pluggable CLI worker-adapters** (`claude -p`, `codex exec`, opt-in API). **Not** the `@anthropic-ai/claude-agent-sdk` library — it is API-key-only (see §2.1), conflicting with the subscription-first default; v1 ships **zero npm runtime deps** by shelling out to the `claude`/`codex` binaries the user already has. |
| Auth posture | **Subscription-first, serialized** (§2.1). Default to the user's plans; metered API is an opt-in for true parallelism. |
| Autonomy | **Bounded strategy tick** — re-score/prune/*add* beads within the human-set goal; never edits the goal; never closes/deletes a human-created or in-progress bead (§5.3). |
| Crew | **The Card Room** (regulated casino; the crew is the audited *house*). *Roster/models/tool rules are provisional, pending the §13 refinement pass.* |
| Memory | **Low-bloat JIT** — plain files per type + beads; naive scan under a token budget; no embedding index, no sqlite (§6). |
| Gate | **Kept** as the fail-closed PreToolUse hook + per-query `disallowedTools` deny-rules (§7). |
| beads access | **`bd` CLI (`--json`), shelled from the driver** — not MCP — for the hands-off path (§8). |
| Kept invariants | beads single source of truth; no-clobber of user-repo docs; instruction priority user-repo > The 5 to 9 > defaults; "funny on the surface, rigorous underneath." |

### 2.1 Auth & runtimes (subscription-first, serialized)

The hard reality the research surfaced (primary-source, **as of 2026-06-15** — re-verify):

- The **Claude Agent SDK requires a Console API key**; it does **not** accept Max-subscription OAuth, and using subscription tokens in the SDK/third-party tools **violates Anthropic ToS** (enforced). → the driver does **not** use the SDK library for the subscription path.
- **As of today, non-interactive Claude (`claude -p`, SDK, Actions) no longer draws from the Max interactive pool** — it draws from a *separate metered "Agent SDK credit"* (~$100–200/mo at API prices, no rollover), then API billing. **Only *interactive* terminal Claude Code rides the Max subscription.** The ToS-safe subscription auth for `claude -p` is `claude setup-token` (a long-lived OAuth token, expires ~1yr → rotation needed).
- **Codex** runs hands-off on the ChatGPT plan: `codex exec --json --output-schema …`, plan-authed via `codex login --device-auth` (beta) or a seeded `~/.codex/auth.json`. **But OpenAI ToS forbids sharing one login across concurrent jobs** → **no parallel Codex workers on a single plan** (serialize), and it's the "advanced / private-repo / API-recommended" path.
- **True parallel pools (K≥2) therefore require metered API** (or multiple accounts = ToS gray).

**Posture (locked): subscription-first, serialized.**
| Mode | Default backend | Concurrency |
|---|---|---|
| Watched (`/clock-in`, present) | interactive Claude Code (Max pool) or Codex | n/a |
| Hands-off (the night shift) | **Codex `codex exec`** on the ChatGPT plan | **serialized, K=1** |
| Hands-off + parallel pool (opt-in) | **metered API** (budget-capped) | K≥2 |

**Pluggable worker-adapter** (the existing `FIVE_TO_NINE_AGENT_CMD` seam, formalized): a worker
is `runWorker({role, systemPrompt, task, allowedTools, disallowedTools, model, outputSchema,
timeoutTurns, sandbox}) → StructuredResult`. The driver owns dispatch/frontier/join and never
reads model output to decide control flow; each adapter only translates the call to its
backend CLI and validates the schema-bound result. Adapters: **Claude** (`claude -p
--output-format json --model … --permission-mode … --allowedTools … --disallowedTools … `),
**Codex** (`codex exec --json --output-schema …`), **API** (opt-in, metered).

**Auth safety (non-negotiable):** the driver **refuses to start without a confirmed credential
mode**; **scrubs a stray `ANTHROPIC_API_KEY`** from the worker env unless the API backend was
explicitly chosen (prevents surprise metered bills); prints a one-line **"this shift bills
<backend> as <subscription|metered-API>; budget ≤ $X / N tokens"** banner before iteration 1;
records the credential mode in the shift report. Never wrap/proxy a subscription behind a
shared service (ToS).

## 3. Architecture

```
          driver/  (TypeScript, shells out)  ── deterministic control loop (code) ──
                          │
  ┌───────────────────────┼────────────────────────────────────────────┐
  │ read beads (bd --json) → compute write-independent frontier → dispatch │
  └───────────────────────┼────────────────────────────────────────────┘
        │ worker-adapter → `claude -p` | `codex exec` | (api)  — each loads the PLUGIN
        ▼            (default: serialized K=1; parallel K≥2 = metered-API opt-in)
  [Dealer]      [Floor Auditor]      [Eye in the Sky]
  worker = a CLI agent run: role agent + PreToolUse gate-hook + bd-read tools
        │ structured JSON out (schema-validated by the driver)
        └──────────── driver enforces: mechanical gate · author≠grader · join ───┘
                          │
        Cage write queue (concurrency-1 mutex) = the ONLY process that runs `bd` writes,
        shift-branch merges, and memory commits  ──►  beads (JSONL) + memory files
                          │
   gate = PreToolUse hook (fires under bypass) + disallowedTools deny-rules (fire under bypass)
                          │
                 durable tick journal (fsync) → crash-safe, idempotent resume
```

### 3.1 Code drives dispatch
The driver (TypeScript, <~500 LoC of orchestration) queries beads, computes the
**write-independent** ready frontier, dispatches workers via the adapter, validates each
worker's structured JSON output against a schema, and enforces the mechanical gate, the
author≠grader rule, and write-serialization **in code**. It never asks an LLM "what next."
Each worker run carries ~10–12s process overhead — an intentional trade of latency for
context integrity (fresh context per worker → no rot; the property today's `night-shift.sh`
already relies on).

### 3.2 The single-writer principle (read-parallel, write-serial)
Reads/verification fan out; **all writes serialize through one path.** Concretely (§8): a
single **in-process async write queue** (a zero-dep promise-chain mutex, concurrency=1) in the
driver, through which **every `bd` mutation, every shift-branch merge, and every memory commit
is awaited**; reads bypass it. Single-writer is guaranteed **by construction** — exactly one
process ever runs a `bd` write verb — with beads' embedded-DB lock only as a backstop. Workers
are read-only against beads and have **no write path**.

## 4. The crew — The Card Room (plugin `agents/*.md`)

Native plugin subagents, re-skinned to the Card Room, invoked by the driver per role.
**Provisional, pending the §13 refinement pass.**

| Persona | Function | Model | Boundary |
|---|---|---|---|
| **The Owner** | strategy | `opus` | sets the one goal + acceptance; authorizes intent at the gate, still defers to the human. |
| **The Pit Boss** | planner | `sonnet` | *produces* the bead DAG + strategy-tick proposals; the Cage queue persists them. |
| **The Dealers** ×K | developer pool (TDD) | `sonnet` (→`opus` hard) | one bead, test-first, isolated `git worktree`; read-only against beads. |
| **The Floor Auditor** ×K | independent QA | `sonnet` (→`opus`) | re-counts vs a fixed rubric; **no instance verifies a bead it implemented, never shares the Dealer's worktree/context**; produces blocking bug-bead content. |
| **The Eye in the Sky** | security | `opus` | secrets/authz/injection/deps; marks a bead unsafe so it can't reach the gate. |
| **The Cage Cashier** | merge-join | `sonnet` | resolves merge conflicts; the driver's single write queue commits beads/branch/memory. |
| **The Floorman** | ops / CI | `haiku` | lint/format/preflight/stage; never ships. |

### 4.1 How the structural guarantees are actually enforced (corrected)

**Critical:** under `bypassPermissions` (how hands-off runs), `allowedTools` does **NOT** remove
capability, and `canUseTool` is **not reached**. Permission evaluation order is **Hooks → Deny
rules → Ask rules → Permission mode → Allow rules → canUseTool**; bypass skips only *mode +
allow*. So guarantees come from the layers that **always** fire:

1. **No write path:** workers are never handed a `bd`-write capability or the Cage queue; only
   the driver process runs `bd` write verbs.
2. **`disallowedTools` deny-rules per worker query** (e.g. `Bash(bd create*)`, `Bash(bd update*)`,
   `Bash(bd close*)`, `Bash(bd claim*)`, `Bash(bd note*)`, plus deploy/publish/push-force) —
   these fire under bypass.
3. **The PreToolUse irreversible-gate hook** — fires under bypass (documented; Slice-0 smoke-tested).

Read-only roles (Auditor, Eye) run with a tight `allowedTools` + `permissionMode:'dontAsk'` so
anything unlisted is hard-denied. `agents/*.md` frontmatter tool-lists **cannot** override an
inherited bypass mode, so scoping lives in each top-level worker query's options. A CI check
asserts no Dealer/Auditor query carries a `bd`-write path.

## 5. The loop

### 5.1 Stand-up (once)
The Owner sets one goal + acceptance. The Pit Boss produces the bead DAG; the Cage queue
commits it.

### 5.2 Work tick (capped)
Knobs (named, defaulted, never uncapped): `max-iterations` (30), `no-progress-window` (3),
`K` (concurrency; **default 1 / serialized**; K≥2 only on the API backend), `budget-usd` /
`budget-tokens` (required-style caps).

1. Driver computes the **write-independent frontier** with **layered independence** (escalating
   strictness): (a) each bead declares an **in-scope-dirs / touch-set**; (b) an **interface
   barrier** (beads touching shared interfaces/types are serialized); (c) a **`git merge-tree`
   dry-run backstop** before integration; (d) **K=1 when independence is unknown.**
2. Dispatch ≤`K` **Dealers** via the adapter, each in its own `git worktree add` sandbox with
   `BEADS_DIR` exported to the main `.beads` for **read context only**; test-first → green.
3. **Mechanical gate** — the repo's real typecheck/lint/test/build. No green, no close.
4. **Floor Auditors** verify independently against a fixed rubric (per the §4.1 firewall),
   emitting a **schema-validated worker outcome**; the driver does a **schema-validated join.**
   On fail → blocking `bug` bead + repro (Cage persists); re-queue, never silently fix.
5. **The Eye in the Sky** runs on secrets/authz/deps/outward beads; can mark unsafe.
6. **The Cage queue** integrates results one at a time onto the shift branch, commits bead
   mutations + role-produced memory, closes beads — each via the **exactly-once key** (§5.6).

### 5.3 Strategy tick (bounded autonomy)
Every `strategy-tick-interval` work-ticks (default 5), the Owner + Pit Boss *propose*
re-prioritizations and new beads; the driver applies them. **Hard, code-enforced invariants:**
only re-prioritize existing beads and add new ones *within the locked goal*; **never** edit the
goal/acceptance; **never close or delete a human-created or in-progress bead.** *Value rubric
(v1, coarse; refined in the plan):* `acceptance-proximity + unblock-count − staleness/cost` —
distinct from memory **importance** (§6), and not derivable/gameable by the Dealers.

### 5.4 Guards
Iteration cap; no-progress-window; stuck-bead escalation (bump a tier, re-run, then surface).

### 5.5 Clock out
Backlog drained / cap / no-progress / budget breach → **shift report** (closed, blocked + why,
gate result, credential mode + cost estimate, anything parked at the gate). Then refine scope or
hand back.

### 5.6 Durability, resumption & idempotency (the #1 best-practice gap)
A hands-off loop must survive crashes without double-doing work:
- **Append-only fsynced tick journal** (`.claude/five-to-nine/runs/<shift>/journal.jsonl`):
  every claim, dispatch, outcome, merge, close, and cap increment is journaled *before* its
  effect; on restart the driver **replays** to reconstruct state.
- **Run lock** (single live driver) + **journaled caps** (the iteration cap can't reset on
  restart).
- **Exactly-once side effects:** every `bd close` / git commit carries an **idempotency key**;
  an **outbox** records intent→done so a crash between "did it" and "recorded it" is
  reconciled, not repeated.
- **Lease/heartbeat per worktree** with **dead-PID prune**: a crashed worker's claim is
  released and its orphaned `git worktree` cleaned.
- **Poison quarantine:** a bead that fails the same way N times is quarantined (not retried
  forever) and surfaced.

## 6. Memory — learn & grow, without context bloat

- **Substrate:** plain files per type under `.claude/five-to-nine/memory/` + a small **index
  sidecar**; **no sqlite**, no embedding index. beads (JSONL) is the durable, committed store of
  record. (The SDK file-memory tool is available on the interactive path; the hands-off driver
  uses files it controls.)
- **Authoring vs persisting:** roles *produce* memory content; the **Cage write queue is the sole
  committer** (§3.2).
- **Correction to today's repo:** do **not** rely on `bd remember` (auto-injects at `bd prime` =
  front-loading). Use `bd memories <keyword>` + per-bead `bd note` for JIT recall. **Updating
  `skills/shift-memory-beads/SKILL.md` (which teaches the anti-pattern and a stale worktree verb)
  is an explicit early plan task**; no re-skinned agent prompt may reference `bd remember`.
- **Four types (only):** episodic, semantic, procedural (Reflexion lessons: *"X failed because Y;
  do Z"*), user-preference.
- **Retrieval (v1):** a **naive Node scan** scoring recency + importance (write-time) + relevance
  (keyword), injecting only top-k under a **hard per-task token budget (≈1–2K, tuned)**;
  size-capped blocks, **oldest-lowest-importance eviction/summarization.**
- **"With the user":** user-preference memory is written from interactive `/clock-in`, gate
  decisions, and explicit corrections; recalled JIT later (§12 check).
- **Firewall:** the Auditor's rubric is never in memory a Dealer can read/edit.
- **Governance:** writes serialized through the Cage queue; provenance + timestamp + confidence;
  **verify-before-act** on recall; secrets/PII never persisted; human-auditable.

## 7. Safety — the Color Up gate

Full autonomy on everything **reversible**; the deny-list of **irreversible outward actions**
(prod/remote deploy, publish a release/package, `git push --force`, delete remote data,
rotate/destroy secrets) hard-stops for human consent.

**Mechanism (kept + corrected):** the existing fail-closed **`hooks/irreversible-gate.mjs`
PreToolUse hook** (90/90 on `gate-cases.txt`) — which **fires under bypass** (documented; the
eval order is Hooks → Deny → Ask → Mode → Allow → canUseTool, and bypass skips only Mode/Allow).
Because `canUseTool` is **not** reached under bypass, the in-code belt-and-suspenders is a
**`disallowedTools` deny-list** (always evaluated), **not** `canUseTool`. The bd-CLI Bash writes
are covered by the same Bash-targeting hook/deny rules → no safety regression vs MCP.

**Durable consent:** the gate's pause/approve is **journaled and resumable** — an irreversible
effect runs **only after** a recorded human approval on resume, and pre-pause work cannot
double-fire (§5.6 exactly-once). Terminology: shift-branch merges/pushes = reversible (no gate);
publish/prod deploy = irreversible (gated). The Eye "blocks a release" *earlier* (marks a bead
unsafe) — distinct from the gate.

## 8. beads integration (CLI, not MCP, for the driver)

The hands-off driver talks to beads via the **`bd` CLI shelled with `--json`** — per beads' own
guidance, CLI+hooks is recommended over MCP in shell environments (~1–2K vs 10–50K tokens). The
**beads MCP is kept only for the interactive `/clock-in` path** (and any MCP-only runtime). A
typed **beads-CLI adapter module** (`driver/beads.ts`: wrappers over `bd ready/show/create/
update/close/note/dep` with `--json` parsing + nonzero-exit handling) is the **only** caller of
`bd` writes and routes them through the §3.2 write queue; unit-tested against a **mocked `bd`
binary** so the build needs no live `bd`.

**Worktrees:** there is **no `bd worktree` subcommand** — the driver creates and manages
worktrees with native **`git worktree add`**, exporting `BEADS_DIR` to the main `.beads`. Fix the
stale `bd worktree …` verb in `skills/running-the-shift` and `skills/shift-memory-beads`. The
JSONL export is the only committed beads artifact (`bd import` rebuilds the local DB); the DB
stays gitignored. Dolt server mode is a v2 option, unnecessary at K≤2.

## 9. Repo structure, toolchain & testing

**New `driver/` (TypeScript):** `main.ts` (CLI entry), `orchestrator.ts` (the loop + frontier),
`adapters/` (`claude.ts`, `codex.ts`, `api.ts` — the worker-adapter), `beads.ts` (the bd-CLI
adapter + write queue), `journal.ts` (durability/resume), `memory.ts` (files-on-disk backend),
`observability.ts` (Tier-0 JSONL + budget breaker), `schemas/` (worker outcome schemas).
**Toolchain (ethos-fitting):** **Node 18+**, **tsx** (run TS directly — **no build step**, no
`dist/`), **pnpm** (committed lockfile), **`node:test`**, **biome** (lint+format, single binary).
**Zero npm runtime deps in v1** (the driver shells out to `claude`/`codex`); optional deps
(OTel, pino) lazy-load only when configured. `/clock-in` invokes a thin POSIX
`scripts/launch-driver.sh` (Git-Bash-compatible) that runs the driver via `node`/`tsx`.

**Kept & reused:** the whole plugin — manifests, `hooks/` incl. the **gate** (unchanged),
`agents/` (re-skinned), `commands/`, `skills/` (re-skinned + corrected), the beads MCP (interactive
path), the portable `AGENTS.md` core (prose-only).

**Retired (deprecated during transition):** `scripts/night-shift.sh` + `hooks/shift-loop.sh` —
deleted only when the driver passes all §12 criteria (the explicit trigger), then their
`validate-plugin.sh` `required[]` entries are removed.

**Testing:** unit tests (`node:test`) for **frontier/independence determinism**, **schema
validation**, the **bd adapter (mocked binary)**, and a **kill-mid-tick resume** test; the gate
keeps `gate-cases.txt` parity. **Gate evolution:** extend `validate-plugin.sh` to also run the
driver's TS typecheck + lint + unit tests; each slice (§15) states its own green definition so CI
is never red mid-migration.

**Voice rules (anti-corny):** flavor only in persona voice + handoff banter; acceptance/findings/
gate/logs stay plain; a `plain` mode; anti-sycophancy; a plain real-job label beside every persona.

## 10. Observability (two tiers)

**Tier 0 (default, zero-dep):** the driver writes an **append-only NDJSON run log**
(`runs/<shift>/events.jsonl`) — one record per tick start, computed frontier (+independence
groups), worker dispatch (role/model/bead/worktree), worker result (`total_cost_usd`, usage,
duration), every **gate/deny decision** (so §12's gate criteria are *evidenced*, not asserted),
Cage merge, bead close, budget-ledger update, and clock-out. Ships a **zero-dep `.mjs` viewer/
summarizer**. **Budget breaker:** `--budget-usd`/`--budget-tokens` are required-style caps; the
Cage-serialized ledger sums per-worker cost from each result; at ~80% it soft-warns, on breach it
stops dispatching, drains in-flight, clocks out, and surfaces. **All $ figures are client-side
ESTIMATES** (carry a margin; reconcile against the provider's cost API only out-of-band).

**Tier 1 (opt-in):** when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, lazy-load `@opentelemetry/sdk-node`
and wrap tick/frontier/Cage spans in GenAI `gen_ai.*` conventions with a canonical correlation key
set (`shift.id`, `tick`, `bead.id`, `role`, `model`, `worktree`, `frontier.group`). Never load OTel
when no backend is set; never store raw repo content/secrets in traces; export is async/best-effort
(the breaker never depends on the collector).

## 11. Anti-patterns deliberately avoided
1. Prose-as-orchestration → the driver dispatches in code. 2. Role theater → workers spawned only
per ready bead. 3. Self-graded completion → §4.1 enforcement (no write path + deny-rules + hook).
4. Write collisions → worktree isolation + the single Cage write queue. 5. Context bloat →
fresh-per-worker context + JIT memory under budget. 6. Uncapped/degenerate loops → caps +
no-progress + escalation + budget breaker. 7. Clobbering the user repo → additive only.
8. Theme corniness → anti-corny voice rules + `plain` mode. 9. **Telemetry that costs more than it
tells** → zero-dep default; never load OTel/log raw content without opt-in; never block the loop on
a collector. 10. **Surprise billing** → credential-mode confirmation + API-key scrub + budget banner.

## 12. v1 success criteria
- **Code-deterministic dispatch:** given a bead DAG the driver dispatches exactly the expected
  workers in the expected order (unit-tested with a mocked adapter).
- **The gate fires under bypass** and blocks a sample `git push --force` and a sample publish; the
  `disallowedTools` deny-rules also block them; fails closed; `gate-cases.txt` parity — all
  **evidenced from the Tier-0 log.**
- **Author ≠ grader is structural:** a CI assertion shows no Dealer/Auditor worker query carries a
  bd-write path.
- **Serialized correctness (default K=1):** a full shift runs claim → implement → verify →
  integrate → close, single-writer by construction, no collisions; and (opt-in) K=2 on the API
  backend with the `git merge-tree` backstop shows zero merge collisions.
- **Crash-safe:** a **kill-mid-tick** test resumes with no double-close, no orphaned worktree, caps
  intact.
- **Budget honored:** a shift halts cleanly at the configured `--budget-usd`/`--budget-tokens`.
- **Memory learns (falsifiable):** a **Reflexion ablation** — the same comparable bead, with vs
  without the recalled lesson, shows a measurable difference (e.g., fewer failed gate attempts) —
  replaces the earlier unfalsifiable A→B claim. A stated user preference is honored on a later shift.
- `/clock-in` still launches the driver; the auth banner + credential mode appear in the report.

## 13. Out of scope for v1 (tracked in beads)
- **A dedicated role-refinement / optimization pass** (requested): once a working single-bead driver
  exists, re-examine the roster, model right-sizing, and per-worker tool rules. §4 is provisional
  pending this. (Track as its own bead.)
- True parallel pools on a single subscription (ToS-limited); embedding-based memory retrieval;
  Dolt server mode; a live dashboard; multi-repo / federation. Codex GitHub `@codex` lane is an
  optional later hands-off mode.

## 14. Open questions / risks
- **Provider auth/billing volatility:** dated 2026-06-15; changed 2–3× in 2026 (Anthropic's credit
  split is effective *today*). Re-verify before any release; keep limits/flags out of code.
- **Subscription auth reliability for unattended runs:** `setup-token` (1-yr expiry/rotation) and
  Codex `device-auth` (beta) must be **smoke-tested for overnight stability** in Slice 0.
- **Concurrency/independence:** the layered independence algorithm and safe `K`; default K=1.
- **Cost figures are estimates** (the breaker uses a conservative margin; the report labels them).
- **Strategy-tick value scoring:** concrete + non-gameable in the plan; the "never delete human/
  in-progress beads" invariant is the safety floor.

## 15. Delivery slices (the plan builds these in order; each behind a green gate)
- **Slice 0 — spike (de-risk):** prove the load-bearing mechanics — the **Claude (`claude -p` +
  `setup-token`) and Codex (`codex exec` device-auth) adapters** producing schema-valid output on
  the *subscription*; the **PreToolUse gate-hook + `disallowedTools` deny-rules firing under
  `--dangerously-skip-permissions`**; the **credential-mode confirmation + API-key scrub**;
  overnight auth-token stability. *Green = spike report + pinned adapter flags + auth notes.*
- **Slice 1 — single-bead vertical (proves the thesis):** bootstrap `driver/` (wired into the
  validate gate); the adapter + one Dealer; a deterministic single-bead tick (claim via the Cage
  queue → one Dealer in a `git worktree` → mechanical gate → independent Auditor with the firewall →
  Cage serialized close), the **bd-CLI adapter + write queue**, the **journal/resume** skeleton, and
  the **Tier-0 run log + budget breaker**. *Green = dispatch determinism + §4.1 enforcement + gate +
  kill-mid-tick resume + a single-bead shift.*
- **Slice 2 — K-parallelism (opt-in API backend):** layered independence + `git merge-tree` backstop
  + the Cage serialized merge join; K=2 with zero collisions.
- **Slice 3 — memory:** the four types, JIT scan under budget, the Reflexion loop + ablation test,
  the firewall, governance; the `shift-memory-beads` correction.
- **Slice 4 — strategy tick:** the bounded value rubric + the hard non-deletion invariants.
- **Slice 5 — finish:** Tier-1 OTel (behind the flag); the full Card Room re-skin; `/clock-in`
  launcher + auth banner; retire the legacy bash loop; docs.
- **Then:** the §13 role-refinement pass.
