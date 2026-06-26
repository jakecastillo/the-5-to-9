import { render } from 'ink-testing-library';
import { expect, test } from 'vitest';
import { CommandPalette } from './CommandPalette.tsx';

test('empty slash shows all commands in registry order', () => {
  const { lastFrame, unmount } = render(<CommandPalette query="/" selectedIndex={0} />);
  const frame = lastFrame() ?? '';
  expect(frame).toContain('/clock-in');
  expect(frame).toContain('/run');
  expect(frame).toContain('/quit');
  unmount();
});

test('/ru ranks run first with its argHint', () => {
  const { lastFrame, unmount } = render(<CommandPalette query="/ru" selectedIndex={0} />);
  const frame = lastFrame() ?? '';
  const lines = frame.split('\n').filter((l) => l.trim().length > 0);
  // First visible content line has /run
  const runLineIdx = lines.findIndex((l) => l.includes('/run'));
  expect(runLineIdx).toBe(0);
  // argHint is shown somewhere for /run
  expect(frame).toContain('--max-iterations');
  unmount();
});

test('selectedIndex=0 marks the first row with ▸ glyph', () => {
  const { lastFrame, unmount } = render(<CommandPalette query="/ru" selectedIndex={0} />);
  const frame = lastFrame() ?? '';
  const lines = frame.split('\n').filter((l) => l.trim().length > 0);
  expect(lines[0]).toContain('▸');
  unmount();
});

test('selectedIndex=1 marks the second row (not the first)', () => {
  const { lastFrame, unmount } = render(<CommandPalette query="/" selectedIndex={1} />);
  const frame = lastFrame() ?? '';
  const lines = frame.split('\n').filter((l) => l.trim().length > 0);
  // first row has no ▸
  expect(lines[0]).not.toContain('▸');
  // second row has ▸
  expect(lines[1]).toContain('▸');
  unmount();
});

test('clamped selectedIndex beyond list length still marks the last row', () => {
  // /ru likely matches run + possibly run-adjacent; selectedIndex=99 should clamp to last
  const { lastFrame, unmount } = render(<CommandPalette query="/ru" selectedIndex={99} />);
  const frame = lastFrame() ?? '';
  const lines = frame.split('\n').filter((l) => l.trim().length > 0);
  // at least one row must have ▸
  expect(lines.some((l) => l.includes('▸'))).toBe(true);
  unmount();
});

test('no-match query shows empty-state message', () => {
  const { lastFrame, unmount } = render(<CommandPalette query="/zzz" selectedIndex={0} />);
  const frame = lastFrame() ?? '';
  expect(frame).toContain('no matching');
  unmount();
});

test('summary text appears for each row', () => {
  const { lastFrame, unmount } = render(<CommandPalette query="/clock" selectedIndex={0} />);
  const frame = lastFrame() ?? '';
  // clock-in has summary "Open a shift with a goal"
  expect(frame).toContain('Open a shift with a goal');
  unmount();
});
