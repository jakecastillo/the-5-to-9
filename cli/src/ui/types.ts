import type { DashboardModel } from '../operations/dashboard-model.ts';
import type { Pane } from './keymap.ts';

/** Which transient overlay (if any) currently traps input. */
export type ModalKind = 'clock-in' | 'help' | 'gate' | 'quit-confirm' | 'report' | null;

/** A surfaced gate event (Phase 1 — surface only, no interactive approve). */
export interface GateEvent {
  /** The flagged command/segment. */
  segment: string;
  /** The irreversible category (deploy/publish/force-push/delete-remote/rotate-secrets). */
  category: string;
  /** The bead the flagged command was working on, if known. */
  bead?: string;
  /** The role that triggered it, if known. */
  role?: string;
}

/**
 * The single top-level TUI state object. The poller diffs the polled `model`
 * in place; selection/scroll/filter/modal live here separately so a background
 * tick never yanks the cursor (the lazydocker rule).
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
  /** Scroll offset of the focused list (preserved across polls). */
  scrollOffset: number;
  /** The backlog filter string (empty = no filter). */
  filter: string;
  /** The active modal, or null. */
  modal: ModalKind;
  /** A surfaced gate event when modal === 'gate'. */
  gate: GateEvent | null;
  /** Whether a run is currently being streamed. */
  running: boolean;
}

/** The default initial UI state (no data yet, Status focused). */
export function initialState(): AppState {
  return {
    model: null,
    error: null,
    focusedPane: 'status',
    selectedBeadId: null,
    scrollOffset: 0,
    filter: '',
    modal: null,
    gate: null,
    running: false,
  };
}
