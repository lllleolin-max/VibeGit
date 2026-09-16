import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanupSandbox, createSandbox, writeProjectFile, type TestSandbox } from '../helpers'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

describe('Project registry and explicit working-tree checks', () => {
  let sandbox: TestSandbox | undefined

  afterEach(async () => {
    vi.restoreAllMocks()
    if (sandbox) await cleanupSandbox(sandbox)
    sandbox = undefined
  })

  it('returns the registry without scanning projects and marks its working-tree status as unknown', async () => {
    sandbox = await createSandbox()
    const first = await sandbox.service.addProject({ path: sandbox.projectPath })
    const otherPath = join(sandbox.root, 'second project')
    await mkdir(otherPath)
    const second = await sandbox.service.addProject({ path: otherPath })
    const run = vi.spyOn(sandbox.service.git.runner, 'run').mockRejectedValue(new Error('Git must not run to list projects'))

    const projects = await sandbox.service.listProjects()
    expect(projects.map((project) => project.id).sort()).toEqual([first.id, second.id].sort())
    expect(projects.every((project) => project.worktreeStatus === 'unknown')).toBe(true)
    expect(run).not.toHaveBeenCalled()
  })

  it('checks only the selected working tree and distinguishes a later edit from a saved checkpoint', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'app.txt', 'saved content\n')
    const first = await sandbox.service.addProject({ path: sandbox.projectPath, initialize: true })
    const otherPath = join(sandbox.root, 'second project')
    await mkdir(otherPath)
    await sandbox.service.addProject({ path: otherPath })
    const capture = vi.spyOn(sandbox.service.git, 'captureWorktreeTree')
    expect(await sandbox.service.refreshProject(first.id)).toMatchObject({ worktreeStatus: 'checked', hasUnsavedChanges: false })
    await writeProjectFile(sandbox, 'app.txt', 'later edit\n')
    expect(await sandbox.service.refreshProject(first.id)).toMatchObject({ worktreeStatus: 'checked', hasUnsavedChanges: true })
    expect(capture.mock.calls.every(([path]) => path === sandbox!.projectPath)).toBe(true)
    expect((await sandbox.service.listProjects()).every((project) => project.worktreeStatus === 'unknown')).toBe(true)
  })

  it.each(['create', 'connect'] as const)('returns the successful %s result without starting an unrelated worktree scan', async (operation) => {
    sandbox = await createSandbox()
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const remoteUrl = 'ssh://git@ssh.github.com:443/example/backup.git'
    const persistRemote = async (): Promise<string> => {
      sandbox!.service.database.updateProjectRemote(project.id, remoteUrl)
      return remoteUrl
    }
    vi.spyOn(sandbox.service.github, 'createPrivateRepository').mockImplementation(persistRemote)
    vi.spyOn(sandbox.service.github, 'connect').mockImplementation(persistRemote)
    const refresh = vi.spyOn(sandbox.service, 'refreshProject').mockRejectedValue(new Error('A saved remote must not wait for a scan'))
    const result = operation === 'create'
      ? await sandbox.service.createPrivateRepository({ projectId: project.id, name: 'backup' })
      : await sandbox.service.connectRemote({ projectId: project.id, remoteUrl })
    expect(result).toMatchObject({ id: project.id, githubRemoteUrl: remoteUrl, githubSyncStatus: 'pending', worktreeStatus: 'unknown' })
    expect(refresh).not.toHaveBeenCalled()
  })

  it.each(['connect', 'push'] as const)('preserves a successful %s while an older background scan is still pending', async (operation) => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'app.txt', 'saved content\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath, initialize: true })
    const remoteUrl = 'ssh://git@ssh.github.com:443/example/backup.git'
    const checkpoint = sandbox.service.database.getLatestCheckpoint(project.id)!
    if (operation === 'push') {
      await sandbox.service.git.setRemote(project.path, remoteUrl, 'vibegit')
      sandbox.service.database.updateProjectRemote(project.id, remoteUrl)
    }
    const captured = await sandbox.service.git.captureWorktreeTree(project.path)
    const pending = deferred<typeof captured>()
    const capture = vi.spyOn(sandbox.service.git, 'captureWorktreeTree').mockReturnValueOnce(pending.promise)
    const refresh = sandbox.service.refreshProject(project.id)
    await vi.waitFor(() => expect(capture).toHaveBeenCalled())
    const syncedAt = '2026-09-16T00:00:00.000Z'
    if (operation === 'connect') {
      vi.spyOn(sandbox.service.github, 'connect').mockImplementation(async () => {
        await sandbox!.service.git.setRemote(project.path, remoteUrl, 'vibegit')
        sandbox!.service.database.updateProjectRemote(project.id, remoteUrl)
        return remoteUrl
      })
      await sandbox.service.connectRemote({ projectId: project.id, remoteUrl })
    } else {
      sandbox.service.database.markCheckpointSynced(checkpoint.id, syncedAt)
    }
    pending.resolve(captured)
    const expected = { githubRemoteUrl: remoteUrl, githubSyncStatus: operation === 'connect' ? 'pending' : 'synced' }
    expect(await refresh).toMatchObject(expected)
    expect(sandbox.service.database.getProject(project.id)).toMatchObject(expected)
    if (operation === 'push') expect(sandbox.service.database.getProject(project.id)?.lastSyncedAt).toBe(syncedAt)
  })

  it.each([false, true])('does not recreate a removed project after a delayed repository check (initialized: %s)', async (initialize) => {
    sandbox = await createSandbox()
    const project = await sandbox.service.addProject({ path: sandbox.projectPath, initialize })
    const pending = deferred<boolean>()
    const repositoryCheck = vi.spyOn(sandbox.service.git, 'isRepository').mockReturnValueOnce(pending.promise)
    const refresh = sandbox.service.refreshProject(project.id).catch((error: unknown) => error)
    await vi.waitFor(() => expect(repositoryCheck).toHaveBeenCalled())
    await sandbox.service.removeProject(project.id)
    pending.resolve(initialize)
    expect(await refresh).toMatchObject({ code: 'PROJECT_NOT_FOUND' })
    expect(sandbox.service.database.getProject(project.id)).toBeUndefined()
    expect(await sandbox.service.listProjects()).toEqual([])
  })

  it('marks an older worktree check unknown if the active checkpoint changes before its result is stored', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'app.txt', 'saved content\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath, initialize: true })
    const checkpoint = sandbox.service.database.getLatestCheckpoint(project.id)!
    const tree = await sandbox.service.git.getCommitTree(project.path, checkpoint.gitObjectId)
    const pending = deferred<string>()
    const getTree = vi.spyOn(sandbox.service.git, 'getCommitTree').mockReturnValueOnce(pending.promise)
    const refresh = sandbox.service.refreshProject(project.id)
    await vi.waitFor(() => expect(getTree).toHaveBeenCalled())
    await writeProjectFile(sandbox, 'app.txt', 'newly saved content\n')
    const newer = await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'newer' })
    pending.resolve(tree)
    expect(await refresh).toMatchObject({ worktreeStatus: 'unknown', lastCheckpointAt: newer.createdAt })
    expect(sandbox.service.database.getActiveCheckpoint(project.id)?.id).toBe(newer.id)
  })
})
