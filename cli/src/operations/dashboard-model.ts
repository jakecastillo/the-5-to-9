import { type BeadLite, makeBeadsRead } from '../beads-read.ts';
import { stateDir as defaultStateDir } from '../paths.ts';
import { type OpDeps, type StatusView, status } from './status.ts';

/** The full dashboard model: status + the three bead lists + progress. */
export interface DashboardModel extends StatusView {
  ready: BeadLite[];
  inProgress: BeadLite[];
  blocked: BeadLite[];
  progress: { closed: number; total: number; pct: number };
}

/**
 * Assemble the dashboard model — a port of shift-dashboard.sh's data-gathering.
 * Progress percentage uses integer division to match the bash dashboard exactly.
 * Strictly read-only.
 */
export async function getDashboardModel(deps: OpDeps = {}): Promise<DashboardModel> {
  const beads = deps.beads ?? makeBeadsRead();
  const dir = deps.stateDir ?? defaultStateDir();
  const [view, ready, inProgress, blocked] = await Promise.all([
    status({ beads, stateDir: dir }),
    beads.ready(),
    beads.list('in_progress'),
    beads.list('blocked'),
  ]);
  const closed = view.counts.closed;
  const total = closed + ready.length + inProgress.length + blocked.length;
  const pct = total > 0 ? Math.floor((closed * 100) / total) : 0;
  return {
    ...view,
    ready,
    inProgress,
    blocked,
    progress: { closed, total, pct },
  };
}
