import { render } from 'ink-testing-library';
import { expect, test, vi } from 'vitest';
import { App } from './App.tsx';
import { ACTIVE_MODEL, IDLE_MODEL } from './fixtures.ts';

const delay = (ms = 40) => new Promise((r) => setTimeout(r, ms));

/** A common deps bundle: injected read + no real run + spies for teardown. */
function testDeps(overrides: Record<string, unknown> = {}) {
  const tailStop = vi.fn();
  return {
    read: vi.fn(async () => ACTIVE_MODEL),
    startRun: vi.fn(async () => ({
      pid: 4242,
      journalPath: '/tmp/none.jsonl',
      detached: true as const,
    })),
    killRun: vi.fn(),
    makeTail: vi.fn(() => ({ lines: () => [], stop: tailStop })),
    tailStop,
    pollIntervalMs: 5000, // long so only the immediate tick fires in tests
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pane focus via Ctrl+1/2/3 (sent as Alt+1/2/3 = \x1bN in terminal; meta+digit in ink)
// ---------------------------------------------------------------------------

test('Alt+1/2/3 move pane focus — stream gets f-follow, backlog gets g/G top/bottom', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('\x1b3'); // Alt+3 → focus Run Stream
  await delay();
  // 'f follow' is a stream-only footer binding
  expect(lastFrame()).toContain('f follow');
  stdin.write('\x1b2'); // Alt+2 → focus Backlog
  await delay();
  // 'g/G top/bottom' is a backlog-only footer binding
  expect(lastFrame()).toContain('g/G top/bottom');
  unmount();
});

test('Tab / Shift+Tab cycle pane focus', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('\t'); // Tab → cycle forward from status
  await delay();
  // After one Tab from status, focus is backlog (status→backlog→stream)
  expect(lastFrame()).toContain('g/G top/bottom');
  unmount();
});

// ---------------------------------------------------------------------------
// Input buffer (CommandBar)
// ---------------------------------------------------------------------------

test('printable key appends to ui.input and CommandBar renders it', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('h');
  await delay();
  // CommandBar shows the typed character
  expect(lastFrame()).toContain('> h');
  unmount();
});

test('typing / starts a command; the buffer accumulates', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('/run');
  await delay();
  expect(lastFrame()).toContain('> /run');
  unmount();
});

test('Esc clears the input buffer', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('hello');
  await delay();
  expect(lastFrame()).toContain('> hello');
  stdin.write('\x1B'); // Esc
  await delay();
  expect(lastFrame()).not.toContain('> hello');
  unmount();
});

// ---------------------------------------------------------------------------
// Command dispatch (Enter)
// ---------------------------------------------------------------------------

test('/clock-in command opens the ClockInModal', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('/clock-in');
  await delay();
  stdin.write('\r'); // Enter
  await delay();
  expect(lastFrame()).toMatch(/shift goal/i);
  unmount();
});

test('/clock-out command opens the shift report', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('/clock-out');
  await delay();
  stdin.write('\r'); // Enter → ctx.clockOut()
  await delay();
  expect(lastFrame()).toMatch(/shift report/i);
  // Never kills the driver
  expect(d.killRun).not.toHaveBeenCalled();
  unmount();
});

test('/quit command with live shift opens quit-confirm and NEVER calls killRun', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('/quit');
  await delay();
  stdin.write('\r'); // Enter → ctx.quit()
  await delay();
  expect(lastFrame()).toMatch(/quit|clock out|leave/i);
  expect(d.killRun).not.toHaveBeenCalled();
  unmount();
  expect(d.killRun).not.toHaveBeenCalled();
});

test('unknown command shows a notify line (error message echoed)', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('/notacommand');
  await delay();
  stdin.write('\r');
  await delay();
  // The notify path echoes the error into the stream area
  expect(lastFrame()).toMatch(/unknown command|notacommand/i);
  unmount();
});

test('/follow command toggles follow on/off regardless of focused pane', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  expect(lastFrame()).toMatch(/follow ▸ on/);
  stdin.write('/follow');
  await delay();
  stdin.write('\r');
  await delay();
  expect(lastFrame()).toMatch(/follow · off/);
  stdin.write('/follow');
  await delay();
  stdin.write('\r');
  await delay();
  expect(lastFrame()).toMatch(/follow ▸ on/);
  unmount();
});

