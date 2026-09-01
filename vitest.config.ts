import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Scenario tests drive the real hooks against a fake SSE stream and a real
// IndexedDB (fake-indexeddb), so they need a DOM and the `@/` alias the app uses.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
