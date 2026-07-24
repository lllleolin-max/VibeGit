export type AgentType = 'codex' | 'claude-code' | 'manual' | 'system' | 'unknown'

export type CheckpointType =
  | 'initial'
  | 'manual'
  | 'pre_agent'
  | 'post_agent'
  | 'pre_restore'
  | 'pre_sync'
  | 'stable'

export type TestStatus = 'not_run' | 'passed' | 'failed' | 'unknown'
export type GitHubSyncStatus = 'not_configured' | 'pending' | 'synced' | 'failed'
export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type_changed' | 'unknown'

export interface ChangedFile {
  path: string
  previousPath?: string
  kind: ChangeKind
  insertions: number
  deletions: number
  binary: boolean
}

export interface Project {
  id: string
  name: string
  path: string
  createdAt: string
  lastActivityAt: string
  isGitRepository: boolean
  protectionEnabled: boolean
  hasUnsavedChanges: boolean
  untrackedFiles: number
  lastAgent?: AgentType
  lastCheckpointAt?: string
  githubRemoteUrl?: string
  githubSyncStatus: GitHubSyncStatus
  lastSyncedAt?: string
}

export interface Checkpoint {
  id: string
  projectId: string
  createdAt: string
  type: CheckpointType
  title: string
  agent: AgentType
  agentSessionId?: string
  taskText?: string
  summary?: string
  gitObjectId: string
  parentCheckpointId?: string
  changedFiles: ChangedFile[]
  insertions: number
  deletions: number
  testStatus: TestStatus
  githubSyncStatus: GitHubSyncStatus
  isStable: boolean
  note?: string
  metadata: Record<string, unknown>
}

export interface GitStatus {
  isRepository: boolean
  branch?: string
  hasHead: boolean
  hasChanges: boolean
  staged: string[]
  modified: string[]
  deleted: string[]
  untracked: string[]
  ignored: string[]
}

export interface FileDiff {
  path: string
  previousPath?: string
  kind: ChangeKind
  patch: string
  binary: boolean
  insertions: number
  deletions: number
}

export interface CheckpointDiff {
  fromObjectId?: string
  toObjectId: string
  files: FileDiff[]
  insertions: number
  deletions: number
}

export interface RestoreImpactFile {
  path: string
  action: 'add' | 'overwrite' | 'remove' | 'preserve' | 'move_to_recovery'
  reason: string
}

export interface RestorePreview {
  token: string
  projectId: string
  targetCheckpointId: string
  insuranceCheckpointId: string
  createdAt: string
  expiresAt: string
  stateTreeObjectId: string
  headObjectId?: string
  headRef?: string
  indexFingerprint: string
  activeCheckpointId?: string
  conflictPaths: string[]
  files: RestoreImpactFile[]
  addCount: number
  overwriteCount: number
  removeCount: number
  conflictCount: number
}

export interface RestoreRecord {
  id: string
  projectId: string
  targetCheckpointId: string
  insuranceCheckpointId: string
  createdAt: string
  completedAt?: string
  undoneAt?: string
  recoveryDirectory?: string
  status: 'prepared' | 'executing' | 'completed' | 'undoing' | 'failed' | 'undone'
  errorCode?: string
}

export interface ShelvedChange {
  id: string
  projectId: string
  checkpointId: string
  restoreId: string
  title: string
  createdAt: string
  retrievedAt?: string
  status: 'active' | 'retrieved'
}

export interface AgentEvent {
  event: 'task-start' | 'task-end'
  agent: Exclude<AgentType, 'manual' | 'system' | 'unknown'>
  projectPath: string
  sessionId?: string
  eventId?: string
  taskText?: string
  timestamp: string
  success?: boolean
  testStatus?: TestStatus
}

export interface AgentEventRecord {
  id: string
  projectId: string
  event: AgentEvent['event']
  agent: AgentEvent['agent']
  sessionId?: string
  sourceEventId?: string
  taskText?: string
  createdAt: string
  success?: boolean
  checkpointId?: string
  message: string
}

export type RiskSeverity = 'warning' | 'blocked'
export type RiskKind =
  | 'sensitive_path'
  | 'private_key'
  | 'api_key'
  | 'access_token'
  | 'credentials'
  | 'database'
  | 'large_file'
  | 'lfs_pointer'
  | 'dependency_directory'
  | 'build_artifact'

export interface SensitiveRisk {
  path: string
  kind: RiskKind
  severity: RiskSeverity
  message: string
  ignoreSuggestion?: string
}

export interface SensitiveScanResult {
  scannedAt: string
  scannedFiles: number
  blocked: boolean
  risks: SensitiveRisk[]
}

export interface GitHubCliStatus {
  installed: boolean
  authenticated: boolean
  username?: string
  sshKeyReady?: boolean
  message: string
}

export interface GitHubOnboardingResult {
  username: string
  sshKeyCreated: boolean
  message: string
}

export interface GitHubSyncResult {
  remoteUrl: string
  checkpointId: string
  syncedAt: string
  branch: string
}

