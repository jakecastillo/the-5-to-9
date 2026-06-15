---
name: shift-memory-beads
description: "Use when the crew needs to read or write the backlog/memory during a shift — creating beads, wiring dependencies, claiming ready work atomically, isolating parallel writes, or recording durable notes. The beads (bd) conventions, verbs, label taxonomy, and single-writer rules for The 5 to 9."
---

# Shift Memory = Beads

[beads](https://github.com/steveyegge/beads) (`bd`) is The 5 to 9's brain — backlog,
dependency DAG, atomic ready-work queue, and durable cross-session memory. It is the
substrate, not a sidecar: state lives in beads, **not** in the conversation. The loop
"remembers" across iterations because it recovers from beads + git + files, not a transcript.

The 5 to 9 ships thin **conventions** over `bd` (a label taxonomy, helper verbs, a setup
flow) — never a reimplementation. Learn `bd` itself with `bd prime` (AI-optimized workflow
context) and `bd onboard` (minimal agent snippet); load them just-in-time, not up front.

## Initialize (once per repo)

```bash
bd doctor            # health check; tells you if bd is set up
bd init              # create the local store if missing
```

Commit the **JSONL export** (`bd export` → `.beads/*.jsonl`); keep the local DB
(`.beads/*.db`) **gitignored**. The export is the git-native source of truth that survives
sessions; the DB is a local cache.

## The bead graph

```bash
bd create --type epic    --acceptance "the goal is met when ..." -p 1 "Top goal"
bd create --type feature --parent <epic>  --acceptance "..."        "A slice"
bd create --type task    --parent <feature>                          "A unit"
bd create --type bug     -p 1 --acceptance "..."                     "Something broke"
```

Types: `epic` (the goal) → `feature` (a shippable slice) → `task` (a unit of work);
`bug` (a defect, filed by QA/security); `chore` (hygiene/devops debt).

## Dependencies — what actually gates readiness

```bash
bd dep <blocker> --blocks <blocked>     # a real gate: <blocked> isn't ready until <blocker> closes
bd dep cycles                           # detect cycles before they deadlock the loop
```

- **`blocks` and parent-child edges gate `bd ready`.** Use them only when work genuinely
  must wait.
- **`discovered-from` is provenance, not a gate.** Use it to record where an idea/bug came
  from without blocking the queue. Don't reach for `blocks` when you mean "related to."

## The blackboard — atomic claim (no duplicate work)

```bash
bd ready --json                 # what's unblocked right now
bd ready --claim --json         # atomically claim the first ready bead — the key verb
bd update <id> --claim          # claim a specific bead
bd update <id> --status closed  # or: bd close <id>
```

`bd ready --claim` is how two workers never grab the same ticket — the claim is atomic at
the store, not negotiated at runtime. This is the single most important verb in the loop.

## Parallel-write safety (the #1 multi-agent failure, solved)

beads' embedded store is **single-writer** — serialize writes. For genuinely independent
work, isolate each writer:

```bash
bd worktree <id>                # isolated git worktree for one Line Cook
export BEADS_DIR="$REPO/.beads" # so the detached worktree finds the MAIN backlog
bd merge-slot                   # serialized merge gate — one integration at a time
```

Worktree isolation + a merge-slot is exactly "isolate writes, gate the merge" — it prevents
two agents editing the same files. Never point two writers at the DB at once.

## Durable memory

```bash
bd remember "<note>"            # durable note tied to the shift/bead
bd recall "<query>"             # pull relevant notes back
bd memories                     # list what's remembered
bd kv set <k> <v> ; bd kv get <k>   # small key/value shift state
```

Record *why* a decision was made, what a gate showed, and what's left — in beads, so the
next fresh-context iteration picks it up.

## Label taxonomy (The 5 to 9 conventions)

Keep labels few and meaningful:

- `security` — owned by the Bouncer; a P0 `security` bug `blocks` the release epic.
- `release` — the ship epic; the gate hangs off it.
- `gate` — marks a bead whose close requires the irreversible-action human gate.
- `chore` — hygiene/devops debt (the Janitor).
- `discovered` — work the crew surfaced mid-shift (paired with a `discovered-from` edge).

## Ship hygiene

```bash
bd preflight     # PR-readiness check (the Janitor runs this before integrating)
bd status        # progress snapshot (the Owner reads this to judge "done")
bd github        # GitHub sync helpers
```

## Rules of the house

- **Single-writer:** serialize DB writes; isolate parallel work in worktrees with `BEADS_DIR` set.
- **Only `blocks` / parent-child gate `bd ready`;** `discovered-from` never blocks.
- **Commit the JSONL export; gitignore the DB.** Memory is git-native and survives sessions.
- **State in beads, not history.** If it matters next iteration, it goes in beads.
