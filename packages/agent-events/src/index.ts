import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { AgentEvent, AgentEventRecord, Checkpoint, FeatureChangeSummary, RecordAgentSummaryInput } from '@vibegit/shared'
import { redactSecrets, VibeGitError } from '@vibegit/shared'
import { VibeGitDatabase } from '@vibegit/database'
import { CheckpointEngine } from '@vibegit/checkpoint-engine'

export interface AgentEventResult {
  event: AgentEventRecord
  checkpoint?: Checkpoint
  changed: boolean
  summaryRequired?: boolean
}

interface StoredAgentSummary {
  projectPath: string
  agent: RecordAgentSummaryInput['agent']
  sessionId?: string
  summary: FeatureChangeSummary
  createdAt: string
}

function summaryLabel(summary: FeatureChangeSummary): string {
  if (summary.overview) return summary.overview
  const parts = [
    summary.added.length ? `新增 ${summary.added.length} 项` : '',
    summary.improved.length ? `改进 ${summary.improved.length} 项` : '',
    summary.removed.length ? `移除 ${summary.removed.length} 项` : ''
  ].filter(Boolean)
  return parts.join('、')
}

function automaticSummary(agent: AgentEvent['agent']): FeatureChangeSummary {
  const label = agent === 'codex' ? 'Codex' : 'Claude Code'
  return {
    overview: `VibeGit automatically recorded this checkpoint because ${label} did not provide a plain-language feature summary.`,
    added: [],
    improved: [],
    removed: []
  }
}

export function adaptHookEvent(input: unknown, agent: AgentEvent['agent']): AgentEvent | undefined {
  if (!input || typeof input !== 'object') throw new VibeGitError('INVALID_HOOK_EVENT', 'Hook 输入必须是 JSON 对象')
  const record = input as Record<string, unknown>
  const eventName = record.hook_event_name
  if (eventName !== 'UserPromptSubmit' && eventName !== 'Stop' && eventName !== 'StopFailure') return undefined
  if (typeof record.cwd !== 'string' || !record.cwd) throw new VibeGitError('INVALID_HOOK_EVENT', 'Hook 输入缺少 cwd')
  const sourceId = typeof record.turn_id === 'string'
    ? record.turn_id
    : typeof record.prompt_id === 'string'
      ? record.prompt_id
      : undefined
  return {
    event: eventName === 'UserPromptSubmit' ? 'task-start' : 'task-end',
    agent,
    projectPath: record.cwd,
    timestamp: new Date().toISOString(),
    ...(typeof record.session_id === 'string' ? { sessionId: record.session_id } : {}),
    ...(sourceId ? { eventId: sourceId } : {}),
    ...(eventName === 'UserPromptSubmit' && typeof record.prompt === 'string' ? { taskText: record.prompt } : {}),
    ...(eventName === 'StopFailure' ? { success: false } : {}),
    ...(typeof record.stop_hook_active === 'boolean' ? { stopHookActive: record.stop_hook_active } : {})
  }
}

function taskTitle(event: AgentEvent, safeTaskText?: string): string {
  const firstLine = safeTaskText?.split(/\r?\n/, 1)[0]?.trim()
  if (firstLine) return firstLine.slice(0, 80)
  if (event.success === false) return 'Agent 任务中断后的保存点'
  return event.success === true ? 'Agent 完成修改' : 'Agent 本轮结束后的保存点'
}

function pathContains(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
}

export class AgentEventService {
  constructor(
    readonly database: VibeGitDatabase,
    readonly checkpoints: CheckpointEngine,
    readonly dataDirectory: string
  ) {}

  private summaryDirectory(): string {
    return join(this.dataDirectory, 'agent-change-summaries')
  }

  async recordSummary(input: RecordAgentSummaryInput): Promise<void> {
    const projectPath = await realpath(resolve(input.projectPath))
    const project = this.database.listProjects()
      .filter((candidate) => pathContains(candidate.path, projectPath))
      .sort((left, right) => right.path.length - left.path.length)[0]
    if (!project || !project.protectionEnabled) {
      throw new VibeGitError('PROJECT_NOT_REGISTERED', 'Register this project and enable VibeGit protection before recording a change summary')
    }
    const record: StoredAgentSummary = {
      projectPath: project.path,
      agent: input.agent,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      summary: input.summary,
      createdAt: new Date().toISOString()
    }
    await mkdir(this.summaryDirectory(), { recursive: true })
    await writeFile(join(this.summaryDirectory(), `${randomUUID()}.json`), JSON.stringify(record), 'utf8')
  }

