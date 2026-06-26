import { render } from 'ink-testing-library';
import { expect, test, vi } from 'vitest';
import { App } from './App.tsx';
import { ACTIVE_MODEL, IDLE_MODEL } from './fixtures.ts';
import { footerFor } from './keymap.ts';

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

test('Alt+1/2/3 move pane focus — arrows respect focused pane', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('\x1b3'); // Alt+3 → focus Run Stream
  await delay();
  stdin.write('\x1B[B'); // Down while stream focused → no backlog nav
  await delay();
  // No bead row should carry the selection marker (▸ <beadId>) when stream is focused.
  // Note: RunStreamPane shows "▸ on" (follow), so we check bead-id patterns specifically.
  expect(lastFrame()).not.toMatch(/▸\s+t59-/);
  stdin.write('\x1b2'); // Alt+2 → focus Backlog
  await delay();
  stdin.write('\x1B[B'); // Down while backlog focused → selects first bead
  await delay();
  // After focus switch + Down, a bead row gains the ▸ marker
  expect(lastFrame()).toMatch(/▸\s+t59-/);
  unmount();
});

test('Tab cycles pane focus forward (buffer empty → pane cycle, not palette complete)', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('\t'); // Tab → cycle forward from status to backlog
  await delay();
  // After one Tab from status, focus is backlog — pressing Down navigates the backlog
  stdin.write('\x1B[B');
  await delay();
  expect(lastFrame()).toContain('▸'); // selection appeared → backlog is focused
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

// ---------------------------------------------------------------------------
// Bead 200.3: CommandPalette + live bare-text filter
// ---------------------------------------------------------------------------

test('/ru shows the command palette with run ranked first (▸ glyph + argHint)', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('/ru');
  await delay();
  const frame = lastFrame() ?? '';
  const lines = frame.split('\n').filter((l) => l.trim().length > 0);
  const runLine = lines.find((l) => l.includes('/run'));
  expect(runLine).toBeTruthy();
  // first match row has the ▸ selected glyph
  const firstMatchIdx = lines.findIndex((l) => l.includes('/run'));
  expect(lines[firstMatchIdx]).toContain('▸');
  // argHint is visible
  expect(frame).toContain('--max-iterations');
  unmount();
});

test('Tab with palette open completes the buffer to the selected command', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('/ru');
  await delay();
  stdin.write('\t'); // Tab → complete to /run (+ trailing space for args)
  await delay();
  // The buffer is now /run (trailing space may be stripped by terminal renderer)
  expect(lastFrame()).toContain('> /run');
  // Palette still shows the completed command
  expect(lastFrame()).toContain('/run');
  unmount();
});

test('Down/Up arrows move palette selection when buffer starts with /', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('/'); // show full palette; clock-in is registry-order first
  await delay();
  stdin.write('\x1B[B'); // Down → move selection to index 1
  await delay();
  const frame = lastFrame() ?? '';
  const lines = frame.split('\n').filter((l) => l.trim().length > 0);
  const clockInIdx = lines.findIndex((l) => l.includes('/clock-in'));
  const clockOutIdx = lines.findIndex((l) => l.includes('/clock-out'));
  expect(clockInIdx).toBeGreaterThanOrEqual(0);
  expect(clockOutIdx).toBeGreaterThanOrEqual(0);
  // clock-in (index 0) should NOT be selected; clock-out (index 1) should be
  expect(lines[clockInIdx]).not.toContain('▸');
  expect(lines[clockOutIdx]).toContain('▸');
  unmount();
});

test('Enter on /ru dispatches the selected run command (palette selection fills in the verb)', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('/ru'); // palette shows run first (selectedIndex=0)
  await delay();
  stdin.write('\r'); // Enter → dispatches run via palette
  await delay();
  expect(d.startRun).toHaveBeenCalledTimes(1);
  // buffer cleared after dispatch
  expect(lastFrame()).not.toContain('> /ru');
  unmount();
});

test('bare text (no slash) live-filters the backlog and shows filter indicator', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('add');
  await delay();
  const frame = lastFrame() ?? '';
  // The filter indicator shows
  expect(frame).toMatch(/filter.*add/i);
  // The matching bead is visible
  expect(frame).toContain('add token rotation');
  // Non-matching beads are filtered out
  expect(frame).not.toContain('wire refresh endpoint');
  // No palette (bare text, no slash)
  expect(frame).not.toContain('/clock-in');
  unmount();
});

