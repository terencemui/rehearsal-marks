import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // No publicDir override: the app ships no static assets. The `library/`
  // catalog this once pointed at was deleted with the rest of the Library
  // (ADR-0002).
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
