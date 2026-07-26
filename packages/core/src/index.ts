import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, join, resolve } from 'node:path'
import { readFile, realpath, stat, writeFile } from 'node:fs/promises'
import type {
  AddProjectInput,
  AgentConnectionStatus,
  AgentEvent,
  AppSettings,
  Checkpoint,
  CheckpointDiff,
  ChangeSummarySkillStatus,
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

const CHANGE_SUMMARY_SKILL_NAME = 'vibegit-change-summary'
const CHANGE_SUMMARY_SKILL_VERSION = '2'
const CHANGE_SUMMARY_SKILL_SOURCE = 'https://raw.githubusercontent.com/lllleolin-max/VibeGit/main/skills/vibegit-change-summary/SKILL.md'
const CHANGE_SUMMARY_SKILL_DEPLOYMENT_COMMAND = [
  'Install or upgrade the VibeGit Change Summary skill for all relevant agents on this computer.',
  `Download and inspect ${CHANGE_SUMMARY_SKILL_SOURCE}.`,
  `For every installed agent, create the matching global file with exactly that content: Codex -> %USERPROFILE%\\.codex\\skills\\${CHANGE_SUMMARY_SKILL_NAME}\\SKILL.md; Claude Code -> %USERPROFILE%\\.claude\\skills\\${CHANGE_SUMMARY_SKILL_NAME}\\SKILL.md.`,
  'Create missing directories, do not modify or remove any other skill or project file, then verify each created SKILL.md contains its YAML frontmatter.',
  `Verify that the installed skill declares vibegit-skill-version: ${CHANGE_SUMMARY_SKILL_VERSION}. Tell me which agents were configured and whether they need to restart.`
].join(' ')

const PROTECTION_MARKER_FILE = 'protected.json'
const PROTECTION_MARKER_PATH = '.git/vibegit/protected.json'

function installedChangeSummarySkill(path: string): boolean {
  try {
    if (!existsSync(path)) return false
    const content = readFileSync(path, 'utf8').slice(0, 2_048)
    return content.trimStart().startsWith('---')
      && content.includes(`name: ${CHANGE_SUMMARY_SKILL_NAME}`)
      && content.includes(`vibegit-skill-version: ${CHANGE_SUMMARY_SKILL_VERSION}`)
  } catch {
    return false
  }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function ensureProjectProtectionMarker(git: GitEngine, projectPath: string): Promise<void> {
  const markerDirectory = await git.getPrivateDataDirectory(projectPath)
  const markerPath = join(markerDirectory, PROTECTION_MARKER_FILE)
  const marker = {
    schemaVersion: 1,
    enabled: true,
    summarySkill: CHANGE_SUMMARY_SKILL_NAME
  }
  const existingMarker = await readOptionalText(markerPath)
  if (existingMarker) {
    try {
      const parsed = JSON.parse(existingMarker) as Record<string, unknown>
      if (parsed.schemaVersion !== 1 || parsed.summarySkill !== CHANGE_SUMMARY_SKILL_NAME) {
        throw new VibeGitError('VIBEGIT_MARKER_CONFLICT', `VibeGit protection marker conflicts with an existing file: ${PROTECTION_MARKER_PATH}`, {
          detail: markerPath,
          remediation: 'Remove the conflicting VibeGit marker, then enable protection again.'
        })
      }
    } catch (error) {
      if (error instanceof VibeGitError) throw error
      throw new VibeGitError('VIBEGIT_MARKER_CONFLICT', `VibeGit protection marker is not valid JSON: ${PROTECTION_MARKER_PATH}`, {
        detail: markerPath,
        remediation: 'Remove the invalid VibeGit marker, then enable protection again.',
        cause: error
      })
    }
  }
  if (existingMarker !== `${JSON.stringify(marker, null, 2)}\n`) await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
}

async function hasProjectProtectionMarker(git: GitEngine, projectPath: string): Promise<boolean> {
  try {
    const markerPath = join(await git.getPrivateDataDirectory(projectPath), PROTECTION_MARKER_FILE)
    const content = await readOptionalText(markerPath)
    if (!content) return false
    const marker = JSON.parse(content) as Record<string, unknown>
    return marker.schemaVersion === 1 && marker.enabled === true && marker.summarySkill === CHANGE_SUMMARY_SKILL_NAME
  } catch {
    return false
  }
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

type AgentExecutableName = 'codex' | 'claude'
type AgentDiscoverySource = 'path' | 'known-location' | 'volume-scan' | 'not-found'

interface AgentExecutableDiscovery {
  location?: string
  source: AgentDiscoverySource
}

function agentExecutableFileNames(name: AgentExecutableName): string[] {
  return process.platform === 'win32'
    ? [`${name}.cmd`, `${name}.exe`, `${name}.bat`, name]
    : [name]
}

async function runLocator(executable: string, args: string[], timeoutMs: number): Promise<{ stdout: string; exitCode: number | null }> {
  return await new Promise((resolvePromise) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout?.on('data', (chunk: Buffer | string) => { stdout += chunk.toString() })
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* The process has already exited. */ }
    }, timeoutMs)
    child.on('error', () => {
      clearTimeout(timer)
      resolvePromise({ stdout: '', exitCode: null })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ stdout, exitCode: code })
    })
  })
}

