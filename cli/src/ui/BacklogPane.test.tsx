import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { expect, test, vi } from 'vitest';
import { BacklogPane } from './BacklogPane.tsx';
import { ACTIVE_MODEL } from './fixtures.ts';
import { initialState } from './types.ts';

const delay = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function wide(node: React.ReactElement) {
  return render(<Box width={120}>{node}</Box>);
}

test('BacklogPane renders without a scrollOffset prop (dead state removed)', () => {
  // No `scrollOffset` is passed — the Ink flex layout auto-flows the sections.
  const { lastFrame, unmount } = wide(
    <BacklogPane
      model={ACTIVE_MODEL}
      isActive
      selectedId="t59-4a1"
      filter=""
      onSelect={() => {}}
    />,
  );
  const f = lastFrame() ?? '';
  expect(f).toContain('t59-4a1');
  expect(f).toMatch(/READY/);
  unmount();
});

test('AppState no longer carries the dead scrollOffset field', () => {
  expect('scrollOffset' in initialState()).toBe(false);
});

test('renders READY / IN-PROGRESS / BLOCKED sections, bead ids, and a progress bar', () => {
  const { lastFrame, unmount } = wide(
    <BacklogPane
      model={ACTIVE_MODEL}
      isActive
      selectedId="t59-4a1"
      filter=""
      onSelect={() => {}}
    />,
  );
  const f = lastFrame() ?? '';
  expect(f).toMatch(/READY/);
  expect(f).toMatch(/IN.PROGRESS/i);
  expect(f).toMatch(/BLOCKED/);
  expect(f).toContain('t59-4a1');
  expect(f).toContain('t59-7e0');
  // progress bar text: closed 7/11 (63%)
  expect(f).toMatch(/7\/11/);
  expect(f).toMatch(/63%/);
  unmount();
});

test('down-arrow moves selection → onSelect fires with the next id', async () => {
  const onSelect = vi.fn();
  const { stdin, unmount } = wide(
    <BacklogPane
      model={ACTIVE_MODEL}
      isActive
      selectedId="t59-4a1"
      filter=""
      onSelect={onSelect}
    />,
  );
  await delay();
  stdin.write('\x1B[B'); // down
  await delay();
  expect(onSelect).toHaveBeenCalled();
  // The next id in the flattened ready→inprogress→blocked order after t59-4a1.
  expect(onSelect).toHaveBeenCalledWith('t59-9c2');
  unmount();
});

test('selection is preserved across a poll (rerender with same ids keeps highlight)', () => {
  const r = wide(
    <BacklogPane
      model={ACTIVE_MODEL}
      isActive
      selectedId="t59-9c2"
      filter=""
      onSelect={() => {}}
    />,
  );
  const before = r.lastFrame();
  // A new model object with the SAME ids (a background poll tick).
  r.rerender(
    <Box width={120}>
      <BacklogPane
        model={{ ...ACTIVE_MODEL }}
        isActive
        selectedId="t59-9c2"
        filter=""
        onSelect={() => {}}
      />
    </Box>,
  );
  expect(r.lastFrame()).toBe(before);
  expect(r.lastFrame()).toContain('t59-9c2');
  r.unmount();
});

test('filter="ready" renders only the READY section', () => {
  const { lastFrame, unmount } = wide(
    <BacklogPane
      model={ACTIVE_MODEL}
      isActive
      selectedId={null}
      filter="rotation"
      onSelect={() => {}}
    />,
  );
  const f = lastFrame() ?? '';
  // 'rotation' matches only the ready bead "add token rotation".
  expect(f).toContain('t59-4a1');
  expect(f).not.toContain('t59-7e0'); // blocked bead filtered out
  expect(f).not.toContain('t59-3b2'); // in-progress bead filtered out
  unmount();
});
