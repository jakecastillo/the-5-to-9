import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/bin.ts'],
  format: ['esm'],
  clean: true,
  target: 'node20',
  // Bundle the workspace driver so the published CLI is self-contained.
  noExternal: ['@the-5-to-9/driver'],
});
