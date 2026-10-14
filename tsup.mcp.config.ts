import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['apps/mcp/src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist/mcp',
  clean: true,
  splitting: false,
  metafile: true,
  noExternal: [/.*/],
  // Bundled CommonJS dependencies may require Node builtins at runtime.
  banner: { js: "import { createRequire as __vibegitCreateRequire } from 'node:module'; const require = __vibegitCreateRequire(import.meta.url);" }
})
