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

test('doctor: no-backend detail does not reference the dead CLI subcommand', async () => {
  // Bug gzi: "set one with `the-5-to-9 config set backend …`" was a dead
  // reference after the commander surface was removed. The hint must point to
  // the surviving ways to set a backend (env var or TUI command).
  const report = await doctor({ nodeVersion: 'v20.19.0', hasBd: true, hasBackend: true });
  const detail = report.checks.find((c) => c.name === 'backend')?.detail ?? '';
  // Must NOT contain the dead CLI form.
  expect(detail).not.toMatch(/the-5-to-9 config set/);
  // Must mention the env var or the TUI form.
  expect(detail).toMatch(/FIVE_TO_NINE_BACKEND|\/config set/i);
});
