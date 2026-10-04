import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VibeGitDatabase } from '@vibegit/database'
import type { Project } from '@vibegit/shared'
import { VibeGitError } from '@vibegit/shared'

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

  it('preserves actionable application errors after rolling back a transaction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-db-domain-error-'))
    const database = new VibeGitDatabase(join(root, 'state.sqlite'))
    try {
      const failure = new VibeGitError('CHECKPOINT_NOT_FOUND', '找不到这个保存点')
      expect(() => database.transaction(() => {
        database.setSetting('transient', 'value')
        throw failure
      })).toThrow(failure)
      expect(database.getSetting('transient')).toBeUndefined()
      database.setSetting('persistent', 'works after rollback')
      expect(database.getSetting('persistent')).toBe('works after rollback')
    } finally {
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('checks lease ownership in the transaction that removes project records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-db-lease-delete-'))
    const database = new VibeGitDatabase(join(root, 'state.sqlite'))
    try {
      database.upsertProject({
        id: 'protected-project', name: 'Protected project', path: root,
        createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(),
        isGitRepository: false, protectionEnabled: false, hasUnsavedChanges: false,
        untrackedFiles: 0, githubSyncStatus: 'not_configured'
      })
      expect(database.acquireProjectOperation('protected-project', 'active-owner', 'save', Date.now(), Date.now() + 60_000)).toBe(true)
      expect(() => database.deleteProject('protected-project', 'other-owner')).toThrow(expect.objectContaining({ code: 'PROJECT_OPERATION_LEASE_LOST' }))
      expect(database.getProject('protected-project')).toBeDefined()
      expect(database.hasProjectOperation('protected-project', 'active-owner')).toBe(true)
      database.deleteProject('protected-project', 'active-owner')
      expect(database.getProject('protected-project')).toBeUndefined()
    } finally {
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