export interface AppSettings {
  gitExecutable?: string
  ghExecutable?: string
  dataDirectory: string
  commandTimeoutMs: number
}

export interface DataDirectoryUpdateResult {
  dataDirectory: string
  restartRequired: boolean
}

export interface EnvironmentCheckResult {
  github: GitHubCliStatus
  agents: AgentConnectionStatus
  githubCliInstallAttempted: boolean
  githubCliInstalled: boolean
  message: string
}

export interface HealthStatus {
  ready: boolean
  database: 'ok'
  git: 'ok' | 'unavailable'
  version: string
}

export interface CreateCheckpointInput {
  projectId: string
  type: CheckpointType
  title: string
  agent?: AgentType
  agentSessionId?: string
  taskText?: string
  summary?: string
  testStatus?: TestStatus
  isStable?: boolean
  note?: string
  metadata?: Record<string, unknown>
  allowEmpty?: boolean
}

export interface AddProjectInput {
  path: string
  initialize?: boolean
}

export interface CreatePrivateRepositoryInput {
  projectId: string
  name: string
  owner?: string
}

export interface ConnectRemoteInput {
  projectId: string
  remoteUrl: string
}

export interface PublicError {
  code: string
  message: string
  detail?: string
  remediation?: string
  retryable: boolean
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: PublicError }

export class VibeGitError extends Error {
  readonly code: string
  readonly detail: string | undefined
  readonly remediation: string | undefined
  readonly retryable: boolean
  readonly causeValue: unknown

  constructor(
    code: string,
    message: string,
    options: {
      detail?: string
      remediation?: string
      retryable?: boolean
      cause?: unknown
    } = {}
  ) {
    super(message)
    this.name = 'VibeGitError'
    this.code = code
    this.detail = options.detail
    this.remediation = options.remediation
    this.retryable = options.retryable ?? false
    this.causeValue = options.cause
  }
}

const SECRET_ASSIGNMENT = /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|_?auth[_-]?token|client[_-]?secret|secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi
const BEARER_TOKEN = /(bearer\s+)[a-z0-9._~+/-]{8,}/gi
const KNOWN_ACCESS_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|(?:sk|rk)-(?:live|test|proj)-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16})\b/g
const PRIVATE_KEY_BLOCK = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g

export function redactSecrets(value: string): string {
  return value
    .replace(PRIVATE_KEY_BLOCK, '[REDACTED PRIVATE KEY]')
    .replace(SECRET_ASSIGNMENT, '$1[REDACTED]')
    .replace(BEARER_TOKEN, '$1[REDACTED]')
    .replace(KNOWN_ACCESS_TOKEN, '[REDACTED]')
}

export function toPublicError(error: unknown): PublicError {
  if (error instanceof VibeGitError) {
    return {
      code: error.code,
      message: redactSecrets(error.message),
      ...(error.detail ? { detail: redactSecrets(error.detail) } : {}),
      ...(error.remediation ? { remediation: error.remediation } : {}),
      retryable: error.retryable
    }
  }
  const message = error instanceof Error ? error.message : '发生了未知错误'
  return {
    code: 'UNEXPECTED_ERROR',
    message: 'VibeGit 未能完成操作',
    detail: redactSecrets(message),
    remediation: '请保留当前文件并重试；若问题持续，请查看诊断日志。',
    retryable: true
  }
}

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

export function fail<T = never>(error: unknown): ApiResult<T> {
  return { ok: false, error: toPublicError(error) }
}

export const IPC_CHANNELS = {
  health: 'app:health',
  selectProjectDirectory: 'dialog:select-project-directory',
  listProjects: 'projects:list',
  addProject: 'projects:add',
  refreshProject: 'projects:refresh',
  initializeProtection: 'projects:initialize-protection',
  listCheckpoints: 'checkpoints:list',
  createCheckpoint: 'checkpoints:create',
  getCheckpointDiff: 'checkpoints:diff',
  prepareRestore: 'restore:prepare',
  executeRestore: 'restore:execute',
  undoRestore: 'restore:undo',
  failedRestoreForToken: 'restore:failed-for-token',
  listFailedRestores: 'restore:list-failed',
  openRecoveryDirectory: 'restore:open-recovery-directory',
  listShelves: 'shelves:list',
  createShelf: 'shelves:create',
  retrieveShelf: 'shelves:retrieve',
  githubStatus: 'github:status',
  githubAuthorize: 'github:authorize',
  githubScan: 'github:scan',
  githubCreatePrivate: 'github:create-private',
  githubConnect: 'github:connect',
  githubPush: 'github:push',
  githubIgnoreRisk: 'github:ignore-risk',
  minimizeWindow: 'window:minimize',
  toggleMaximizeWindow: 'window:toggle-maximize',
  closeWindow: 'window:close',
  agentStatus: 'agents:status',
  listAgentEvents: 'agents:list-events',
  getSettings: 'settings:get',
  selectDataDirectory: 'dialog:select-data-directory',
  setDataDirectory: 'settings:set-data-directory',
  checkEnvironment: 'environment:check'
} as const

