import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import type {
  ChangedFile,
  ChangeKind,
  CheckpointDiff,
  FileDiff,
  GitStatus
} from '@vibegit/shared'
import { redactSecrets, VibeGitError } from '@vibegit/shared'

export interface CommandResult {
  command: string
  args: string[]
  cwd: string
  stdout: string
  stderr: string
  stdoutBuffer: Buffer
  exitCode: number
  durationMs: number
}

export interface RepositoryStateFingerprint {
  headObjectId?: string
  headRef?: string
  indexFingerprint: string
}

export interface CommandAuditEntry {
  executable: string
  args: string[]
  cwd: string
  exitCode: number
  durationMs: number
  stderr: string
}

export interface CommandOptions {
  env?: NodeJS.ProcessEnv
  stdin?: string | Buffer
  timeoutMs?: number
  allowExitCodes?: number[]
  maxOutputBytes?: number
}

export interface GitRunnerOptions {
  executable?: string
  timeoutMs?: number
  audit?: (entry: CommandAuditEntry) => void
}

const DEFAULT_TIMEOUT = 20_000
const DEFAULT_MAX_OUTPUT = 32 * 1024 * 1024
const INHERITED_GIT_ENVIRONMENT_KEYS = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_EXTERNAL_DIFF',
  'GIT_ASKPASS',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS'
])

function safeArgs(args: readonly string[]): string[] {
  return args.map((arg) => redactSecrets(arg))
}

function isolatedGitEnvironment(overrides: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (INHERITED_GIT_ENVIRONMENT_KEYS.has(key) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)) delete environment[key]
  }
  return { ...environment, ...overrides, GIT_TERMINAL_PROMPT: '0' }
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function assertSafeGitCommand(args: readonly string[]): void {
  const normalized = args.map((arg) => arg.toLowerCase())
  const globalOptionsWithValue = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix'])
  let commandIndex = 0
  while (commandIndex < normalized.length) {
    const argument = normalized[commandIndex]
    if (!argument?.startsWith('-')) break
    if (globalOptionsWithValue.has(argument)) commandIndex += 2
    else commandIndex += 1
  }
  const command = normalized[commandIndex]
  const commandArgs = normalized.slice(commandIndex + 1)
  if (command === 'clean') {
    throw new VibeGitError('DANGEROUS_GIT_COMMAND', 'VibeGit 禁止执行会删除未知文件的 Git clean')
  }
  if (command === 'reset' && commandArgs.includes('--hard')) {
    throw new VibeGitError('DANGEROUS_GIT_COMMAND', 'VibeGit 禁止执行不可逆的 hard reset')
  }
  if (command === 'push' && commandArgs.some((arg) =>
    arg === '--force' ||
    arg === '-f' ||
    arg === '--delete' ||
    arg.startsWith('--force-with-lease') ||
    arg.startsWith('+') ||
    /^:[^:]/.test(arg)
  )) {
    throw new VibeGitError('DANGEROUS_GIT_COMMAND', 'VibeGit 禁止强制覆盖 GitHub 历史')
  }
  if (command === 'config' && commandArgs.some((arg) => arg === '--global' || arg === '--system')) {
    throw new VibeGitError('DANGEROUS_GIT_COMMAND', 'VibeGit 不会修改全局 Git 配置')
  }
  if (command === 'rm' && !commandArgs.includes('--cached')) {
    throw new VibeGitError('DANGEROUS_GIT_COMMAND', 'VibeGit 禁止 Git 直接删除工作区文件')
  }
}

export class GitCommandRunner {
  readonly executable: string
  readonly timeoutMs: number
  private readonly audit: ((entry: CommandAuditEntry) => void) | undefined

  constructor(options: GitRunnerOptions = {}) {
    this.executable = options.executable ?? process.env.VIBEGIT_GIT_PATH ?? 'git'
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
    this.audit = options.audit
  }

