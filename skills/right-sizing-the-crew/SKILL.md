---
name: right-sizing-the-crew
description: "Use when assigning or tuning which Claude model each 5-to-9 role runs on, or when a role keeps under/over-performing — maps roles to Opus/Sonnet/Haiku by cost and stakes."
---

# Right-Sizing the Crew

The 5 to 9 runs a night-shift crew of role-agents against a beads backlog. Each role gets a default model picked for the job's cost and stakes. This skill is the reference for that mapping, when to escalate, and how to override.

## The rule: start cheap, escalate on signal

Pick the cheapest model that reliably does the job, then escalate only when a real signal says you must. Cost and capability run opposite directions — paying for Opus everywhere burns budget on routine scans; running everything on Haiku tanks quality where judgment matters.

- **Default down.** Routine, mechanical, high-volume work runs on Haiku. Coordination, coding, and QA run on Sonnet. Only strategy, adversarial critique, and security default to Opus.
- **Escalate on signal, not on vibe.** A signal is concrete: the task is genuinely hard architecture, the gate is irreversible, the role keeps shipping wrong/shallow output, or a verifier keeps catching the same class of miss. Bump one tier, re-run, and watch whether the signal clears.
- **De-escalate too.** If a role consistently nails its work with margin to spare, drop it a tier and reclaim budget. Right-sizing cuts both ways.
- **Match the model to the stakes, not the title.** A "developer" doing a one-line config edit doesn't need Opus; a "developer" designing a migration plan might.

## The crew → model map

The 5 to 9 has 7 roles. Defaults below; rationale is why that tier is the floor for that job.

| Role | Job | Default model | Why this tier |
| --- | --- | --- | --- |
| The Owner | Executive / strategy & goal-setting | **opus** | Sets direction for the whole shift; a wrong goal wastes every downstream hour. Strategy is the highest-leverage, lowest-volume call — pay for it. |
| The Floor Manager | Project manager / orchestrator (lead) | **sonnet** | Coordinates the crew and the backlog: claims work, sequences the DAG, routes blockers. High-volume coordination where Sonnet's speed/quality balance wins. |
| The Regular | Business analyst (voice of the user) | **sonnet** | Translates intent into concrete, testable requirements. Needs solid reasoning, runs often enough that Opus would be wasteful. |
| The Line Cook | Developer (TDD, isolated worktree) | **sonnet** | Writes code test-first in a sandbox. Most coding is well-scoped and reversible; Sonnet handles it cleanly and the Health Inspector catches misses. |
| The Health Inspector | QA / independent verifier | **sonnet** | Independently checks the Line Cook's work against the spec. Verification is high-volume; Sonnet is the right floor — escalate when the gate is release-critical. |
| The Bouncer | Security | **opus** | Adversarial review of irreversible/outward actions and the SECURITY policy. A missed security call is the most expensive error the crew can make — critic-grade model. |
| The Janitor | Devops / CI-CD | **haiku** | Routine ops: run the suite, lint, format, wire CI, tidy. Mechanical and high-volume — Haiku is fast and cheap, and failures here are loud and reversible. |

Pattern: **Opus = strategy + critic + security** (Owner, Bouncer) · **Sonnet = coordination + coding + QA** (Floor Manager, Regular, Line Cook, Health Inspector) · **Haiku = routine scans + ops** (Janitor).

## Escalation triggers

Bump one tier when a concrete signal appears. Common cases:

- **Genuinely hard architecture → escalate the Line Cook to opus.** A nontrivial design (data migration, concurrency model, cross-cutting refactor) where a wrong shape is expensive to unwind. Sonnet codes; Opus designs the hard parts.
- **Release-gating verification → escalate the Health Inspector to opus.** When the Inspector's pass/fail is the last gate before a release or an irreversible action, run the verifier at critic grade so a subtle miss doesn't ship.
- **The Owner keeps setting muddy goals → already opus; sharpen the prompt, not the model.** If strategy is thin, the fix is usually the goal/context, not a higher tier (it's already the top).
- **A role keeps under-performing → escalate one tier and re-run.** Shallow analysis (Regular), repeated test-fixing churn (Line Cook), missed defects caught downstream (Health Inspector), flaky orchestration (Floor Manager): bump the offending role one tier and watch the signal.
- **A role keeps over-performing with margin → de-escalate one tier.** Janitor never escalates by default; a consistently-clean Sonnet role can drop to Haiku for mechanical subsets.
- **Security-sensitive or irreversible work touches a non-Bouncer role → loop in the opus Bouncer**, don't just upgrade the acting role. The gate belongs to the critic role.

## How to override

Model resolution order (first match wins):

1. **Per-invocation** — the model passed when the role/subagent is launched for a single run. Narrowest scope, highest precedence; use for one-off escalations without changing the role's default.
2. **`CLAUDE_CODE_SUBAGENT_MODEL` env var** — overrides the model for dispatched subagents across the session/shift. Use to globally shift the crew (e.g. force everything to Sonnet for a budget-constrained shift, or to Opus for a high-stakes one).
3. **Frontmatter `model:` field** — the role's declared default in its agent/skill definition. The persistent, version-controlled default for that role.
4. **Built-in defaults** — the per-role tiers in the table above.

Set the `model:` frontmatter field to one of the bare aliases: `opus`, `sonnet`, `haiku`.

```yaml
---
name: the-line-cook
model: opus   # escalated default: this Line Cook handles hard architecture
---
```

## Model resolution & what the bare aliases mean

- **Bare aliases resolve to the current generation.** As of this writing: bare `opus` = **Claude Opus 4.8** (`claude-opus-4-8`) on the Anthropic API — a 1M-token context window, top of the Opus tier. Bare `sonnet` = **Claude Sonnet 4.6** (`claude-sonnet-4-6`); bare `haiku` = **Claude Haiku 4.5** (`claude-haiku-4-5`).
- **Prefer the bare alias over a pinned ID** in role frontmatter so the crew rides generation upgrades automatically. Pin a full ID (e.g. `claude-opus-4-8`) only when you need reproducibility for a specific shift.
- **Resolution order** is per-invocation > `CLAUDE_CODE_SUBAGENT_MODEL` > frontmatter `model:` > built-in default (see above). The narrowest, most specific setting wins.

## Quick reference

- Floor = Haiku (ops) · Sonnet (coordination/coding/QA) · Opus (strategy/critic/security).
- Escalate one tier per concrete signal; de-escalate when a role over-delivers.
- Override precedence: per-invocation → env (`CLAUDE_CODE_SUBAGENT_MODEL`) → frontmatter `model:` → default.
- Bare `opus`/`sonnet`/`haiku` track the current generation; `opus` = Opus 4.8 (1M context) on the Anthropic API today.