  private async consumeSummary(projectPath: string, agent: RecordAgentSummaryInput['agent'], sessionId?: string): Promise<FeatureChangeSummary | undefined> {
    let candidates: Array<{ path: string; record: StoredAgentSummary }> = []
    try {
      const files = await readdir(this.summaryDirectory())
      candidates = (await Promise.all(files.filter((file) => file.endsWith('.json')).map(async (file) => {
        try {
          const record = JSON.parse(await readFile(join(this.summaryDirectory(), file), 'utf8')) as StoredAgentSummary
          return record.projectPath === projectPath && record.agent === agent && (sessionId ? record.sessionId === sessionId : !record.sessionId)
            ? { path: join(this.summaryDirectory(), file), record }
            : undefined
        } catch { return undefined }
      }))).filter((entry): entry is { path: string; record: StoredAgentSummary } => Boolean(entry))
    } catch { return undefined }
    const selected = candidates.sort((left, right) => right.record.createdAt.localeCompare(left.record.createdAt))[0]
    if (!selected) return undefined
    try { await unlink(selected.path) } catch { /* The checkpoint can still use the summary once. */ }
    return selected.record.summary
  }

  async handle(input: AgentEvent, options: { enforceSummary?: boolean } = {}): Promise<AgentEventResult> {
    let projectPath: string
    try {
      projectPath = await realpath(resolve(input.projectPath))
    } catch (error) {
      throw new VibeGitError('PROJECT_PATH_UNAVAILABLE', 'Agent 事件中的项目目录无法访问', {
        detail: resolve(input.projectPath),
        cause: error
      })
    }
    const project = this.database.listProjects()
      .filter((candidate) => pathContains(candidate.path, projectPath))
      .sort((left, right) => right.path.length - left.path.length)[0]
    if (!project) {
      throw new VibeGitError('PROJECT_NOT_REGISTERED', '这个项目还没有添加到 VibeGit', {
        detail: projectPath,
        remediation: '先在桌面应用中添加项目并开启版本保护。'
      })
    }
    if (!project.protectionEnabled) {
      throw new VibeGitError('PROTECTION_NOT_ENABLED', '这个项目尚未开启版本保护', {
        remediation: '先在桌面应用中点击“开启版本保护”。'
      })
    }
    const taskText = input.taskText ? redactSecrets(input.taskText).slice(0, 10_000) : undefined
    let reservationId: string | undefined
    if (input.eventId) {
      reservationId = randomUUID()
      const reserved = this.database.reserveAgentEvent({
        id: reservationId,
        projectId: project.id,
        event: input.event,
        agent: input.agent,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        sourceEventId: input.eventId,
        ...(taskText ? { taskText } : {}),
        createdAt: input.timestamp,
        ...(input.success !== undefined ? { success: input.success } : {}),
        message: '正在处理'
      })
      if (!reserved) {
        const existing = this.database.getAgentEventBySource(project.id, input.agent, input.event, input.eventId)
        if (!existing) throw new VibeGitError('AGENT_EVENT_RESERVATION_RACE', 'Agent 事件正在由另一个进程处理', { retryable: true })
        const checkpoint = existing.checkpointId ? this.database.getCheckpoint(existing.checkpointId) : undefined
        const event = this.database.isAgentEventReservation(existing.id)
          ? { ...existing, message: '同一事件正在处理，未重复创建保存点' }
          : existing
        return { event, ...(checkpoint ? { checkpoint } : {}), changed: event.event === 'task-end' && Boolean(checkpoint) }
      }
    }
    const persist = (record: AgentEventRecord): void => {
      if (reservationId) this.database.completeReservedAgentEvent(record)
      else this.database.insertAgentEvent(record)
    }

    try {
      if (input.event === 'task-start') {
        const checkpoint = await this.checkpoints.create({
          projectId: project.id,
          type: 'pre_agent',
          title: '修改前保护点',
          agent: input.agent,
          ...(input.sessionId ? { agentSessionId: input.sessionId } : {}),
          ...(taskText ? { taskText } : {}),
          summary: `${input.agent === 'codex' ? 'Codex' : 'Claude Code'} 开始任务前自动保护`,
          metadata: { source: 'agent-event', eventTimestamp: input.timestamp },
          allowEmpty: true
        })
        if (!checkpoint) throw new VibeGitError('PRE_AGENT_CHECKPOINT_FAILED', '未能创建修改前保护点')
        const record: AgentEventRecord = {
          id: reservationId ?? randomUUID(),
          projectId: project.id,
          event: input.event,
          agent: input.agent,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(input.eventId ? { sourceEventId: input.eventId } : {}),
          ...(taskText ? { taskText } : {}),
          createdAt: input.timestamp,
          checkpointId: checkpoint.id,
          message: '已创建修改前保护点'
        }
        persist(record)
        return { event: record, checkpoint, changed: false }
      }

      const started = this.database.getLatestAgentStart(project.id, input.agent, input.sessionId)
      const resolvedTaskText = taskText ?? started?.taskText
      const featureSummary = await this.consumeSummary(project.path, input.agent, input.sessionId)
      if (!featureSummary && options.enforceSummary && !input.stopHookActive && await this.checkpoints.hasPendingChanges(project.id)) {
        if (reservationId) this.database.deleteAgentEventReservation(reservationId)
        return {
          event: {
            id: randomUUID(),
            projectId: project.id,
            event: input.event,
            agent: input.agent,
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            ...(input.eventId ? { sourceEventId: input.eventId } : {}),
            ...(resolvedTaskText ? { taskText: resolvedTaskText } : {}),
            createdAt: input.timestamp,
            ...(input.success !== undefined ? { success: input.success } : {}),
            message: '检测到文件变化，正在等待 Agent 生成 VibeGit 功能说明'
          },
          changed: false,
          summaryRequired: true
        }
      }
      const resolvedFeatureSummary = featureSummary ?? automaticSummary(input.agent)
      const featureSummarySource = featureSummary ? 'agent' : 'auto-generated'
      const checkpoint = await this.checkpoints.create({
        projectId: project.id,
        type: 'post_agent',
        title: taskTitle(input, resolvedTaskText),
        agent: input.agent,
        ...(input.sessionId ? { agentSessionId: input.sessionId } : {}),
        ...(resolvedTaskText ? { taskText: resolvedTaskText } : {}),
        summary: summaryLabel(resolvedFeatureSummary),
        testStatus: input.testStatus ?? 'unknown',
        metadata: {
          source: 'agent-event',
          eventTimestamp: input.timestamp,
          ...(input.success !== undefined ? { success: input.success } : {}),
          featureSummary: resolvedFeatureSummary,
          featureSummarySource,
          ...(started ? { startEventId: started.id, preAgentCheckpointId: started.checkpointId } : {})
        }
      })
      const record: AgentEventRecord = {
        id: reservationId ?? randomUUID(),
        projectId: project.id,
        event: input.event,
        agent: input.agent,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.eventId ? { sourceEventId: input.eventId } : {}),
        ...(resolvedTaskText ? { taskText: resolvedTaskText } : {}),
        createdAt: input.timestamp,
        ...(input.success !== undefined ? { success: input.success } : {}),
        ...(checkpoint ? { checkpointId: checkpoint.id } : {}),
        message: checkpoint
          ? input.success === undefined ? '本轮已结束，已创建功能保存点（任务状态未知）' : '已创建功能保存点'
          : input.success === undefined ? '本轮已结束，但没有检测到文件变化（任务状态未知）' : '任务完成，但没有检测到文件变化'
      }
      persist(record)
      return { event: record, ...(checkpoint ? { checkpoint } : {}), changed: Boolean(checkpoint) }
    } catch (error) {
      if (reservationId) this.database.deleteAgentEventReservation(reservationId)
      throw error
    }
  }
}