  async run(cwd: string, args: readonly string[], options: CommandOptions = {}): Promise<CommandResult> {
    assertSafeGitCommand(args)
    const resolvedCwd = resolve(cwd)
    try {
      await access(resolvedCwd, fsConstants.R_OK)
    } catch (error) {
      throw new VibeGitError('PROJECT_PATH_UNAVAILABLE', '项目文件夹不可访问', {
        detail: resolvedCwd,
        remediation: '确认文件夹仍然存在且当前用户有读取权限。',
        cause: error
      })
    }

    const startedAt = Date.now()
    const timeoutMs = options.timeoutMs ?? this.timeoutMs
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT

    return await new Promise<CommandResult>((resolvePromise, reject) => {
      let settled = false
      let terminationError: VibeGitError | undefined
      let stdoutBytes = 0
      let stderrBytes = 0
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let child

      try {
        child = spawn(this.executable, [...args], {
          cwd: resolvedCwd,
          env: isolatedGitEnvironment(options.env),
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        })
      } catch (error) {
        reject(new VibeGitError('GIT_NOT_AVAILABLE', '没有找到可用的 Git', {
          detail: error instanceof Error ? error.message : String(error),
          remediation: '请安装 Git，或在设置中选择 Git 可执行文件。',
          cause: error
        }))
        return
      }

      const timer = setTimeout(() => {
        if (settled) return
        terminationError = new VibeGitError('GIT_COMMAND_TIMEOUT', 'Git 操作超时，已安全停止', {
          detail: `${safeArgs(args).join(' ')} (${timeoutMs}ms)`,
          remediation: '项目文件仍在原处。检查磁盘、杀毒软件或仓库大小后重试。',
          retryable: true
        })
        child.kill()
      }, timeoutMs)

      const failForSize = (): void => {
        if (settled || stdoutBytes + stderrBytes <= maxOutputBytes) return
        terminationError = new VibeGitError('GIT_OUTPUT_TOO_LARGE', 'Git 返回的数据过大，已安全停止', {
          remediation: '缩小查看范围或排除大型生成文件后重试。'
        })
        clearTimeout(timer)
        child.kill()
      }

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length
        stdoutChunks.push(chunk)
        failForSize()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length
        stderrChunks.push(chunk)
        failForSize()
      })
      child.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new VibeGitError('GIT_NOT_AVAILABLE', '没有找到可用的 Git', {
          detail: error.message,
          remediation: '请安装 Git，或在设置中选择 Git 可执行文件。',
          cause: error
        }))
      })
      child.on('close', (exitCode) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (terminationError) {
          reject(terminationError)
          return
        }
        const stdoutBuffer = Buffer.concat(stdoutChunks)
        const stderrBuffer = Buffer.concat(stderrChunks)
        const result: CommandResult = {
          command: this.executable,
          args: [...args],
          cwd: resolvedCwd,
          stdout: stdoutBuffer.toString('utf8'),
          stderr: stderrBuffer.toString('utf8'),
          stdoutBuffer,
          exitCode: exitCode ?? -1,
          durationMs: Date.now() - startedAt
        }
        this.audit?.({
          executable: basename(this.executable),
          args: safeArgs(args),
          cwd: resolvedCwd,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          stderr: redactSecrets(result.stderr).slice(0, 2_000)
        })
        const allowed = new Set(options.allowExitCodes ?? [0])
        if (!allowed.has(result.exitCode)) {
          reject(new VibeGitError('GIT_COMMAND_FAILED', 'Git 未能完成操作', {
            detail: redactSecrets(result.stderr.trim() || result.stdout.trim() || `退出码 ${result.exitCode}`),
            remediation: '项目文件没有被自动删除。请根据提示处理后重试。',
            retryable: true
          }))
          return
        }
        resolvePromise(result)
      })

      if (options.stdin !== undefined) child.stdin.end(options.stdin)
      else child.stdin.end()
    })
  }
}

export interface TreeEntry {
  mode: string
  type: 'blob' | 'tree' | 'commit'
  objectId: string
  path: string
}

export interface CapturedTree {
  treeObjectId: string
  hasHead: boolean
}

export interface HiddenCheckpointObject {
  commitObjectId: string
  treeObjectId: string
  ref: string
}

function normalizeKind(status: string): ChangeKind {
  switch (status[0]) {
    case 'A': return 'added'
    case 'M': return 'modified'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'T': return 'type_changed'
    default: return 'unknown'
  }
}

function parseNameStatus(output: Buffer): Array<{ status: string; path: string; previousPath?: string }> {
  const tokens = output.toString('utf8').split('\0')
  const result: Array<{ status: string; path: string; previousPath?: string }> = []
  let index = 0
  while (index < tokens.length) {
    const status = tokens[index++]
    if (!status) continue
    const firstPath = tokens[index++] ?? ''
    if (status.startsWith('R') || status.startsWith('C')) {
      const secondPath = tokens[index++] ?? ''
      result.push({ status, path: secondPath, previousPath: firstPath })
    } else {
      result.push({ status, path: firstPath })
    }
  }
  return result
}

function parseNumstat(output: Buffer): Map<string, { insertions: number; deletions: number; binary: boolean }> {
  const tokens = output.toString('utf8').split('\0')
  const stats = new Map<string, { insertions: number; deletions: number; binary: boolean }>()
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index++]
    if (!token) continue
    const firstTab = token.indexOf('\t')
    const secondTab = token.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0) continue
    const addedText = token.slice(0, firstTab)
    const deletedText = token.slice(firstTab + 1, secondTab)
    let path = token.slice(secondTab + 1)
    if (!path) {
      index += 1 // previous path for a rename
      path = tokens[index++] ?? ''
    }
    const binary = addedText === '-' || deletedText === '-'
    stats.set(path, {
      insertions: binary ? 0 : Number.parseInt(addedText, 10) || 0,
      deletions: binary ? 0 : Number.parseInt(deletedText, 10) || 0,
      binary
    })
  }
  return stats
}

