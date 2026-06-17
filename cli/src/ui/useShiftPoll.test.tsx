import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { expect, test, vi } from 'vitest';
import type { DashboardModel } from '../operations/dashboard-model.ts';
import { ACTIVE_MODEL } from './fixtures.ts';
import { useShiftPoll } from './useShiftPoll.ts';

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
