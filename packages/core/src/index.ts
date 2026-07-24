import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import type {
  AddProjectInput,
  AgentConnectionStatus,
  AgentEvent,
  AppSettings,
  Checkpoint,
  CheckpointDiff,
  ConnectRemoteInput,
  CreateCheckpointInput,
  CreatePrivateRepositoryInput,
  GitHubCliStatus,
  GitHubOnboardingResult,
  GitHubSyncResult,
  HealthStatus,
  Project,
  RecordAgentSummaryInput,
  RemoveProjectResult,
  RestorePreview,
  RestoreRecord,
  SensitiveRisk,
  SensitiveScanResult,
  ShelvedChange
} from '@vibegit/shared'
import { VibeGitError } from '@vibegit/shared'
import { VibeGitDatabase } from '@vibegit/database'
import { GitCommandRunner, GitEngine } from '@vibegit/git-engine'
import { CheckpointEngine } from '@vibegit/checkpoint-engine'
import { AgentEventService, type AgentEventResult } from '@vibegit/agent-events'
import { GitHubProvider, VIBEGIT_REMOTE_NAME } from '@vibegit/github-provider'

export interface VibeGitServiceOptions {
  dataDirectory?: string
  gitExecutable?: string
  ghExecutable?: string
  commandTimeoutMs?: number
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

export function defaultDataDirectory(): string {
  if (process.env.VIBEGIT_DATA_DIR) return resolve(process.env.VIBEGIT_DATA_DIR)
  if (process.platform === 'win32' && process.env.APPDATA) return resolve(process.env.APPDATA, 'VibeGit')
  if (process.platform === 'darwin') return resolve(homedir(), 'Library', 'Application Support', 'VibeGit')
  return resolve(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'vibegit')
}

function bundledGitHubCliExecutable(): string | undefined {
  if (process.platform !== 'win32') return undefined
  const candidates = [
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'GitHub CLI', 'gh.exe') : undefined,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'GitHub CLI', 'gh.exe') : undefined
  ]
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))
}

async function executableOnPath(name: string): Promise<boolean> {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which'
  return await new Promise<boolean>((resolvePromise) => {
    const child = spawn(locator, [name], { shell: false, windowsHide: true, stdio: 'ignore' })
    child.on('error', () => resolvePromise(false))
    child.on('close', (code) => resolvePromise(code === 0))
  })
}

function knownAgentExecutable(name: 'codex' | 'claude'): string | undefined {
  if (process.platform !== 'win32') return undefined
  const candidates = [
    process.env.APPDATA ? join(process.env.APPDATA, 'npm', `${name}.cmd`) : undefined,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'npm', `${name}.cmd`) : undefined,
    join(homedir(), '.local', 'bin', `${name}.exe`),
    join(homedir(), '.local', 'bin', `${name}.cmd`),
    join(homedir(), '.local', 'bin', name)
  ]
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))
}

async function agentExecutableAvailable(name: 'codex' | 'claude'): Promise<boolean> {
  return await executableOnPath(name) || Boolean(knownAgentExecutable(name))
}

export class VibeGitService {
  readonly settings: AppSettings
  readonly database: VibeGitDatabase
  readonly git: GitEngine
  readonly checkpoints: CheckpointEngine
  readonly agentEvents: AgentEventService
  readonly github: GitHubProvider

  constructor(options: VibeGitServiceOptions = {}) {
    const dataDirectory = resolve(options.dataDirectory ?? defaultDataDirectory())
    const commandTimeoutMs = options.commandTimeoutMs ?? 20_000
    const ghExecutable = options.ghExecutable ?? bundledGitHubCliExecutable()
    this.settings = {
      ...(options.gitExecutable ? { gitExecutable: options.gitExecutable } : {}),
      ...(ghExecutable ? { ghExecutable } : {}),
      dataDirectory,
      commandTimeoutMs
    }
    this.database = new VibeGitDatabase(join(dataDirectory, 'vibegit.sqlite'))
    this.git = new GitEngine(new GitCommandRunner({
      ...(options.gitExecutable ? { executable: options.gitExecutable } : {}),
      timeoutMs: commandTimeoutMs
    }))
    this.checkpoints = new CheckpointEngine(this.database, this.git)
    this.agentEvents = new AgentEventService(this.database, this.checkpoints, dataDirectory)
    this.github = new GitHubProvider(this.database, this.git, this.checkpoints, {
      ...(ghExecutable ? { ghExecutable } : {}),
      dataDirectory,
      timeoutMs: commandTimeoutMs
    })
  }

  close(): void {
    this.database.close()
  }

  async health(): Promise<HealthStatus> {
    let git: HealthStatus['git'] = 'unavailable'
    try { await this.git.version(this.settings.dataDirectory); git = 'ok' } catch { /* Report unavailable. */ }
    return {
      ready: this.database.health(),
      database: 'ok',
      git,
      version: '0.1.0'
    }
  }

