// Shared test/dev fixtures: a small set of state objects that pin StatusBar +
// Backlog + gate rendering across the TUI tests (spec "Testing" section).
import type { DashboardModel } from '../operations/dashboard-model.ts';
import type { GateMarker, ShiftState } from '../state.ts';

export const ACTIVE_SHIFT: ShiftState = {
  active: true,
  goal: 'Ship auth refactor + green CI',
  branch: 'the-5-to-9/shift-20260617',
  started: '2026-06-17T02:00:00Z',
  status: 'active',
  maxIterations: 'uncapped',
  iteration: 4,
};

export const IDLE_SHIFT: ShiftState = {
  active: false,
  goal: '',
  branch: '',
  started: '',
  status: '',
  maxIterations: '',
  iteration: 0,
};

export const GREEN_GATE: GateMarker = {
  color: 'GREEN',
  count: 18,
  ts: '2026-06-17T02:34:05Z',
};

export const RED_GATE: GateMarker = {
  color: 'RED',
  count: 4,
  ts: '2026-06-17T03:00:00Z',
};

/** A fully-populated, active dashboard model (READY/IN-PROGRESS/BLOCKED). */
export const ACTIVE_MODEL: DashboardModel = {
  state: ACTIVE_SHIFT,
  readyCount: 2,
  counts: { closed: 7, inProgress: 1, blocked: 1 },
  gate: GREEN_GATE,
  ready: [
    { id: 't59-4a1', title: 'add token rotation', status: 'open' },
    { id: 't59-9c2', title: 'wire refresh endpoint', status: 'open' },
  ],
  inProgress: [{ id: 't59-3b2', title: 'session store migration', status: 'in_progress' }],
  blocked: [{ id: 't59-7e0', title: 'rotate prod secret', status: 'blocked' }],
  progress: { closed: 7, total: 11, pct: 63 },
};

/** An idle dashboard model — no active shift, empty backlog. */
export const IDLE_MODEL: DashboardModel = {
  state: IDLE_SHIFT,
  readyCount: 0,
  counts: { closed: 0, inProgress: 0, blocked: 0 },
  gate: null,
  ready: [],
  inProgress: [],
  blocked: [],
  progress: { closed: 0, total: 0, pct: 0 },
};
