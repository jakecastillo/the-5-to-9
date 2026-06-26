import { execFileSync } from 'node:child_process';

/** A single preflight check result. */
export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** The preflight report. `ok` is true only when all REQUIRED checks pass. */
export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DoctorDeps {
  backend?: 'claude' | 'codex' | 'api';
  /** Override the detected node version (e.g. "v20.19.0"); defaults to the live runtime. */
  nodeVersion?: string;
  /** Override the bd-present probe. */
  hasBd?: boolean;
  /** Override the backend-CLI-present probe. */
  hasBackend?: boolean;
}

const NODE_FLOOR_MAJOR = 20;
const NODE_FLOOR_MINOR = 19;

function commandExists(cmd: string): boolean {
  try {
    execFileSync('command', ['-v', cmd], { stdio: 'ignore', shell: '/bin/sh' });
    return true;
  } catch {
    return false;
  }
}

function parseMajorMinor(v: string): { major: number; minor: number } {
  const m = /v?(\d+)\.(\d+)/.exec(v);
  return { major: m ? Number(m[1]) : 0, minor: m ? Number(m[2]) : 0 };
}

function nodeMeetsFloor(v: string): boolean {
  const { major, minor } = parseMajorMinor(v);
  if (major > NODE_FLOOR_MAJOR) return true;
  if (major < NODE_FLOOR_MAJOR) return false;
  return minor >= NODE_FLOOR_MINOR;
}

/**
 * Preflight the environment: node ≥ 20.19 (required), the chosen backend CLI
 * (required when a backend is named), and bd (optional — a missing backlog only
 * disables the backlog views). `ok` reflects only the required checks.
 */
export async function doctor(deps: DoctorDeps = {}): Promise<DoctorReport> {
  const backend = deps.backend;
  const nodeVersion = deps.nodeVersion ?? process.versions.node;
  const hasBd = deps.hasBd ?? commandExists('bd');
  const hasBackend = deps.hasBackend ?? (backend ? commandExists(backend) : true);

  const nodeOk = nodeMeetsFloor(nodeVersion);
  const checks: DoctorCheck[] = [
    {
      name: 'node',
      ok: nodeOk,
      detail: nodeOk
        ? `node ${nodeVersion} (≥ ${NODE_FLOOR_MAJOR}.${NODE_FLOOR_MINOR})`
        : `node ${nodeVersion} is below the ${NODE_FLOOR_MAJOR}.${NODE_FLOOR_MINOR} floor`,
    },
    {
      name: 'bd',
      ok: hasBd,
      detail: hasBd ? 'beads (bd) found' : 'beads (bd) not found — backlog views disabled',
    },
    {
      name: 'backend',
      ok: hasBackend,
      detail: backend
        ? hasBackend
          ? `backend CLI '${backend}' found`
          : `backend CLI '${backend}' not found`
        : 'no backend selected (set FIVE_TO_NINE_BACKEND, or use `/config set backend <claude|codex|api>` in the TUI)',
    },
  ];

  // Required: node floor + (backend present, when a backend is named). bd is optional.
  const ok = nodeOk && hasBackend;
  return { ok, checks };
}
