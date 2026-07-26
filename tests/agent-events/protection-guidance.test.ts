import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupSandbox, createSandbox, writeProjectFile, type TestSandbox } from '../helpers'

describe('VibeGit private protection marker', () => {
  let sandbox: TestSandbox | undefined

  afterEach(async () => {
    if (sandbox) await cleanupSandbox(sandbox)
    sandbox = undefined
  })

  it('marks protected projects inside the private Git directory without changing project files', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'app.ts', 'export const value = 1\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })

    await sandbox.service.initializeProtection(project.id)

    const privateDirectory = await sandbox.service.git.getPrivateDataDirectory(sandbox.projectPath)
    await expect(readFile(join(privateDirectory, 'protected.json'), 'utf8')).resolves.toBe(
      '{\n  "schemaVersion": 1,\n  "enabled": true,\n  "summarySkill": "vibegit-change-summary"\n}\n'
    )
    await expect(sandbox.service.hasProjectProtectionMarker(project.id)).resolves.toBe(true)
    await expect(readFile(join(sandbox.projectPath, 'AGENTS.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('restores a missing private marker when a protected project is refreshed', async () => {
    sandbox = await createSandbox()
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const privateDirectory = await sandbox.service.git.getPrivateDataDirectory(sandbox.projectPath)
    await rm(join(privateDirectory, 'protected.json'))

    await sandbox.service.refreshProject(project.id)

    await expect(readFile(join(privateDirectory, 'protected.json'), 'utf8')).resolves.toContain('"enabled": true')
  })
})
