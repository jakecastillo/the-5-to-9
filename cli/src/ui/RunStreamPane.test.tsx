import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { expect, test, vi } from 'vitest';
import { RunStreamPane } from './RunStreamPane.tsx';

const delay = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function wide(node: React.ReactElement) {
  return render(<Box width={120}>{node}</Box>);
}

// ---------------------------------------------------------------------------
// Legacy tests — adapted for the windowed render API
// (viewportHeight default 50 keeps all small fixtures fully visible)
// ---------------------------------------------------------------------------

test('renders all provided completed lines (small set, large viewport)', () => {
  const lines = ['l1', 'l2', 'l3'];
  const { lastFrame, unmount } = wide(
    <RunStreamPane
      lines={lines}
      liveLine=""
      follow
      isActive
      running={false}
      viewportHeight={50}
      scroll={0}
    />,
  );
  const f = lastFrame() ?? '';
  for (const l of lines) expect(f).toContain(l);
  unmount();
});

test('windowed render: each visible line appears exactly once per frame', () => {
  const r = wide(
    <RunStreamPane
      lines={['a', 'b']}
      liveLine=""
      follow
      isActive
      running={false}
      viewportHeight={50}
      scroll={0}
    />,
  );
  r.rerender(
    <Box width={120}>
      <RunStreamPane
        lines={['a', 'b', 'c', 'd']}
        liveLine=""
        follow
        isActive
        running={false}
        viewportHeight={50}
        scroll={0}
      />
    </Box>,
  );
  for (const frame of r.frames) {
    const standaloneA = (frame.match(/(^|\n)a(?=\n|$)/g) ?? []).length;
    expect(standaloneA).toBeLessThanOrEqual(1);
  }
  // The latest frame shows every visible line exactly once.
  const last = r.lastFrame() ?? '';
  for (const l of ['a', 'b', 'c', 'd']) {
    expect((last.match(new RegExp(`(^|\\n)${l}(?=\\n|$)`, 'g')) ?? []).length).toBe(1);
  }
  r.unmount();
});

test('the live tail line + spinner render below the history when running', () => {
  const { lastFrame, unmount } = wide(
    <RunStreamPane
      lines={['done line']}
      liveLine="Dealer working t59-9c2 …"
      follow
      isActive
      running
      viewportHeight={50}
      scroll={0}
    />,
  );
  const f = lastFrame() ?? '';
  expect(f).toContain('Dealer working t59-9c2');
  unmount();
});

// ---------------------------------------------------------------------------
// Bead 200.9: windowed render — scroll=0 shows the TAIL, not the whole buffer
// ---------------------------------------------------------------------------

const FIFTY = Array.from({ length: 50 }, (_, i) => `line-${i}`);

test('scroll=0 with viewportHeight=5: shows last 5 lines only', () => {
  const { lastFrame, unmount } = wide(
    <RunStreamPane
      lines={FIFTY}
      liveLine=""
      follow
      isActive
      running={false}
      viewportHeight={5}
      scroll={0}
    />,
  );
  const f = lastFrame() ?? '';
  // Last 5 lines must be visible
  expect(f).toContain('line-49');
  expect(f).toContain('line-48');
  expect(f).toContain('line-47');
  expect(f).toContain('line-46');
  expect(f).toContain('line-45');
  // Lines well outside the window must NOT be visible
  expect(f).not.toContain('line-0');
  expect(f).not.toContain('line-1');
  unmount();
});

test('scroll=5 with viewportHeight=5: shows window 5 lines above the tail', () => {
  const { lastFrame, unmount } = wide(
    <RunStreamPane
      lines={FIFTY}
      liveLine=""
      follow={false}
      isActive
      running={false}
      viewportHeight={5}
      scroll={5}
    />,
  );
  const f = lastFrame() ?? '';
  // Window ending at lines[50-5=45): lines 40–44
  expect(f).toContain('line-44');
  expect(f).toContain('line-43');
  expect(f).toContain('line-42');
  expect(f).toContain('line-41');
  expect(f).toContain('line-40');
  // The tail and lines outside the window are NOT visible
  expect(f).not.toContain('line-49');
  expect(f).not.toContain('line-39');
  unmount();
});

test('scroll=0 + 50 lines + viewportHeight=5: shows "↑ older" indicator (45 older above)', () => {
  const { lastFrame, unmount } = wide(
    <RunStreamPane
      lines={FIFTY}
      liveLine=""
      follow
      isActive
      running={false}
      viewportHeight={5}
      scroll={0}
    />,
  );
  const f = lastFrame() ?? '';
  // 50 - 5 - 0 = 45 lines above the viewport
  expect(f).toMatch(/↑.*older/);
  unmount();
});

test('scroll=5: shows both "↑ older" and "↓ newer" indicators', () => {
  const { lastFrame, unmount } = wide(
    <RunStreamPane
      lines={FIFTY}
      liveLine=""
      follow={false}
      isActive
      running={false}
      viewportHeight={5}
      scroll={5}
    />,
  );
  const f = lastFrame() ?? '';
  expect(f).toMatch(/↑.*older/); // lines above
  expect(f).toMatch(/↓.*newer/); // lines below (scroll amount)
  unmount();
});

test('all lines fit in viewport: no "older" indicator shown', () => {
  const { lastFrame, unmount } = wide(
    <RunStreamPane
      lines={['a', 'b', 'c']}
      liveLine=""
      follow
      isActive
      running={false}
      viewportHeight={20}
      scroll={0}
    />,
  );
  const f = lastFrame() ?? '';
  expect(f).not.toMatch(/older/);
  expect(f).not.toMatch(/newer/);
  unmount();
});
