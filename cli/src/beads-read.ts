import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { ExecFn } from '@the-5-to-9/driver/src/exec.ts';
import { realExec } from '@the-5-to-9/driver/src/exec.ts';
import { beadsDir } from './paths.ts';

/** A minimal bead shape — enough for the dashboard/status views. */
export interface BeadLite {
  id: string;
  title: string;
  status?: string;
}

export interface BeadsRead {
  available(): boolean;
  ready(): Promise<BeadLite[]>;
  list(status: 'in_progress' | 'blocked'): Promise<BeadLite[]>;
  /** Returns the count for the given status, or null when the bd invocation
   * fails. null is distinguishable from a real empty backlog (0). */
  count(status: string): Promise<number | null>;
  /** The number of ready beads — counts `bd ready --json` occurrences, NOT
   * `bd count --status ready` (which is always 0; "ready" is a view, not a status). */
  readyCount(): Promise<number>;
}

/** The ONLY bd verbs this adapter may ever build. Reads only — never writes. */
export const BD_READ_VERBS = ['ready', 'list', 'count', 'show', 'blocked'] as const;

interface MakeOpts {
  /** Override the bd-availability probe (tests inject a deterministic value). */
  available?: boolean;
}

function bdAvailable(): boolean {
  try {
    execFileSync('command', ['-v', 'bd'], { stdio: 'ignore', shell: '/bin/sh' });
    return true;
  } catch {
    try {
      execFileSync('bd', ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

/** Env with BEADS_DIR set when a .beads/ exists, so worktrees find the main DB. */
function beadsEnv(): NodeJS.ProcessEnv {
  const dir = beadsDir();
  if (existsSync(dir)) return { ...process.env, BEADS_DIR: dir };
  return process.env;
}

function parseBeads(json: string): BeadLite[] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map((b) => ({
      id: String(b.id ?? ''),
      title: String(b.title ?? ''),
      status: b.status != null ? String(b.status) : undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Build a read-only beads adapter. `exec` defaults to the driver's realExec;
 * tests inject a stub. `available` short-circuits the bd probe.
 */
export function makeBeadsRead(exec: ExecFn = realExec, opts: MakeOpts = {}): BeadsRead {
  const present = opts.available ?? bdAvailable();

  function assertReadVerb(verb: string): void {
    if (!(BD_READ_VERBS as readonly string[]).includes(verb)) {
      throw new Error(`beads-read: refusing non-read verb '${verb}'`);
    }
  }

  async function run(args: string[]): Promise<string> {
    assertReadVerb(args[0]);
    const { stdout } = await exec('bd', args, { env: beadsEnv() });
    return stdout;
  }

  async function readList(args: string[]): Promise<BeadLite[]> {
    if (!present) return [];
    try {
      return parseBeads(await run(args));
    } catch {
      return [];
    }
  }

  return {
    available: () => present,
    ready: () => readList(['ready', '--json']),
    list: (status) => readList(['list', `--status=${status}`, '--json']),
    async count(status: string): Promise<number | null> {
      if (!present) return 0;
      // Failures return null — distinguishable from a genuine empty count (0).
      // Only the legitimate "bd ran and reported 0" path returns 0.
      try {
        const out = await run(['count', '--status', status]);
        const m = out.match(/\d+/);
        return m ? Number.parseInt(m[0], 10) : 0;
      } catch {
        return null;
      }
    },
    async readyCount(): Promise<number> {
      const r = await readList(['ready', '--json']);
      return r.length;
    },
  };
}
