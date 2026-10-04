import { VibeGitError, type SensitiveRisk, type VibeGitApi } from '@vibegit/shared'

function invalid(field: string): never {
  throw new VibeGitError('INVALID_API_ARGUMENT', `请求参数无效：${field}`)
}

function text(value: unknown, field: string, maxLength = 100): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return invalid(field)
  return value
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('input')
  return value as Record<string, unknown>
}

const noArguments = new Set<keyof VibeGitApi>([
  'health', 'selectProjectDirectory', 'listProjects', 'githubStatus', 'githubAuthorize',
  'githubAuthorizationStatus', 'minimizeWindow', 'toggleMaximizeWindow', 'closeWindow',
  'agentStatus', 'getSettings', 'selectDataDirectory', 'checkEnvironment'
])

const identifierArguments = new Set<keyof VibeGitApi>([
  'removeProject', 'refreshProject', 'initializeProtection', 'listCheckpoints', 'deleteCheckpoint',
  'getCheckpointDiff', 'executeRestore', 'undoRestore', 'failedRestoreForToken', 'listFailedRestores',
  'openRecoveryDirectory', 'listShelves', 'retrieveShelf', 'githubScan', 'githubPush', 'listAgentEvents'
])

// Both transports accept the same public input and strip internal-only fields.
// TypeScript annotations alone do not validate renderer/HTTP messages at runtime.
export function validateApiArguments(method: keyof VibeGitApi, args: unknown[]): unknown[] {
  const count = noArguments.has(method) ? 0 : ['renameCheckpoint', 'prepareRestore', 'createShelf', 'githubIgnoreRisk'].includes(method) ? 2 : 1
  if (args.length !== count) return invalid('args')
  if (noArguments.has(method)) return []
  if (identifierArguments.has(method)) return [text(args[0], 'id')]
  if (method === 'setDataDirectory') return [text(args[0], 'path', 10_000)]
  if (method === 'renameCheckpoint' || method === 'createShelf') return [text(args[0], 'id'), text(args[1], 'title', 160)]
  if (method === 'prepareRestore') return [text(args[0], 'projectId'), text(args[1], 'checkpointId')]
  if (method === 'githubIgnoreRisk') {
    const risk = record(args[1])
    const kinds = new Set<SensitiveRisk['kind']>([
      'sensitive_path', 'private_key', 'api_key', 'access_token', 'credentials',
      'database', 'large_file', 'lfs_pointer', 'dependency_directory', 'build_artifact'
    ])
    if (typeof risk.kind !== 'string' || !kinds.has(risk.kind as SensitiveRisk['kind'])) return invalid('risk.kind')
    return [text(args[0], 'projectId'), {
      path: text(risk.path, 'risk.path', 10_000), kind: risk.kind,
      severity: 'blocked', message: '由主进程重新扫描确认'
    }]
  }
  const input = record(args[0])
  if (method === 'addProject') {
    if (input.initialize !== undefined && typeof input.initialize !== 'boolean') return invalid('initialize')
    return [{ path: text(input.path, 'path', 10_000), ...(input.initialize === true ? { initialize: true } : {}) }]
  }
  const projectId = text(input.projectId, 'projectId')
  if (method === 'createCheckpoint') {
    if (input.type !== 'manual' && input.type !== 'stable') return invalid('type')
    const note = input.note === undefined ? undefined : text(input.note, 'note', 2_000)
    return [{ projectId, type: input.type, title: text(input.title, 'title', 160), agent: 'manual', isStable: input.type === 'stable', ...(note ? { note } : {}) }]
  }
  if (method === 'githubConnect') return [{ projectId, remoteUrl: text(input.remoteUrl, 'remoteUrl', 2_000) }]
  if (method === 'githubCreatePrivate') {
    const owner = input.owner === undefined ? undefined : text(input.owner, 'owner')
    return [{ projectId, name: text(input.name, 'name'), ...(owner ? { owner } : {}) }]
  }
  return invalid('method')
}