function parsePorcelain(output: string): GitStatus {
  const tokens = output.split('\0')
  const status: GitStatus = {
    isRepository: true,
    hasHead: false,
    hasChanges: false,
    staged: [],
    modified: [],
    deleted: [],
    untracked: [],
    ignored: []
  }
  for (let index = 0; index < tokens.length; index += 1) {
    const entry = tokens[index]
    if (!entry || entry.length < 3) continue
    const code = entry.slice(0, 2)
    const path = entry.slice(3)
    if (code[0] === 'R' || code[0] === 'C' || code[1] === 'R' || code[1] === 'C') index += 1
    if (code === '??') status.untracked.push(path)
    else if (code === '!!') status.ignored.push(path)
    else {
      if (code[0] !== ' ' && code[0] !== '?') status.staged.push(path)
      if (code.includes('D')) status.deleted.push(path)
      else if (code[1] !== ' ') status.modified.push(path)
    }
  }
  status.hasChanges = status.staged.length > 0 || status.modified.length > 0 || status.deleted.length > 0 || status.untracked.length > 0
  return status
}

export class GitEngine {
  readonly runner: GitCommandRunner

  constructor(runner = new GitCommandRunner()) {
    this.runner = runner
  }

  async version(cwd = process.cwd()): Promise<string> {
    return (await this.runner.run(cwd, ['--version'])).stdout.trim()
  }

  async getRepositoryRoot(projectPath: string): Promise<string | undefined> {
    const result = await this.runner.run(projectPath, ['rev-parse', '--show-toplevel'], { allowExitCodes: [0, 128] })
    if (result.exitCode !== 0 || !result.stdout.trim()) return undefined
    return await realpath(resolve(result.stdout.trim()))
  }

  async isRepository(projectPath: string): Promise<boolean> {
    const root = await this.getRepositoryRoot(projectPath)
    if (!root) return false
    return samePath(root, await realpath(resolve(projectPath)))
  }

  async assertRepositoryRoot(projectPath: string): Promise<void> {
    const root = await this.getRepositoryRoot(projectPath)
    if (!root) throw new VibeGitError('NOT_A_GIT_PROJECT', '此项目尚未开启版本保护')
    const selected = await realpath(resolve(projectPath))
    if (!samePath(root, selected)) {
      throw new VibeGitError('PROJECT_MUST_BE_REPOSITORY_ROOT', '请选择 Git 项目的最外层文件夹', {
        detail: root,
        remediation: '重新添加提示路径中的项目根目录；VibeGit 不会越过所选目录保存或恢复文件。'
      })
    }
  }

  async initialize(projectPath: string): Promise<void> {
    await mkdir(projectPath, { recursive: true })
    const existingRoot = await this.getRepositoryRoot(projectPath)
    if (existingRoot) {
      await this.assertRepositoryRoot(projectPath)
      return
    }
    await this.runner.run(projectPath, ['init'])
  }

  async getPrivateDataDirectory(projectPath: string): Promise<string> {
    const rawGitDirectory = (await this.runner.run(projectPath, ['rev-parse', '--absolute-git-dir'])).stdout.trim()
    if (!rawGitDirectory) throw new VibeGitError('GIT_DIRECTORY_UNAVAILABLE', '无法定位 Git 私有目录')
    const gitDirectory = await realpath(resolve(rawGitDirectory))
    const privateDirectory = resolve(gitDirectory, 'vibegit')
    if (privateDirectory !== gitDirectory && !privateDirectory.startsWith(`${gitDirectory}${sep}`)) {
      throw new VibeGitError('UNSAFE_PRIVATE_DIRECTORY', 'VibeGit 私有目录越出了 Git 目录')
    }
    try {
      const existing = await lstat(privateDirectory)
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new VibeGitError('UNSAFE_PRIVATE_DIRECTORY', 'Git 私有目录中的 vibegit 路径不安全', {
          remediation: '请先将 .git 内同名的符号链接或文件移走，再重试。'
        })
      }
    } catch (error) {
      if (error instanceof VibeGitError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await mkdir(privateDirectory, { recursive: false })
    }
    const verified = await realpath(privateDirectory)
    if (verified !== gitDirectory && !verified.startsWith(`${gitDirectory}${sep}`)) {
      throw new VibeGitError('UNSAFE_PRIVATE_DIRECTORY', 'VibeGit 私有目录解析到了 Git 目录之外')
    }
    return verified
  }