function existingExecutable(candidates: Iterable<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return undefined
}

function existingAgentExecutable(name: AgentExecutableName, candidates: Iterable<string | undefined>): string | undefined {
  const allowedNames = new Set(agentExecutableFileNames(name).map((fileName) => fileName.toLowerCase()))
  return existingExecutable(Array.from(candidates).filter((candidate) => candidate && allowedNames.has(basename(candidate).toLowerCase())))
}

async function executableOnPath(name: AgentExecutableName): Promise<string | undefined> {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = await runLocator(locator, [name], 2_500)
  if (result.exitCode !== 0) return undefined
  return existingAgentExecutable(name, result.stdout.split(/\r?\n/).map((line) => line.trim()))
}

async function windowsUserPathDirectories(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const queries = [
    ['query', 'HKCU\\Environment', '/v', 'Path'],
    ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', '/v', 'Path']
  ]
  const outputs = await Promise.all(queries.map((args) => runLocator('reg.exe', args, 2_000)))
  return outputs.flatMap((output) => output.stdout.split(/\r?\n/)
    .map((line) => line.match(/^\s*Path\s+REG_\w+\s+(.+)$/i)?.[1])
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(';')))
}

async function knownAgentExecutable(name: AgentExecutableName): Promise<string | undefined> {
  const fileNames = agentExecutableFileNames(name)
  const pathDirectories = [
    ...(process.env.PATH?.split(delimiter) ?? []),
    ...(await windowsUserPathDirectories())
  ]
  const candidates = [
    ...pathDirectories.flatMap((directory) => fileNames.map((fileName) => join(directory, fileName))),
    ...[
      process.env.APPDATA ? join(process.env.APPDATA, 'npm') : undefined,
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'npm') : undefined,
      process.env.APPDATA ? join(process.env.APPDATA, 'pnpm') : undefined,
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'pnpm') : undefined,
      join(homedir(), '.local', 'bin'),
      join(homedir(), 'scoop', 'shims'),
      join(homedir(), '.volta', 'bin'),
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Volta', 'bin') : undefined,
      process.env.ProgramData ? join(process.env.ProgramData, 'chocolatey', 'bin') : undefined,
      process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs') : undefined,
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'nodejs') : undefined
    ].flatMap((directory) => directory ? fileNames.map((fileName) => join(directory, fileName)) : [])
  ]
  return existingAgentExecutable(name, candidates)
}

