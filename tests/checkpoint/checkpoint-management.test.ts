import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TestSandbox } from '../helpers'
import { cleanupSandbox, createSandbox, writeProjectFile } from '../helpers'

describe('checkpoint management', () => {
  let sandbox: TestSandbox | undefined

  afterEach(async () => {
    if (sandbox) await cleanupSandbox(sandbox)
    sandbox = undefined
  })

  it('renames a checkpoint and safely removes one timeline record without touching project files', async () => {
    sandbox = await createSandbox('checkpoint management')
    await writeProjectFile(sandbox, 'app.txt', 'version one\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint

    await writeProjectFile(sandbox, 'app.txt', 'version two\n')
    const first = await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'first version' })
    await writeProjectFile(sandbox, 'app.txt', 'version three\n')
    const second = await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'second version' })

    expect(sandbox.service.renameCheckpoint(first.id, '  renamed   version  ')).toMatchObject({ id: first.id, title: 'renamed version' })
    await expect(sandbox.service.deleteCheckpoint(first.id)).resolves.toEqual({ checkpointId: first.id, projectId: project.id })

    const remaining = sandbox.service.listCheckpoints(project.id)
    expect(remaining.map((checkpoint) => checkpoint.id)).not.toContain(first.id)
    expect(remaining.find((checkpoint) => checkpoint.id === second.id)?.parentCheckpointId).toBe(initial.id)
    expect(await readFile(`${sandbox.projectPath}/app.txt`, 'utf8')).toBe('version three\n')

    await sandbox.service.deleteCheckpoint(second.id)
    await expect(sandbox.service.deleteCheckpoint(initial.id)).rejects.toMatchObject({ code: 'CHECKPOINT_DELETE_LAST_FORBIDDEN' })
    expect(sandbox.service.listCheckpoints(project.id)).toHaveLength(1)
  })

  it.each(['checkpoint', 'project'] as const)('serializes %s removal behind an in-flight save', async (kind) => {
    sandbox = await createSandbox(`serialized ${kind} removal`)
    await writeProjectFile(sandbox, 'app.txt', 'version one\n')
    const service = sandbox.service
    const project = await service.addProject({ path: sandbox.projectPath })
    const initial = (await service.initializeProtection(project.id)).checkpoint
    await writeProjectFile(sandbox, 'app.txt', 'version two\n')
    let release!: () => void
    let signalStarted!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { signalStarted = resolve })
    const originalCreate = service.git.createHiddenCheckpoint.bind(service.git)
    const create = vi.spyOn(service.git, 'createHiddenCheckpoint').mockImplementationOnce(async (...args) => {
      signalStarted()
      await waiting
      return await originalCreate(...args)
    })
    const save = service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'concurrent save' })
    await started
    const databaseDelete = vi.spyOn(service.database, kind === 'project' ? 'deleteProject' : 'deleteCheckpoint')
    let removalComplete = false
    const removal = (kind === 'project' ? service.removeProject(project.id) : service.deleteCheckpoint(initial.id))
      .then((result) => { removalComplete = true; return result })
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
      expect(removalComplete).toBe(false)
      expect(databaseDelete).not.toHaveBeenCalled()
      expect(service.database.getCheckpoint(initial.id)).toBeDefined()
    } finally {
      release()
    }
    const saved = await save
    await removal
    expect(await readFile(`${sandbox.projectPath}/app.txt`, 'utf8')).toBe('version two\n')
    if (kind === 'project') expect(service.database.getProject(project.id)).toBeUndefined()
    else expect(service.listCheckpoints(project.id).map((checkpoint) => checkpoint.id)).toEqual([saved.id])
    create.mockRestore()
    databaseDelete.mockRestore()
  })

  it.each(['checkpoint', 'project'] as const)('retains %s refs when its database deletion fails', async (kind) => {
    sandbox = await createSandbox(`failed ${kind} removal`)
    await writeProjectFile(sandbox, 'app.txt', 'version one\n')
    const service = sandbox.service
    const project = await service.addProject({ path: sandbox.projectPath })
    const initial = (await service.initializeProtection(project.id)).checkpoint
    await writeProjectFile(sandbox, 'app.txt', 'version two\n')
    const next = await service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'another version' })
    const databaseDelete = vi.spyOn(service.database, kind === 'project' ? 'deleteProject' : 'deleteCheckpoint')
      .mockImplementation(() => { throw new Error('database unavailable') })
    const deleteRef = vi.spyOn(service.git, 'deleteCheckpointRef')
    try {
      await expect(kind === 'project' ? service.removeProject(project.id) : service.deleteCheckpoint(next.id))
        .rejects.toThrow('database unavailable')
      expect(deleteRef).not.toHaveBeenCalled()
      expect(service.listCheckpoints(project.id)).toHaveLength(2)
      for (const checkpoint of [initial, next]) {
        const reference = await service.git.runner.run(sandbox.projectPath, ['rev-parse', `refs/vibegit/checkpoints/${checkpoint.id}`])
        expect(reference.stdout.trim()).toBe(checkpoint.gitObjectId)
      }
    } finally {
      databaseDelete.mockRestore()
      deleteRef.mockRestore()
    }
  })

  it('reports committed deletion as complete when private ref cleanup fails', async () => {
    sandbox = await createSandbox('cleanup after committed deletion')
    await writeProjectFile(sandbox, 'app.txt', 'version one\n')
    const service = sandbox.service
    const project = await service.addProject({ path: sandbox.projectPath })
    const initial = (await service.initializeProtection(project.id)).checkpoint
    await writeProjectFile(sandbox, 'app.txt', 'version two\n')
    const next = await service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'another version' })
    const deleteRef = vi.spyOn(service.git, 'deleteCheckpointRef').mockRejectedValueOnce(new Error('repository unavailable'))
    try {
      await expect(service.deleteCheckpoint(next.id)).resolves.toEqual({ checkpointId: next.id, projectId: project.id })
      expect(service.listCheckpoints(project.id).map((checkpoint) => checkpoint.id)).toEqual([initial.id])
      const retained = await service.git.runner.run(sandbox.projectPath, ['rev-parse', `refs/vibegit/checkpoints/${next.id}`])
      expect(retained.stdout.trim()).toBe(next.gitObjectId)
    } finally {
      deleteRef.mockRestore()
    }
  })
})
