/** The three numbered panes. */
export type Pane = 'status' | 'backlog' | 'stream';

/**
 * A single keymap entry. This table is the ONE source of truth: it drives both
 * `useInput` dispatch (App) AND the Footer/HelpOverlay rendering, so the
 * displayed keys can never drift from the real bindings.
 */
export interface KeyBinding {
  /** The display label for the key (e.g. `↑/↓`, `Alt+1/2/3`, `Ctrl+C`). */
  key: string;
  /** A short verb shown in the footer (e.g. `run`, `move`). */
  action: string;
  /** A longer description for the full help overlay. */
  help: string;
  /** Panes this binding is legal in, or 'global' (every pane). */
  panes: Pane[] | 'global';
  /** Only shown/active when a shift is live. Unused in the new model (all bindings always available). */
  requiresShift?: boolean;
  /**
   * A stable action id dispatched by `useInput` (decoupled from the key label
   * so re-keying never touches the dispatcher).
   */
  id: string;
}

/**
 * The keymap — encodes the ACTUAL command-model bindings verbatim. All entries
 * are global (no pane-specific or requiresShift). Dead single-letter bindings
 * (c/r/o/j/k/g/G/f) from the pre-200.2 era are removed.
 */
export const KEYMAP: KeyBinding[] = [
  {
    key: '/',
    action: 'commands',
    help: 'Open the command palette (type to fuzzy-filter slash commands)',
    panes: 'global',
    id: 'palette',
  },
  {
    key: '↑/↓',
    action: 'move',
    help: 'Move backlog selection; move palette row when palette is open',
    panes: 'global',
    id: 'move',
  },
  {
    key: 'Tab',
    action: 'complete/cycle',
    help: 'Complete palette selection to buffer; cycle pane focus when palette closed (Shift+Tab reverse)',
    panes: 'global',
    id: 'tab',
  },
  {
    key: 'Enter',
    action: 'run',
    help: 'Dispatch the command buffer (slash command or palette selection)',
    panes: 'global',
    id: 'enter',
  },
  {
    key: 'Alt+1/2/3',
    action: 'panes',
    help: 'Focus Status / Backlog / Run Stream',
    panes: 'global',
    id: 'focus-num',
  },
  {
    key: 'Esc',
    action: 'clear',
    help: 'Clear command buffer and filter (never a side effect)',
    panes: 'global',
    id: 'escape',
  },
  {
    key: '?',
    action: 'help',
    help: 'Open the help overlay (empty buffer only; else appended as literal)',
    panes: 'global',
    id: 'help',
  },
  {
    key: 'Ctrl+C',
    action: 'quit',
    help: 'Quit the viewer (never kills the driver)',
    panes: 'global',
    id: 'quit',
  },
];

/** True when a binding is legal in the given pane (or is global). */
export function appliesTo(b: KeyBinding, pane: Pane): boolean {
  return b.panes === 'global' || b.panes.includes(pane);
}

/**
 * The bindings legal in `pane` given the current shift state — the single
 * source for BOTH the footer and the help overlay so they can't drift.
 * With all bindings now global and no requiresShift entries, this returns
 * the full KEYMAP for any pane/shiftActive combination.
 */
export function bindingsFor(pane: Pane, shiftActive: boolean): KeyBinding[] {
  return KEYMAP.filter((b) => appliesTo(b, pane) && (!b.requiresShift || shiftActive));
}

/**
 * Render the footer string for a pane: `key action · key action · …`. Generated
 * from the keymap table, so the displayed hints always match real bindings.
 */
export function footerFor(pane: Pane, shiftActive: boolean): string {
  return bindingsFor(pane, shiftActive)
    .map((b) => `${b.key} ${b.action}`)
    .join(' · ');
}
