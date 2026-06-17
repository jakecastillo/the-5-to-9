import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** `git rev-parse --show-toplevel`, or null if not in a git repo / git absent. */
function gitToplevel(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Repo root resolution, mirroring scripts/lib/common.sh `f9_repo_root`:
 * CLAUDE_PROJECT_DIR → git toplevel → cwd.
 */
export function repoRoot(): string {
  return process.env.CLAUDE_PROJECT_DIR ?? gitToplevel() ?? process.cwd();
}

/** The gitignored shift-state directory (same files the plugin uses). */
export function stateDir(): string {
  return join(repoRoot(), '.claude', 'five-to-nine');
}
