import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from './paths.ts';

/** The active shift's state, read from shift.local.md + iteration.count. */
export interface ShiftState {
  active: boolean;
  goal: string;
  branch: string;
  started: string;
  status: string;
  maxIterations: string;
  iteration: number;
}

/** A parsed last-gate.txt marker, or null when absent/malformed. */
export interface GateMarker {
  color: 'GREEN' | 'RED';
  count: number;
  ts: string;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Parse YAML frontmatter (the block between the first two `---` fences) into a
 * flat key→value map. Each line must match `key: value`; surrounding quotes on
 * the value are stripped. Mirrors scripts/lib/common.sh `f9_state_get`.
 */
function parseFrontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split('\n');
  let fences = 0;
  for (const line of lines) {
    if (line.trim() === '---') {
      fences++;
      if (fences >= 2) break;
      continue;
    }
    if (fences !== 1) continue;
    const m = /^(\w+):\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2];
    const q = /^"(.*)"$/.exec(value);
    if (q) value = q[1];
    out[m[1]] = value;
  }
  return out;
}

/**
 * Read the active shift state from `dir` (defaults to the resolved stateDir()).
 * Returns `{ active: false, ... }` when shift.local.md is absent.
 */
export function readShiftState(dir: string = stateDir()): ShiftState {
  const text = readText(join(dir, 'shift.local.md'));
  if (text == null) {
    return {
      active: false,
      goal: '',
      branch: '',
      started: '',
      status: '',
      maxIterations: '',
      iteration: 0,
    };
  }
  const fm = parseFrontmatter(text);
  const countRaw = readText(join(dir, 'iteration.count'));
  const iteration = countRaw != null ? Number.parseInt(countRaw.trim(), 10) : 0;
  return {
    active: true,
    goal: fm.goal ?? '',
    branch: fm.branch ?? '',
    started: fm.started ?? '',
    status: fm.status ?? '',
    maxIterations: fm.max_iterations ?? '',
    iteration: Number.isNaN(iteration) ? 0 : iteration,
  };
}

/**
 * Read last-gate.txt as `"<COLOR> <count> <ts...>"`. Returns null unless the
 * color is GREEN/RED, the count is digits, and a non-empty timestamp follows.
 * Mirrors the validation in scripts/shift-dashboard.sh.
 */
export function readGateMarker(dir: string = stateDir()): GateMarker | null {
  const text = readText(join(dir, 'last-gate.txt'));
  if (text == null) return null;
  const line = text.split('\n')[0]?.trim() ?? '';
  const sp1 = line.indexOf(' ');
  if (sp1 < 0) return null;
  const color = line.slice(0, sp1);
  const rest = line.slice(sp1 + 1);
  const sp2 = rest.indexOf(' ');
  if (sp2 < 0) return null;
  const countStr = rest.slice(0, sp2);
  const ts = rest.slice(sp2 + 1).trim();
  if (!/^(GREEN|RED)$/.test(color)) return null;
  if (!/^\d+$/.test(countStr)) return null;
  if (ts.length === 0) return null;
  return { color: color as 'GREEN' | 'RED', count: Number.parseInt(countStr, 10), ts };
}
