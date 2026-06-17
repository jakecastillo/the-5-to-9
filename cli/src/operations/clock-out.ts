import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir as defaultStateDir } from '../paths.ts';
import { readShiftState } from '../state.ts';

/** The summary returned when a shift is clocked out. */
export interface ShiftReport {
  goal: string;
  branch: string;
  started: string;
  ended: string;
  iterations: number;
}

export interface ClockOutOpts {
  /** Override the repo root (state dir derived from it). Defaults to repoRoot(). */
  cwd?: string;
  /** Override the state dir directly (wins over cwd). */
  stateDir?: string;
}

/** UTC `YYYYMMDDTHHMMSSZ` archive stamp. */
function archiveStamp(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/** UTC `YYYY-MM-DDTHH:MM:SSZ`. */
function isoSeconds(d: Date): string {
  return `${d.toISOString().split('.')[0]}Z`;
}

/**
 * Close the shift: read the report fields, archive shift.local.md, clear the
 * live counters. A port of scripts/clock-out.sh. Idempotent / benign when there
 * is no active shift. The beads JSONL export is left to the gate/plugin to keep
 * this side-effect-free against the single-writer DB.
 */
export async function clockOut(opts: ClockOutOpts = {}): Promise<ShiftReport> {
  const resolvedDir =
    opts.stateDir ?? (opts.cwd ? join(opts.cwd, '.claude', 'five-to-nine') : defaultStateDir());

  const state = readShiftState(resolvedDir);
  const ended = isoSeconds(new Date());

  if (!state.active) {
    return { goal: state.goal, branch: state.branch, started: state.started, ended, iterations: 0 };
  }

  const stateFile = join(resolvedDir, 'shift.local.md');
  const archiveDir = join(resolvedDir, 'archive');
  try {
    mkdirSync(archiveDir, { recursive: true });
    renameSync(stateFile, join(archiveDir, `shift-${archiveStamp(new Date())}.md`));
  } catch {
    // archiving failed — fall back to removing the live state so the loop won't resume
    try {
      rmSync(stateFile, { force: true });
    } catch {
      // last resort: leave it; readShiftState will still report it, but counters are cleared
    }
  }

  // Clear the live counters so a Stop-loop guard reliably no-ops.
  try {
    rmSync(join(resolvedDir, 'iteration.count'), { force: true });
    rmSync(join(resolvedDir, 'closed.snapshot'), { force: true });
  } catch {
    // best-effort
  }

  return {
    goal: state.goal,
    branch: state.branch,
    started: state.started,
    ended,
    iterations: state.iteration,
  };
}
