import type { ParsedInput } from './command-parse.ts';

/** Options the `/run` command assembles from its flags. */
export interface RunCommandOpts {
  maxIterations?: number;
  backend?: 'claude' | 'codex' | 'api';
  concurrency?: number;
}

/**
 * The seam every command handler calls — the operations facade plus the few
 * UI-only effects (filter, follow, clear, help, quit, notify). The TUI assembles
 * a real context (App wires the facade + state setters); tests inject a mock.
 * No command imports the facade directly, so this module stays pure + unit-testable.
 */
export interface CommandContext {
  clockIn(goal: string): void | Promise<void>;
  clockOut(): void | Promise<void>;
  run(opts: RunCommandOpts): void | Promise<void>;
  status(): void | Promise<void>;
  doctor(): void | Promise<void>;
  configGet(key?: string): void;
  configSet(key: string, value: string): void;
  gate(action: 'pending' | 'approve' | 'deny', id?: string, token?: string): void;
  filter(query: string): void;
  follow(): void;
  clear(): void;
  help(topic?: string): void;
  quit(): void;
  notify(message: string): void;
}

/** One command in the palette: its name, aliases, help text, and handler. */
export interface CommandSpec {
  name: string;
  aliases?: string[];
  summary: string;
  argHint?: string;
  run: (ctx: CommandContext, parsed: ParsedInput) => void | Promise<void>;
}

/** The command registry — the single vocabulary the palette and dispatch share. */
export const COMMANDS: CommandSpec[] = [
  {
    name: 'clock-in',
    aliases: ['ci'],
    summary: 'Open a shift with a goal',
    argHint: '<goal…>',
    run: (ctx, p) => ctx.clockIn(p.args.join(' ')),
  },
  {
    name: 'clock-out',
    aliases: ['co'],
    summary: 'Close the shift and show the report',
    run: (ctx) => ctx.clockOut(),
  },
  {
    name: 'run',
    summary: 'Start the driver loop',
    argHint: '--max-iterations <n> --backend <claude|codex|api> -K <n>',
    run: (ctx, p) => {
      const opts: RunCommandOpts = {};
      if (p.flags.maxIterations != null && p.flags.maxIterations !== false) {
        opts.maxIterations = Number(p.flags.maxIterations);
      }
      if (typeof p.flags.backend === 'string') {
        opts.backend = p.flags.backend as RunCommandOpts['backend'];
      }
      const k = p.flags.K ?? p.flags.concurrency;
      if (k != null && k !== false) opts.concurrency = Number(k);
      ctx.run(opts);
    },
  },
  {
    name: 'status',
    summary: 'Print the current shift state (read-only)',
    run: (ctx) => ctx.status(),
  },
  {
    name: 'doctor',
    summary: 'Preflight node / bd / backend',
    run: (ctx) => ctx.doctor(),
  },
  {
    name: 'config',
    summary: 'Read or set CLI config',
    argHint: 'get|set <key> [value]',
    run: (ctx, p) => {
      if (p.args[0] === 'set') ctx.configSet(p.args[1], p.args[2]);
      else ctx.configGet(p.args[1]);
    },
  },
  {
    name: 'gate',
    summary: 'Resolve a pending irreversible-action consent',
    argHint: 'pending|approve|deny <id> [--token <t>]',
    run: (ctx, p) => {
      const action = (p.args[0] ?? 'pending') as 'pending' | 'approve' | 'deny';
      const token = typeof p.flags.token === 'string' ? p.flags.token : undefined;
      ctx.gate(action, p.args[1], token);
    },
  },
  {
    name: 'filter',
    summary: 'Filter the backlog (same as typing without a slash)',
    argHint: '<text>',
    run: (ctx, p) => ctx.filter(p.args.join(' ')),
  },
  {
    name: 'follow',
    summary: 'Toggle the run-stream follow/tail',
    run: (ctx) => ctx.follow(),
  },
  {
    name: 'clear',
    summary: 'Clear the run-stream view',
    run: (ctx) => ctx.clear(),
  },
  {
    name: 'help',
    aliases: ['?', 'h'],
    summary: 'Show the command palette / help',
    argHint: '[command]',
    run: (ctx, p) => ctx.help(p.args[0]),
  },
  {
    name: 'quit',
    aliases: ['exit', 'q'],
    summary: 'Quit the viewer (never kills the driver)',
    run: (ctx) => ctx.quit(),
  },
];

/** Resolve a verb (or alias) to its spec, case-insensitively. */
export function findCommand(name: string): CommandSpec | undefined {
  const n = name.toLowerCase();
  return COMMANDS.find((c) => c.name === n || (c.aliases?.includes(n) ?? false));
}

/** The canonical command names, in registry order (palette default order). */
export function commandNames(): string[] {
  return COMMANDS.map((c) => c.name);
}
