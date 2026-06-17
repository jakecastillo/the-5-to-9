import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../paths.ts';

/** The result of opening a shift. */
export interface ClockInResult {
  /** The shift branch (or "(current)" when branch ops were skipped/failed). */
  branch: string;
  /** Absolute path to the written shift.local.md. */
  stateFile: string;
  /** Best-effort warnings (e.g. git failures) — never thrown. */
  warnings: string[];
}

export interface ClockInOpts {
  /** Skip creating/switching the shift branch (state only). */
  noBranch?: boolean;
  /** Override the repo root (and thus state dir + git cwd). Defaults to repoRoot(). */
  cwd?: string;
}

/** UTC `YYYY-MM-DDTHH:MM:SSZ` (ms truncated to match the bash `date -u` format). */
function isoSeconds(d: Date): string {
  return `${d.toISOString().split('.')[0]}Z`;
}

/** UTC `YYYYMMDD` for the branch name. */
function dateStamp(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Open a shift: write gitignored state and (unless noBranch) move to a dedicated
 * the-5-to-9/shift-<date> branch. A port of scripts/setup-shift.sh. Git ops are
 * best-effort — failures become warnings, never throws.
 */
export async function clockIn(goal: string, opts: ClockInOpts = {}): Promise<ClockInResult> {
  const root = opts.cwd ?? repoRoot();
  const dir = join(root, '.claude', 'five-to-nine');
  const stateFile = join(dir, 'shift.local.md');
  const warnings: string[] = [];

  const effectiveGoal =
    goal.trim() === '' ? "(infer the smallest defensible goal from the repo's own intent)" : goal;

  mkdirSync(dir, { recursive: true });

  const now = new Date();
  const started = isoSeconds(now);
  const maxIter = process.env.FIVE_TO_NINE_MAX_ITER ?? 'uncapped';

  // --- dedicated shift branch (reversible; never main/prod) -------------------
  let branch = '(current)';
  const noBranch = opts.noBranch || process.env.FIVE_TO_NINE_NO_BRANCH === '1';
  if (!noBranch) {
    branch = resolveBranch(root, now, warnings);
  }

  // --- write the shift state (frontmatter + goal body) ------------------------
  const escapedGoal = effectiveGoal.replace(/"/g, '\\"');
  const content = [
    '---',
    `goal: "${escapedGoal}"`,
    `branch: ${branch}`,
    `started: ${started}`,
    'engine: in-session',
    'status: active',
    `max_iterations: ${maxIter}`,
    '---',
    effectiveGoal,
    '',
  ].join('\n');
  writeFileSync(stateFile, content);

  // Reset the loop counters for a clean shift.
  writeFileSync(join(dir, 'iteration.count'), '0\n');
  try {
    rmSync(join(dir, 'closed.snapshot'), { force: true });
  } catch {
    // best-effort
  }

  return { branch, stateFile, warnings };
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/**
 * Resolve (and switch to) the shift branch. If already on a the-5-to-9/shift-*
 * branch, keep it; otherwise checkout/create the-5-to-9/shift-<date>. Any git
 * failure is recorded as a warning and the function returns "(current)".
 */
function resolveBranch(root: string, now: Date, warnings: string[]): string {
  try {
    git(root, ['rev-parse', '--git-dir']);
  } catch {
    warnings.push('not a git repository — staying put (state written, no branch created)');
    return '(current)';
  }

  let current: string;
  try {
    current = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {
    current = 'HEAD';
  }
  if (current.startsWith('the-5-to-9/shift-')) return current;

  const target = `the-5-to-9/shift-${dateStamp(now)}`;
  const exists = (() => {
    try {
      git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${target}`]);
      return true;
    } catch {
      return false;
    }
  })();
  try {
    git(root, exists ? ['checkout', target] : ['checkout', '-b', target]);
    return target;
  } catch {
    warnings.push(`couldn't switch to ${target}; staying on ${current}`);
    return '(current)';
  }
}
