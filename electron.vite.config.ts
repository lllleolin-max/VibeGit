import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const aliases = {
  '@vibegit/shared': resolve('packages/shared/src/index.ts'),
  '@vibegit/git-engine': resolve('packages/git-engine/src/index.ts'),
  '@vibegit/database': resolve('packages/database/src/index.ts'),
  '@vibegit/checkpoint-engine': resolve('packages/checkpoint-engine/src/index.ts'),
  '@vibegit/agent-events': resolve('packages/agent-events/src/index.ts'),
  '@vibegit/github-provider': resolve('packages/github-provider/src/index.ts'),
  '@vibegit/core': resolve('packages/core/src/index.ts')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: aliases },
    build: { rollupOptions: { input: resolve('apps/desktop/src/main/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        input: resolve('apps/desktop/src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs' }
      }
    }
  },
  renderer: {
    root: resolve('apps/desktop/src/renderer'),
    resolve: { alias: aliases },
    plugins: [react()],
    build: { rollupOptions: { input: resolve('apps/desktop/src/renderer/index.html') } }
  }
})