  async createPrivateRecoveryDirectory(projectPath: string, restoreId: string): Promise<string> {
    if (!/^[a-zA-Z0-9-]+$/.test(restoreId)) throw new VibeGitError('INVALID_RESTORE_ID', '恢复记录标识无效')
    const privateDirectory = await this.getPrivateDataDirectory(projectPath)
    const recoveryRoot = resolve(privateDirectory, 'recovery')
    try {
      const existing = await lstat(recoveryRoot)
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new VibeGitError('UNSAFE_RECOVERY_DIRECTORY', 'Git 私有恢复目录不安全')
      }
    } catch (error) {
      if (error instanceof VibeGitError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await mkdir(recoveryRoot, { recursive: false })
    }
    const verifiedRoot = await realpath(recoveryRoot)
    if (verifiedRoot !== privateDirectory && !verifiedRoot.startsWith(`${privateDirectory}${sep}`)) {
      throw new VibeGitError('UNSAFE_RECOVERY_DIRECTORY', '恢复目录解析到了 Git 私有目录之外')
    }
    const recoveryDirectory = resolve(verifiedRoot, restoreId)
    await mkdir(recoveryDirectory, { recursive: false })
    const verifiedRecovery = await realpath(recoveryDirectory)
    if (!verifiedRecovery.startsWith(`${verifiedRoot}${sep}`)) {
      throw new VibeGitError('UNSAFE_RECOVERY_DIRECTORY', '本次恢复目录解析到了 Git 私有目录之外')
    }
    return verifiedRecovery
  }

  async createPrivateUndoDirectory(projectPath: string, recoveryDirectory: string, undoId: string): Promise<string> {
    if (!/^[a-zA-Z0-9-]+$/.test(undoId)) throw new VibeGitError('INVALID_UNDO_ID', '撤销记录标识无效')
    const privateDirectory = await this.getPrivateDataDirectory(projectPath)
    const recoveryRoot = await realpath(resolve(privateDirectory, 'recovery'))
    if (!recoveryRoot.startsWith(`${privateDirectory}${sep}`)) throw new VibeGitError('UNSAFE_RECOVERY_DIRECTORY', '恢复根目录解析到了 Git 私有目录之外')
    const verifiedRecovery = await realpath(resolve(recoveryDirectory))
    if (!verifiedRecovery.startsWith(`${recoveryRoot}${sep}`)) {
      throw new VibeGitError('UNSAFE_RECOVERY_DIRECTORY', '撤销来源不在 Git 私有恢复目录中')
    }
    const undoRoot = resolve(verifiedRecovery, 'undo')
    try {
      const existing = await lstat(undoRoot)
      if (existing.isSymbolicLink() || !existing.isDirectory()) throw new VibeGitError('UNSAFE_RECOVERY_DIRECTORY', '撤销恢复目录不安全')
    } catch (error) {
      if (error instanceof VibeGitError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await mkdir(undoRoot, { recursive: false })
    }
    const verifiedUndoRoot = await realpath(undoRoot)
    if (!verifiedUndoRoot.startsWith(`${verifiedRecovery}${sep}`)) throw new VibeGitError('UNSAFE_RECOVERY_DIRECTORY', '撤销目录解析到了恢复区之外')
    const undoDirectory = resolve(verifiedUndoRoot, undoId)
    await mkdir(undoDirectory, { recursive: false })
    const verifiedUndo = await realpath(undoDirectory)
    if (!verifiedUndo.startsWith(`${verifiedUndoRoot}${sep}`)) throw new VibeGitError('UNSAFE_RECOVERY_DIRECTORY', '本次撤销目录解析到了恢复区之外')
    return verifiedUndo
  }

  async getStatus(projectPath: string, includeIgnored = false): Promise<GitStatus> {
    if (!(await this.isRepository(projectPath))) {
      return {
        isRepository: false,
        hasHead: false,
        hasChanges: false,
        staged: [],
        modified: [],
        deleted: [],
        untracked: [],
        ignored: []
      }
    }
    const args = ['status', '--porcelain=v1', '-z', '--untracked-files=all']
    if (includeIgnored) args.push('--ignored=matching')
    const parsed = parsePorcelain((await this.runner.run(projectPath, args)).stdout)
    const head = await this.runner.run(projectPath, ['rev-parse', '--verify', 'HEAD'], { allowExitCodes: [0, 128] })
    parsed.hasHead = head.exitCode === 0
    const branch = await this.runner.run(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowExitCodes: [0, 1, 128] })
    if (branch.exitCode === 0 && branch.stdout.trim()) parsed.branch = branch.stdout.trim()
    return parsed
  }

