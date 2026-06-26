import { expect, test } from 'vitest';
import { fuzzyRank, nearestName } from './fuzzy.ts';

test('empty query returns all targets unchanged (palette shows everything)', () => {
  const names = ['run', 'status', 'clock-in'];
  expect(fuzzyRank('', names)).toEqual(names);
});

test('prefix match ranks above a mere substring match', () => {
  const ranked = fuzzyRank('st', ['fastest', 'status']);
  expect(ranked[0]).toBe('status'); // prefix beats substring
  expect(ranked).toContain('fastest');
});

test('non-matches are excluded', () => {
  // 'ru' is a subsequence of 'run' only — not of status/clock-in.
  expect(fuzzyRank('ru', ['run', 'status', 'clock-in'])).toEqual(['run']);
});

test('a shared prefix returns both, in input order on a tie', () => {
  expect(fuzzyRank('clock', ['clock-in', 'clock-out', 'run'])).toEqual(['clock-in', 'clock-out']);
});

test('subsequence (non-contiguous, in order) still matches', () => {
  // c-i appears in order inside clock-in
  expect(fuzzyRank('ci', ['clock-in', 'run'])).toEqual(['clock-in']);
});

test('nearestName finds the closest by edit distance (did-you-mean)', () => {
  expect(nearestName('rnu', ['run', 'status'])).toBe('run');
  expect(nearestName('stauts', ['run', 'status'])).toBe('status');
});

test('nearestName returns undefined when nothing is close enough', () => {
  expect(nearestName('zzzzzz', ['run', 'status'])).toBeUndefined();
});
