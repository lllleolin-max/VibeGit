import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VibeGitDatabase } from '@vibegit/database'
import type { Project } from '@vibegit/shared'

describe('VibeGitDatabase', () => {
  it('persists projects across reopen and reports health', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-db-'))
    const file = join(root, 'state.sqlite')
    const project: Project = {
      id: 'project-1',
      name: '测试项目',
      path: join(root, '测试 项目'),
      createdAt: '2026-07-11T00:00:00.000Z',
      lastActivityAt: '2026-07-11T00:00:00.000Z',
      isGitRepository: false,
      protectionEnabled: false,
      hasUnsavedChanges: true,
      untrackedFiles: 0,
      githubSyncStatus: 'not_configured'
    }
    const first = new VibeGitDatabase(file)
    expect(first.health()).toBe(true)
    first.upsertProject(project)
    first.close()

    const reopened = new VibeGitDatabase(file)
    expect(reopened.getProject('project-1')).toMatchObject({ name: '测试项目', path: project.path })
    reopened.close()
    await rm(root, { recursive: true, force: true })
  })

  it('rolls back a failed transaction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-db-'))
    const database = new VibeGitDatabase(join(root, 'state.sqlite'))
    expect(() => database.transaction(() => {
      database.setSetting('transient', 'value')
      throw new Error('stop')
    })).toThrow(/本地记录未能安全保存/)
    expect(database.getSetting('transient')).toBeUndefined()
    database.close()
    await rm(root, { recursive: true, force: true })
  })
})

