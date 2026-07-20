import { mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VibeGitService } from '@vibegit/core'
import type { RestoreRecord } from '@vibegit/shared'
import type { TestSandbox } from '../helpers'
import { cleanupSandbox, createSandbox, writeProjectFile } from '../helpers'

function normalizedLines(value: string): string {
  return value.replaceAll('\r\n', '\n')
}

describe('checkpoint and safe restore', () => {
  let sandbox: TestSandbox | undefined
  afterEach(async () => { if (sandbox) await cleanupSandbox(sandbox); sandbox = undefined })

  it('creates a readable initial checkpoint for an empty unborn repository', async () => {
    sandbox = await createSandbox('empty project')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initialized = await sandbox.service.initializeProtection(project.id)

    expect(initialized.checkpoint.changedFiles).toEqual([])
    expect(initialized.checkpoint.type).toBe('initial')
    await expect(sandbox.service.git.verifyCommit(sandbox.projectPath, initialized.checkpoint.gitObjectId)).resolves.toBeUndefined()
    await expect(sandbox.service.createCheckpoint({
      projectId: project.id,
      type: 'manual',
      title: '没有变化的版本'
    })).rejects.toMatchObject({ code: 'NO_CHANGES' })
  })

  it('initializes a normal folder, creates a diff, and tracks unsaved state relative to the latest checkpoint', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'src/你好 file.ts', 'export const value = 1\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    expect(project.isGitRepository).toBe(false)
    const initialized = await sandbox.service.initializeProtection(project.id)
    expect(initialized.checkpoint.type).toBe('initial')
    expect(initialized.checkpoint.changedFiles.map((file) => file.path)).toContain('src/你好 file.ts')
    expect((await sandbox.service.refreshProject(project.id)).hasUnsavedChanges).toBe(false)

    await writeProjectFile(sandbox, 'src/你好 file.ts', 'export const value = 2\nexport const added = true\n')
    expect((await sandbox.service.refreshProject(project.id)).hasUnsavedChanges).toBe(true)
    const manual = await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: '完成中文路径修改' })
    const diff = await sandbox.service.getCheckpointDiff(manual.id)
    expect(diff.files[0]?.patch).toContain('export const added = true')
    expect(diff.insertions).toBeGreaterThan(0)
    expect((await sandbox.service.refreshProject(project.id)).hasUnsavedChanges).toBe(false)
  })

  it('restores an old checkpoint, preserves unrelated untracked files, and precisely undoes target-only files', async () => {
    sandbox = await createSandbox('恢复 测试')
    await writeProjectFile(sandbox, 'app.txt', 'version one\n')
    await writeProjectFile(sandbox, 'only-old.txt', 'old file\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint

    await writeProjectFile(sandbox, 'app.txt', 'version two\n')
    await rm(join(sandbox.projectPath, 'only-old.txt'))
    await writeProjectFile(sandbox, 'current-only.txt', 'keep me\n')
    await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: '第二个版本' })
    await writeProjectFile(sandbox, 'app.txt', 'version three unsaved\n')
    const repositoryStateBefore = await sandbox.service.git.getRepositoryStateFingerprint(sandbox.projectPath)

    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    expect(preview.insuranceCheckpointId).toBeTruthy()
    const restored = await sandbox.service.executeRestore(preview.token)
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'app.txt'), 'utf8'))).toBe('version one\n')
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'only-old.txt'), 'utf8'))).toBe('old file\n')
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'current-only.txt'), 'utf8'))).toBe('keep me\n')
    expect(await sandbox.service.git.getRepositoryStateFingerprint(sandbox.projectPath)).toEqual(repositoryStateBefore)

    await sandbox.service.undoRestore(restored.id)
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'app.txt'), 'utf8'))).toBe('version three unsaved\n')
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'current-only.txt'), 'utf8'))).toBe('keep me\n')
    expect(await sandbox.service.git.getRepositoryStateFingerprint(sandbox.projectPath)).toEqual(repositoryStateBefore)
    await expect(readFile(join(sandbox.projectPath, 'only-old.txt'), 'utf8')).rejects.toThrow()
  })

  it('moves an ignored name conflict to recovery and restores it on undo', async () => {
    sandbox = await createSandbox('ignored conflict')
    await writeProjectFile(sandbox, '.gitignore', '\n')
    await writeProjectFile(sandbox, 'secret.env', 'versioned placeholder\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint

    await writeProjectFile(sandbox, '.gitignore', 'secret.env\n')
    await writeProjectFile(sandbox, 'secret.env', 'local ignored value\n')
    await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: '开始忽略本地文件' })

    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    expect(preview.conflictCount).toBeGreaterThanOrEqual(1)
    expect(preview.conflictPaths).toContain('secret.env')
    const restored = await sandbox.service.executeRestore(preview.token)
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'secret.env'), 'utf8'))).toBe('versioned placeholder\n')
    expect(restored.recoveryDirectory).toBeTruthy()

    await sandbox.service.undoRestore(restored.id)
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'secret.env'), 'utf8'))).toBe('local ignored value\n')
  })

  it('persists and exposes the exact recovery directory when restore fails after moving a conflict', async () => {
    sandbox = await createSandbox('failed restore recovery access')
    await writeProjectFile(sandbox, '.gitignore', '\n')
    await writeProjectFile(sandbox, 'secret.env', 'versioned placeholder\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint
    await writeProjectFile(sandbox, '.gitignore', 'secret.env\n')
    await writeProjectFile(sandbox, 'secret.env', 'LOCAL VALUE MUST SURVIVE\n')
    await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'ignore local secret' })
    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    vi.spyOn(sandbox.service.git, 'restoreWorktree').mockRejectedValueOnce(new Error('injected restore failure'))

    await expect(sandbox.service.executeRestore(preview.token)).rejects.toMatchObject({ code: 'RESTORE_FAILED' })
    const failed = sandbox.service.getFailedRestoreForToken(preview.token)
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'RESTORE_FAILED' })
    expect(failed?.recoveryDirectory).toBeTruthy()
    expect(await readFile(join(failed!.recoveryDirectory!, 'files', 'secret.env'), 'utf8')).toBe('LOCAL VALUE MUST SURVIVE\n')
  })

  it('rechecks the worktree after staging and never overwrites a concurrent edit', async () => {
    sandbox = await createSandbox('edit during restore staging')
    await writeProjectFile(sandbox, 'app.txt', 'target old\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint
    await writeProjectFile(sandbox, 'app.txt', 'state at preview\n')
    await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'current' })
    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    const materialize = sandbox.service.git.materializeCommit.bind(sandbox.service.git)
    vi.spyOn(sandbox.service.git, 'materializeCommit').mockImplementationOnce(async (...args) => {
      await materialize(...args)
      await writeProjectFile(sandbox!, 'app.txt', 'EXTERNAL EDIT AFTER VALIDATION\n')
    })

    await expect(sandbox.service.executeRestore(preview.token)).rejects.toMatchObject({ code: 'RESTORE_FAILED' })
    expect(await readFile(join(sandbox.projectPath, 'app.txt'), 'utf8')).toBe('EXTERNAL EDIT AFTER VALIDATION\n')
    expect(sandbox.service.getFailedRestoreForToken(preview.token)?.errorCode).toBe('RESTORE_STATE_CHANGED')
  })

  it.skipIf(process.platform === 'win32')('restores an ignored symlink conflict even when it is dangling inside recovery storage', async () => {
    sandbox = await createSandbox('symlink recovery')
    await writeProjectFile(sandbox, '.gitignore', '\n')
    await writeProjectFile(sandbox, 'target.txt', 'versioned target\n')
    await symlink('target.txt', join(sandbox.projectPath, 'alias.txt'))
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint
    await rm(join(sandbox.projectPath, 'alias.txt'))
    await writeProjectFile(sandbox, '.gitignore', 'alias.txt\n')
    await writeProjectFile(sandbox, 'local-target.txt', 'local target\n')
    await symlink('local-target.txt', join(sandbox.projectPath, 'alias.txt'))
    await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'ignored local link' })

    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    const restored = await sandbox.service.executeRestore(preview.token)
    expect(await readlink(join(sandbox.projectPath, 'alias.txt'))).toBe('target.txt')
    await sandbox.service.undoRestore(restored.id)
    expect(await readlink(join(sandbox.projectPath, 'alias.txt'))).toBe('local-target.txt')
  })

  it('treats a user-tracked .vibegit directory as project data and keeps recovery inside Git private storage', async () => {
    sandbox = await createSandbox('tracked vibegit data')
    await sandbox.service.git.initialize(sandbox.projectPath)
    await writeProjectFile(sandbox, '.vibegit/user.txt', 'committed base\n')
    await sandbox.service.git.runner.run(sandbox.projectPath, ['add', '--', '.vibegit/user.txt'])
    await sandbox.service.git.runner.run(sandbox.projectPath, [
      '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
      'commit', '-m', 'track user vibegit data'
    ])
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint
    expect(initial.changedFiles.map((file) => file.path)).toContain('.vibegit/user.txt')
    expect((await sandbox.service.git.listTree(sandbox.projectPath, initial.gitObjectId)).map((entry) => entry.path)).toContain('.vibegit/user.txt')

    await writeProjectFile(sandbox, '.vibegit/user.txt', 'UNSAVED USER DATA\n')
    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    const restored = await sandbox.service.executeRestore(preview.token)
    expect(normalizedLines(await readFile(join(sandbox.projectPath, '.vibegit/user.txt'), 'utf8'))).toBe('committed base\n')
    expect(restored.recoveryDirectory?.replaceAll('\\', '/')).toContain('/.git/vibegit/recovery/')

    await sandbox.service.undoRestore(restored.id)
    expect(normalizedLines(await readFile(join(sandbox.projectPath, '.vibegit/user.txt'), 'utf8'))).toBe('UNSAVED USER DATA\n')
  })

  it('uses Git checkout conversion so CRLF attributes survive restore and undo', async () => {
    sandbox = await createSandbox('attributes restore')
    await writeProjectFile(sandbox, '.gitattributes', '*.txt text eol=crlf\n')
    await writeProjectFile(sandbox, 'app.txt', 'one\r\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint
    await writeProjectFile(sandbox, 'app.txt', 'two\r\n')
    await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'two' })

    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    const restored = await sandbox.service.executeRestore(preview.token)
    expect(await readFile(join(sandbox.projectPath, 'app.txt'), 'utf8')).toBe('one\r\n')
    await sandbox.service.undoRestore(restored.id)
    expect(await readFile(join(sandbox.projectPath, 'app.txt'), 'utf8')).toBe('two\r\n')
  })

  it('captures current bytes of a staged file even after it becomes ignored', async () => {
    sandbox = await createSandbox('staged then ignored')
    await writeProjectFile(sandbox, '.gitignore', '\n')
    await writeProjectFile(sandbox, 'secret.env', 'TARGET INITIAL\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint
    await sandbox.service.git.runner.run(sandbox.projectPath, ['add', '--', 'secret.env'])
    await writeProjectFile(sandbox, '.gitignore', 'secret.env\n')
    await writeProjectFile(sandbox, 'secret.env', 'UNSAVED AFTER STAGING\n')
    const current = await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'ignored staged current' })
    const currentEntry = (await sandbox.service.git.listTree(sandbox.projectPath, current.gitObjectId)).find((entry) => entry.path === 'secret.env')
    expect(currentEntry).toBeDefined()
    expect((await sandbox.service.git.readBlob(sandbox.projectPath, currentEntry!.objectId)).toString('utf8')).toBe('UNSAVED AFTER STAGING\n')

    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    const restored = await sandbox.service.executeRestore(preview.token)
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'secret.env'), 'utf8'))).toBe('TARGET INITIAL\n')
    await sandbox.service.undoRestore(restored.id)
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'secret.env'), 'utf8'))).toBe('UNSAVED AFTER STAGING\n')
  })

  it('restores every leaf of a mixed ordinary-and-ignored directory conflict on undo', async () => {
    sandbox = await createSandbox('mixed directory conflict')
    await writeProjectFile(sandbox, 'config', 'target file\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint
    await rm(join(sandbox.projectPath, 'config'))
    await writeProjectFile(sandbox, '.gitignore', 'config/secret.env\n')
    await writeProjectFile(sandbox, 'config/public.txt', 'public original\n')
    await writeProjectFile(sandbox, 'config/secret.env', 'ignored original\n')
    await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'directory version' })

    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    expect(preview.conflictPaths).toContain('config')
    const restored = await sandbox.service.executeRestore(preview.token)
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'config'), 'utf8'))).toBe('target file\n')

    await sandbox.service.undoRestore(restored.id)
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'config/public.txt'), 'utf8'))).toBe('public original\n')
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'config/secret.env'), 'utf8'))).toBe('ignored original\n')
  })

  it('stops when files change after the restore preview', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'app.txt', 'one\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint
    await writeProjectFile(sandbox, 'app.txt', 'two\n')
    await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'two' })
    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    await writeFile(join(sandbox.projectPath, 'app.txt'), 'changed after preview\n', 'utf8')
    await expect(sandbox.service.executeRestore(preview.token)).rejects.toMatchObject({ code: 'RESTORE_STATE_CHANGED' })
    expect(await readFile(join(sandbox.projectPath, 'app.txt'), 'utf8')).toBe('changed after preview\n')
  })

  it('stops when only the real Git index changes after preview', async () => {
    sandbox = await createSandbox('index fingerprint')
    await writeProjectFile(sandbox, 'app.txt', 'one\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint
    await writeProjectFile(sandbox, 'app.txt', 'two\n')
    await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'two' })
    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    await sandbox.service.git.runner.run(sandbox.projectPath, ['add', '--', 'app.txt'])

    await expect(sandbox.service.executeRestore(preview.token)).rejects.toMatchObject({ code: 'RESTORE_REPOSITORY_STATE_CHANGED' })
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'app.txt'), 'utf8'))).toBe('two\n')
  })

  it('atomically claims restore and undo operations across service instances', async () => {
    sandbox = await createSandbox('concurrent restore')
    await writeProjectFile(sandbox, 'app.txt', 'one\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint
    await writeProjectFile(sandbox, 'app.txt', 'two\n')
    await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'two' })
    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    const competingService = new VibeGitService({ dataDirectory: sandbox.dataDirectory, commandTimeoutMs: 10_000 })

    try {
      const restoreAttempts = await Promise.allSettled([
        sandbox.service.executeRestore(preview.token),
        competingService.executeRestore(preview.token)
      ])
      const restored = restoreAttempts.find((result): result is PromiseFulfilledResult<RestoreRecord> => result.status === 'fulfilled')
      const restoreRejected = restoreAttempts.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      expect(restored).toBeDefined()
      expect(restoreRejected?.reason).toMatchObject({ code: 'RESTORE_ALREADY_USED' })
      expect(normalizedLines(await readFile(join(sandbox.projectPath, 'app.txt'), 'utf8'))).toBe('one\n')
      expect(sandbox.service.getRestore(restored!.value.id).status).toBe('completed')

      const undoAttempts = await Promise.allSettled([
        sandbox.service.undoRestore(restored!.value.id),
        competingService.undoRestore(restored!.value.id)
      ])
      expect(undoAttempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const undoRejected = undoAttempts.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      expect(undoRejected?.reason).toMatchObject({ code: 'RESTORE_NOT_UNDOABLE' })
      expect(normalizedLines(await readFile(join(sandbox.projectPath, 'app.txt'), 'utf8'))).toBe('two\n')
      expect(sandbox.service.getRestore(restored!.value.id).status).toBe('undone')
    } finally {
      competingService.close()
    }
  })

  it('keeps undo retryable when its preflight stops before any worktree mutation', async () => {
    sandbox = await createSandbox('retryable undo preflight')
    await writeProjectFile(sandbox, 'app.txt', 'one\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint
    await writeProjectFile(sandbox, 'app.txt', 'two\n')
    await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'two' })
    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    const restored = await sandbox.service.executeRestore(preview.token)
    const mergeMarker = join(sandbox.projectPath, '.git', 'MERGE_HEAD')
    await writeFile(mergeMarker, '0'.repeat(40) + '\n', 'utf8')

    await expect(sandbox.service.undoRestore(restored.id)).rejects.toMatchObject({ code: 'RESTORE_GIT_OPERATION_ACTIVE' })
    expect(sandbox.service.getRestore(restored.id).status).toBe('completed')
    await rm(mergeMarker)
    await expect(sandbox.service.undoRestore(restored.id)).resolves.toMatchObject({ status: 'undone' })
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'app.txt'), 'utf8'))).toBe('two\n')
  })

  it('serializes different restore tokens for the same project across service instances', async () => {
    sandbox = await createSandbox('cross instance lease')
    await writeProjectFile(sandbox, 'app.txt', 'one\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint
    await writeProjectFile(sandbox, 'app.txt', 'two\n')
    const second = await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'two' })
    await writeProjectFile(sandbox, 'app.txt', 'three\n')
    await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'three' })
    const firstPreview = await sandbox.service.prepareRestore(project.id, initial.id)
    const secondPreview = await sandbox.service.prepareRestore(project.id, second.id)
    const competingService = new VibeGitService({ dataDirectory: sandbox.dataDirectory, commandTimeoutMs: 10_000 })

    try {
      const outcomes = await Promise.allSettled([
        sandbox.service.executeRestore(firstPreview.token),
        competingService.executeRestore(secondPreview.token)
      ])
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const rejected = outcomes.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      expect(rejected?.reason).toMatchObject({ code: 'RESTORE_REPOSITORY_STATE_CHANGED' })
      const content = normalizedLines(await readFile(join(sandbox.projectPath, 'app.txt'), 'utf8'))
      expect(['one\n', 'two\n']).toContain(content)
      const statuses = [firstPreview, secondPreview].map((item) => sandbox!.service.database.getRestoreByToken(item.token)?.record.status)
      expect(statuses.sort()).toEqual(['completed', 'failed'])
    } finally {
      competingService.close()
    }
  })

  it('reconciles an executing restore after its crashed-process lease expires', async () => {
    sandbox = await createSandbox('expired operation lease')
    await writeProjectFile(sandbox, 'app.txt', 'one\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint
    await writeProjectFile(sandbox, 'app.txt', 'two\n')
    await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'two' })
    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    const expiredAt = Date.now() - 1_000
    expect(sandbox.service.database.acquireProjectOperation(
      project.id,
      'crashed-owner',
      'restore',
      expiredAt - 1_000,
      expiredAt
    )).toBe(true)
    expect(sandbox.service.database.claimRestore(preview.token)).toBe(true)

    const now = Date.now()
    expect(sandbox.service.database.acquireProjectOperation(
      project.id,
      'replacement-owner',
      'recovery',
      now,
      now + 60_000
    )).toBe(true)
    expect(sandbox.service.database.getRestoreByToken(preview.token)?.record).toMatchObject({
      status: 'failed',
      errorCode: 'INTERRUPTED_OPERATION'
    })
    sandbox.service.database.releaseProjectOperation(project.id, 'replacement-owner')
  })

  it('surfaces a crash-interrupted recovery directory after the next app launch', async () => {
    sandbox = await createSandbox('interrupted recovery reopen')
    await writeProjectFile(sandbox, 'app.txt', 'one\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint
    await writeProjectFile(sandbox, 'app.txt', 'two\n')
    await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'two' })
    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    const pending = sandbox.service.database.getRestoreByToken(preview.token)!
    const recoveryDirectory = await sandbox.service.git.createPrivateRecoveryDirectory(sandbox.projectPath, pending.record.id)
    await mkdir(join(recoveryDirectory, 'files'), { recursive: true })
    await writeFile(join(recoveryDirectory, 'files', 'ignored.txt'), 'RECOVER ME\n', 'utf8')
    sandbox.service.database.updateRestore(pending.record.id, { status: 'executing', recoveryDirectory })
    expect(sandbox.service.database.acquireProjectOperation(
      project.id,
      'crashed-owner',
      'restore',
      Date.now(),
      Date.now() + 60_000,
      0
    )).toBe(true)
    sandbox.service.close()
    sandbox.service = new VibeGitService({ dataDirectory: sandbox.dataDirectory, commandTimeoutMs: 10_000 })

    expect(sandbox.service.getRestore(pending.record.id)).toMatchObject({
      status: 'failed', errorCode: 'INTERRUPTED_OPERATION', recoveryDirectory
    })
    expect(sandbox.service.listFailedRestores(project.id)).toContainEqual(expect.objectContaining({ id: pending.record.id, recoveryDirectory }))
    expect(await readFile(join(recoveryDirectory, 'files', 'ignored.txt'), 'utf8')).toBe('RECOVER ME\n')
  })

  it('temporarily shelves unfinished changes and retrieves them without data loss', async () => {
    sandbox = await createSandbox('shelf flow')
    await writeProjectFile(sandbox, 'app.txt', 'stable\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    await writeProjectFile(sandbox, 'app.txt', 'unfinished work\n')
    await writeProjectFile(sandbox, 'new draft.txt', 'draft\n')

    const shelf = await sandbox.service.createShelf(project.id, '登录页草稿')
    expect(shelf.status).toBe('active')
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'app.txt'), 'utf8'))).toBe('stable\n')
    await expect(readFile(join(sandbox.projectPath, 'new draft.txt'), 'utf8')).rejects.toThrow()

    const retrieved = await sandbox.service.retrieveShelf(shelf.id)
    expect(retrieved.status).toBe('retrieved')
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'app.txt'), 'utf8'))).toBe('unfinished work\n')
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'new draft.txt'), 'utf8'))).toBe('draft\n')
  })

  it('uses the active baseline for consecutive shelves instead of a previous shelf insurance point', async () => {
    sandbox = await createSandbox('consecutive shelves')
    await writeProjectFile(sandbox, 'app.txt', 'stable\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)

    await writeProjectFile(sandbox, 'app.txt', 'work A\n')
    await sandbox.service.createShelf(project.id, 'work A')
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'app.txt'), 'utf8'))).toBe('stable\n')

    await writeProjectFile(sandbox, 'app.txt', 'work B\n')
    await sandbox.service.createShelf(project.id, 'work B')
    expect(normalizedLines(await readFile(join(sandbox.projectPath, 'app.txt'), 'utf8'))).toBe('stable\n')
    expect(sandbox.service.listShelves(project.id).filter((shelf) => shelf.status === 'active')).toHaveLength(2)
  })

  it('uses the restored active version as the next save baseline, including after undo', async () => {
    sandbox = await createSandbox('active checkpoint baseline')
    await writeProjectFile(sandbox, 'app.txt', 'one\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint
    await writeProjectFile(sandbox, 'app.txt', 'two\n')
    const second = await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'two' })

    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    const restored = await sandbox.service.executeRestore(preview.token)
    await expect(sandbox.service.createCheckpoint({
      projectId: project.id,
      type: 'manual',
      title: 'must not duplicate restored state'
    })).rejects.toMatchObject({ code: 'NO_CHANGES' })

    await sandbox.service.undoRestore(restored.id)
    await expect(sandbox.service.createCheckpoint({
      projectId: project.id,
      type: 'manual',
      title: 'must not duplicate undone state'
    })).rejects.toMatchObject({ code: 'NO_CHANGES' })
    await writeProjectFile(sandbox, 'app.txt', 'three\n')
    const third = await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'three' })
    expect(third.parentCheckpointId).toBe(second.id)
    expect(third.changedFiles).toContainEqual(expect.objectContaining({ path: 'app.txt', kind: 'modified' }))
  })

  it('rejects selecting a subdirectory of an existing repository before any checkpoint can cross that boundary', async () => {
    sandbox = await createSandbox('repository root boundary')
    const nested = join(sandbox.projectPath, 'packages', 'app')
    await mkdir(nested, { recursive: true })
    await sandbox.service.git.initialize(sandbox.projectPath)
    await writeProjectFile(sandbox, 'root.txt', 'outside selected folder\n')
    await writeProjectFile(sandbox, 'packages/app/draft.txt', 'CURRENT UNTRACKED MUST SURVIVE\n')

    await expect(sandbox.service.addProject({ path: nested })).rejects.toMatchObject({
      code: 'PROJECT_MUST_BE_REPOSITORY_ROOT'
    })
    expect(await readFile(join(nested, 'draft.txt'), 'utf8')).toBe('CURRENT UNTRACKED MUST SURVIVE\n')
    expect(sandbox.service.database.listProjects()).toHaveLength(0)
  })
})