  async captureWorktreeTree(projectPath: string): Promise<CapturedTree> {
    await this.assertRepositoryRoot(projectPath)
    if (!(await this.isRepository(projectPath))) {
      throw new VibeGitError('NOT_A_GIT_PROJECT', '此项目尚未开启版本保护', {
        remediation: '先点击“开启版本保护”。'
      })
    }
    const temporary = await mkdtemp(join(tmpdir(), 'vibegit-index-'))
    const indexPath = join(temporary, 'index')
    const env = { GIT_INDEX_FILE: indexPath }
    try {
      const head = await this.runner.run(projectPath, ['rev-parse', '--verify', 'HEAD'], { allowExitCodes: [0, 128] })
      const hasHead = head.exitCode === 0
      // Seed from the user's real index tree rather than HEAD. A newly staged
      // file therefore remains known as tracked even if it was later added to
      // .gitignore; add -A captures its current worktree bytes without touching
      // the real index.
      const realIndexTree = (await this.runner.run(projectPath, ['write-tree'])).stdout.trim()
      if (!realIndexTree) throw new VibeGitError('CHECKPOINT_INDEX_TREE_FAILED', '无法读取当前暂存状态')
      await this.runner.run(projectPath, ['read-tree', realIndexTree], { env })
      await this.runner.run(projectPath, ['add', '-A', '--', '.'], { env, timeoutMs: 60_000 })
      const treeObjectId = (await this.runner.run(projectPath, ['write-tree'], { env })).stdout.trim()
      if (!treeObjectId) throw new VibeGitError('CHECKPOINT_TREE_FAILED', '无法读取当前项目状态')
      return { treeObjectId, hasHead }
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }

  async createHiddenCheckpoint(
    projectPath: string,
    input: { id: string; title: string; createdAt: string; parentObjectId?: string; treeObjectId?: string }
  ): Promise<HiddenCheckpointObject> {
    if (!/^[a-zA-Z0-9_-]+$/.test(input.id)) {
      throw new VibeGitError('INVALID_CHECKPOINT_ID', '保存点标识不安全')
    }
    const treeObjectId = input.treeObjectId ?? (await this.captureWorktreeTree(projectPath)).treeObjectId
    const args = ['commit-tree', treeObjectId]
    if (input.parentObjectId) {
      await this.verifyCommit(projectPath, input.parentObjectId)
      args.push('-p', input.parentObjectId)
    }
    const identity = {
      GIT_AUTHOR_NAME: 'VibeGit',
      GIT_AUTHOR_EMAIL: 'checkpoint@vibegit.local',
      GIT_AUTHOR_DATE: input.createdAt,
      GIT_COMMITTER_NAME: 'VibeGit',
      GIT_COMMITTER_EMAIL: 'checkpoint@vibegit.local',
      GIT_COMMITTER_DATE: input.createdAt
    }
    const commitObjectId = (await this.runner.run(projectPath, args, { env: identity, stdin: `${input.title}\n` })).stdout.trim()
    const ref = `refs/vibegit/checkpoints/${input.id}`
    const objectFormat = (await this.runner.run(projectPath, ['rev-parse', '--show-object-format'])).stdout.trim()
    const zeroObjectId = '0'.repeat(objectFormat === 'sha256' ? 64 : 40)
    await this.runner.run(projectPath, ['update-ref', '-m', `VibeGit: ${input.title}`, ref, commitObjectId, zeroObjectId])
    await this.verifyCommit(projectPath, commitObjectId)
    return { commitObjectId, treeObjectId, ref }
  }

  async deleteCheckpointRef(projectPath: string, id: string): Promise<void> {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new VibeGitError('INVALID_CHECKPOINT_ID', '保存点标识不安全')
    await this.runner.run(projectPath, ['update-ref', '-d', `refs/vibegit/checkpoints/${id}`])
  }

  async verifyCommit(projectPath: string, objectId: string): Promise<void> {
    const result = await this.runner.run(projectPath, ['cat-file', '-e', `${objectId}^{commit}`], { allowExitCodes: [0, 1, 128] })
    if (result.exitCode !== 0) throw new VibeGitError('CHECKPOINT_UNREADABLE', '保存点无法读取', {
      detail: objectId,
      remediation: '停止恢复操作并选择另一个保存点。'
    })
  }

  async getCommitTree(projectPath: string, objectId: string): Promise<string> {
    await this.verifyCommit(projectPath, objectId)
    return (await this.runner.run(projectPath, ['rev-parse', `${objectId}^{tree}`])).stdout.trim()
  }

  async getEmptyTree(projectPath: string): Promise<string> {
    return (await this.runner.run(projectPath, ['mktree'], { stdin: '' })).stdout.trim()
  }

  async summarizeDiff(projectPath: string, fromObjectId: string | undefined, toObjectId: string): Promise<ChangedFile[]> {
    const from = fromObjectId ?? await this.getEmptyTree(projectPath)
    const [names, numstat] = await Promise.all([
      this.runner.run(projectPath, ['-c', 'core.quotepath=false', 'diff', '--name-status', '-z', '-M', from, toObjectId, '--']),
      this.runner.run(projectPath, ['-c', 'core.quotepath=false', 'diff', '--numstat', '-z', '-M', from, toObjectId, '--'])
    ])
    const stats = parseNumstat(numstat.stdoutBuffer)
    return parseNameStatus(names.stdoutBuffer).map((change) => {
      const fileStats = stats.get(change.path) ?? { insertions: 0, deletions: 0, binary: false }
      return {
        path: change.path,
        ...(change.previousPath ? { previousPath: change.previousPath } : {}),
        kind: normalizeKind(change.status),
        ...fileStats
      }
    })
  }

  async getDiff(projectPath: string, fromObjectId: string | undefined, toObjectId: string): Promise<CheckpointDiff> {
    const from = fromObjectId ?? await this.getEmptyTree(projectPath)
    const summary = await this.summarizeDiff(projectPath, from, toObjectId)
    const files: FileDiff[] = []
    for (const changed of summary) {
      let patch = ''
      if (!changed.binary) {
        const patchResult = await this.runner.run(
          projectPath,
          ['-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--no-color', '--unified=3', from, toObjectId, '--', changed.path],
          { maxOutputBytes: 4 * 1024 * 1024 }
        )
        patch = patchResult.stdout.length > 1_000_000
          ? `${patchResult.stdout.slice(0, 1_000_000)}\n… Diff 过长，已截断显示 …\n`
          : patchResult.stdout
      }
      files.push({
        path: changed.path,
        ...(changed.previousPath ? { previousPath: changed.previousPath } : {}),
        kind: changed.kind,
        patch,
        binary: changed.binary,
        insertions: changed.insertions,
        deletions: changed.deletions
      })
    }
    return {
      ...(fromObjectId ? { fromObjectId } : {}),
      toObjectId,
      files,
      insertions: files.reduce((sum, file) => sum + file.insertions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0)
    }
  }

  async listTree(projectPath: string, objectId: string): Promise<TreeEntry[]> {
    const output = (await this.runner.run(projectPath, ['ls-tree', '-r', '-z', '--full-tree', objectId])).stdoutBuffer.toString('utf8')
    return output.split('\0').filter(Boolean).map((entry) => {
      const tab = entry.indexOf('\t')
      const metadata = entry.slice(0, tab).split(' ')
      const type = metadata[1]
      if (tab < 0 || metadata.length < 3 || (type !== 'blob' && type !== 'tree' && type !== 'commit')) {
        throw new VibeGitError('INVALID_GIT_TREE', '保存点包含无法识别的文件记录')
      }
      return { mode: metadata[0] ?? '', type, objectId: metadata[2] ?? '', path: entry.slice(tab + 1) }
    })
  }

  async readBlob(projectPath: string, objectId: string): Promise<Buffer> {
    return (await this.runner.run(projectPath, ['cat-file', 'blob', objectId], { maxOutputBytes: 128 * 1024 * 1024 })).stdoutBuffer
  }

  async getBlobSize(projectPath: string, objectId: string): Promise<number> {
    const output = (await this.runner.run(projectPath, ['cat-file', '-s', objectId])).stdout.trim()
    const size = Number.parseInt(output, 10)
    if (!Number.isSafeInteger(size) || size < 0) throw new VibeGitError('INVALID_GIT_BLOB_SIZE', 'Git 文件大小无效')
    return size
  }

  async listTrackedFiles(projectPath: string): Promise<string[]> {
    return (await this.runner.run(projectPath, ['ls-files', '-z'])).stdout.split('\0').filter(Boolean)
  }

  async listUntrackedFiles(projectPath: string): Promise<{ ordinary: string[]; ignored: string[] }> {
    const [ordinary, ignored] = await Promise.all([
      this.runner.run(projectPath, ['ls-files', '--others', '--exclude-standard', '-z']),
      this.runner.run(projectPath, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'])
    ])
    return {
      ordinary: ordinary.stdout.split('\0').filter(Boolean),
      ignored: ignored.stdout.split('\0').filter(Boolean)
    }
  }

  async getRepositoryStateFingerprint(projectPath: string): Promise<RepositoryStateFingerprint> {
    const [head, headRef, index] = await Promise.all([
      this.runner.run(projectPath, ['rev-parse', '--verify', 'HEAD'], { allowExitCodes: [0, 128] }),
      this.runner.run(projectPath, ['symbolic-ref', '--quiet', 'HEAD'], { allowExitCodes: [0, 1, 128] }),
      this.runner.run(projectPath, ['ls-files', '--stage', '-z'])
    ])
    return {
      ...(head.exitCode === 0 && head.stdout.trim() ? { headObjectId: head.stdout.trim() } : {}),
      ...(headRef.exitCode === 0 && headRef.stdout.trim() ? { headRef: headRef.stdout.trim() } : {}),
      indexFingerprint: createHash('sha256').update(index.stdoutBuffer).digest('hex')
    }
  }

  async assertRestoreStateSafe(projectPath: string): Promise<void> {
    const sparse = await this.runner.run(projectPath, ['config', '--bool', 'core.sparseCheckout'], { allowExitCodes: [0, 1] })
    if (sparse.exitCode === 0 && sparse.stdout.trim() === 'true') throw new VibeGitError('RESTORE_SPARSE_CHECKOUT_UNSUPPORTED', '暂不能在稀疏检出的项目中安全回退', {
      remediation: '先关闭 sparse checkout，或在高级 Git 工具中处理。'
    })
    const unmerged = await this.runner.run(projectPath, ['ls-files', '--unmerged', '-z'])
    if (unmerged.stdoutBuffer.length > 0) throw new VibeGitError('RESTORE_UNMERGED_STATE', '项目正在处理文件冲突，VibeGit 已停止回退', {
      remediation: '先在 Git 工具中完成或取消当前冲突处理，再重新预览。'
    })
    const markers = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']
    for (const marker of markers) {
      const markerPath = (await this.runner.run(projectPath, ['rev-parse', '--git-path', marker])).stdout.trim()
      try {
        await lstat(resolve(projectPath, markerPath))
        throw new VibeGitError('RESTORE_GIT_OPERATION_ACTIVE', '项目正在执行合并或变基，VibeGit 已停止回退', {
          remediation: '先在 Git 工具中完成或取消当前操作，再重新预览。'
        })
      } catch (error) {
        if (error instanceof VibeGitError) throw error
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }

  async materializeCommit(projectPath: string, objectId: string, destination: string): Promise<void> {
    await this.verifyCommit(projectPath, objectId)
    const temporary = await mkdtemp(join(tmpdir(), 'vibegit-checkout-index-'))
    const env = { GIT_INDEX_FILE: join(temporary, 'index') }
    await mkdir(destination, { recursive: true })
    try {
      await this.runner.run(projectPath, ['read-tree', objectId], { env })
      const prefix = `${resolve(destination)}${sep}`
      await this.runner.run(projectPath, ['checkout-index', '--all', '--force', `--prefix=${prefix}`], {
        env,
        timeoutMs: 120_000,
        maxOutputBytes: 4 * 1024 * 1024
      })
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }

  async restoreWorktree(projectPath: string, objectId: string): Promise<void> {
    await this.verifyCommit(projectPath, objectId)
    await this.runner.run(projectPath, ['restore', `--source=${objectId}`, '--worktree', '--', '.'], {
      timeoutMs: 120_000,
      maxOutputBytes: 4 * 1024 * 1024
    })
  }

  async verifyWorktreeAgainstCommit(projectPath: string, objectId: string): Promise<void> {
    await this.verifyCommit(projectPath, objectId)
    const temporary = await mkdtemp(join(tmpdir(), 'vibegit-verify-index-'))
    const env = { GIT_INDEX_FILE: join(temporary, 'index') }
    try {
      await this.runner.run(projectPath, ['read-tree', objectId], { env })
      await this.runner.run(projectPath, ['update-index', '--refresh'], { env, allowExitCodes: [0, 1] })
      const diff = await this.runner.run(projectPath, ['diff-files', '--quiet', '--'], { env, allowExitCodes: [0, 1] })
      if (diff.exitCode !== 0) {
        const detail = await this.runner.run(projectPath, ['diff-files', '--name-status', '--'], { env })
        throw new VibeGitError('RESTORE_VERIFICATION_FAILED', '恢复后的文件未通过 Git 工作区校验', {
          detail: detail.stdout.trim()
        })
      }
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }

  async getRemoteUrl(projectPath: string, remote = 'origin'): Promise<string | undefined> {
    if (!/^[a-zA-Z0-9._-]+$/.test(remote) || remote.startsWith('-')) return undefined
    const result = await this.runner.run(projectPath, ['config', '--get', `remote.${remote}.url`], { allowExitCodes: [0, 1, 2, 128] })
    return result.exitCode === 0 ? result.stdout.trim() : undefined
  }

  async setRemote(projectPath: string, remoteUrl: string, remote = 'origin'): Promise<void> {
    if (!/^(https:\/\/|ssh:\/\/|git@)[^\s]+$/i.test(remoteUrl)) {
      throw new VibeGitError('INVALID_REMOTE_URL', 'GitHub 备份位置格式无效')
    }
    const existing = await this.getRemoteUrl(projectPath, remote)
    if (existing) await this.runner.run(projectPath, ['remote', 'set-url', remote, remoteUrl])
    else await this.runner.run(projectPath, ['remote', 'add', remote, remoteUrl])
  }

  private async assertRemoteUrlNotRewritten(projectPath: string, remoteUrl: string): Promise<void> {
    const rewrites = await this.runner.run(projectPath, [
      'config',
      '--get-regexp',
      '^url\\..*\\.(insteadof|pushinsteadof)$'
    ], { allowExitCodes: [0, 1] })
    if (rewrites.exitCode === 0) {
      for (const line of rewrites.stdout.split(/\r?\n/).filter(Boolean)) {
        const match = line.match(/^\S+\s+(.+)$/)
        if (!match) {
          throw new VibeGitError('UNSAFE_GIT_URL_REWRITE', '检测到无法安全解析的 Git URL 重写配置')
        }
        const prefix = match[1]!
        if (remoteUrl.startsWith(prefix)) {
          throw new VibeGitError('UNSAFE_GIT_URL_REWRITE', 'Git 配置会把已验证的 GitHub 地址改写到其他位置', {
            remediation: '移除适用于该 GitHub 地址的 url.*.insteadOf / pushInsteadOf 配置后再备份。'
          })
        }
      }
    }
    const effective = (await this.runner.run(projectPath, ['ls-remote', '--get-url', remoteUrl])).stdout.trim()
    if (effective !== remoteUrl) {
      throw new VibeGitError('UNSAFE_GIT_URL_REWRITE', 'Git 实际解析出的备份地址与已验证地址不一致', {
        remediation: '检查仓库、本机和环境中的 Git URL 重写配置后再备份。'
      })
    }
  }

  async pushCheckpoint(projectPath: string, objectId: string, remoteUrl: string, branch = 'vibegit-backup'): Promise<void> {
    await this.verifyCommit(projectPath, objectId)
    if (remoteUrl.startsWith('-') || !/^(https:\/\/|ssh:\/\/|git@)[^\s]+$/i.test(remoteUrl)) {
      throw new VibeGitError('INVALID_REMOTE_URL', '备份位置格式无效')
    }
    if (!/^[a-zA-Z0-9._/-]+$/.test(branch) || branch.includes('..')) {
      throw new VibeGitError('INVALID_BACKUP_BRANCH', '备份分支名称无效')
    }
    await this.assertRemoteUrlNotRewritten(projectPath, remoteUrl)
    const remoteRef = `refs/heads/${branch}`
    const advertised = await this.runner.run(projectPath, ['ls-remote', '--heads', remoteUrl, remoteRef], {
      timeoutMs: 120_000,
      maxOutputBytes: 4 * 1024 * 1024
    })
    const remoteTip = advertised.stdout.trim().split(/\s+/)[0] || undefined
    if (remoteTip && !/^[0-9a-f]{40,64}$/i.test(remoteTip)) {
      throw new VibeGitError('INVALID_REMOTE_RESPONSE', 'GitHub 返回了无法识别的备份版本')
    }
    if (remoteTip) {
      await this.runner.run(projectPath, ['fetch', '--no-tags', remoteUrl, remoteRef], {
        timeoutMs: 120_000,
        maxOutputBytes: 4 * 1024 * 1024
      })
      await this.verifyCommit(projectPath, remoteTip)
    }

    // Never push the local checkpoint commit itself: its parent chain can contain
    // an older local-only secret. Export only the scanned tree, linked to the
    // previous already-safe remote snapshot.
    const treeObjectId = await this.getCommitTree(projectPath, objectId)
    const commitArgs = ['commit-tree', treeObjectId]
    if (remoteTip) commitArgs.push('-p', remoteTip)
    const createdAt = new Date().toISOString()
    const identity = {
      GIT_AUTHOR_NAME: 'VibeGit Backup',
      GIT_AUTHOR_EMAIL: 'backup@vibegit.local',
      GIT_AUTHOR_DATE: createdAt,
      GIT_COMMITTER_NAME: 'VibeGit Backup',
      GIT_COMMITTER_EMAIL: 'backup@vibegit.local',
      GIT_COMMITTER_DATE: createdAt
    }
    const exportCommit = (await this.runner.run(projectPath, commitArgs, {
      env: identity,
      stdin: `VibeGit safe backup ${createdAt}\n`
    })).stdout.trim()
    await this.verifyCommit(projectPath, exportCommit)
    const pendingRef = `refs/vibegit/backups/pending-${randomUUID()}`
    const objectFormat = (await this.runner.run(projectPath, ['rev-parse', '--show-object-format'])).stdout.trim()
    const zeroObjectId = '0'.repeat(objectFormat === 'sha256' ? 64 : 40)
    await this.runner.run(projectPath, ['update-ref', pendingRef, exportCommit, zeroObjectId])
    try {
      await this.runner.run(
        projectPath,
        ['push', '--no-verify', '--porcelain', remoteUrl, `${exportCommit}:${remoteRef}`],
        { timeoutMs: 120_000, maxOutputBytes: 4 * 1024 * 1024 }
      )
    } finally {
      await this.runner.run(projectPath, ['update-ref', '-d', pendingRef], { allowExitCodes: [0, 1, 128] })
    }
  }

  resolveProjectFile(projectPath: string, relativePath: string): string {
    const root = resolve(projectPath)
    const target = resolve(root, relativePath)
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new VibeGitError('UNSAFE_PROJECT_PATH', '保存点包含越出项目目录的路径')
    }
    return target
  }

  async fileExists(path: string): Promise<boolean> {
    try { await lstat(path); return true } catch { return false }
  }
}
