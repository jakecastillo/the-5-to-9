import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolve as defaultResolve } from '../consent.ts';
import { type ClockInResult, clockIn as defaultClockIn } from '../operations/clock-in.ts';
import type { DashboardModel } from '../operations/dashboard-model.ts';
import type { RunHandle, RunOpts } from '../operations/run.ts';
import { BacklogPane } from './BacklogPane.tsx';
import { ClockInModal } from './ClockInModal.tsx';
import { CommandBar } from './CommandBar.tsx';
import { CommandPalette } from './CommandPalette.tsx';
import { Footer } from './Footer.tsx';
import { GateModal } from './GateModal.tsx';
import { GateNotice } from './GateNotice.tsx';
import { HelpOverlay } from './HelpOverlay.tsx';
import { RunStreamPane } from './RunStreamPane.tsx';
import { ShiftReportView } from './ShiftReportView.tsx';
import { StaticStatusDump } from './StaticStatusDump.tsx';
import { StatusBar } from './StatusBar.tsx';
import { matchesFilter } from './backlog-filter.ts';
import { parseCommandLine, resolveCommand } from './command-parse.ts';
import { type CommandContext, commandNames, findCommand } from './commands.ts';
import { fuzzyRank } from './fuzzy.ts';
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
  /**
   * Open a shift with a goal (defaults to operations/clock-in.ts clockIn).
   * Injected so tests pass a mock and never write real state or switch branches.
   */
  clockIn?: (goal: string) => Promise<ClockInResult>;
}

export interface AppProps {
  initial?: Partial<AppState>;
  rawModeSupported?: boolean;
  deps?: AppDeps;
}

/**
 * The root TUI component. Owns the single top-level state object + the poll
 * interval + the journal tail. `useInput` dispatches every key through the
 * single key router. Quitting stops the poller and tail but NEVER kills the
 * detached driver (the viewer is a separate process).
 */
