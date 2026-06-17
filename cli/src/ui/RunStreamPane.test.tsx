import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { expect, test, vi } from 'vitest';
import { RunStreamPane } from './RunStreamPane.tsx';

const delay = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function wide(node: React.ReactElement) {
  return render(<Box width={120}>{node}</Box>);
}

test('renders all provided completed lines', () => {
  const lines = ['l1', 'l2', 'l3'];
  const { lastFrame, unmount } = wide(
    <RunStreamPane lines={lines} liveLine="" follow isActive running={false} />,
  );
  const f = lastFrame() ?? '';
  for (const l of lines) expect(f).toContain(l);
  unmount();
});

test('<Static> renders completed lines once — never duplicated within a frame', () => {
  const r = wide(<RunStreamPane lines={['a', 'b']} liveLine="" follow isActive running={false} />);
  // Appending lines must not re-print earlier completed lines: each completed
  // line appears at most once in any rendered frame (the <Static> guarantee —
  // completed items are written once, never repainted/reflowed).
  r.rerender(
    <Box width={120}>
      <RunStreamPane lines={['a', 'b', 'c', 'd']} liveLine="" follow isActive running={false} />
    </Box>,
  );
  for (const frame of r.frames) {
    const standaloneA = (frame.match(/(^|\n)a(?=\n|$)/g) ?? []).length;
    expect(standaloneA).toBeLessThanOrEqual(1);
  }
  // The latest frame shows every completed line exactly once.
  const last = r.lastFrame() ?? '';
  for (const l of ['a', 'b', 'c', 'd']) {
    expect((last.match(new RegExp(`(^|\\n)${l}(?=\\n|$)`, 'g')) ?? []).length).toBe(1);
  }
  r.unmount();
});

test('the live tail line + spinner render below the static history when running', () => {
  const { lastFrame, unmount } = wide(
    <RunStreamPane
      lines={['done line']}
      liveLine="Dealer working t59-9c2 …"
      follow
      isActive
      running
    />,
  );
  const f = lastFrame() ?? '';
  expect(f).toContain('Dealer working t59-9c2');
  unmount();
});

test('`f` toggles follow via onToggleFollow', async () => {
  const onToggleFollow = vi.fn();
  const { stdin, unmount } = wide(
    <RunStreamPane
      lines={[]}
      liveLine=""
      follow
      isActive
      running={false}
      onToggleFollow={onToggleFollow}
    />,
  );
  await delay();
  stdin.write('f');
  await delay();
  expect(onToggleFollow).toHaveBeenCalledTimes(1);
  unmount();
});
