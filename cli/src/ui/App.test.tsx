import { render } from 'ink-testing-library';
import { expect, test, vi } from 'vitest';
import { App } from './App.tsx';
import { ACTIVE_MODEL, IDLE_MODEL, PENDING_GATE_MODEL } from './fixtures.ts';

const delay = (ms = 80) => new Promise((r) => setTimeout(r, ms));

test('App renders the goal text from the initial model', () => {
  const { lastFrame, unmount } = render(<App initial={{ model: ACTIVE_MODEL }} />);
  expect(lastFrame()).toContain('Ship auth refactor + green CI');
  unmount();
});

test('App in non-raw stdin falls back to StaticStatusDump (no interactive layout)', () => {
  const { lastFrame, unmount } = render(
    <App initial={{ model: IDLE_MODEL }} rawModeSupported={false} />,
  );
  const frame = lastFrame() ?? '';
  // The plain dump names the inactive shift and never paints the pane chrome.
  expect(frame).toMatch(/no active shift/i);
  // It must NOT render the interactive pane layout.
  expect(frame).not.toMatch(/RUN STREAM/);
  expect(frame).not.toMatch(/BACKLOG/);
  unmount();
});

// A poll read pinned to the pending-gate model so the consent stays surfaced
// across ticks (the real getDashboardModel would read the test cwd and clobber).
const pendingRead = () => Promise.resolve(PENDING_GATE_MODEL);

test('App surfaces a pending consent as the type-to-confirm GateModal', async () => {
  const { lastFrame, unmount } = render(<App deps={{ read: pendingRead }} />);
  await delay();
  const f = lastFrame() ?? '';
  expect(f).toMatch(/APPROVE OR DENY/i); // the GateModal, not the surface notice
  expect(f).toContain('gh release create v1');
  expect(f).toMatch(/type exactly/i);
  unmount();
});

test('App: a non-TTY NEVER shows the gate modal even with a pending consent', async () => {
  const { lastFrame, unmount } = render(
    <App deps={{ read: pendingRead }} rawModeSupported={false} />,
  );
  await delay();
  const f = lastFrame() ?? '';
  // The interactive modal must not appear off-TTY; the dump path is shown.
  expect(f).not.toMatch(/APPROVE OR DENY/i);
  expect(f).not.toMatch(/type exactly/i);
  unmount();
});

test('App: approving in the GateModal routes through the injected resolveConsent', async () => {
  const resolveConsent = vi.fn(() => ({ ok: true }));
  const { stdin, unmount } = render(<App deps={{ read: pendingRead, resolveConsent }} />);
  await delay();
  stdin.write('gh'); // the exact token from the fixture
  await delay();
  stdin.write('\r'); // Enter → approve
  await delay();
  expect(resolveConsent).toHaveBeenCalledWith('c-abc', true, 'gh');
  unmount();
});

test('App: Esc in the GateModal denies through resolveConsent (default-deny)', async () => {
  const resolveConsent = vi.fn(() => ({ ok: true }));
  const { stdin, unmount } = render(<App deps={{ read: pendingRead, resolveConsent }} />);
  await delay();
  stdin.write('\x1B'); // Esc → deny
  await delay();
  expect(resolveConsent).toHaveBeenCalledWith('c-abc', false, undefined);
  expect(resolveConsent).not.toHaveBeenCalledWith('c-abc', true, expect.anything());
  unmount();
});
