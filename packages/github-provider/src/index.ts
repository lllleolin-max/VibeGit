import { spawn } from 'node:child_process'
import { appendFile, readFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import type {
  GitHubCliStatus,
  GitHubSyncResult,
  SensitiveRisk,
  SensitiveScanResult
} from '@vibegit/shared'
import { redactSecrets, VibeGitError } from '@vibegit/shared'
import { VibeGitDatabase } from '@vibegit/database'
import { GitEngine, type TreeEntry } from '@vibegit/git-engine'
import { CheckpointEngine } from '@vibegit/checkpoint-engine'

const DEFAULT_GH_TIMEOUT = 30_000
const MAX_FILE_BYTES = 10 * 1024 * 1024
export const VIBEGIT_REMOTE_NAME = 'vibegit'

export interface GhResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface GhOptions {
  allowExitCodes?: number[]
  timeoutMs?: number
}

export type GhExecutor = (
  cwd: string,
  args: string[],
  options: GhOptions,
  environment: NodeJS.ProcessEnv
) => Promise<GhResult>

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/')
}

function literalGitignoreRule(path: string): string {
  const normalized = normalizePath(path).replace(/^\/+/, '')
  const directory = normalized.endsWith('/')
  const body = (directory ? normalized.slice(0, -1) : normalized).replace(/([\\*?[\]#!])/g, '\\$1')
  return `/${body}${directory ? '/' : ''}`
}

function githubRepositorySlug(remoteUrl: string): string | undefined {
  const normalized = remoteUrl.trim().replace(/\.git$/i, '').replace(/\/$/, '')
  const match = normalized.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)$/i)
  return match?.[1]
}

function risk(path: string, kind: SensitiveRisk['kind'], message: string, ignoreSuggestion?: string): SensitiveRisk {
  return {
    path,
    kind,
    severity: 'blocked',
    message,
    ...(ignoreSuggestion ? { ignoreSuggestion } : {})
  }
}

function fileNameRisks(path: string, size: number): SensitiveRisk[] {
  const normalized = normalizePath(path)
  const lower = normalized.toLowerCase()
  const name = basename(lower)
  const extension = extname(lower)
  const results: SensitiveRisk[] = []
  const directorySuggestion = (names: Set<string>): string | undefined => {
    const segments = normalized.split('/')
    const index = segments.findIndex((segment) => names.has(segment.toLowerCase()))
    return index >= 0 ? `${segments.slice(0, index + 1).join('/')}/` : undefined
  }

  if (name === '.env' || name.startsWith('.env.')) {
    results.push(risk(path, 'sensitive_path', '环境变量文件可能包含密钥', literalGitignoreRule(normalized)))
  }
  if (extension === '.pem' || extension === '.key' || /^(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/.test(name)) {
    results.push(risk(path, 'private_key', '文件名表明它可能是私钥', literalGitignoreRule(normalized)))
  }
  const credentialConfigNames = new Set([
    '.netrc',
    '.pypirc',
    '.dockercfg',
    '.git-credentials'
  ])
  if (credentialConfigNames.has(name) || /(^|[-_.])(credentials?|secrets?)([-_.]|$)/.test(name)) {
    results.push(risk(path, 'credentials', '凭据文件不应进入远程备份', literalGitignoreRule(normalized)))
  }
  if (['.db', '.sqlite', '.sqlite3', '.mdb'].includes(extension)) {
    results.push(risk(path, 'database', '数据库文件可能包含个人或生产数据', literalGitignoreRule(normalized)))
  }
  if (/(^|\/)(node_modules|\.venv|venv|env)(\/|$)/.test(lower)) {
    results.push(risk(
      path,
      'dependency_directory',
      '依赖或虚拟环境目录不应备份',
      literalGitignoreRule(directorySuggestion(new Set(['node_modules', '.venv', 'venv', 'env'])) ?? normalized)
    ))
  }
  if (/(^|\/)(dist|build|out|coverage|\.next|target)(\/|$)/.test(lower)) {
    results.push(risk(
      path,
      'build_artifact',
      '生成文件会让备份变大且难以理解',
      literalGitignoreRule(directorySuggestion(new Set(['dist', 'build', 'out', 'coverage', '.next', 'target'])) ?? normalized)
    ))
  }
  if (size > MAX_FILE_BYTES) {
    results.push(risk(path, 'large_file', `文件超过 ${MAX_FILE_BYTES / 1024 / 1024} MB`, literalGitignoreRule(normalized)))
  }
  return results
}

function credentialConfigContentRisks(path: string, content: string): SensitiveRisk[] {
  if (basename(path).toLowerCase() !== '.npmrc') return []
  // A project-level .npmrc can contain harmless reproducibility settings such
  // as node-linker. Only block it when it actually contains an npm credential.
  return /(?:^|\n)\s*(?:[^\n]*:\s*)?_(?:authToken|auth)\s*=/i.test(content)
    ? [risk(path, 'credentials', 'npm 配置包含认证凭据', literalGitignoreRule(path))]
    : []
}

function decodeTextForScan(bytes: Buffer): string | undefined {
  if (bytes.length === 0) return ''

  // Credential files are often written by Windows tooling as UTF-16. Treat both
  // BOM-marked and easily identifiable BOM-less UTF-16 as text instead of
  // skipping them merely because they contain NUL bytes.
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString('utf16le')
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const body = Buffer.from(bytes.subarray(2))
    for (let index = 0; index + 1 < body.length; index += 2) {
      const first = body[index]!
      body[index] = body[index + 1]!
      body[index + 1] = first
    }
    return body.toString('utf16le')
  }
  if (!bytes.includes(0)) return bytes.toString('utf8').replace(/^\uFEFF/, '')

  const sampleLength = Math.min(bytes.length - (bytes.length % 2), 4096)
  if (sampleLength < 4) return undefined
  let evenNulls = 0
  let oddNulls = 0
  const pairs = sampleLength / 2
  for (let index = 0; index < sampleLength; index += 2) {
    if (bytes[index] === 0) evenNulls += 1
    if (bytes[index + 1] === 0) oddNulls += 1
  }
  if (oddNulls / pairs > 0.3 && evenNulls / pairs < 0.1) return bytes.toString('utf16le')
  if (evenNulls / pairs > 0.3 && oddNulls / pairs < 0.1) {
    const swapped = Buffer.from(bytes.subarray(0, bytes.length - (bytes.length % 2)))
    for (let index = 0; index + 1 < swapped.length; index += 2) {
      const first = swapped[index]!
      swapped[index] = swapped[index + 1]!
      swapped[index + 1] = first
    }
    return swapped.toString('utf16le')
  }
  return undefined
}

function contentRisks(path: string, content: string): SensitiveRisk[] {
  const patterns: Array<{ kind: SensitiveRisk['kind']; pattern: RegExp; message: string }> = [
    { kind: 'lfs_pointer', pattern: /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\noid sha256:[0-9a-f]{64}\r?\nsize \d+/m, message: '检测到 Git LFS 指针；真实大文件尚未经过安全扫描' },
    { kind: 'private_key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, message: '检测到私钥头部' },
    { kind: 'api_key', pattern: /\bAKIA[0-9A-Z]{16}\b/, message: '检测到疑似 AWS Access Key' },
    { kind: 'access_token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/, message: '检测到疑似 GitHub Token' },
    { kind: 'access_token', pattern: /\bnpm_[A-Za-z0-9]{20,}\b/, message: '检测到疑似 npm Token' },
    { kind: 'access_token', pattern: /\b(?:sk|rk)-(?:live|test|proj)-[A-Za-z0-9_-]{16,}\b/, message: '检测到疑似访问令牌' },
    { kind: 'api_key', pattern: /(?:api[_-]?key|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9_./+\-=]{16,}/i, message: '检测到疑似 API Key 赋值' },
    { kind: 'access_token', pattern: /(?:access[_-]?token|refresh[_-]?token|_authToken)\s*[:=]\s*["']?[A-Za-z0-9_./+\-=]{16,}/i, message: '检测到疑似访问令牌赋值' }
  ]
  return patterns
    .filter(({ pattern }) => pattern.test(content))
    .map(({ kind, message }) => risk(path, kind, message, literalGitignoreRule(path)))
}

export class SensitiveFileScanner {
  constructor(readonly git: GitEngine) {}

  async scan(projectPath: string, objectId?: string): Promise<SensitiveScanResult> {
    const tree = objectId ?? (await this.git.captureWorktreeTree(projectPath)).treeObjectId
    const entries = await this.git.listTree(projectPath, tree)
    const risks: SensitiveRisk[] = []
    let scannedFiles = 0

    for (const entry of entries) {
      if (entry.type !== 'blob') continue
      scannedFiles += 1
      const size = await this.git.getBlobSize(projectPath, entry.objectId)
      risks.push(...fileNameRisks(entry.path, size))
      if (size <= MAX_FILE_BYTES) {
        const bytes = await this.git.readBlob(projectPath, entry.objectId)
        const content = decodeTextForScan(bytes)
        if (content !== undefined) {
          risks.push(...credentialConfigContentRisks(entry.path, content))
          risks.push(...contentRisks(entry.path, content))
        }
      }
    }
    const unique = [...new Map(risks.map((item) => [`${item.path}\0${item.kind}`, item])).values()]
    return {
      scannedAt: new Date().toISOString(),
      scannedFiles,
      blocked: unique.length > 0,
      risks: unique
    }
  }
}

export interface GitHubProviderOptions {
  ghExecutable?: string
  timeoutMs?: number
  executor?: GhExecutor
}

export class GitHubProvider {
  readonly ghExecutable: string
  readonly timeoutMs: number
  readonly scanner: SensitiveFileScanner
  private readonly executor: GitHubProviderOptions['executor']

  constructor(
    readonly database: VibeGitDatabase,
    readonly git: GitEngine,
    readonly checkpoints: CheckpointEngine,
    options: GitHubProviderOptions = {}
  ) {
    this.ghExecutable = options.ghExecutable ?? process.env.VIBEGIT_GH_PATH ?? 'gh'
    this.timeoutMs = options.timeoutMs ?? DEFAULT_GH_TIMEOUT
    this.executor = options.executor
    this.scanner = new SensitiveFileScanner(git)
  }

  private async runGh(cwd: string, args: string[], options: GhOptions = {}): Promise<GhResult> {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      // Never let an ambient GH_HOST redirect Private verification or
      // repository creation to a different GitHub Enterprise host.
      GH_HOST: 'github.com',
      GH_PROMPT_DISABLED: '1',
      GIT_TERMINAL_PROMPT: '0'
    }
    if (this.executor) return await this.executor(cwd, [...args], options, environment)
    const timeoutMs = options.timeoutMs ?? this.timeoutMs
    return await new Promise<GhResult>((resolvePromise, reject) => {
      let settled = false
      let child
      try {
        child = spawn(this.ghExecutable, args, {
          cwd: resolve(cwd),
          shell: false,
          windowsHide: true,
          env: environment,
          stdio: ['ignore', 'pipe', 'pipe']
        })
      } catch (error) {
        reject(new VibeGitError('GH_NOT_AVAILABLE', '未安装 GitHub CLI', {
          remediation: '安装 gh 后即可使用 GitHub 私有备份；本地保存点不受影响。',
          cause: error
        }))
        return
      }
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill()
        reject(new VibeGitError('GH_COMMAND_TIMEOUT', 'GitHub 操作超时，已安全停止', {
          retryable: true,
          remediation: '检查网络连接后重试；本地保存点未受影响。'
        }))
      }, timeoutMs)
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new VibeGitError('GH_NOT_AVAILABLE', '未安装 GitHub CLI', {
          detail: error.message,
          remediation: '安装 gh 后即可使用 GitHub 私有备份；本地保存点不受影响。',
          cause: error
        }))
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const result = {
          exitCode: code ?? -1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8')
        }
        if (!(options.allowExitCodes ?? [0]).includes(result.exitCode)) {
          reject(new VibeGitError('GH_COMMAND_FAILED', 'GitHub 未能完成操作', {
            detail: redactSecrets(result.stderr.trim() || result.stdout.trim()),
            remediation: '检查 GitHub 登录、网络和仓库权限后重试。',
            retryable: true
          }))
          return
        }
        resolvePromise(result)
      })
    })
  }

  async status(cwd = process.cwd()): Promise<GitHubCliStatus> {
    try {
      await this.runGh(cwd, ['--version'])
    } catch (error) {
      if (error instanceof VibeGitError && error.code === 'GH_NOT_AVAILABLE') {
        return { installed: false, authenticated: false, message: '未安装 GitHub CLI；本地保护仍可正常使用' }
      }
      throw error
    }
    const auth = await this.runGh(cwd, ['auth', 'status', '--hostname', 'github.com'], { allowExitCodes: [0, 1] })
    if (auth.exitCode !== 0) {
      return { installed: true, authenticated: false, message: '尚未登录 GitHub；请运行 gh auth login' }
    }
    const user = await this.runGh(cwd, ['api', '--hostname', 'github.com', 'user', '--jq', '.login'], { allowExitCodes: [0, 1] })
    return {
      installed: true,
      authenticated: true,
      ...(user.exitCode === 0 && user.stdout.trim() ? { username: user.stdout.trim() } : {}),
      message: 'GitHub 已连接'
    }
  }

  async createPrivateRepository(projectId: string, name: string, owner?: string): Promise<string> {
    const project = this.database.getProject(projectId)
    if (!project) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) throw new VibeGitError('INVALID_REPOSITORY_NAME', '仓库名称只能包含字母、数字、点、横线和下划线')
    const ghStatus = await this.status(project.path)
    if (!ghStatus.authenticated) throw new VibeGitError('GH_NOT_AUTHENTICATED', 'GitHub 尚未授权', {
      remediation: '在终端执行 gh auth login，完成浏览器授权后返回重试。'
    })
    const account = owner ?? ghStatus.username
    if (!account || !/^[A-Za-z0-9-]+$/.test(account)) throw new VibeGitError('GITHUB_OWNER_UNKNOWN', '无法确定 GitHub 账户')
    const fullName = `${account}/${name}`
    await this.runGh(project.path, ['repo', 'create', fullName, '--private'], { timeoutMs: 60_000 })
    const remoteUrl = `https://github.com/${fullName}.git`
    await this.verifyPrivateRepository(project.path, remoteUrl)
    await this.git.setRemote(project.path, remoteUrl, VIBEGIT_REMOTE_NAME)
    this.database.updateProjectRemote(projectId, remoteUrl)
    return remoteUrl
  }

  private async verifyPrivateRepository(projectPath: string, remoteUrl: string): Promise<string> {
    const slug = githubRepositorySlug(remoteUrl)
    if (!slug) throw new VibeGitError('NOT_A_GITHUB_REMOTE', '请输入 GitHub 仓库地址')
    const ghStatus = await this.status(projectPath)
    if (!ghStatus.authenticated) throw new VibeGitError('GH_NOT_AUTHENTICATED', 'GitHub 尚未授权', {
      remediation: '在终端执行 gh auth login，完成浏览器授权后返回重试。'
    })
    const visibility = await this.runGh(projectPath, ['repo', 'view', slug, '--json', 'visibility', '--jq', '.visibility'], { allowExitCodes: [0, 1] })
    if (visibility.exitCode !== 0) throw new VibeGitError('GITHUB_REPOSITORY_UNAVAILABLE', '无法读取这个 GitHub 仓库', {
      remediation: '确认仓库地址和当前 GitHub 账户权限后重试。'
    })
    if (visibility.stdout.trim().toUpperCase() !== 'PRIVATE') {
      throw new VibeGitError('GITHUB_REPOSITORY_NOT_PRIVATE', '为保护源码，只能连接 Private GitHub 仓库', {
        remediation: '先在 GitHub 将仓库可见性改为 Private，或让 VibeGit 创建新的私有仓库。'
      })
    }
    return slug
  }

  async connect(projectId: string, remoteUrl: string): Promise<string> {
    const project = this.database.getProject(projectId)
    if (!project) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
    await this.verifyPrivateRepository(project.path, remoteUrl)
    await this.git.setRemote(project.path, remoteUrl, VIBEGIT_REMOTE_NAME)
    this.database.updateProjectRemote(projectId, remoteUrl)
    return remoteUrl
  }

  async scan(projectId: string): Promise<SensitiveScanResult> {
    const project = this.database.getProject(projectId)
    if (!project) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
    return await this.scanner.scan(project.path)
  }

  async ignoreRisk(projectId: string, item: SensitiveRisk): Promise<SensitiveScanResult> {
    const project = this.database.getProject(projectId)
    if (!project) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
    const currentScan = await this.scanner.scan(project.path)
    const verified = currentScan.risks.find((candidate) =>
      candidate.path === item.path && candidate.kind === item.kind && Boolean(candidate.ignoreSuggestion)
    )
    if (!verified?.ignoreSuggestion || verified.ignoreSuggestion.includes('\0') || verified.ignoreSuggestion.includes('\n')) {
      throw new VibeGitError('INVALID_IGNORE_RULE', '这条风险无法自动加入忽略列表')
    }
    const gitignorePath = resolve(project.path, '.gitignore')
    let existing = ''
    try { existing = await readFile(gitignorePath, 'utf8') } catch { /* Create below. */ }
    const lines = existing.split(/\r?\n/)
    if (!lines.includes(verified.ignoreSuggestion)) {
      const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
      await appendFile(gitignorePath, `${prefix}${verified.ignoreSuggestion}\n`, 'utf8')
    }
    return await this.scanner.scan(project.path)
  }

  async push(projectId: string): Promise<GitHubSyncResult> {
    const project = this.database.getProject(projectId)
    if (!project) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
    const remoteUrl = await this.git.getRemoteUrl(project.path, VIBEGIT_REMOTE_NAME)
    if (!remoteUrl) throw new VibeGitError('GITHUB_REMOTE_NOT_CONFIGURED', '尚未设置 GitHub 备份位置')
    await this.verifyPrivateRepository(project.path, remoteUrl)

    const checkpoint = await this.checkpoints.create({
      projectId,
      type: 'pre_sync',
      title: 'GitHub 同步前保护点',
      agent: 'system',
      summary: '推送前自动保存并进行敏感文件检查',
      allowEmpty: true
    })
    if (!checkpoint) throw new VibeGitError('PRE_SYNC_CHECKPOINT_FAILED', '未能创建同步前保护点')
    const scan = await this.scanner.scan(project.path, checkpoint.gitObjectId)
    if (scan.blocked) {
      this.database.updateProjectSyncFailure(projectId)
      throw new VibeGitError('SENSITIVE_FILES_BLOCKED', `发现 ${scan.risks.length} 项风险，已阻止上传`, {
        detail: scan.risks.map((item) => `${item.path}: ${item.message}`).join('\n'),
        remediation: '将风险文件加入 .gitignore 或移除敏感内容，重新扫描通过后再备份。'
      })
    }
    try {
      await this.verifyPrivateRepository(project.path, remoteUrl)
      // Push to the exact URL that was checked above. A mutable remote alias such
      // as `origin` could otherwise be changed between the visibility check and
      // the network operation.
      await this.git.pushCheckpoint(project.path, checkpoint.gitObjectId, remoteUrl)
      const syncedAt = new Date().toISOString()
      this.database.markCheckpointSynced(checkpoint.id, syncedAt)
      return { remoteUrl, checkpointId: checkpoint.id, syncedAt, branch: 'vibegit-backup' }
    } catch (error) {
      this.database.updateProjectSyncFailure(projectId)
      throw error
    }
  }
}

export type { TreeEntry }