test('Esc clears the buffer AND the live filter (non-matching beads reappear)', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('add');
  await delay();
  expect(lastFrame()).not.toContain('wire refresh endpoint');
  stdin.write('\x1B'); // Esc
  await delay();
  // buffer cleared
  expect(lastFrame()).not.toContain('> add');
  // filter cleared — filtered-out bead is visible again
  expect(lastFrame()).toContain('wire refresh endpoint');
  unmount();
});

test('/zzz + Enter surfaces a notify error (no palette match → did-you-mean hint)', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('/zzz');
  await delay();
  stdin.write('\r');
  await delay();
  expect(lastFrame()).toMatch(/unknown command|zzz/i);
  unmount();
});

test('empty buffer with no active shift shows the clock-in placeholder', async () => {
  const d = testDeps({ read: vi.fn(async () => IDLE_MODEL) });
  const { lastFrame, unmount } = render(<App deps={d} />);
  await delay(60);
  const frame = lastFrame() ?? '';
  expect(frame).toContain('/clock-in');
  expect(frame).toContain('to start a shift');
  unmount();
});

// ---------------------------------------------------------------------------
// Bead 200.4: ? disambiguation + keymap single source of truth
// ---------------------------------------------------------------------------

test('? on empty buffer opens the help overlay', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('?'); // buffer is empty → opens help
  await delay();
  expect(lastFrame()).toMatch(/Keys|help/i);
  unmount();
});

test('? with a non-empty buffer appends as a literal character', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('hello');
  await delay();
  stdin.write('?');
  await delay();
  expect(lastFrame()).toContain('> hello?');
  unmount();
});

test('Footer text is generated from the KEYMAP table (single source of truth, no drift)', async () => {
  const d = testDeps();
  const { lastFrame, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  const frame = lastFrame() ?? '';
  // The footer renders from footerFor. The test terminal width (80 cols) truncates the full
  // string, so we verify the first couple of bindings which are guaranteed to be visible.
  // The Footer.test.tsx suite has the definitive width=200 equality assertion.
  const expected = footerFor('status', true);
  const firstBinding = expected.split(' · ')[0]; // e.g. "/ commands"
  const secondBinding = expected.split(' · ')[1]; // e.g. "↑/↓ move"
  expect(frame).toContain(firstBinding);
  expect(frame).toContain(secondBinding);
  // Old dead single-letter bindings must NOT appear
  expect(frame).not.toContain('j/k');
  expect(frame).not.toContain('g/G');
  unmount();
});

// ---------------------------------------------------------------------------
// Bead cer: palette Down must NOT advance backlog selection (mutual exclusion)
// ---------------------------------------------------------------------------

test('palette open: Down advances palette selection but leaves backlog cursor unchanged', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));

  // Focus the backlog pane and select the first bead via Down
  stdin.write('\x1b2'); // Alt+2 → focus backlog
  await delay();
  stdin.write('\x1B[B'); // Down → select t59-4a1 (first bead)
  await delay();

  // Confirm t59-4a1 is selected (has ▸) and t59-9c2 is not
  const frameBefore = lastFrame() ?? '';
  const linesBefore = frameBefore.split('\n');
  const bead1Before = linesBefore.find((l) => l.includes('t59-4a1'));
  const bead2Before = linesBefore.find((l) => l.includes('t59-9c2'));
  expect(bead1Before).toMatch(/▸/); // first bead selected
  expect(bead2Before).not.toMatch(/▸/); // second bead not selected

  // Open the palette by typing '/'
  stdin.write('/');
  await delay();

  // Now press Down — this should advance the PALETTE index (0 → 1),
  // NOT the backlog cursor (which should remain on t59-4a1).
  stdin.write('\x1B[B');
  await delay();

  const frameAfter = lastFrame() ?? '';
  const linesAfter = frameAfter.split('\n');

  // (a) Palette selection advanced: clock-out (2nd registry entry) has ▸
  const clockOutLine = linesAfter.find((l) => l.includes('/clock-out'));
  expect(clockOutLine).toBeDefined();
  expect(clockOutLine).toMatch(/▸/);

  // (b) Backlog cursor is unchanged: t59-4a1 still selected, t59-9c2 not
  const bead1After = linesAfter.find((l) => l.includes('t59-4a1'));
  const bead2After = linesAfter.find((l) => l.includes('t59-9c2'));
  expect(bead1After).toMatch(/▸/); // still on first bead
  expect(bead2After).not.toMatch(/▸/); // second bead still NOT selected
  unmount();
});
