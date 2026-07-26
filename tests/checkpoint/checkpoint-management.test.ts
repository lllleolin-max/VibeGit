import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
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
})
