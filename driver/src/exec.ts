import { spawn } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type ExecFn = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<ExecResult>;

/** Real process exec; tests inject a mock ExecFn instead. */
export const realExec: ExecFn = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    // stdin is 'ignore' (closed) so a tool that reads stdin — e.g. `codex exec`,
    // which prints "Reading additional input from stdin…" — gets immediate EOF
    // instead of blocking on our open pipe. stdout/stderr stay captured.
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr, code: 0 });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`));
    });
  });
