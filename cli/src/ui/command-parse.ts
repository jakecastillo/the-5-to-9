import { type CommandSpec, commandNames, findCommand } from './commands.ts';
import { nearestName } from './fuzzy.ts';

/** A structurally-parsed command line — verb, positional args, and flags. */
export interface ParsedInput {
  /** The verb as typed (lower-cased), before alias resolution. */
  name: string;
  /** Positional arguments, in order (free text, e.g. a clock-in goal). */
  args: string[];
  /** Flags: `--key value` / `--key=value` / `-K value` → value; bare → true. */
  flags: Record<string, string | boolean>;
}

/** Resolved command: the spec + the parsed line, or a typed error with a hint. */
export type ResolveResult =
  | { ok: true; spec: CommandSpec; parsed: ParsedInput }
  | { ok: false; error: string; suggestion?: string };

/** kebab-case → camelCase (`max-iterations` → `maxIterations`). */
function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Parse a raw command line into {name, args, flags}. A leading `/` is optional.
 * Long flags (`--foo`) camelCase their key; short flags (`-K`) keep their letter.
 * A flag takes the next token as its value unless that token is itself a flag (or
 * absent), in which case the flag is boolean `true`.
 */
export function parseCommandLine(raw: string): ParsedInput {
  const trimmed = raw.trim().replace(/^\//, '');
  const tokens = trimmed.length === 0 ? [] : trimmed.split(/\s+/);
  const name = (tokens.shift() ?? '').toLowerCase();
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.startsWith('--')) {
      const body = tok.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        flags[camel(body.slice(0, eq))] = body.slice(eq + 1);
      } else {
        const next = tokens[i + 1];
        if (next != null && !next.startsWith('-')) {
          flags[camel(body)] = next;
          i++;
        } else {
          flags[camel(body)] = true;
        }
      }
    } else if (tok.startsWith('-') && tok.length > 1) {
      const key = tok.slice(1);
      const next = tokens[i + 1];
      if (next != null && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      args.push(tok);
    }
  }
  return { name, args, flags };
}

/**
 * Parse + resolve a line against the registry (alias-aware). An unknown verb
 * returns a did-you-mean suggestion drawn from the canonical command names.
 */
export function resolveCommand(raw: string): ResolveResult {
  const parsed = parseCommandLine(raw);
  if (parsed.name === '') return { ok: false, error: 'empty command' };
  const spec = findCommand(parsed.name);
  if (spec) return { ok: true, spec, parsed };
  const suggestion = nearestName(parsed.name, commandNames());
  return {
    ok: false,
    error: `unknown command '${parsed.name}'${suggestion ? ` — did you mean '${suggestion}'?` : ''}`,
    suggestion,
  };
}
