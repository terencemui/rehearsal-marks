import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The library catalog is the repo's `library/` directory: library.json at
  // the site root, label sets under /labelsets/. Audio is never in the repo —
  // it streams from the catalog's absolute audioUrl (R2 in production).
  publicDir: 'library',
  test: {
    // Globals let @testing-library/react auto-cleanup the DOM between tests.
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Stale worktrees under .claude/ hold old code with its own test files —
    // the default include glob would run them against the current node_modules.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/worktrees/**'],
  },
});