  async addProject(input: AddProjectInput): Promise<Project> {
    const requested = resolve(input.path)
    let projectPath: string
    try {
      const info = await stat(requested)
      if (!info.isDirectory()) throw new VibeGitError('PROJECT_PATH_NOT_DIRECTORY', '请选择项目文件夹，而不是单个文件')
      projectPath = await realpath(requested)
    } catch (error) {
      if (error instanceof VibeGitError) throw error
      throw new VibeGitError('PROJECT_PATH_UNAVAILABLE', '项目文件夹不存在或无法访问', {
        detail: requested,
        remediation: '重新选择一个可访问的本地文件夹。',
        cause: error
      })
    }
    const existing = this.database.getProjectByPath(projectPath)
    if (existing) {
      if (input.initialize && !existing.protectionEnabled) return (await this.initializeProtection(existing.id)).project
      return await this.refreshProject(existing.id)
    }

    const repositoryRoot = await this.git.getRepositoryRoot(projectPath)
    if (repositoryRoot && !samePath(repositoryRoot, projectPath)) {
      throw new VibeGitError('PROJECT_MUST_BE_REPOSITORY_ROOT', '所选文件夹位于一个更大的 Git 项目中', {
        detail: repositoryRoot,
        remediation: '请选择提示路径中的项目根目录；这样备份和回退不会越过你选择的范围。'
      })
    }
    const isGitRepository = Boolean(repositoryRoot)
    const now = new Date().toISOString()
    const project: Project = {
      id: randomUUID(),
      name: basename(projectPath) || projectPath,
      path: projectPath,
      createdAt: now,
      lastActivityAt: now,
      isGitRepository,
      protectionEnabled: false,
      hasUnsavedChanges: isGitRepository ? (await this.git.getStatus(projectPath)).hasChanges : true,
      untrackedFiles: isGitRepository ? (await this.git.getStatus(projectPath)).untracked.length : 0,
      githubSyncStatus: 'not_configured'
    }
    this.database.upsertProject(project)
    if (input.initialize) return (await this.initializeProtection(project.id)).project
    return project
  }

  async removeProject(projectId: string): Promise<RemoveProjectResult> {
    const project = this.requireProject(projectId)
    const checkpoints = this.database.listCheckpoints(project.id)
    for (const checkpoint of checkpoints) {
      try { await this.git.deleteCheckpointRef(project.path, checkpoint.id) }
      catch { /* If the working repository has moved, still remove VibeGit's local registry. */ }
    }
    this.database.deleteProject(project.id)
    return { projectId: project.id, removedCheckpoints: checkpoints.length }
  }

  async initializeProtection(projectId: string): Promise<{ project: Project; checkpoint: Checkpoint }> {
    const project = this.requireProject(projectId)
    await this.git.initialize(project.path)
    const updated: Project = {
      ...project,
      isGitRepository: true,
      protectionEnabled: project.protectionEnabled,
      lastActivityAt: new Date().toISOString()
    }
    this.database.upsertProject(updated)
    const existing = this.database.getLatestCheckpoint(projectId)
    const checkpoint = existing ?? await this.checkpoints.create({
      projectId,
      type: 'initial',
      title: '初始化项目',
      agent: 'system',
      summary: '已开启版本保护并保存当前项目状态',
      allowEmpty: true
    })
    if (!checkpoint) throw new VibeGitError('INITIAL_CHECKPOINT_FAILED', '未能创建初始保存点')
    return { project: await this.refreshProject(projectId), checkpoint }
  }

  async listProjects(): Promise<Project[]> {
    const projects = this.database.listProjects()
    const refreshed: Project[] = []
    for (const project of projects) {
      try { refreshed.push(await this.refreshProject(project.id)) }
      catch { refreshed.push(project) }
    }
    return refreshed
  }

  async refreshProject(projectId: string): Promise<Project> {
    const project = this.requireProject(projectId)
    const isGitRepository = await this.git.isRepository(project.path)
    if (!isGitRepository) {
      const updated = { ...project, isGitRepository: false, protectionEnabled: false, hasUnsavedChanges: true, untrackedFiles: 0 }
      this.database.upsertProject(updated)
      return updated
    }
    const [status, remoteUrl, capture] = await Promise.all([
      this.git.getStatus(project.path),
      this.git.getRemoteUrl(project.path, VIBEGIT_REMOTE_NAME),
      this.git.captureWorktreeTree(project.path)
    ])
    const latest = this.database.getLatestCheckpoint(projectId)
    const active = this.database.getActiveCheckpoint(projectId) ?? latest
    const activeTree = active ? await this.git.getCommitTree(project.path, active.gitObjectId) : undefined
    const validatedRemoteUrl = project.githubRemoteUrl && remoteUrl === project.githubRemoteUrl
      ? remoteUrl
      : undefined
    const updated: Project = {
      ...project,
      isGitRepository: true,
      protectionEnabled: project.protectionEnabled && Boolean(latest),
      hasUnsavedChanges: activeTree ? capture.treeObjectId !== activeTree : status.hasChanges,
      untrackedFiles: status.untracked.length,
      lastActivityAt: latest?.createdAt ?? project.lastActivityAt,
      ...(latest ? { lastCheckpointAt: latest.createdAt, lastAgent: latest.agent } : {}),
      githubSyncStatus: validatedRemoteUrl ? project.githubSyncStatus : 'not_configured',
      ...(validatedRemoteUrl ? { githubRemoteUrl: validatedRemoteUrl } : {})
    }
    if (!validatedRemoteUrl) {
      delete updated.githubRemoteUrl
      delete updated.lastSyncedAt
    }
    this.database.upsertProject(updated)
    return updated
  }