function windowsVolumeRoots(): string[] {
  if (process.platform !== 'win32') return []
  return Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`).filter((root) => existsSync(root))
}

async function scanWindowsVolumes(name: AgentExecutableName): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined
  const results = await Promise.all(windowsVolumeRoots().map(async (root) => {
    const result = await runLocator('where.exe', ['/R', root, `${name}.*`], 8_000)
    if (result.exitCode !== 0) return undefined
    return existingAgentExecutable(name, result.stdout.split(/\r?\n/).map((line) => line.trim()))
  }))
  return results.find((result): result is string => Boolean(result))
}

async function discoverAgentExecutable(name: AgentExecutableName, scanAllDrives: boolean): Promise<AgentExecutableDiscovery> {
  const onPath = await executableOnPath(name)
  if (onPath) return { location: onPath, source: 'path' }
  const knownLocation = await knownAgentExecutable(name)
  if (knownLocation) return { location: knownLocation, source: 'known-location' }
  if (scanAllDrives) {
    const scannedLocation = await scanWindowsVolumes(name)
    if (scannedLocation) return { location: scannedLocation, source: 'volume-scan' }
  }
  return { source: 'not-found' }
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
      version: '1.0.0'
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
    await ensureProjectProtectionMarker(this.git, project.path)
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
    if (project.protectionEnabled) await ensureProjectProtectionMarker(this.git, project.path)
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

  renameCheckpoint(checkpointId: string, title: string): Checkpoint {
    const normalized = title.trim().replace(/\s+/g, ' ')
    if (!normalized || normalized.length > 160) {
      throw new VibeGitError('INVALID_CHECKPOINT_TITLE', '保存点名称需要是 1 到 160 个字符')
    }
    return this.database.renameCheckpoint(checkpointId, normalized)
  }

  async deleteCheckpoint(checkpointId: string): Promise<{ checkpointId: string; projectId: string }> {
    const checkpoint = this.database.prepareCheckpointDeletion(checkpointId)
    const project = this.requireProject(checkpoint.projectId)
    // Validate before removing the private Git ref. The database repeats the
    // validation transactionally when it removes the record.
    await this.git.deleteCheckpointRef(project.path, checkpoint.id)
    this.database.deleteCheckpoint(checkpoint.id)
    await this.refreshProject(project.id)
    return { checkpointId: checkpoint.id, projectId: project.id }
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

  async handleAgentEvent(event: AgentEvent, options?: { enforceSummary?: boolean }): Promise<AgentEventResult> {
    const result = await this.agentEvents.handle(event, options)
    const project = this.requireProject(result.event.projectId)
    await ensureProjectProtectionMarker(this.git, project.path)
    return result
  }

  async hasProjectProtectionMarker(projectId: string): Promise<boolean> {
    const project = this.requireProject(projectId)
    return await hasProjectProtectionMarker(this.git, project.path)
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

  async agentStatus(options: { scanAllDrives?: boolean } = {}): Promise<AgentConnectionStatus> {
    const [codex, claudeCode] = await Promise.all([
      discoverAgentExecutable('codex', options.scanAllDrives === true),
      discoverAgentExecutable('claude', options.scanAllDrives === true)
    ])
    const describe = (label: string, discovery: AgentExecutableDiscovery): AgentConnectionStatus['codex'] => {
      const detected = Boolean(discovery.location)
      return {
        installed: detected,
        integration: detected ? 'template' : 'not_configured',
        detail: detected
          ? `检测到 ${label}；事件 CLI 模板可用`
          : `未在 PATH 中检测到 ${label}`,
        detection: discovery.source,
        ...(discovery.location ? { location: discovery.location } : {})
      }
    }
    return {
      codex: describe('Codex', codex),
      claudeCode: describe('Claude Code', claudeCode)
    }
  }

  async changeSummarySkillStatus(agents?: AgentConnectionStatus): Promise<ChangeSummarySkillStatus> {
    const detectedAgents = agents ?? await this.agentStatus()
    const codex = {
      available: detectedAgents.codex.installed,
      installed: installedChangeSummarySkill(join(homedir(), '.codex', 'skills', CHANGE_SUMMARY_SKILL_NAME, 'SKILL.md'))
    }
    const claudeCode = {
      available: detectedAgents.claudeCode.installed,
      installed: installedChangeSummarySkill(join(homedir(), '.claude', 'skills', CHANGE_SUMMARY_SKILL_NAME, 'SKILL.md'))
    }
    return {
      ready: (!codex.available || codex.installed) && (!claudeCode.available || claudeCode.installed),
      codex,
      claudeCode,
      deploymentCommand: CHANGE_SUMMARY_SKILL_DEPLOYMENT_COMMAND
    }
  }

  private requireProject(projectId: string): Project {
    const project = this.database.getProject(projectId)
    if (!project) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
    return project
  }
}

export * from '@vibegit/shared'
