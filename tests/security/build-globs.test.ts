import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

it('keeps build globs working and treats complex single-branch repetitions as literals', () => {
  const require = createRequire(import.meta.url)
  const fromVite = createRequire(require.resolve('vite/package.json'))
  const { isMatch } = fromVite('picomatch') as { isMatch: (path: string, pattern: string) => boolean }
  expect(isMatch('src/main.ts', 'src/**/*.ts')).toBe(true)
  expect(isMatch('abab', '+(ab)')).toBe(true)
  expect(isMatch('123', '+([0-9])')).toBe(true)
  expect(isMatch('src-main', '+(src-*)')).toBe(false)
  expect(isMatch('+(src-*)', '+(src-*)')).toBe(true)
})
