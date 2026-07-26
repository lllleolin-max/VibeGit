import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TestSandbox } from '../helpers'
import { cleanupSandbox, createSandbox, writeProjectFile } from '../helpers'
import { parseAgentEvent, parseRecordAgentSummary } from '@vibegit/shared'
import { adaptHookEvent } from '@vibegit/agent-events'
import { VibeGitService } from '@vibegit/core'

const fakeSecret = () => ['abcdefghijklm', 'nopqrstuvwxyz123456'].join('')

describe('Agent events', () => {
  let sandbox: TestSandbox | undefined
  afterEach(async () => { if (sandbox) await cleanupSandbox(sandbox); sandbox = undefined })

  it('creates pre/post Agent checkpoints and skips a no-change task end', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'app.ts', 'export const value = 1\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const timestamp = new Date().toISOString()
    const start = await sandbox.service.handleAgentEvent({
      event: 'task-start', agent: 'codex', projectPath: sandbox.projectPath,
      sessionId: 'session-1', taskText: '增加邮箱验证码登录', timestamp
    })
    expect(start.checkpoint?.type).toBe('pre_agent')

    await writeProjectFile(sandbox, 'app.ts', 'export const value = 2\n')
    const end = await sandbox.service.handleAgentEvent({
      event: 'task-end', agent: 'codex', projectPath: sandbox.projectPath,
      sessionId: 'session-1', success: true, timestamp: new Date().toISOString()
    })
    expect(end.changed).toBe(true)
    expect(end.checkpoint).toMatchObject({ type: 'post_agent', taskText: '增加邮箱验证码登录', agent: 'codex' })

    const noChange = await sandbox.service.handleAgentEvent({
      event: 'task-end', agent: 'codex', projectPath: sandbox.projectPath,
      sessionId: 'session-1', success: true, timestamp: new Date().toISOString()
    })
    expect(noChange.changed).toBe(false)
    expect(noChange.event.message).toContain('没有检测到文件变化')
  })

  it('validates stdin event shape', () => {
    expect(() => parseAgentEvent({ event: 'wrong' })).toThrow(/event 必须/)
    expect(parseAgentEvent({ event: 'task-start', agent: 'claude-code', projectPath: 'C:/demo', timestamp: '2026-07-11T08:00:00Z' })).toMatchObject({ agent: 'claude-code' })
  })

  it('attaches the queued plain-language summary to the matching Agent checkpoint', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'app.ts', 'export const value = 1\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    await sandbox.service.handleAgentEvent({
      event: 'task-start', agent: 'codex', projectPath: sandbox.projectPath,
      sessionId: 'summary-session', timestamp: new Date().toISOString()
    })
    await sandbox.service.recordAgentSummary(parseRecordAgentSummary({
      projectPath: sandbox.projectPath,
      agent: 'codex',
      sessionId: 'summary-session',
      summary: { overview: '用户现在可以使用邮箱验证码登录。', added: ['邮箱验证码登录'], improved: ['登录失败提示'], removed: [] }
    }))
    await writeProjectFile(sandbox, 'app.ts', 'export const value = 2\n')
    const result = await sandbox.service.handleAgentEvent({
      event: 'task-end', agent: 'codex', projectPath: sandbox.projectPath,
      sessionId: 'summary-session', timestamp: new Date().toISOString()
    })
    expect(result.checkpoint?.summary).toBe('用户现在可以使用邮箱验证码登录。')
    expect(result.checkpoint?.metadata).toMatchObject({
      featureSummary: { added: ['邮箱验证码登录'], improved: ['登录失败提示'], removed: [] }
    })
  })

  it('asks a Hook-managed Agent for a summary before the first task end, then uses a transparent fallback', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'app.ts', 'export const value = 1\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    await sandbox.service.handleAgentEvent({
      event: 'task-start', agent: 'codex', projectPath: sandbox.projectPath,
      sessionId: 'enforced-summary', timestamp: new Date().toISOString()
    }, { enforceSummary: true })
    await writeProjectFile(sandbox, 'app.ts', 'export const value = 2\n')

    const firstStop = await sandbox.service.handleAgentEvent({
      event: 'task-end', agent: 'codex', projectPath: sandbox.projectPath,
      sessionId: 'enforced-summary', eventId: 'stop-1', timestamp: new Date().toISOString()
    }, { enforceSummary: true })
    expect(firstStop).toMatchObject({ changed: false, summaryRequired: true })
    expect(sandbox.service.listCheckpoints(project.id).filter((item) => item.type === 'post_agent')).toHaveLength(0)

    const fallback = await sandbox.service.handleAgentEvent({
      event: 'task-end', agent: 'codex', projectPath: sandbox.projectPath,
      sessionId: 'enforced-summary', eventId: 'stop-2', stopHookActive: true, timestamp: new Date().toISOString()
    }, { enforceSummary: true })
    expect(fallback.checkpoint?.metadata).toMatchObject({ featureSummarySource: 'auto-generated' })
    expect(fallback.checkpoint?.summary).toContain('automatically recorded')
  })

  it('does not attach a summary from a different Agent session', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'app.ts', 'export const value = 1\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    await sandbox.service.handleAgentEvent({
      event: 'task-start', agent: 'codex', projectPath: sandbox.projectPath,
      sessionId: 'current-session', timestamp: new Date().toISOString()
    })
    await sandbox.service.recordAgentSummary({
      projectPath: sandbox.projectPath,
      agent: 'codex',
      sessionId: 'old-session',
      summary: { overview: 'Old session summary', added: [], improved: [], removed: [] }
    })
    await writeProjectFile(sandbox, 'app.ts', 'export const value = 2\n')

    const ended = await sandbox.service.handleAgentEvent({
      event: 'task-end', agent: 'codex', projectPath: sandbox.projectPath,
      sessionId: 'current-session', timestamp: new Date().toISOString()
    })
    expect(ended.checkpoint?.metadata).toMatchObject({ featureSummarySource: 'auto-generated' })
    expect(ended.checkpoint?.summary).not.toContain('Old session summary')
  })

  it('removes only VibeGit records when a protected project is removed', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'app.ts', 'export const value = 1\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initialized = await sandbox.service.initializeProtection(project.id)
    const result = await sandbox.service.removeProject(project.id)
    expect(result).toMatchObject({ projectId: project.id, removedCheckpoints: 1 })
    expect(await sandbox.service.listProjects()).toEqual([])
    await expect(sandbox.service.git.verifyCommit(sandbox.projectPath, initialized.checkpoint.gitObjectId)).resolves.toBeUndefined()
  })

  it('adapts Hook JSON, redacts prompt secrets, and deduplicates retries', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'app.ts', 'export const ok = true\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const adapted = adaptHookEvent({
      hook_event_name: 'UserPromptSubmit', cwd: sandbox.projectPath,
      session_id: 'hook-session', turn_id: 'turn-1',
      prompt: `修复登录 ${['API', 'KEY'].join('_')}=${fakeSecret()} ${['ghp', '_'].join('')}${fakeSecret()} ${['npm', '_'].join('')}${fakeSecret()}`
    }, 'codex')
    expect(adapted).toBeDefined()
    const first = await sandbox.service.handleAgentEvent(adapted!)
    const repeated = await sandbox.service.handleAgentEvent(adapted!)
    expect(repeated.checkpoint?.id).toBe(first.checkpoint?.id)
    expect(first.checkpoint?.taskText).toContain('[REDACTED]')
    expect(first.checkpoint?.taskText).not.toContain('ghp_')
    expect(first.checkpoint?.taskText).not.toContain('npm_')
    expect(sandbox.service.listCheckpoints(project.id).filter((item) => item.type === 'pre_agent')).toHaveLength(1)
    expect(adaptHookEvent({ hook_event_name: 'StopFailure', cwd: sandbox.projectPath, session_id: 'hook-session' }, 'claude-code')).toMatchObject({ event: 'task-end', success: false })

    await writeProjectFile(sandbox, 'app.ts', 'export const ok = false\n')
    const ordinaryStop = adaptHookEvent({
      hook_event_name: 'Stop', cwd: sandbox.projectPath,
      session_id: 'hook-session', turn_id: 'turn-1'
    }, 'codex')
    expect(ordinaryStop).not.toHaveProperty('success')
    const stopped = await sandbox.service.handleAgentEvent(ordinaryStop!)
    expect(stopped.event.success).toBeUndefined()
    expect(stopped.event.message).toContain('任务状态未知')
    expect(stopped.checkpoint?.metadata).not.toHaveProperty('success')
    expect(stopped.checkpoint?.metadata).toMatchObject({ featureSummarySource: 'auto-generated' })
    expect(stopped.checkpoint?.summary).toContain('automatically recorded')
  })

  it('atomically deduplicates concurrent Hook retries across service instances', async () => {
    sandbox = await createSandbox('concurrent agent events')
    await writeProjectFile(sandbox, 'app.ts', 'export const value = 1\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const competitor = new VibeGitService({ dataDirectory: sandbox.dataDirectory, commandTimeoutMs: 10_000 })
    const startEvent = {
      event: 'task-start' as const,
      agent: 'codex' as const,
      projectPath: sandbox.projectPath,
      sessionId: 'concurrent-session',
      eventId: 'turn-concurrent',
      taskText: '并发去重',
      timestamp: new Date().toISOString()
    }

    try {
      await Promise.all([
        sandbox.service.handleAgentEvent(startEvent),
        competitor.handleAgentEvent(startEvent)
      ])
      expect(sandbox.service.listCheckpoints(project.id).filter((item) => item.type === 'pre_agent')).toHaveLength(1)

      await writeProjectFile(sandbox, 'app.ts', 'export const value = 2\n')
      const endEvent = {
        event: 'task-end' as const,
        agent: 'codex' as const,
        projectPath: sandbox.projectPath,
        sessionId: 'concurrent-session',
        eventId: 'turn-concurrent',
        timestamp: new Date().toISOString()
      }
      await Promise.all([
        sandbox.service.handleAgentEvent(endEvent),
        competitor.handleAgentEvent(endEvent)
      ])
      expect(sandbox.service.listCheckpoints(project.id).filter((item) => item.type === 'post_agent')).toHaveLength(1)
      expect(sandbox.service.database.listAgentEvents(project.id).filter((item) => item.sourceEventId === 'turn-concurrent')).toHaveLength(2)
    } finally {
      competitor.close()
    }
  })

  it('does not associate a sessionless task end with another Agent start', async () => {
    sandbox = await createSandbox('mixed agents without sessions')
    await writeProjectFile(sandbox, 'app.ts', 'export const value = 1\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const startedAt = new Date().toISOString()
    const codexStart = await sandbox.service.handleAgentEvent({
      event: 'task-start',
      agent: 'codex',
      projectPath: sandbox.projectPath,
      taskText: 'Codex task',
      timestamp: startedAt
    })
    await sandbox.service.handleAgentEvent({
      event: 'task-start',
      agent: 'claude-code',
      projectPath: sandbox.projectPath,
      taskText: 'Claude task',
      timestamp: startedAt
    })
    await writeProjectFile(sandbox, 'app.ts', 'export const value = 2\n')

    const ended = await sandbox.service.handleAgentEvent({
      event: 'task-end',
      agent: 'codex',
      projectPath: sandbox.projectPath,
      timestamp: new Date().toISOString()
    })

    expect(ended.checkpoint).toMatchObject({ agent: 'codex', taskText: 'Codex task' })
    expect(ended.checkpoint?.metadata).toMatchObject({ startEventId: codexStart.event.id })
  })

  it('locates the registered project when an Agent runs from a nested working directory', async () => {
    sandbox = await createSandbox('nested agent cwd')
    const nested = join(sandbox.projectPath, 'packages', 'app')
    await mkdir(nested, { recursive: true })
    await writeProjectFile(sandbox, 'app.txt', 'before\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)

    const started = await sandbox.service.handleAgentEvent({
      event: 'task-start',
      agent: 'codex',
      projectPath: nested,
      taskText: 'Nested task',
      timestamp: new Date().toISOString()
    })

    expect(started.checkpoint).toMatchObject({ projectId: project.id, type: 'pre_agent', taskText: 'Nested task' })
  })
})
