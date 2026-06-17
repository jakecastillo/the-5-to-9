import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolve as defaultResolve } from '../consent.ts';
import type { DashboardModel } from '../operations/dashboard-model.ts';
import type { RunHandle, RunOpts } from '../operations/run.ts';
import { BacklogPane } from './BacklogPane.tsx';
import { ClockInModal } from './ClockInModal.tsx';
import { Footer } from './Footer.tsx';
import { GateModal } from './GateModal.tsx';
import { GateNotice } from './GateNotice.tsx';
import { HelpOverlay } from './HelpOverlay.tsx';
import { RunStreamPane } from './RunStreamPane.tsx';
import { ShiftReportView } from './ShiftReportView.tsx';
import { StaticStatusDump } from './StaticStatusDump.tsx';
import { StatusBar } from './StatusBar.tsx';
import type { Pane } from './keymap.ts';
import { type JournalTail, tailJournal } from './tail.ts';
import { type AppState, initialState } from './types.ts';
import { type PollRead, useShiftPoll } from './useShiftPoll.ts';

/**
 * The injection seam for the App: data reads, run control, and the tail factory
 * are all overridable so tests never fork processes or kill real runs. Defaults
 * wire the real facade.
 */
export interface AppDeps {
  /** The poll read (defaults to the facade getDashboardModel via useShiftPoll). */
  read?: PollRead<DashboardModel>;
  /** Start a detached driver run. */
  startRun?: (opts: RunOpts) => Promise<RunHandle>;
  /**
   * Kill a run. The viewer MUST NEVER call this on quit — it exists only so a
   * test can assert it is never invoked. Quitting detaches cleanly.
   */
  killRun?: (pid: number) => void;
  /** Build a journal tail (defaults to tailJournal). */
  makeTail?: (path: string, onLines: (added: string[]) => void) => JournalTail;
  /** Poll cadence in ms (default 1500 while a shift is live). */
  pollIntervalMs?: number;
  /** Seed `running` so the tail attaches immediately (tests). */
  initialRunning?: boolean;
  /** Seed a journal path so the tail attaches without a real run (tests). */
  initialJournalPath?: string;
  /** Resolve a pending consent (defaults to consent.resolve). Injected for tests. */
  resolveConsent?: (
    id: string,
    approved: boolean,
    token?: string,
  ) => { ok: boolean; error?: string };
}

export interface AppProps {
  initial?: Partial<AppState>;
  rawModeSupported?: boolean;
  deps?: AppDeps;
}

/**
 * The root TUI component. Owns the single top-level state object + the poll
 * interval + the journal tail. `useInput` dispatches every key through the
 * single keymap. Quitting stops the poller and tail but NEVER kills the
 * detached driver (the viewer is a separate process).
 */
