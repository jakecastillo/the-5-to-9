import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { expect, test, vi } from 'vitest';
import type { DashboardModel } from '../operations/dashboard-model.ts';
import { ACTIVE_MODEL } from './fixtures.ts';
import { createPoller, useShiftPoll } from './useShiftPoll.ts';

function Probe({
  read,
  enabled,
  intervalMs = 50,
}: {
  read: () => Promise<DashboardModel>;
  enabled: boolean;
  intervalMs?: number;
}): React.ReactElement {
  const { data } = useShiftPoll(intervalMs, enabled, read);
  return <Text>{data ? data.state.goal : 'no-data'}</Text>;
}

test('useShiftPoll polls via the injected read and renders data', async () => {
  const read = vi.fn(async () => ACTIVE_MODEL);
  const { lastFrame, unmount } = render(<Probe read={read} enabled />);
  await vi.waitFor(() => expect(lastFrame()).toContain('Ship auth refactor + green CI'));
  unmount();
});

test('unmount stops the poller — read is not called after unmount', async () => {
  const read = vi.fn(async () => ACTIVE_MODEL);
  // A long interval so only the immediate tick fires before we unmount; this
  // makes the "no read after unmount" assertion deterministic (no interval
  // tick races with the unmount).
  const { unmount } = render(<Probe read={read} enabled intervalMs={5000} />);
  await vi.waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(0));
  unmount();
  const callsAtUnmount = read.mock.calls.length;
  await new Promise((r) => setTimeout(r, 200));
  expect(read.mock.calls.length).toBe(callsAtUnmount);
});

test('disabled poller does not read', async () => {
  const read = vi.fn(async () => ACTIVE_MODEL);
  const { unmount } = render(<Probe read={read} enabled={false} />);
  await new Promise((r) => setTimeout(r, 120));
  expect(read.mock.calls.length).toBe(0);
  unmount();
});

test('toggling enabled false stops the poller — no further reads after the flip', async () => {
  const read = vi.fn(async () => ACTIVE_MODEL);
  // A short interval so an un-stopped poller WOULD keep reading after the flip.
  const r = render(<Probe read={read} enabled intervalMs={20} />);
  await vi.waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(0));

  // Flip enabled → false. The previous poller must be stopped (its interval
  // cleared), not merely orphaned by nulling the ref.
  r.rerender(<Probe read={read} enabled={false} intervalMs={20} />);
  const callsAtFlip = read.mock.calls.length;

  // Several interval periods elapse; a leaked interval would tick more reads.
  await new Promise((res) => setTimeout(res, 150));
  expect(read.mock.calls.length).toBe(callsAtFlip);
  r.unmount();
});

test('createPoller.stop clears the interval — no tick after stop', () => {
  vi.useFakeTimers();
  try {
    const read = vi.fn(async () => ACTIVE_MODEL);
    const poller = createPoller(read, 20, () => {});
    expect(read).toHaveBeenCalledTimes(1); // immediate tick
    poller.stop();
    vi.advanceTimersByTime(200); // 10 interval periods
    // A stopped poller fires no further reads (interval cleared).
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
