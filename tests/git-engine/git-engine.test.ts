import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { GitCommandRunner, GitEngine } from '@vibegit/git-engine'
import { VibeGitError } from '@vibegit/shared'

describe('GitEngine', () => {
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

    const captured = await git.captureWorktreeTree(root)
    const entry = (await git.listTree(root, captured.treeObjectId)).find((item) => item.path === 'app.txt')
    expect(entry).toBeDefined()
    expect((await git.readBlob(root, entry!.objectId)).toString('utf8')).toBe('working\n')
    expect((await git.runner.run(root, ['write-tree'])).stdout.trim()).toBe(indexBefore)
    expect((await git.runner.run(root, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(headBefore)
    expect(await readFile(join(root, 'app.txt'), 'utf8')).toBe('working\n')
    await rm(root, { recursive: true, force: true })
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
