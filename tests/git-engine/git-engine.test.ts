import { mkdtemp, mkdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { GitCommandRunner, GitEngine } from '@vibegit/git-engine'
import { VibeGitError } from '@vibegit/shared'

describe('GitEngine', () => {
  it.skipIf(process.platform !== 'win32').each(['timeout', 'output limit'] as const)('stops Windows descendants holding Git pipes after %s', async (reason) => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-process-tree-'))
    const pidPath = join(root, 'descendant.pid')
    const scriptPath = join(root, 'git-wrapper.cjs')
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
    let descendantPid: number | undefined
    try {
      await writeFile(scriptPath, [
        "const { spawn } = require('node:child_process');",
        "const { writeFileSync } = require('node:fs');",
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 1, 2], windowsHide: true });",
        `writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
        reason === 'output limit' ? "setTimeout(() => process.stdout.write('x'.repeat(8192)), 300);" : '',
        'setInterval(() => {}, 1000);'
      ].join('\n'))
      const runner = new GitCommandRunner({ executable: process.execPath, timeoutMs: reason === 'timeout' ? 1500 : 10_000 })
      const startedAt = Date.now()
      await expect(runner.run(root, [scriptPath], { maxOutputBytes: 1024 })).rejects.toMatchObject({
        code: reason === 'timeout' ? 'GIT_COMMAND_TIMEOUT' : 'GIT_OUTPUT_TOO_LARGE'
      })
      expect(Date.now() - startedAt).toBeLessThan(8000)
      descendantPid = Number(await readFile(pidPath, 'utf8'))
      expect(() => process.kill(descendantPid!, 0)).toThrow()
      expect(() => process.kill(unrelated.pid!, 0)).not.toThrow()
    } finally {
      unrelated.kill()
      descendantPid ??= Number(await readFile(pidPath, 'utf8').catch(() => '0'))
      if (descendantPid) {
        try { process.kill(descendantPid) } catch { /* Already terminated by the runner. */ }
      }
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  }, 12_000)

  it.each(['running', 'exited'] as const)('bounds cleanup when a %s child never closes without killing a reused PID', async (state) => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-failed-cleanup-'))
    const child = Object.assign(new EventEmitter(), {
      pid: 987654,
      exitCode: state === 'exited' ? 0 : null,
      signalCode: null,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => false),
      unref: vi.fn()
    })
    const spawnMock = vi.spyOn(childProcess, 'spawn').mockImplementation(() => child as unknown as childProcess.ChildProcess)
    syncBuiltinESMExports()
    try {
      // Model an OS cleanup failure without leaving a real orphan on the host.
      const runner = new GitCommandRunner({ timeoutMs: 25 })
      const startedAt = Date.now()
      await expect(runner.run(root, ['status'])).rejects.toMatchObject({
        code: 'GIT_COMMAND_TIMEOUT',
        message: expect.stringContaining('无法确认子进程已全部退出')
      })
      expect(Date.now() - startedAt).toBeLessThan(8000)
      expect(child.stdout.destroyed).toBe(true)
      expect(child.stderr.destroyed).toBe(true)
      if (state === 'exited') {
        expect(spawnMock).toHaveBeenCalledTimes(1)
        expect(child.kill).not.toHaveBeenCalled()
      }
    } finally {
      spawnMock.mockRestore()
      syncBuiltinESMExports()
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  }, 12_000)

  it('limits file diffs to literal paths and preserves rename patches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-diff-paths-'))
    const git = new GitEngine()
    try {
      await git.initialize(root)
      await writeFile(join(root, '[id].txt'), 'route before\n')
      await writeFile(join(root, 'i.txt'), 'unrelated before\n')
      await writeFile(join(root, 'old.txt'), 'rename this content\n')
      const before = await git.captureWorktreeTree(root)
      await writeFile(join(root, '[id].txt'), 'route after\n')
      await writeFile(join(root, 'i.txt'), 'unrelated after\n')
      await rename(join(root, 'old.txt'), join(root, 'new.txt'))
      const after = await git.captureWorktreeTree(root)
      const diff = await git.getDiff(root, before.treeObjectId, after.treeObjectId)
      const route = diff.files.find((file) => file.path === '[id].txt')
      expect(route?.patch).toContain('+route after')
      expect(route?.patch).not.toContain('unrelated')
      const renamed = diff.files.find((file) => file.path === 'new.txt')
      expect(renamed).toMatchObject({ kind: 'renamed', previousPath: 'old.txt' })
      expect(renamed?.patch).toContain('rename from old.txt')
      expect(renamed?.patch).not.toContain('new file mode')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('initializes an empty directory and captures non-ignored Unicode files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-git-'))
    const project = join(root, '含 空格 项目')
    await mkdir(join(project, 'dist'), { recursive: true })
    await writeFile(join(project, '.gitignore'), 'dist/\n', 'utf8')
    await writeFile(join(project, '你好 世界.txt'), '你好\n', 'utf8')
    await writeFile(join(project, 'dist', 'bundle.js'), 'generated', 'utf8')
    const git = new GitEngine()

    expect(await git.isRepository(project)).toBe(false)
    await git.initialize(project)
    const captured = await git.captureWorktreeTree(project)
    const paths = (await git.listTree(project, captured.treeObjectId)).map((entry) => entry.path)
    expect(paths).toContain('你好 世界.txt')
    expect(paths).toContain('.gitignore')
    expect(paths).not.toContain('dist/bundle.js')
    expect((await git.getStatus(project)).hasHead).toBe(false)
    await rm(root, { recursive: true, force: true })
  })

  it('captures the working copy without changing HEAD or the real index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-git-'))
    const git = new GitEngine()
    await git.initialize(root)
    await writeFile(join(root, 'app.txt'), 'base\n', 'utf8')
    await git.runner.run(root, ['add', '--', 'app.txt'])
    await git.runner.run(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base'])
    const headBefore = (await git.runner.run(root, ['rev-parse', 'HEAD'])).stdout.trim()
    await writeFile(join(root, 'app.txt'), 'staged\n', 'utf8')
    await git.runner.run(root, ['add', '--', 'app.txt'])
    const indexBefore = (await git.runner.run(root, ['write-tree'])).stdout.trim()
    await writeFile(join(root, 'app.txt'), 'working\n', 'utf8')
    const realIndexBytes = await readFile(join(root, '.git', 'index'))

    const captured = await git.captureWorktreeTree(root)
    expect(await readFile(join(root, '.git', 'index'))).toEqual(realIndexBytes)
    const entry = (await git.listTree(root, captured.treeObjectId)).find((item) => item.path === 'app.txt')
    expect(entry).toBeDefined()
    expect((await git.readBlob(root, entry!.objectId)).toString('utf8')).toBe('working\n')
    expect((await git.runner.run(root, ['write-tree'])).stdout.trim()).toBe(indexBefore)
    expect((await git.runner.run(root, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(headBefore)
    expect(await readFile(join(root, 'app.txt'), 'utf8')).toBe('working\n')
    await rm(root, { recursive: true, force: true })
  })

  it.each([false, true])('reuses tracked stat data with split index %s while capturing hidden worktree edits', async (splitIndex) => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-index-cache-'))
    const project = join(root, 'project')
    const filterScript = join(root, 'clean.cjs')
    const filterLog = join(root, 'clean.log')
    const git = new GitEngine()
    try {
      await git.initialize(project)
      await writeFile(filterScript, [
        "const fs = require('node:fs');",
        `fs.appendFileSync(${JSON.stringify(filterLog)}, process.argv[2] + '\\n');`,
        'process.stdout.write(fs.readFileSync(0));'
      ].join('\n'))
      const filterCommand = `"${process.execPath.replaceAll('\\', '/')}" "${filterScript.replaceAll('\\', '/')}" %f`
      await git.runner.run(project, ['config', 'filter.audit.clean', filterCommand])
      await writeFile(join(project, '.gitattributes'), '*.txt filter=audit\n')
      for (const name of ['unchanged.txt', 'assumed.txt', 'skipped.txt']) {
        await writeFile(join(project, name), `original ${name}\n`)
        const beforeIndex = new Date(Date.now() - 10_000)
        await utimes(join(project, name), beforeIndex, beforeIndex)
      }
      await git.runner.run(project, ['add', '.'])
      await git.runner.run(project, ['update-index', '--assume-unchanged', 'assumed.txt'])
      await git.runner.run(project, ['update-index', '--skip-worktree', 'skipped.txt'])
      if (splitIndex) {
        await git.runner.run(project, ['config', 'core.splitIndex', 'true'])
        await git.runner.run(project, ['update-index', '--split-index'])
      }
      await writeFile(join(project, 'assumed.txt'), 'modified despite assume-unchanged\n')
      await writeFile(join(project, 'skipped.txt'), 'modified despite skip-worktree\n')
      const indexBefore = await readFile(join(project, '.git', 'index'))
      await writeFile(filterLog, '')

      const captured = await git.captureWorktreeTree(project)
      const entries = await git.listTree(project, captured.treeObjectId)
      for (const [name, expected] of [
        ['unchanged.txt', 'original unchanged.txt\n'],
        ['assumed.txt', 'modified despite assume-unchanged\n'],
        ['skipped.txt', 'modified despite skip-worktree\n']
      ]) {
        const entry = entries.find((item) => item.path === name)!
        expect((await git.readBlob(project, entry.objectId)).toString()).toBe(expected)
      }
      // Git may run the clean filter more than once for a changed file. Assert
      // which files enter the pipeline: the untouched file must never be read,
      // while both hidden edits must be captured. Rebuilding through read-tree
      // would also rehash unchanged.txt and fail this assertion.
      const filteredPaths = (await readFile(filterLog, 'utf8')).trim().split('\n')
      expect([...new Set(filteredPaths)].sort()).toEqual(['assumed.txt', 'skipped.txt'])
      expect(await readFile(join(project, '.git', 'index'))).toEqual(indexBefore)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails safely on unresolved conflicts without staging markers or changing the real index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-unmerged-index-'))
    const git = new GitEngine()
    try {
      await git.initialize(root)
      const objectId = (await git.runner.run(root, ['hash-object', '-w', '--stdin'], { stdin: 'base\n' })).stdout.trim()
      await git.runner.run(root, ['update-index', '--index-info'], {
        stdin: [1, 2, 3].map((stage) => `100644 ${objectId} ${stage}\tconflict.txt\n`).join('')
      })
      await writeFile(join(root, 'conflict.txt'), '<<<<<<< ours\n=======\n>>>>>>> theirs\n')
      const indexBefore = await readFile(join(root, '.git', 'index'))
      await expect(git.captureWorktreeTree(root)).rejects.toMatchObject({ code: 'GIT_COMMAND_FAILED' })
      expect(await readFile(join(root, '.git', 'index'))).toEqual(indexBefore)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not hide same-size edits with a racy index timestamp', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-racy-index-'))
    const git = new GitEngine()
    try {
      await git.initialize(root)
      await git.runner.run(root, ['config', 'core.trustctime', 'false'])
      const path = join(root, 'racy.txt')
      const timestamp = new Date(Date.now() - 10_000)
      await writeFile(path, 'before\n')
      await utimes(path, timestamp, timestamp)
      await git.runner.run(root, ['add', '--', 'racy.txt'])
      await utimes(join(root, '.git', 'index'), timestamp, timestamp)
      await writeFile(path, 'after \n')
      await utimes(path, timestamp, timestamp)

      const captured = await git.captureWorktreeTree(root)
      const entry = (await git.listTree(root, captured.treeObjectId)).find((item) => item.path === 'racy.txt')!
      expect((await git.readBlob(root, entry.objectId)).toString()).toBe('after \n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('handles a command closing stdin early without an unhandled stream error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-stdin-close-'))
    try {
      const runner = new GitCommandRunner({ executable: process.execPath })
      await expect(runner.run(root, ['-e', 'process.exit(1)'], { stdin: Buffer.alloc(8 * 1024 * 1024) }))
        .rejects.toMatchObject({ code: 'GIT_COMMAND_FAILED' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('captures and compares a many-file working copy without losing paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-git-'))
    const git = new GitEngine()
    await git.initialize(root)
    await Promise.all(Array.from({ length: 120 }, async (_, index) => {
      const directory = join(root, '批量文件', `组 ${index % 8}`)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, `文件 ${index}.txt`), `before ${index}\n`, 'utf8')
    }))
    const before = await git.captureWorktreeTree(root)

    await Promise.all(Array.from({ length: 120 }, async (_, index) => {
      const path = join(root, '批量文件', `组 ${index % 8}`, `文件 ${index}.txt`)
      await writeFile(path, `after ${index}\n`, 'utf8')
    }))
    const after = await git.captureWorktreeTree(root)
    const changes = await git.summarizeDiff(root, before.treeObjectId, after.treeObjectId)

    expect((await git.listTree(root, after.treeObjectId)).filter((entry) => entry.type === 'blob')).toHaveLength(120)
    expect(changes).toHaveLength(120)
    expect(changes.every((entry) => entry.kind === 'modified')).toBe(true)
    await rm(root, { recursive: true, force: true })
  })

  it('blocks destructive commands and reports missing/timeout executables structurally', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-git-'))
    const runner = new GitCommandRunner()
    await expect(runner.run(root, ['reset', '--hard'])).rejects.toMatchObject({ code: 'DANGEROUS_GIT_COMMAND' })
    await expect(runner.run(root, ['clean', '-fd'])).rejects.toMatchObject({ code: 'DANGEROUS_GIT_COMMAND' })
    await expect(runner.run(root, ['push', '--force', 'origin', 'main'])).rejects.toMatchObject({ code: 'DANGEROUS_GIT_COMMAND' })
    await expect(runner.run(root, ['-c', 'core.quotepath=false', 'reset', '--hard'])).rejects.toMatchObject({ code: 'DANGEROUS_GIT_COMMAND' })
    await expect(runner.run(root, ['push', 'origin', '+main:main'])).rejects.toMatchObject({ code: 'DANGEROUS_GIT_COMMAND' })

    const missing = new GitCommandRunner({ executable: join(root, 'does-not-exist.exe') })
    await expect(missing.run(root, ['--version'])).rejects.toMatchObject({ code: 'GIT_NOT_AVAILABLE' })

    const timeout = new GitCommandRunner({ executable: process.execPath, timeoutMs: 50 })
    await expect(timeout.run(root, ['-e', 'setTimeout(() => {}, 10000)'])).rejects.toSatisfy((error: unknown) =>
      error instanceof VibeGitError && error.code === 'GIT_COMMAND_TIMEOUT'
    )
    await rm(root, { recursive: true, force: true })
  })

  it('does not inherit Git directory or index overrides from the app environment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-env-root-'))
    const other = await mkdtemp(join(tmpdir(), 'vibegit-env-other-'))
    const git = new GitEngine()
    await git.initialize(root)
    await git.initialize(other)
    const originalGitDir = process.env.GIT_DIR
    const originalIndex = process.env.GIT_INDEX_FILE
    process.env.GIT_DIR = join(other, '.git')
    process.env.GIT_INDEX_FILE = join(other, '.git', 'index')
    try {
      expect(await git.getRepositoryRoot(root)).toBe(root)
      await writeFile(join(root, 'local.txt'), 'kept in root\n', 'utf8')
      const captured = await git.captureWorktreeTree(root)
      expect((await git.listTree(root, captured.treeObjectId)).map((entry) => entry.path)).toContain('local.txt')
    } finally {
      if (originalGitDir === undefined) delete process.env.GIT_DIR
      else process.env.GIT_DIR = originalGitDir
      if (originalIndex === undefined) delete process.env.GIT_INDEX_FILE
      else process.env.GIT_INDEX_FILE = originalIndex
      await rm(root, { recursive: true, force: true })
      await rm(other, { recursive: true, force: true })
    }
  })

  it('uses an explicit SSH command only for a trusted SSH backup transport', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-ssh-transport-'))
    const bareRemote = join(root, 'remote.git')
    const remoteUrl = 'ssh://git@ssh.github.com:443/test-user/backup.git'
    const sshCommand = 'ssh -i "C:/VibeGit/ssh/key" -o IdentitiesOnly=yes -o BatchMode=yes'
    const git = new GitEngine()
    try {
      await git.initialize(root)
      await writeFile(join(root, 'README.md'), '# Safe export\n', 'utf8')
      await git.runner.run(root, ['add', '--', 'README.md'])
      await git.runner.run(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base'])
      const objectId = (await git.runner.run(root, ['rev-parse', 'HEAD'])).stdout.trim()
      await mkdir(bareRemote, { recursive: true })
      await git.runner.run(bareRemote, ['init', '--bare'])

      const originalRun = git.runner.run.bind(git.runner)
      const run = vi.spyOn(git.runner, 'run').mockImplementation(async (cwd, args, options) => {
        const networkOperation = args[0] === 'fetch' || args[0] === 'push' ||
          (args[0] === 'ls-remote' && !args.includes('--get-url'))
        const routedArgs = networkOperation ? args.map((argument) => argument === remoteUrl ? bareRemote : argument) : [...args]
        return await originalRun(cwd, routedArgs, options)
      })

      await git.pushCheckpoint(root, objectId, remoteUrl, 'vibegit-backup', { sshCommand })
      const remoteCalls = run.mock.calls.filter(([, args]) =>
        args[0] === 'fetch' || args[0] === 'push' || (args[0] === 'ls-remote' && !args.includes('--get-url'))
      )
      expect(remoteCalls).not.toHaveLength(0)
      expect(remoteCalls.every(([, , options]) => options?.env?.GIT_SSH_COMMAND === sshCommand)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