  async createCheckpoint(input: CreateCheckpointInput): Promise<Checkpoint> {
    const checkpoint = await this.checkpoints.create(input)
    if (!checkpoint) throw new VibeGitError('NO_CHANGES', '当前没有需要保存的新修改', {
      remediation: '文件发生变化后再创建保存点。'
    })
    return checkpoint
  }

  listCheckpoints(projectId: string): Checkpoint[] {
    return this.checkpoints.list(projectId)
  }

  async getCheckpointDiff(checkpointId: string): Promise<CheckpointDiff> {
    return await this.checkpoints.diff(checkpointId)
  }

  async prepareRestore(projectId: string, checkpointId: string): Promise<RestorePreview> {
    return await this.checkpoints.prepareRestore(projectId, checkpointId)
  }

  async executeRestore(token: string): Promise<RestoreRecord> {
    return await this.checkpoints.executeRestore(token)
  }

  async undoRestore(restoreId: string): Promise<RestoreRecord> {
    return await this.checkpoints.undoRestore(restoreId)
  }

  listShelves(projectId: string): ShelvedChange[] {
    return this.checkpoints.listShelves(projectId)
  }

  async createShelf(projectId: string, title: string): Promise<ShelvedChange> {
    return await this.checkpoints.shelve(projectId, title)
  }

  async retrieveShelf(shelfId: string): Promise<ShelvedChange> {
    return await this.checkpoints.retrieveShelf(shelfId)
  }

  getRestore(restoreId: string): RestoreRecord {
    const record = this.database.getRestore(restoreId)
    if (!record) throw new VibeGitError('RESTORE_NOT_FOUND', '找不到这次回退记录')
    return record
  }

  getFailedRestoreForToken(token: string): RestoreRecord | null {
    const restore = this.database.getRestoreByToken(token)?.record
    return restore?.status === 'failed' && restore.recoveryDirectory ? restore : null
  }

  listFailedRestores(projectId: string): RestoreRecord[] {
    this.requireProject(projectId)
    return this.database.listFailedRestoresWithRecovery(projectId)
  }

  async handleAgentEvent(event: AgentEvent): Promise<AgentEventResult> {
    return await this.agentEvents.handle(event)
  }

  async recordAgentSummary(input: RecordAgentSummaryInput): Promise<void> {
    await this.agentEvents.recordSummary(input)
  }

  listAgentEvents(projectId: string) {
    this.requireProject(projectId)
    return this.database.listAgentEvents(projectId)
  }

  async githubStatus(): Promise<GitHubCliStatus> {
    return await this.github.status(this.settings.dataDirectory)
  }

  async authorizeGitHub(): Promise<GitHubOnboardingResult> {
    return await this.github.authorizeAndProvisionSshKey(this.settings.dataDirectory)
  }

  async scanSensitiveFiles(projectId: string): Promise<SensitiveScanResult> {
    return await this.github.scan(projectId)
  }

  async ignoreSensitiveRisk(projectId: string, risk: SensitiveRisk): Promise<SensitiveScanResult> {
    return await this.github.ignoreRisk(projectId, risk)
  }

  async createPrivateRepository(input: CreatePrivateRepositoryInput): Promise<Project> {
    await this.github.createPrivateRepository(input.projectId, input.name, input.owner)
    return await this.refreshProject(input.projectId)
  }

  async connectRemote(input: ConnectRemoteInput): Promise<Project> {
    await this.github.connect(input.projectId, input.remoteUrl)
    return await this.refreshProject(input.projectId)
  }

  async pushToGitHub(projectId: string): Promise<GitHubSyncResult> {
    return await this.github.push(projectId)
  }

  async agentStatus(): Promise<AgentConnectionStatus> {
    const [codexInstalled, claudeInstalled] = await Promise.all([
      agentExecutableAvailable('codex'),
      agentExecutableAvailable('claude')
    ])
    return {
      codex: {
        installed: codexInstalled,
        integration: codexInstalled ? 'template' : 'not_configured',
        detail: codexInstalled ? '检测到 Codex；事件 CLI 模板可用' : '未在 PATH 中检测到 Codex CLI'
      },
      claudeCode: {
        installed: claudeInstalled,
        integration: claudeInstalled ? 'template' : 'not_configured',
        detail: claudeInstalled ? '检测到 Claude Code；事件 CLI 模板可用' : '未在 PATH 中检测到 Claude Code'
      }
    }
  }

  private requireProject(projectId: string): Project {
    const project = this.database.getProject(projectId)
    if (!project) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
    return project
  }
}

export * from '@vibegit/shared'
