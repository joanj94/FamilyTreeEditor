import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The app is a static SPA served from a GitHub Pages project page, so asset URLs must be
 * relative to the repository sub-path rather than to the domain root. `base: './'` keeps the
 * built bundle working both at `/FamilyTreeEditor/` and when opened from a local directory.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    globals: true,
    /* `node` is the default on purpose. `layout/` is a pure function from document to
       coordinates and must stay testable with no DOM at all. The handful of suites that
       genuinely need a DOM opt in per file with `// @vitest-environment jsdom`. */
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/**/*.test.{ts,tsx}'],
    },
  },
});
