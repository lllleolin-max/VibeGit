import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { TestSandbox } from '../helpers'
import { cleanupSandbox, createSandbox, writeProjectFile } from '../helpers'

describe('complete local P0 flow', () => {
  let sandbox: TestSandbox | undefined
  afterEach(async () => { if (sandbox) await cleanupSandbox(sandbox); sandbox = undefined })

  it('initializes → Agent saves → timeline/diff → restore → undo with intact content', async () => {
    sandbox = await createSandbox('完整 流程')
    await writeProjectFile(sandbox, 'src/app.ts', 'export const version = 1\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initial = (await sandbox.service.initializeProtection(project.id)).checkpoint
    await sandbox.service.handleAgentEvent({
      event: 'task-start', agent: 'claude-code', projectPath: sandbox.projectPath,
      sessionId: 'e2e-session', taskText: '把版本升级为 2', timestamp: new Date().toISOString()
    })
    await writeProjectFile(sandbox, 'src/app.ts', 'export const version = 2\nexport const feature = true\n')
    const end = await sandbox.service.handleAgentEvent({
      event: 'task-end', agent: 'claude-code', projectPath: sandbox.projectPath,
      sessionId: 'e2e-session', success: true, timestamp: new Date().toISOString()
    })
    expect(end.checkpoint).toBeDefined()
    const timeline = sandbox.service.listCheckpoints(project.id)
    expect(timeline.map((item) => item.type)).toEqual(expect.arrayContaining(['initial', 'pre_agent', 'post_agent']))
    const diff = await sandbox.service.getCheckpointDiff(end.checkpoint!.id)
    expect(diff.files.some((file) => file.path === 'src/app.ts')).toBe(true)

    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    const restored = await sandbox.service.executeRestore(preview.token)
    expect(await readFile(`${sandbox.projectPath}/src/app.ts`, 'utf8')).toContain('version = 1')
    await sandbox.service.undoRestore(restored.id)
    const final = await readFile(`${sandbox.projectPath}/src/app.ts`, 'utf8')
    expect(final).toContain('version = 2')
    expect(final).toContain('feature = true')
  })
})

