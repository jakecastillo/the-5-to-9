import type { DashboardModel } from '../operations/dashboard-model.ts';
import type { Pane } from './keymap.ts';

/** Which transient overlay (if any) currently traps input. */
export type ModalKind = 'clock-in' | 'help' | 'gate' | 'quit-confirm' | 'report' | null;

/**
 * A surfaced gate event. When `id`/`token` are present it is a Phase-1b pending
 * consent the type-to-confirm GateModal can resolve; without them it is a
 * surface-only notice (GateNotice).
 */
export interface GateEvent {
  /** The consent record id (Phase 1b — present means resolvable). */
  id?: string;
  /** The flagged command/segment. */
  segment: string;
  /** The full flagged command (alias of segment for the consent contract). */
  command?: string;
  /** The irreversible category (deploy/publish/force-push/delete-remote/rotate-secrets). */
  category: string;
  /** The canonical confirm token the human must type (Phase 1b). */
  token?: string;
  /** The bead the flagged command was working on, if known. */
  bead?: string;
  /** The role that triggered it, if known. */
  role?: string;
}

/**
 * The single top-level TUI state object. The poller diffs the polled `model`
 * in place; selection/filter/modal live here separately so a background tick
 * never yanks the cursor (the lazydocker rule).
 */
export interface AppState {
  /** Last-known-good polled dashboard data (null until the first poll). */
  model: DashboardModel | null;
  /** A transient poll error message, shown without blanking last-known-good. */
  error: string | null;
  /** The focused pane. */
  focusedPane: Pane;
  /** The currently selected bead id (preserved across polls). */
  selectedBeadId: string | null;
  /** The backlog filter string (empty = no filter). */
  filter: string;
  /** The command-bar input buffer (empty = idle). */
  input: string;
  /** The active modal, or null. */
  modal: ModalKind;
  /** A surfaced gate event when modal === 'gate'. */
  gate: GateEvent | null;
  /** Whether a run is currently being streamed. */
  running: boolean;
  /** Whether the Run Stream auto-scrolls to the tail (follow mode). */
  follow: boolean;
}

/** The default initial UI state (no data yet, Status focused). */
export function initialState(): AppState {
  return {
    model: null,
    error: null,
    focusedPane: 'status',
    selectedBeadId: null,
    filter: '',
    input: '',
    modal: null,
    gate: null,
    running: false,
    follow: true,
  };
}
