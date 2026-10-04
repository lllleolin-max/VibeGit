import { link, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import packageMetadata from '../../package.json'
import { cleanupSandbox, createSandbox, type TestSandbox } from '../helpers'

describe('Protection marker file boundary', () => {
  let sandbox: TestSandbox | undefined
  afterEach(async () => {
    if (sandbox) await cleanupSandbox(sandbox)
    sandbox = undefined
  })

  async function prepare() {
    sandbox = await createSandbox()
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.git.initialize(project.path)
    const marker = join(await sandbox.service.git.getPrivateDataDirectory(project.path), 'protected.json')
    return { project, marker }
  }

  it('rejects hard links without rewriting the outside file or registering a checkpoint', async () => {
    const { project, marker } = await prepare()
    const outside = join(sandbox!.root, 'outside.json')
    const content = JSON.stringify({ schemaVersion: 1, enabled: false, summarySkill: 'vibegit-change-summary' })
    await writeFile(outside, content)
    await link(outside, marker)
    await expect(sandbox!.service.initializeProtection(project.id)).rejects.toMatchObject({ code: 'UNSAFE_PROTECTION_MARKER' })
    expect(await readFile(outside, 'utf8')).toBe(content)
    expect(await sandbox!.service.hasProjectProtectionMarker(project.id)).toBe(false)
    expect(sandbox!.service.listCheckpoints(project.id)).toEqual([])
  })

  it.skipIf(process.platform === 'win32')('rejects a symbolic link even when its target looks like a valid marker', async () => {
    const { project, marker } = await prepare()
    const outside = join(sandbox!.root, 'outside.json')
    const content = JSON.stringify({ schemaVersion: 1, enabled: true, summarySkill: 'vibegit-change-summary' })
    await writeFile(outside, content)
    await symlink(outside, marker)
    await expect(sandbox!.service.initializeProtection(project.id)).rejects.toMatchObject({ code: 'UNSAFE_PROTECTION_MARKER' })
    expect(await readFile(outside, 'utf8')).toBe(content)
    expect(await sandbox!.service.hasProjectProtectionMarker(project.id)).toBe(false)
  })

  it.each(['directory', 'oversized'] as const)('rejects a %s marker instead of trusting or replacing it', async (kind) => {
    const { project, marker } = await prepare()
    if (kind === 'directory') await mkdir(marker)
    else await writeFile(marker, ' '.repeat(16_385))
    await expect(sandbox!.service.initializeProtection(project.id)).rejects.toMatchObject({ code: 'UNSAFE_PROTECTION_MARKER' })
  })

  it('reports the package version actually being built', async () => {
    sandbox = await createSandbox()
    expect((await sandbox.service.health()).version).toBe(packageMetadata.version)
  })
})
