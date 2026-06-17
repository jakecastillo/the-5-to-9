/** The three numbered panes. */
export type Pane = 'status' | 'backlog' | 'stream';

/**
 * A single keymap entry. This table is the ONE source of truth: it drives both
 * `useInput` dispatch (App, B9) AND the Footer/HelpOverlay rendering (here, B2),
 * so the displayed keys can never drift from the real bindings.
 */
export interface KeyBinding {
  /** The display label for the key (e.g. `tab`, `j/k`, `ctrl+u`). */
  key: string;
  /** A short verb shown in the footer (e.g. `run`, `filter`). */
  action: string;
  /** A longer description for the full help overlay. */
  help: string;
  /** Panes this binding is legal in, or 'global' (every pane). */
  panes: Pane[] | 'global';
  /** Only shown/active when a shift is live (the `r`/`o` actions). */
  requiresShift?: boolean;
  /**
   * A stable action id dispatched by `useInput` (decoupled from the key label
   * so re-keying never touches the dispatcher).
   */
  id: string;
}

/** The keymap — encodes the spec's keymap table verbatim. */
export const KEYMAP: KeyBinding[] = [
  {
    key: '1/2/3',
    action: 'panes',
    help: 'Focus Status / Backlog / Run Stream',
    panes: 'global',
    id: 'focus-num',
  },
  {
    key: 'tab',
    action: 'cycle',
    help: 'Cycle focus next / prev (Shift+Tab)',
    panes: 'global',
    id: 'cycle',
  },
  {
    key: 'j/k',
    action: 'move',
    help: 'Move selection / scroll focused pane',
    panes: ['backlog', 'stream'],
    id: 'move',
  },
  {
    key: 'g/G',
    action: 'top/bottom',
    help: 'Jump to top / bottom of list',
    panes: ['backlog'],
    id: 'edge',
  },
  {
    key: 'enter',
    action: 'details',
    help: 'Open bead detail / submit in a flow',
    panes: ['backlog'],
    id: 'enter',
  },
  {
    key: '/',
    action: 'filter',
    help: 'Filter backlog (id/title/state); Esc clears',
    panes: ['backlog'],
    id: 'filter',
  },
  {
    key: 'c',
    action: 'clock-in',
    help: 'Clock in: open the goal text-input modal',
    panes: 'global',
    id: 'clock-in',
  },
  {
    key: 'r',
    action: 'run',
    help: 'Run the loop; focus the Run Stream',
    panes: 'global',
    requiresShift: true,
    id: 'run',
  },
  {
    key: 'f',
    action: 'follow',
    help: 'Toggle follow/tail (auto-scroll vs pin)',
    panes: ['stream'],
    id: 'follow',
  },
  {
    key: 'ctrl+u/d',
    action: 'page',
    help: 'Page the stream up / down',
    panes: ['stream'],
    id: 'page',
  },
  {
    key: 'o',
    action: 'clock-out',
    help: 'Clock out: stop streaming, open the report',
    panes: 'global',
    requiresShift: true,
    id: 'clock-out',
  },
  { key: '?', action: 'help', help: 'Toggle the full keymap overlay', panes: 'global', id: 'help' },
  {
    key: 'esc',
    action: 'cancel',
    help: 'Close modal / pop detail / clear filter (never a side effect)',
    panes: 'global',
    id: 'escape',
  },
  {
    key: 'q',
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
