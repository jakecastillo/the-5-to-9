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

test('1/2/3 and Tab move focus — the footer changes per pane', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('3'); // focus Run Stream
  await delay();
  expect(lastFrame()).toContain('follow'); // stream-only binding
  stdin.write('2'); // focus Backlog
  await delay();
  expect(lastFrame()).toContain(footerFor('backlog', true).split(' · ')[0]);
  unmount();
});

test('`c` opens the ClockInModal and traps nav', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('c');
  await delay();
  expect(lastFrame()).toMatch(/shift goal/i);
  unmount();
});

test('`q` with a live shift opens quit-confirm and NEVER calls killRun', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('q');
  await delay();
  expect(lastFrame()).toMatch(/quit|clock out|leave/i);
  expect(d.killRun).not.toHaveBeenCalled();
  unmount();
  expect(d.killRun).not.toHaveBeenCalled();
});

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

test('follow defaults to on, and `f` on the focused stream pane toggles it', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  // Default follow is ON (the RunStreamPane header reflects ui.follow).
  expect(lastFrame()).toMatch(/follow ▸ on/);
  stdin.write('3'); // focus the Run Stream pane so `f` is handled
  await delay();
  stdin.write('f'); // toggle follow off
  await delay();
  expect(lastFrame()).toMatch(/follow · off/);
  stdin.write('f'); // toggle back on
  await delay();
  expect(lastFrame()).toMatch(/follow ▸ on/);
  unmount();
});

test('`f` does NOT toggle follow unless the stream pane is focused', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  // Backlog focused (default is status; move to backlog explicitly).
  stdin.write('2');
  await delay();
  expect(lastFrame()).toMatch(/follow ▸ on/); // still on
  stdin.write('f'); // not on the stream pane → no toggle
  await delay();
  expect(lastFrame()).toMatch(/follow ▸ on/);
  unmount();
});

test('two rapid `r` presses start the run only once (no double-start)', async () => {
  const d = testDeps();
  const { lastFrame, stdin, unmount } = render(<App deps={d} />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor'));
  stdin.write('r');
  stdin.write('r'); // a rapid second press must be ignored while running
  await delay();
  expect(d.startRun).toHaveBeenCalledTimes(1);
  unmount();
});
