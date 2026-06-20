import { type BeadLite, makeBeadsRead } from '../beads-read.ts';
import { listPending } from '../consent.ts';
import { stateDir as defaultStateDir } from '../paths.ts';
import { readGateMarker, readShiftState } from '../state.ts';
import type { OpDeps, StatusView } from './status.ts';

/**
 * A surfaced irreversible-gate stop. Phase 1b carries the consent-contract
 * fields (`id`, `command`, `token`) so the TUI's type-to-confirm modal can call
 * `consent.resolve(id, true, token)`; the legacy surface fields (`segment`,
 * `bead`, `role`) are kept so the existing GateNotice path keeps working.
 */
export interface PendingGate {
  /** The consent record id (Phase 1b — needed to resolve). */
  id?: string;
  /** The flagged command/segment. */
  segment: string;
  /** The full flagged command (alias of `segment` for the consent contract). */
  command?: string;
  /** The irreversible category (deploy/publish/force-push/delete-remote/rotate-secrets). */
  category: string;
  /** The canonical confirm token the human must type (Phase 1b). */
  token?: string;
  /** The bead the flagged command was working on, if known. */
  bead?: string;
  /** The role that triggered it, if known. */
  role?: string;
}

/** The full dashboard model: status + the three bead lists + progress. */
export interface DashboardModel extends StatusView {
  ready: BeadLite[];
  inProgress: BeadLite[];
  blocked: BeadLite[];
  progress: { closed: number; total: number; pct: number };
  /**
   * A surfaced gate stop, when the driver's fail-closed gate halted on an
   * irreversible segment. Phase 1 only surfaces it (the TUI raises a blocking
   * notice); the facade does not yet populate it (Phase 1b wires the driver
   * pending-consent event). Optional + additive so this never breaks callers.
   */
  pendingGate?: PendingGate;
}

/**
 * Assemble the dashboard model — a port of shift-dashboard.sh's data-gathering.
 * Progress percentage uses integer division to match the bash dashboard exactly.
 * Strictly read-only.
 */
export async function getDashboardModel(deps: OpDeps = {}): Promise<DashboardModel> {
  const beads = deps.beads ?? makeBeadsRead();
  const dir = deps.stateDir ?? defaultStateDir();
  // One bd spawn per status: the lists we render ALSO supply the counts (length), so
  // we never re-count in_progress/blocked or re-run `bd ready` via readyCount(). Only
  // `closed` (which we don't list) needs a count. This both halves the per-tick bd
  // spawns and removes the count/list divergence the old status() path could show.
  const [closedCount, ready, inProgress, blocked] = await Promise.all([
    beads.count('closed'),
    beads.ready(),
    beads.list('in_progress'),
    beads.list('blocked'),
  ]);
  const view: StatusView = {
    state: readShiftState(dir),
    readyCount: ready.length,
    counts: { closed: closedCount, inProgress: inProgress.length, blocked: blocked.length },
    gate: readGateMarker(dir),
  };
  // null means bd failed — treat as 0 for progress math (can't know the true count).
  const closed = closedCount ?? 0;
  const total = closed + ready.length + inProgress.length + blocked.length;
  const pct = total > 0 ? Math.floor((closed * 100) / total) : 0;

  // Surface the oldest unresolved consent (if any) as the pending gate. Reads
  // the same git-excluded consent records the modal/subcommand write.
  const next = listPending({ stateDir: dir })[0];
  const pendingGate: PendingGate | undefined = next
    ? {
        id: next.id,
        segment: next.command,
        command: next.command,
        category: next.category,
        token: next.token,
        bead: next.beadId ?? undefined,
        role: next.role ?? undefined,
      }
    : undefined;

  return {
    ...view,
    ready,
    inProgress,
    blocked,
    progress: { closed, total, pct },
    pendingGate,
  };
}