export interface AgentConnectionStatus {
  codex: { installed: boolean; integration: 'available' | 'template' | 'not_configured'; detail: string }
  claudeCode: { installed: boolean; integration: 'available' | 'template' | 'not_configured'; detail: string }
}

export interface VibeGitApi {
  health(): Promise<ApiResult<HealthStatus>>
  selectProjectDirectory(): Promise<ApiResult<string | null>>
  listProjects(): Promise<ApiResult<Project[]>>
  addProject(input: AddProjectInput): Promise<ApiResult<Project>>
  refreshProject(projectId: string): Promise<ApiResult<Project>>
  initializeProtection(projectId: string): Promise<ApiResult<{ project: Project; checkpoint: Checkpoint }>>
  listCheckpoints(projectId: string): Promise<ApiResult<Checkpoint[]>>
  createCheckpoint(input: CreateCheckpointInput): Promise<ApiResult<Checkpoint>>
  getCheckpointDiff(checkpointId: string): Promise<ApiResult<CheckpointDiff>>
  prepareRestore(projectId: string, checkpointId: string): Promise<ApiResult<RestorePreview>>
  executeRestore(token: string): Promise<ApiResult<RestoreRecord>>
  undoRestore(restoreId: string): Promise<ApiResult<RestoreRecord>>
  failedRestoreForToken(token: string): Promise<ApiResult<RestoreRecord | null>>
  listFailedRestores(projectId: string): Promise<ApiResult<RestoreRecord[]>>
  openRecoveryDirectory(restoreId: string): Promise<ApiResult<boolean>>
  listShelves(projectId: string): Promise<ApiResult<ShelvedChange[]>>
  createShelf(projectId: string, title: string): Promise<ApiResult<ShelvedChange>>
  retrieveShelf(shelfId: string): Promise<ApiResult<ShelvedChange>>
  githubStatus(): Promise<ApiResult<GitHubCliStatus>>
  githubAuthorize(): Promise<ApiResult<GitHubOnboardingResult>>
  githubScan(projectId: string): Promise<ApiResult<SensitiveScanResult>>
  githubCreatePrivate(input: CreatePrivateRepositoryInput): Promise<ApiResult<Project>>
  githubConnect(input: ConnectRemoteInput): Promise<ApiResult<Project>>
  githubPush(projectId: string): Promise<ApiResult<GitHubSyncResult>>
  githubIgnoreRisk(projectId: string, risk: SensitiveRisk): Promise<ApiResult<SensitiveScanResult>>
  minimizeWindow(): Promise<ApiResult<boolean>>
  toggleMaximizeWindow(): Promise<ApiResult<boolean>>
  closeWindow(): Promise<ApiResult<boolean>>
  agentStatus(): Promise<ApiResult<AgentConnectionStatus>>
  listAgentEvents(projectId: string): Promise<ApiResult<AgentEventRecord[]>>
  getSettings(): Promise<ApiResult<AppSettings>>
  selectDataDirectory(): Promise<ApiResult<string | null>>
  setDataDirectory(path: string): Promise<ApiResult<DataDirectoryUpdateResult>>
  checkEnvironment(): Promise<ApiResult<EnvironmentCheckResult>>
}

export function parseAgentEvent(input: unknown): AgentEvent {
  if (!input || typeof input !== 'object') {
    throw new VibeGitError('INVALID_EVENT', '事件必须是 JSON 对象')
  }
  const record = input as Record<string, unknown>
  if (record.event !== 'task-start' && record.event !== 'task-end') {
    throw new VibeGitError('INVALID_EVENT', 'event 必须是 task-start 或 task-end')
  }
  if (record.agent !== 'codex' && record.agent !== 'claude-code') {
    throw new VibeGitError('INVALID_EVENT', 'agent 必须是 codex 或 claude-code')
  }
  if (typeof record.projectPath !== 'string' || record.projectPath.trim() === '') {
    throw new VibeGitError('INVALID_EVENT', 'projectPath 不能为空')
  }
  const timestamp = typeof record.timestamp === 'string' ? record.timestamp : new Date().toISOString()
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new VibeGitError('INVALID_EVENT', 'timestamp 不是有效的 ISO 时间')
  }
  return {
    event: record.event,
    agent: record.agent,
    projectPath: record.projectPath,
    timestamp,
    ...(typeof record.sessionId === 'string' ? { sessionId: record.sessionId } : {}),
    ...(typeof record.eventId === 'string' && record.eventId.length <= 500 ? { eventId: record.eventId } : {}),
    ...(typeof record.taskText === 'string' ? { taskText: record.taskText } : {}),
    ...(typeof record.success === 'boolean' ? { success: record.success } : {}),
    ...(record.testStatus === 'passed' || record.testStatus === 'failed' || record.testStatus === 'not_run' || record.testStatus === 'unknown'
      ? { testStatus: record.testStatus }
      : {})
  }
}