export function App({ initial, rawModeSupported = true, deps = {} }: AppProps): React.ReactElement {
  const startRun = deps.startRun;
  const makeTail = deps.makeTail ?? tailJournal;
  const pollIntervalMs = deps.pollIntervalMs ?? 1500;
  const resolveConsent =
    deps.resolveConsent ?? ((id, approved, token) => defaultResolve(id, approved, token));
  const clockInFn = deps.clockIn ?? defaultClockIn;

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

  const onClockInSubmit = useCallback(
    (goal: string) => {
      // Close the modal immediately; then fire the facade to write state.
      setUi((s) => ({ ...s, modal: null }));
      void clockInFn(goal).then((result) => {
        if (result.warnings.length > 0) {
          setStreamLines((lines) => [
            ...lines.slice(-999),
            ...result.warnings.map((w) => `[notice] ${w}`),
          ]);
          setUi((s) => ({ ...s, focusedPane: 'stream' }));
        }
      });
    },
    [clockInFn],
  );

  // A synchronous start guard: `ui.running` can be stale within two rapid key
  // events in the same tick (setUi is async), so the ref is the source of truth
  // that blocks a duplicate run before the first start's state has committed.
  const runningRef = useRef(deps.initialRunning ?? false);
  useEffect(() => {
    runningRef.current = ui.running;
  }, [ui.running]);

  const onRun = useCallback(async () => {
    if (runningRef.current) return; // already running — ignore the duplicate
    runningRef.current = true;
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

  // ---------------------------------------------------------------------------
  // CommandContext: the seam every command handler calls. Methods call the real
  // facade/state setters. No command imports these directly — fully injectable
  // for tests via the facade mock (AppDeps).
  // ---------------------------------------------------------------------------
  const ctx: CommandContext = {
    clockIn: (goal) => {
      const trimmed = goal.trim();
      if (trimmed) {
        // Inline goal supplied — call the facade; fire-and-forget, repaint on warnings.
        void clockInFn(trimmed).then((result) => {
          if (result.warnings.length > 0) {
            setStreamLines((lines) => [
              ...lines.slice(-999),
              ...result.warnings.map((w) => `[notice] ${w}`),
            ]);
            setUi((s) => ({ ...s, focusedPane: 'stream' }));
          }
        });
      } else {
        // No goal — open the interactive modal so the user can type one.
        setUi((s) => ({ ...s, modal: 'clock-in' }));
      }
    },
    clockOut: () => {
      teardownViewer();
      setUi((s) => ({ ...s, modal: 'report', running: false }));
    },
    run: () => {
      void onRun();
    },
    status: () => {
      setStreamLines((lines) => [...lines.slice(-999), '[status] reading shift state…']);
      setUi((s) => ({ ...s, focusedPane: 'stream' }));
    },
    doctor: () => {
      setStreamLines((lines) => [...lines.slice(-999), '[doctor] preflight check…']);
      setUi((s) => ({ ...s, focusedPane: 'stream' }));
    },
    configGet: (key) => {
      const label = key ?? '(all)';
      setStreamLines((lines) => [...lines.slice(-999), `[config get] ${label}`]);
      setUi((s) => ({ ...s, focusedPane: 'stream' }));
    },
    configSet: (key, value) => {
      setStreamLines((lines) => [...lines.slice(-999), `[config set] ${key}=${value}`]);
      setUi((s) => ({ ...s, focusedPane: 'stream' }));
    },
    gate: (action, id) => {
      const label = id ? ` ${id}` : '';
      setStreamLines((lines) => [
        ...lines.slice(-999),
        `[gate] ${action}${label} — see the gate modal for interactive consent`,
      ]);
      setUi((s) => ({ ...s, focusedPane: 'stream' }));
    },
    filter: (query) => {
      setUi((s) => ({ ...s, filter: query }));
    },
    follow: () => {
      setUi((s) => ({ ...s, follow: !s.follow }));
    },
    clear: () => {
      setStreamLines([]);
    },
    help: () => {
      setUi((s) => ({ ...s, modal: 'help' }));
    },
    quit: () => {
      // Quitting NEVER kills the driver. With a live shift, confirm first.
      if (shiftActive) {
        setUi((s) => ({ ...s, modal: 'quit-confirm' }));
      } else {
        teardownViewer();
        exit();
      }
    },
    notify: (message) => {
      setStreamLines((lines) => [...lines.slice(-999), `[notice] ${message}`]);
      setUi((s) => ({ ...s, focusedPane: 'stream' }));
    },
  };

  // ---------------------------------------------------------------------------
  // effectiveFilter: derived from the buffer when it is non-empty bare text,
  // falling back to the persisted ui.filter (set by /filter command).
  // This drives both BacklogPane and the flatBeadIds memo so they always agree.
  // ---------------------------------------------------------------------------
  const effectiveFilter = ui.input !== '' && !ui.input.startsWith('/') ? ui.input : ui.filter;

  // ---------------------------------------------------------------------------
  // Flat bead id list for arrow-key navigation (memoised; recomputes on poll).
  // ---------------------------------------------------------------------------
  const flatBeadIds = useMemo(() => {
    if (!model) return [];
    const q = effectiveFilter.trim().toLowerCase();
    return [
      ...model.ready.filter((b) => matchesFilter(b, q)),
      ...model.inProgress.filter((b) => matchesFilter(b, q)),
      ...model.blocked.filter((b) => matchesFilter(b, q)),
    ].map((b) => b.id);
  }, [model, effectiveFilter]);

  // ---------------------------------------------------------------------------
  // Single keyboard dispatcher. All input flows through here; pane components
  // are now purely presentational. Modals that own the full screen (gate/help/
  // clock-in/report) handle their own useInput internally — App returns early
  // to avoid interference.
  // ---------------------------------------------------------------------------
  useInput((input, key) => {
    // The quit-confirm is NOT a full-screen modal — App resolves it inline.
    if (ui.modal === 'quit-confirm') {
      if (input === 'y' || key.return) {
        teardownViewer();
        exit();
      } else if (key.escape || input === 'n') {
        setUi((s) => ({ ...s, modal: null }));
      }
      return;
    }
    // Full-screen modals (gate / help / clock-in / report) trap their own input.
    if (ui.modal != null) return;

    // Ctrl+1/2/3 focus (sent as Alt+1/2/3 = \x1bN; meta+digit in ink's model).
    // Bare 1/2/3 now type into the command buffer.
    if (key.meta && input === '1') return focus('status');
    if (key.meta && input === '2') return focus('backlog');
    if (key.meta && input === '3') return focus('stream');

    // '?' opens the help overlay ONLY when the buffer is empty; otherwise it
    // is a literal character that gets appended below (so '/gate??' types fine).
    if (input === '?' && ui.input === '') {
      setUi((s) => ({ ...s, modal: 'help' }));
      return;
    }

    // Arrow keys: palette row navigation (buffer starts with '/') or backlog nav.
    if (key.upArrow || key.downArrow) {
      if (ui.input.startsWith('/')) {
        // Move palette selection up/down.
        const verb = ui.input.slice(1).split(/\s+/)[0] ?? '';
        const ranked = fuzzyRank(verb, commandNames());
        const maxIdx = Math.max(0, ranked.length - 1);
        setUi((s) => {
          const cur = Math.min(s.paletteIndex, maxIdx);
          const next = key.downArrow ? Math.min(cur + 1, maxIdx) : Math.max(cur - 1, 0);
          return { ...s, paletteIndex: next };
        });
      } else if (ui.focusedPane === 'backlog' && flatBeadIds.length > 0) {
        const cur = ui.selectedBeadId != null ? flatBeadIds.indexOf(ui.selectedBeadId) : -1;
        const next = key.downArrow
          ? cur < 0
            ? 0
            : Math.min(cur + 1, flatBeadIds.length - 1)
          : cur < 0
            ? 0
            : Math.max(cur - 1, 0);
        setUi((s) => ({ ...s, selectedBeadId: flatBeadIds[next] }));
      }
      return;
    }

    // Tab: complete the buffer to the selected palette command (when palette is
    // open), or cycle pane focus (when no palette).
    if (key.tab) {
      if (ui.input.startsWith('/')) {
        const verb = ui.input.slice(1).split(/\s+/)[0] ?? '';
        const ranked = fuzzyRank(verb, commandNames());
        if (ranked.length > 0) {
          const selected = ranked[Math.min(ui.paletteIndex, ranked.length - 1)];
          setUi((s) => ({ ...s, input: `/${selected} `, paletteIndex: 0 }));
        }
      } else {
        cyclePane(key.shift ? -1 : 1);
      }
      return;
    }

    // Esc: clear the command buffer AND the persisted filter.
    if (key.escape) {
      setUi((s) => ({ ...s, input: '', filter: '', paletteIndex: 0 }));
      return;
    }

    // Enter: dispatch the command buffer.
    if (key.return) {
      const raw = ui.input.trim();
      if (raw === '') return;

      if (raw.startsWith('/')) {
        // Try to resolve the typed text as a full command first.
        const result = resolveCommand(raw);
        if (result.ok) {
          void result.spec.run(ctx, result.parsed);
        } else {
          // Fall back to the highlighted palette row.
          const verb = raw.slice(1).split(/\s+/)[0] ?? '';
          const ranked = fuzzyRank(verb, commandNames());
          if (ranked.length > 0) {
            const selectedName = ranked[Math.min(ui.paletteIndex, ranked.length - 1)];
            const spec = findCommand(selectedName);
            if (spec) {
              const restArgs = raw.slice(1 + verb.length).trim();
              const line = restArgs ? `/${selectedName} ${restArgs}` : `/${selectedName}`;
              void spec.run(ctx, parseCommandLine(line));
            } else {
              ctx.notify(result.error);
            }
          } else {
            // No palette match either — surface the resolveCommand error.
            ctx.notify(result.error);
          }
        }
      } else {
        // Bare text Enter: promote the live filter to a persistent filter and
        // clear the input. Esc is the only way to unset the filter afterward.
        setUi((s) => ({ ...s, input: '', filter: raw, paletteIndex: 0 }));
        return;
      }
      setUi((s) => ({ ...s, input: '', paletteIndex: 0 }));
      return;
    }

    // Backspace / Delete: remove the last character from the buffer.
    if (key.backspace || key.delete) {
      setUi((s) => ({ ...s, input: s.input.slice(0, -1), paletteIndex: 0 }));
      return;
    }

    // Printable characters (no Ctrl/Meta modifier) → append to the buffer.
    if (input.length > 0 && !key.ctrl && !key.meta) {
      setUi((s) => ({ ...s, input: s.input + input, paletteIndex: 0 }));
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
            filter={effectiveFilter}
            onSelect={(id) => setUi((s) => ({ ...s, selectedBeadId: id }))}
          />
        )}
        <RunStreamPane
          lines={streamLines}
          liveLine={ui.running ? 'working…' : ''}
          follow={ui.follow}
          isActive={ui.focusedPane === 'stream'}
          running={ui.running}
        />
      </Box>
      {ui.modal === 'quit-confirm' && (
        <Text>Quit the viewer? The run keeps going in the background. (y/n)</Text>
      )}
      {ui.input.startsWith('/') && (
        <CommandPalette query={ui.input} selectedIndex={ui.paletteIndex} />
      )}
      <CommandBar
        value={ui.input}
        shiftActive={shiftActive}
        filter={effectiveFilter}
        matchCount={effectiveFilter ? flatBeadIds.length : 0}
      />
      <Footer pane={ui.focusedPane} shiftActive={shiftActive} />
    </Box>
  );
}
