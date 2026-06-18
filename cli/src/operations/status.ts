import { type BeadsRead, makeBeadsRead } from '../beads-read.ts';
import { stateDir as defaultStateDir } from '../paths.ts';
import { type GateMarker, type ShiftState, readGateMarker, readShiftState } from '../state.ts';

/** A read-only snapshot of the shift: state + backlog counts + last gate. */
export interface StatusView {
  state: ShiftState;
  readyCount: number;
  /** Count per status. null means the bd invocation failed (not a real 0). */
  counts: { closed: number | null; inProgress: number | null; blocked: number | null };
  gate: GateMarker | null;
}

/** Injection seam for operations: a beads adapter + a state directory. */
export interface OpDeps {
  beads?: BeadsRead;
  stateDir?: string;
}

/** Assemble the read-only status view. Strictly side-effect-free. */
export async function status(deps: OpDeps = {}): Promise<StatusView> {
  const beads = deps.beads ?? makeBeadsRead();
  const dir = deps.stateDir ?? defaultStateDir();
  const [closed, inProgress, blocked, readyCount] = await Promise.all([
    beads.count('closed'),
    beads.count('in_progress'),
    beads.count('blocked'),
    beads.readyCount(),
  ]);
  return {
    state: readShiftState(dir),
    readyCount,
    counts: { closed, inProgress, blocked },
    gate: readGateMarker(dir),
  };
}