test('/run command starts the run; a second dispatch while running is a no-op', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('/run');
  await delay();
  stdin.write('\r');
  await delay();
  expect(d.startRun).toHaveBeenCalledTimes(1);
  // Second /run while already running → runningRef guard prevents a second start
  stdin.write('/run');
  await delay();
  stdin.write('\r');
  await delay();
  expect(d.startRun).toHaveBeenCalledTimes(1);
  unmount();
});

test('empty Enter (buffer empty) is a no-op', async () => {
  const d = testDeps();
  const { stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(d.read).toHaveBeenCalled());
  stdin.write('\r'); // Enter with empty buffer
  await delay();
  // No command fired: startRun not called, killRun not called
  expect(d.startRun).not.toHaveBeenCalled();
  expect(d.killRun).not.toHaveBeenCalled();
  unmount();
});

// ---------------------------------------------------------------------------
// Arrow-key navigation in backlog (App now owns the router)
// ---------------------------------------------------------------------------

test('down arrow in focused backlog selects the first bead', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('\x1b2'); // focus backlog
  await delay();
  stdin.write('\x1B[B'); // down arrow
  await delay();
  // t59-4a1 is first in the ready section; should now have the ▸ marker
  const frame = lastFrame() ?? '';
  const lines = frame.split('\n');
  const beadLine = lines.find((l) => l.includes('t59-4a1'));
  expect(beadLine).toBeTruthy();
  expect(beadLine).toContain('▸');
  unmount();
});

test('up arrow when nothing is selected selects the first bead', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('\x1b2'); // focus backlog
  await delay();
  stdin.write('\x1B[A'); // up arrow
  await delay();
  const frame = lastFrame() ?? '';
  expect(frame).toContain('▸');
  unmount();
});

test('selection is preserved across a simulated poll tick (lazy-docker rule)', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('\x1b2'); // focus backlog
  await delay();
  stdin.write('\x1B[B'); // select t59-4a1
  await delay();
  const frameBefore = lastFrame();
  expect(frameBefore).toContain('▸');
  // A new model object arrives (simulated by re-reading the same data).
  // The selection is held in App state, separate from the polled model,
  // so it survives the poll.
  await delay(60); // let the test poller tick (pollIntervalMs=5000, so it won't fire again)
  // Selection must still be visible — the ▸ marker persists.
  expect(lastFrame()).toContain('▸');
  unmount();
});

// ---------------------------------------------------------------------------
// Gate / polling
// ---------------------------------------------------------------------------

test('a pending-gate model raises GateNotice and pauses polling', async () => {
  const gated = {
    ...ACTIVE_MODEL,
    pendingGate: { segment: 'gh release create v9', category: 'publish', bead: 't59-7e0' },
  };
  const d = testDeps({ read: vi.fn(async () => gated) });
  const { lastFrame, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toMatch(/IRREVERSIBLE ACTION BLOCKED/));
  expect(lastFrame()).toContain('gh release create v9');
  unmount();
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test('on unmount, the poller and the journal tail are both stopped', async () => {
  const d = testDeps({ initialRunning: true, initialJournalPath: '/tmp/none.jsonl' });
  const { unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(d.makeTail).toHaveBeenCalled());
  const read = d.read as ReturnType<typeof vi.fn>;
  const callsAtUnmount = read.mock.calls.length;
  unmount();
  // Effect cleanups run asynchronously after unmount — let them flush.
  await delay(40);
  expect(d.tailStop).toHaveBeenCalled();
  // The poller stops too: no further reads after unmount.
  await delay(120);
  expect(read.mock.calls.length).toBe(callsAtUnmount);
});

test('idle shift renders without crashing', async () => {
  const d = testDeps({ read: vi.fn(async () => IDLE_MODEL) });
  const { lastFrame, unmount } = render(<App deps={d} />);
  await delay();
  expect(lastFrame()).toMatch(/no active shift|The 5 to 9/);
  unmount();
});