export function App({ initial, rawModeSupported = true, deps = {} }: AppProps): React.ReactElement {
  const startRun = deps.startRun;
  const makeTail = deps.makeTail ?? tailJournal;
  const pollIntervalMs = deps.pollIntervalMs ?? 1500;
  const resolveConsent =
    deps.resolveConsent ?? ((id, approved, token) => defaultResolve(id, approved, token));

  const [ui, setUi] = useState<AppState>(() => ({
    ...initialState(),
    running: deps.initialRunning ?? false,
    ...initial,
  }));
  // Completed stream lines come from the tail's ring buffer.
  const [streamLines, setStreamLines] = useState<string[]>([]);
  const [runHandle, setRunHandle] = useState<RunHandle | null>(
    deps.initialJournalPath != null
      ? { pid: -1, journalPath: deps.initialJournalPath, detached: true }
      : null,
  );
  const tailRef = useRef<JournalTail | null>(null);
  // The last gate id we surfaced+closed. A just-resolved/dismissed consent must
  // not immediately re-surface from a stale poll before the next tick drops it.
  const closedGateRef = useRef<string | null>(null);

  // Pause polling while any blocking modal is open (background freeze).
  const pollEnabled = ui.modal == null || ui.modal === 'quit-confirm';
  const { data, error } = useShiftPoll(pollIntervalMs, pollEnabled, deps.read);
  const model = data ?? ui.model;

  // Surface a pending gate from the polled model. A pending consent (with an
  // id+token) opens the type-to-confirm GateModal; a surface-only stop opens
  // the GateNotice. Never re-open the same gate we just closed.
  useEffect(() => {
    const pg = model?.pendingGate;
    if (!pg) {
      // Once the model clears the gate, forget the closed id (a NEW gate with
      // the same id is impossible — ids are uuids — but this keeps the ref tidy).
      if (closedGateRef.current != null) closedGateRef.current = null;
      return;
    }
    if (ui.modal === 'gate') return;
    if (pg.id != null && pg.id === closedGateRef.current) return; // just handled
    setUi((s) => ({ ...s, modal: 'gate', gate: pg }));
  }, [model?.pendingGate, ui.modal]);

  const closeGate = useCallback((gateId?: string) => {
    if (gateId != null) closedGateRef.current = gateId;
    setUi((s) => ({ ...s, modal: null, gate: null }));
  }, []);

  // Attach the journal tail when a run is live; tear it down deterministically.
  useEffect(() => {
    if (!ui.running) return;
    const path = runHandle?.journalPath ?? process.env.FIVE_TO_NINE_JOURNAL ?? '';
    if (path === '') return;
    const tail = makeTail(path, () => setStreamLines(tail.lines()));
    tailRef.current = tail;
    setStreamLines(tail.lines());
    return () => {
      tail.stop();
      tailRef.current = null;
    };
  }, [ui.running, runHandle?.journalPath, makeTail]);

  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;

  const focus = useCallback((pane: Pane) => setUi((s) => ({ ...s, focusedPane: pane })), []);
  const cyclePane = useCallback((dir: 1 | -1) => {
    const order: Pane[] = ['status', 'backlog', 'stream'];
    setUi((s) => {
      const i = order.indexOf(s.focusedPane);
      const next = (i + dir + order.length) % order.length;
      return { ...s, focusedPane: order[next] };
    });
  }, []);

  const onClockInSubmit = useCallback((_goal: string) => {
    // Paint immediately by closing the modal; the poller picks up new state.
    setUi((s) => ({ ...s, modal: null }));
  }, []);

  const onRun = useCallback(async () => {
    if (startRun == null) {
      setUi((s) => ({ ...s, running: true, focusedPane: 'stream' }));
      return;
    }
    const handle = await startRun({});
    setRunHandle(handle);
    setUi((s) => ({ ...s, running: true, focusedPane: 'stream' }));
  }, [startRun]);

  // Stop the viewer's owned resources WITHOUT killing the detached driver.
  const teardownViewer = useCallback(() => {
    tailRef.current?.stop();
    tailRef.current = null;
  }, []);

  const shiftActive = model?.state.active ?? false;

  // The single keyboard dispatcher — every binding is driven by the keymap.
  useInput((input, key) => {
    // Modals trap their own input (handled inside the modal components), except
    // the quit-confirm which we resolve here.
    if (ui.modal === 'quit-confirm') {
      if (input === 'y' || key.return) {
        teardownViewer();
        exit();
      } else if (key.escape || input === 'n') {
        setUi((s) => ({ ...s, modal: null }));
      }
      return;
    }
    if (ui.modal != null) return; // other modals own input

    if (input === '1') return focus('status');
    if (input === '2') return focus('backlog');
    if (input === '3') return focus('stream');
    if (key.tab) return cyclePane(key.shift ? -1 : 1);
    if (input === '?') return setUi((s) => ({ ...s, modal: 'help' }));
    if (input === 'c') return setUi((s) => ({ ...s, modal: 'clock-in' }));
    if (input === 'r' && shiftActive) return void onRun();
    if (input === 'o' && shiftActive) {
      teardownViewer();
      return setUi((s) => ({ ...s, modal: 'report', running: false }));
    }
    if (input === 'q') {
      // Quitting NEVER kills the driver. With a live shift, confirm first.
      if (shiftActive) return setUi((s) => ({ ...s, modal: 'quit-confirm' }));
      teardownViewer();
      exit();
    }
  });

  // Deterministic teardown on unmount: stop the tail (the poller stops itself
  // via useShiftPoll's effect cleanup). Never kills the driver.
  useEffect(() => {
    return () => teardownViewer();
  }, [teardownViewer]);

  if (!rawModeSupported) {
    return <StaticStatusDump model={model} />;
  }

  // Modal overlays take the whole screen (focus-trap).
  if (ui.modal === 'clock-in') {
    return (
      <ClockInModal
        onSubmit={onClockInSubmit}
        onCancel={() => setUi((s) => ({ ...s, modal: null }))}
      />
    );
  }
  if (ui.modal === 'gate' && ui.gate) {
    // A pending consent (id + token) → type-to-confirm GateModal (Phase 1b).
    // A surface-only gate (no id) → the legacy GateNotice.
    if (ui.gate.id != null && ui.gate.token != null) {
      return (
        <GateModal
          pending={{
            id: ui.gate.id,
            command: ui.gate.command ?? ui.gate.segment,
            category: ui.gate.category,
            token: ui.gate.token,
            bead: ui.gate.bead,
            role: ui.gate.role,
          }}
          resolve={resolveConsent}
          onClose={() => closeGate(ui.gate?.id)}
        />
      );
    }
    return (
      <GateNotice
        segment={ui.gate.segment}
        category={ui.gate.category}
        bead={ui.gate.bead}
        roleName={ui.gate.role}
        onDismiss={() => closeGate(ui.gate?.id)}
      />
    );
  }
  if (ui.modal === 'help') {
    return (
      <HelpOverlay pane={ui.focusedPane} onClose={() => setUi((s) => ({ ...s, modal: null }))} />
    );
  }
  if (ui.modal === 'report') {
    return <ShiftReportView model={model} />;
  }

  return (
    <Box flexDirection="column" height={rows - 1}>
      {model ? (
        <StatusBar shift={model.state} gate={model.gate} running={ui.running} />
      ) : (
        <Text>The 5 to 9 — loading…</Text>
      )}
      {error && <Text dimColor>bd unreachable — retrying ({error})</Text>}
      <Box flexDirection="row" flexGrow={1}>
        {model && (
          <BacklogPane
            model={model}
            isActive={ui.focusedPane === 'backlog'}
            selectedId={ui.selectedBeadId}
            scrollOffset={ui.scrollOffset}
            filter={ui.filter}
            onSelect={(id) => setUi((s) => ({ ...s, selectedBeadId: id }))}
          />
        )}
        <RunStreamPane
          lines={streamLines}
          liveLine={ui.running ? 'working…' : ''}
          follow
          isActive={ui.focusedPane === 'stream'}
          running={ui.running}
        />
      </Box>
      {ui.modal === 'quit-confirm' && (
        <Text>Quit the viewer? The run keeps going in the background. (y/n)</Text>
      )}
      <Footer pane={ui.focusedPane} shiftActive={shiftActive} />
    </Box>
  );
}
