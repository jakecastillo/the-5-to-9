import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { expect, test } from 'vitest';
import { StatusBar } from './StatusBar.tsx';
import { ACTIVE_SHIFT, GREEN_GATE, IDLE_SHIFT, RED_GATE } from './fixtures.ts';

function wide(node: React.ReactElement) {
  return render(<Box width={200}>{node}</Box>);
}

test('active shift + GREEN gate renders goal, branch, 4 / ∞, GREEN + 18 groups', () => {
  const { lastFrame, unmount } = wide(
    <StatusBar shift={ACTIVE_SHIFT} gate={GREEN_GATE} running={false} />,
  );
  const f = lastFrame() ?? '';
  expect(f).toContain('Ship auth refactor + green CI');
  expect(f).toContain('the-5-to-9/shift-20260617');
  expect(f).toContain('4 / ∞'); // uncapped → ∞
  expect(f).toContain('GREEN');
  expect(f).toContain('18 groups');
  unmount();
});

test('RED gate surfaces RED with a glyph + word (survives NO_COLOR)', () => {
  const { lastFrame, unmount } = wide(
    <StatusBar shift={ACTIVE_SHIFT} gate={RED_GATE} running={false} />,
  );
  const f = lastFrame() ?? '';
  expect(f).toContain('RED');
  // color is always paired with a word + glyph
  expect(f).toMatch(/[●○⏻◴]/);
  unmount();
});

test('no active shift → "no active shift"', () => {
  const { lastFrame, unmount } = wide(<StatusBar shift={IDLE_SHIFT} gate={null} running={false} />);
  expect(lastFrame()).toMatch(/no active shift/i);
  unmount();
});

test('capped maxIterations renders N / M (not ∞)', () => {
  const capped = { ...ACTIVE_SHIFT, maxIterations: '30', iteration: 4 };
  const { lastFrame, unmount } = wide(<StatusBar shift={capped} gate={null} running={false} />);
  expect(lastFrame()).toContain('4 / 30');
  unmount();
});
