import { expect, test, vi } from 'vitest';
import { launchTui } from './launch.ts';

// Keep the launcher hermetic + fast: the initial model fetch must not touch real
// beads/state (which can hang under concurrent test load). The render-throw path
// is what we exercise; the model is irrelevant.
vi.mock('../operations/dashboard-model.ts', () => ({
  getDashboardModel: async () => null,
}));

const ALT_SCREEN_ENTER = '\x1b[?1049h';
const ALT_SCREEN_LEAVE = '\x1b[?1049l';

/** A minimal stdout stub that records writes and looks like a raw-mode-capable TTY. */
function fakeStdout() {
  const writes: string[] = [];
  const stream = {
    write: (s: string) => {
      writes.push(s);
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  return { stream, writes };
}

/** A stdin stub that probes as a raw-mode TTY so launchTui takes the interactive path. */
function fakeStdin() {
  return {
    isTTY: true,
    setRawMode: () => {},
  } as unknown as NodeJS.ReadStream;
}

test('P1-A: alt-screen is restored (LEAVE written) even when render() throws, and the throw propagates', async () => {
  const { stream: stdout, writes } = fakeStdout();
  const stdin = fakeStdin();
  const boom = new Error('render exploded');
  const renderFn = vi.fn(() => {
    throw boom;
  });

  await expect(
    launchTui({
      stdout,
      stdin,
      rawModeSupported: true,
      useAltScreen: true,
      renderFn: renderFn as unknown as NonNullable<Parameters<typeof launchTui>[0]>['renderFn'],
    }),
  ).rejects.toThrow('render exploded');

  // The alt-screen was entered…
  expect(writes).toContain(ALT_SCREEN_ENTER);
  // …and MUST have been restored even though render() threw before waitUntilExit.
  expect(writes).toContain(ALT_SCREEN_LEAVE);
});

test('P1-A: a normal interactive render still enters and leaves the alt-screen', async () => {
  const { stream: stdout, writes } = fakeStdout();
  const stdin = fakeStdin();
  const renderFn = vi.fn(() => ({ waitUntilExit: async () => {} }));

  await launchTui({
    stdout,
    stdin,
    rawModeSupported: true,
    useAltScreen: true,
    renderFn: renderFn as unknown as NonNullable<Parameters<typeof launchTui>[0]>['renderFn'],
  });

  expect(renderFn).toHaveBeenCalledTimes(1);
  expect(writes).toContain(ALT_SCREEN_ENTER);
  expect(writes).toContain(ALT_SCREEN_LEAVE);
});
