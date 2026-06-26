import { expect, test } from 'vitest';
import { matchesFilter } from './backlog-filter.ts';

const bead = { id: 't59-4a1', title: 'add token rotation', status: 'open' };

test('empty query matches everything', () => {
  expect(matchesFilter(bead, '')).toBe(true);
  expect(matchesFilter({ id: 'x', title: 'y', status: null }, '')).toBe(true);
});

test('matches on id substring (case-insensitive)', () => {
  expect(matchesFilter(bead, 't59')).toBe(true);
  expect(matchesFilter(bead, 'T59')).toBe(true);
  expect(matchesFilter(bead, '4a1')).toBe(true);
});

test('matches on title substring (case-insensitive)', () => {
  expect(matchesFilter(bead, 'add')).toBe(true);
  expect(matchesFilter(bead, 'token')).toBe(true);
  expect(matchesFilter(bead, 'ADD TOKEN')).toBe(true);
});

test('matches on status substring', () => {
  expect(matchesFilter(bead, 'open')).toBe(true);
  expect(matchesFilter(bead, 'OPEN')).toBe(true);
});

test('returns false when query matches nothing', () => {
  expect(matchesFilter(bead, 'zzz')).toBe(false);
  expect(matchesFilter(bead, 'closed')).toBe(false);
});

test('handles null status without crashing', () => {
  expect(matchesFilter({ id: 'a-1', title: 'something', status: null }, 'some')).toBe(true);
  expect(matchesFilter({ id: 'a-1', title: 'something', status: null }, 'open')).toBe(false);
});
