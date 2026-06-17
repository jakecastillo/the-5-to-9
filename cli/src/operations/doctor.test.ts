import { expect, test } from 'vitest';
import { doctor } from './doctor.ts';

test('doctor reports node, bd, and backend checks; ok gated on required checks', async () => {
  const report = await doctor({
    backend: 'claude',
    nodeVersion: 'v20.19.0',
    hasBd: true,
    hasBackend: true,
  });
  const names = report.checks.map((c) => c.name);
  expect(names).toContain('node');
  expect(names).toContain('bd');
  expect(names).toContain('backend');
  expect(report.checks.find((c) => c.name === 'node')?.ok).toBe(true);
  expect(report.ok).toBe(true);
});

test('doctor fails ok when node is below the floor', async () => {
  const report = await doctor({
    backend: 'claude',
    nodeVersion: 'v18.0.0',
    hasBd: true,
    hasBackend: true,
  });
  expect(report.checks.find((c) => c.name === 'node')?.ok).toBe(false);
  expect(report.ok).toBe(false);
});

test('doctor fails ok when the backend CLI is missing', async () => {
  const report = await doctor({
    backend: 'codex',
    nodeVersion: 'v20.19.0',
    hasBd: true,
    hasBackend: false,
  });
  expect(report.checks.find((c) => c.name === 'backend')?.ok).toBe(false);
  expect(report.ok).toBe(false);
});

test('doctor: missing bd is reported but does not fail ok (bd is optional)', async () => {
  const report = await doctor({
    backend: 'claude',
    nodeVersion: 'v20.19.0',
    hasBd: false,
    hasBackend: true,
  });
  expect(report.checks.find((c) => c.name === 'bd')?.ok).toBe(false);
  expect(report.ok).toBe(true);
});
