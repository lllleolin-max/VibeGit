import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { GitEngine } from '@vibegit/git-engine'

describe('bounded checkpoint diffs', () => {
  it('limits actual patch commands while preserving full file and line totals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-diff-limit-'))
    const git = new GitEngine()
    try {
      await git.initialize(root)
      const paths = Array.from({ length: 12 }, (_, index) => `file-${String(index).padStart(2, '0')}.txt`)
      for (const path of paths) await writeFile(join(root, path), 'before\n')
      const before = await git.captureWorktreeTree(root)
      for (const path of paths) await writeFile(join(root, path), 'after\nsecond line\n')
      const after = await git.captureWorktreeTree(root)
      const run = vi.spyOn(git.runner, 'run')

      const result = await git.getDiff(root, before.treeObjectId, after.treeObjectId, { maxFiles: 2, maxPatchCharacters: 10_000 })

      expect(result).toMatchObject({ totalFiles: 12, truncated: true, insertions: 24, deletions: 12 })
      expect(result.files.map((file) => file.path)).toEqual(paths.slice(0, 2))
      expect(result.files.every((file) => file.patch.includes('+after') && file.patchTruncated === false)).toBe(true)
      expect(run.mock.calls.filter(([, args]) => args.includes('--unified=3'))).toHaveLength(2)

      run.mockClear()
      const summaryOnly = await git.getDiff(root, before.treeObjectId, after.treeObjectId, { maxFiles: 0 })
      expect(summaryOnly).toMatchObject({ files: [], totalFiles: 12, truncated: true, insertions: 24, deletions: 12 })
      expect(run.mock.calls.filter(([, args]) => args.includes('--unified=3'))).toHaveLength(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('stops generating patches at the shared character budget and distinguishes binary files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-diff-budget-'))
    const git = new GitEngine()
    try {
      await git.initialize(root)
      await writeFile(join(root, '00-binary.bin'), Buffer.from([0, 1, 2]))
      for (const name of ['01-large.txt', '02-next.txt', '03-last.txt']) {
        await writeFile(join(root, name), `${name}: ${'字'.repeat(20_000)}\n`)
      }
      const after = await git.captureWorktreeTree(root)
      const run = vi.spyOn(git.runner, 'run')

      const result = await git.getDiff(root, undefined, after.treeObjectId, { maxFiles: 4, maxPatchCharacters: 37 })

      expect(result).toMatchObject({ totalFiles: 4, truncated: true, insertions: 3, deletions: 0 })
      expect(result.files[0]).toMatchObject({ binary: true, patch: '', patchTruncated: false })
      expect(result.files[1]?.patch).toHaveLength(37)
      expect(result.files.slice(1).every((file) => file.patchTruncated)).toBe(true)
      expect(result.files.slice(2).every((file) => file.patch === '')).toBe(true)
      expect(result.files.reduce((sum, file) => sum + file.patch.length, 0)).toBe(37)
      expect(run.mock.calls.filter(([, args]) => args.includes('--unified=3'))).toHaveLength(1)

      run.mockClear()
      const zeroBudget = await git.getDiff(root, undefined, after.treeObjectId, { maxPatchCharacters: 0 })
      expect(zeroBudget.files).toHaveLength(4)
      expect(zeroBudget.files.every((file) => file.patch === '')).toBe(true)
      expect(run.mock.calls.filter(([, args]) => args.includes('--unified=3'))).toHaveLength(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid limits (%s) before invoking Git', async (limit) => {
    const git = new GitEngine()
    const run = vi.spyOn(git.runner, 'run')
    await expect(git.getDiff(process.cwd(), undefined, 'unused', { maxFiles: limit }))
      .rejects.toMatchObject({ code: 'INVALID_DIFF_LIMIT' })
    await expect(git.getDiff(process.cwd(), undefined, 'unused', { maxPatchCharacters: limit }))
      .rejects.toMatchObject({ code: 'INVALID_DIFF_LIMIT' })
    expect(run).not.toHaveBeenCalled()
  })
})
