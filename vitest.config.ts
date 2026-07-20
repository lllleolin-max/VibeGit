import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@vibegit/shared': resolve('packages/shared/src/index.ts'),
      '@vibegit/git-engine': resolve('packages/git-engine/src/index.ts'),
      '@vibegit/database': resolve('packages/database/src/index.ts'),
      '@vibegit/checkpoint-engine': resolve('packages/checkpoint-engine/src/index.ts'),
      '@vibegit/agent-events': resolve('packages/agent-events/src/index.ts'),
      '@vibegit/github-provider': resolve('packages/github-provider/src/index.ts'),
      '@vibegit/core': resolve('packages/core/src/index.ts')
    }
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    // Several safety tests deliberately vary inherited process environment
    // variables and open the same SQLite runtime. Keep files deterministic and
    // isolate those global-process probes from one another.
    fileParallelism: false,
    maxWorkers: 1,
    setupFiles: ['tests/setup.ts'],
    coverage: { reporter: ['text', 'html'] }
  }
})
