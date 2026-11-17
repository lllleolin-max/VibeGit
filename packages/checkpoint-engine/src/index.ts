import { createHash, randomUUID, type Hash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type {
  Checkpoint,
  CheckpointDiff,
  CreateCheckpointInput,
  RemoveProjectResult,
  RestoreImpactFile,
  RestorePreview,
  RestoreRecord,
  ShelvedChange
} from '@vibegit/shared'
import { VibeGitError } from '@vibegit/shared'
import { VibeGitDatabase } from '@vibegit/database'
import { GitEngine, type TreeEntry } from '@vibegit/git-engine'

const RESTORE_TOKEN_TTL_MS = 15 * 60 * 1000
const PROJECT_LEASE_TTL_MS = 5 * 60 * 1000
const PROJECT_LEASE_WAIT_MS = 10_000
const PROJECT_LEASE_RETRY_MS = 50

function safeTitle(title: string): string {
  const clean = title.trim().replace(/[\r\n\t]+/g, ' ').slice(0, 160)
  if (!clean) throw new VibeGitError('INVALID_CHECKPOINT_TITLE', '请为保存点填写一个简短名称')
  return clean
}

function isPathInside(root: string, target: string): boolean {
  const normalizedRoot = resolve(root)
  const normalizedTarget = resolve(target)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
}

function normalizeForVolume(value: string): string {
  const normalized = (sep === '\\' ? value.replaceAll('\\', '/') : value).replace(/\/$/, '')
  return process.platform === 'win32' || process.platform === 'darwin' ? normalized.normalize('NFC').toLocaleLowerCase('en-US') : normalized
}

function pathOrAncestor(paths: ReadonlyMap<string, string>, path: string): string | undefined {
  let key = normalizeForVolume(path)
  while (key) {
    const match = paths.get(key)
    if (match !== undefined) return match
    const slash = key.lastIndexOf('/')
    if (slash < 0) break
    key = key.slice(0, slash)
  }
  return undefined
}

async function restoreConflictPaths(
  git: GitEngine,
  projectPath: string,
  untracked: readonly string[],
  targets: readonly TreeEntry[],
  changedPaths: ReadonlySet<string>
): Promise<string[]> {
  const files = new Map<string, string>()
  const directories = new Map<string, string>()
  for (const path of untracked) {
    files.set(normalizeForVolume(path), path)
    let slash = path.lastIndexOf('/')
    while (slash >= 0) {
      const directory = path.slice(0, slash)
      const key = normalizeForVolume(directory)
      if (directories.has(key)) break
      directories.set(key, directory)
      slash = directory.lastIndexOf('/')
    }
  }
  const moves = new Set<string>()
  for (const entry of targets) {
    const move = pathOrAncestor(files, entry.path) ?? directories.get(normalizeForVolume(entry.path))
    if (move) moves.add(move)
    else if (entry.type === 'blob' && changedPaths.has(entry.path)) {
      // Git's untracked-file list omits empty directories. A restore can still
      // replace one with a file, so preserve the actual directory for undo.
      try {
        if ((await lstat(git.resolveProjectFile(projectPath, entry.path))).isDirectory()) moves.add(entry.path)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
      }
    }
  }
  return [...moves].sort()
}

interface RecoveryEntry {
  path: string
  recoveryRelativePath: string
  kind: 'file' | 'directory' | 'symlink'
  size: number
  sha256: string
  mode: number
  capturedInInsurance: boolean
  moved: boolean
}

interface RestoreManifest {
  version: 1
  restoreId: string
  createdAt: string
  targetCheckpointId: string
  insuranceCheckpointId: string
  targetObjectId: string
  insuranceObjectId: string
  createdByRestore: string[]
  conflicts: RecoveryEntry[]
  status: 'planned' | 'restoring' | 'applied' | 'undone'
  undoRecoveryDirectory?: string
}

export interface CheckpointSaveResult {
  checkpoint: Checkpoint
  created: boolean
}

export class CheckpointEngine {
  private readonly projectOperationTails = new Map<string, Promise<void>>()
  private readonly operationOwnerId = randomUUID()

  constructor(
    readonly database: VibeGitDatabase,
    readonly git: GitEngine
  ) {}

  async withProjectOperation<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    if (!this.database.getProject(projectId)) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
    const previous = this.projectOperationTails.get(projectId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolvePromise) => { release = resolvePromise })
    const tail = previous.then(() => gate)
    this.projectOperationTails.set(projectId, tail)
    await previous
    const releaseLocal = (): void => {
      release()
      if (this.projectOperationTails.get(projectId) === tail) this.projectOperationTails.delete(projectId)
    }
    const deadline = Date.now() + PROJECT_LEASE_WAIT_MS
    let acquired = false
    try {
      while (!acquired && Date.now() <= deadline) {
        if (!this.database.getProject(projectId)) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
        const now = Date.now()
        acquired = this.database.acquireProjectOperation(
          projectId,
          this.operationOwnerId,
          'worktree-safety',
          now,
          now + PROJECT_LEASE_TTL_MS
        )
        if (!acquired) await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, PROJECT_LEASE_RETRY_MS))
      }
    } catch (error) {
      releaseLocal()
      throw error
    }
    if (!acquired) {
      releaseLocal()
      throw new VibeGitError('PROJECT_OPERATION_BUSY', '另一个 VibeGit 操作正在保护这个项目', {
        remediation: '等待当前保存或回退完成后重试。',
        retryable: true
      })
    }
    const heartbeat = setInterval(() => {
      try {
        this.database.renewProjectOperation(projectId, this.operationOwnerId, Date.now() + PROJECT_LEASE_TTL_MS)
      } catch {
        // The next destructive step checks ownership and stops safely.
      }
    }, Math.floor(PROJECT_LEASE_TTL_MS / 3))
    heartbeat.unref()
    try {
      return await operation()
    } finally {
      clearInterval(heartbeat)
      try {
        this.database.releaseProjectOperation(projectId, this.operationOwnerId)
      } finally {
        releaseLocal()
      }
    }
  }

  private assertProjectOperation(projectId: string): void {
    if (!this.database.hasProjectOperation(projectId, this.operationOwnerId)) {
      throw new VibeGitError('PROJECT_OPERATION_LEASE_LOST', '项目安全锁已失效，已停止文件操作', {
        remediation: '不要手动移动恢复区；重新打开项目并检查当前文件后再重试。'
      })
    }
  }

  async create(input: CreateCheckpointInput): Promise<Checkpoint | undefined> {
    return await this.withProjectOperation(input.projectId, async () => await this.createLocked(input))
  }

  async initializeProtection(projectId: string, prepareRepository: (path: string) => Promise<void>): Promise<Checkpoint> {
    return await this.withProjectOperation(projectId, async () => {
      const project = this.database.getProject(projectId)
      if (!project) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
      await prepareRepository(project.path)
      const existing = this.database.getLatestCheckpoint(projectId)
      if (existing) {
        await this.git.verifyCommit(project.path, existing.gitObjectId)
        const active = this.database.getActiveCheckpoint(projectId)
        if (active && active.id !== existing.id) await this.git.verifyCommit(project.path, active.gitObjectId)
        this.assertProjectOperation(projectId)
        this.database.enableProjectProtection(projectId)
        return existing
      }
      const checkpoint = await this.createLocked({
        projectId, type: 'initial', title: '初始化项目', agent: 'system',
        summary: '已开启版本保护并保存当前项目状态', allowEmpty: true
      })
      if (!checkpoint) throw new VibeGitError('INITIAL_CHECKPOINT_FAILED', '未能创建初始保存点')
      return checkpoint
    })
  }

  async createOrExisting(input: CreateCheckpointInput): Promise<CheckpointSaveResult> {
    return await this.withProjectOperation(input.projectId, async () => {
      const checkpoint = await this.createLocked(input)
      if (checkpoint) return { checkpoint, created: true }
      // Resolve a no-change result before releasing the lease. Another process
      // can restore or save immediately afterwards and change the active record.
      this.assertProjectOperation(input.projectId)
      const existing = this.database.getActiveCheckpoint(input.projectId) ?? this.database.getLatestCheckpoint(input.projectId)
      if (!existing) throw new VibeGitError('CHECKPOINT_NOT_FOUND', '找不到当前项目状态对应的保存点')
      return { checkpoint: existing, created: false }
    })
  }

  async removeProject(projectId: string): Promise<RemoveProjectResult> {
    return await this.withProjectOperation(projectId, async () => {
      const project = this.database.getProject(projectId)
      if (!project) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
      const checkpoints = this.database.listCheckpoints(projectId)
      this.assertProjectOperation(projectId)
      // Keep every ref intact until the registry deletion commits. Failure to
      // clean up a moved/unavailable repository leaves only private orphan refs,
      // never database records whose saved content has lost its protection.
      this.database.deleteProject(projectId, this.operationOwnerId)
      for (const checkpoint of checkpoints) {
        try { await this.git.deleteCheckpointRef(project.path, checkpoint.id) }
        catch { /* The removed project's files and any remaining refs stay intact. */ }
      }
      return { projectId, removedCheckpoints: checkpoints.length }
    })
  }

  async deleteCheckpoint(checkpointId: string): Promise<{ checkpointId: string; projectId: string }> {
    const checkpoint = this.database.getCheckpoint(checkpointId)
    if (!checkpoint) throw new VibeGitError('CHECKPOINT_NOT_FOUND', '找不到这个保存点')
    return await this.withProjectOperation(checkpoint.projectId, async () => {
      const project = this.database.getProject(checkpoint.projectId)
      if (!project) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
      this.assertProjectOperation(project.id)
      // Validation and deletion are one database transaction. A cleanup failure
      // after this point must not invite a repeat of an already completed action.
      this.database.deleteCheckpoint(checkpointId, this.operationOwnerId)
      try { await this.git.deleteCheckpointRef(project.path, checkpointId) }
      catch { /* A private orphan ref is safe and does not reappear in the timeline. */ }
      return { checkpointId, projectId: project.id }
    })
  }

  async hasPendingChanges(projectId: string): Promise<boolean> {
    const project = this.database.getProject(projectId)
    if (!project) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
    if (!(await this.git.isRepository(project.path))) {
      throw new VibeGitError('NOT_A_GIT_PROJECT', '此项目尚未开启版本保护')
    }
    const baseline = this.database.getActiveCheckpoint(project.id) ?? this.database.getLatestCheckpoint(project.id)
    if (!baseline) return false
    const [previousTree, capture] = await Promise.all([
      this.git.getCommitTree(project.path, baseline.gitObjectId),
      this.git.captureWorktreeTree(project.path)
    ])
    return previousTree !== capture.treeObjectId
  }

  private async createLocked(input: CreateCheckpointInput): Promise<Checkpoint | undefined> {
    const project = this.database.getProject(input.projectId)
    if (!project) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
    if (!(await this.git.isRepository(project.path))) {
      throw new VibeGitError('NOT_A_GIT_PROJECT', '此项目尚未开启版本保护', {
        remediation: '先点击“开启版本保护”。'
      })
    }

    // The newest record can be an internal insurance/sync/shelf checkpoint that
    // intentionally did not become the user's current version. Parentage,
    // no-change detection and diff statistics must follow the active baseline.
    const baseline = this.database.getActiveCheckpoint(project.id) ?? this.database.getLatestCheckpoint(project.id)
    const capture = await this.git.captureWorktreeTree(project.path)
    if (baseline) {
      const previousTree = await this.git.getCommitTree(project.path, baseline.gitObjectId)
      if (previousTree === capture.treeObjectId && !input.allowEmpty) return undefined
    }

    const id = randomUUID()
    const createdAt = new Date().toISOString()
    const title = safeTitle(input.title)
    this.assertProjectOperation(project.id)
    const hidden = await this.git.createHiddenCheckpoint(project.path, {
      id,
      title,
      createdAt,
      ...(baseline ? { parentObjectId: baseline.gitObjectId } : {}),
      treeObjectId: capture.treeObjectId
    })

    try {
      const changedFiles = await this.git.summarizeDiff(project.path, baseline?.gitObjectId, hidden.commitObjectId)
      const checkpoint: Checkpoint = {
        id,
        projectId: project.id,
        createdAt,
        type: input.type,
        title,
        agent: input.agent ?? 'manual',
        ...(input.agentSessionId ? { agentSessionId: input.agentSessionId } : {}),
        ...(input.taskText ? { taskText: input.taskText.trim().slice(0, 10_000) } : {}),
        ...(input.summary ? { summary: input.summary.trim().slice(0, 2_000) } : {}),
        gitObjectId: hidden.commitObjectId,
        ...(baseline ? { parentCheckpointId: baseline.id } : {}),
        changedFiles,
        insertions: changedFiles.reduce((sum, file) => sum + file.insertions, 0),
        deletions: changedFiles.reduce((sum, file) => sum + file.deletions, 0),
        testStatus: input.testStatus ?? 'not_run',
        githubSyncStatus: project.githubRemoteUrl ? 'pending' : 'not_configured',
        isStable: input.isStable ?? input.type === 'stable',
        ...(input.note ? { note: input.note.trim().slice(0, 2_000) } : {}),
        metadata: input.metadata ?? {}
      }
      this.assertProjectOperation(project.id)
      this.database.insertCheckpoint(checkpoint)
      return checkpoint
    } catch (error) {
      try { await this.git.deleteCheckpointRef(project.path, id) } catch { /* Keep original failure. */ }
      throw error
    }
  }

  list(projectId: string): Checkpoint[] {
    if (!this.database.getProject(projectId)) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
    return this.database.listCheckpoints(projectId)
  }

  async diff(checkpointId: string): Promise<CheckpointDiff> {
    const checkpoint = this.database.getCheckpoint(checkpointId)
    if (!checkpoint) throw new VibeGitError('CHECKPOINT_NOT_FOUND', '找不到这个保存点')
    const project = this.database.getProject(checkpoint.projectId)
    if (!project) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
    const parent = checkpoint.parentCheckpointId ? this.database.getCheckpoint(checkpoint.parentCheckpointId) : undefined
    return await this.git.getDiff(project.path, parent?.gitObjectId, checkpoint.gitObjectId)
  }

  async prepareRestore(projectId: string, targetCheckpointId: string): Promise<RestorePreview> {
    return await this.withProjectOperation(projectId, async () => await this.prepareRestoreLocked(projectId, targetCheckpointId))
  }

  private async prepareRestoreLocked(projectId: string, targetCheckpointId: string): Promise<RestorePreview> {
    const project = this.database.getProject(projectId)
    const target = this.database.getCheckpoint(targetCheckpointId)
    if (!project) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
    if (!target || target.projectId !== projectId) throw new VibeGitError('CHECKPOINT_NOT_FOUND', '找不到要恢复的保存点')
    await this.git.assertRestoreStateSafe(project.path)

    const insurance = await this.createLocked({
      projectId,
      type: 'pre_restore',
      title: '回退前保险点',
      agent: 'system',
      summary: `恢复到“${target.title}”前自动保存当前状态`,
      metadata: { targetCheckpointId },
      allowEmpty: true
    })
    if (!insurance) throw new VibeGitError('INSURANCE_CHECKPOINT_FAILED', '未能创建回退前保险点')
    await this.git.verifyCommit(project.path, insurance.gitObjectId)

    const activeCheckpoint = this.database.getActiveCheckpoint(projectId)
    const [changes, targetEntries, tracked, untracked, stateTreeObjectId, repositoryState] = await Promise.all([
      this.git.summarizeDiff(project.path, insurance.gitObjectId, target.gitObjectId),
      this.git.listTree(project.path, target.gitObjectId),
      this.git.listTrackedFiles(project.path),
      this.git.listUntrackedFiles(project.path),
      this.git.getCommitTree(project.path, insurance.gitObjectId),
      this.git.getRepositoryStateFingerprint(project.path)
    ])
    const allUntracked = [...untracked.ordinary, ...untracked.ignored]
    const ignored = new Set(untracked.ignored)
    const targetPaths = new Set(targetEntries.map((entry) => entry.path))
    const trackedPaths = new Set(tracked)
    const files: RestoreImpactFile[] = []

    const changedPaths = new Set(changes.flatMap((change) =>
      change.previousPath ? [change.previousPath, change.path] : [change.path]
    ))
    const conflictPaths = await restoreConflictPaths(this.git, project.path, allUntracked, targetEntries, changedPaths)
    const moves = new Map(conflictPaths.map((path) => [normalizeForVolume(path), path]))
    for (const path of changedPaths) {
      const absolute = this.git.resolveProjectFile(project.path, path)
      const exists = await this.git.fileExists(absolute)
      const conflict = pathOrAncestor(moves, path)
      if (conflict) {
        files.push({ path, action: 'move_to_recovery', reason: `当前路径“${conflict}”会先移入恢复区` })
      } else if (targetPaths.has(path)) {
        files.push({
          path,
          action: exists ? 'overwrite' : 'add',
          reason: exists ? '用所选保存点中的版本覆盖' : '从所选保存点恢复这个文件'
        })
      } else if (trackedPaths.has(path)) {
        files.push({ path, action: 'remove', reason: '所选保存点中不存在；当前内容已存入保险点' })
      } else {
        files.push({ path, action: 'preserve', reason: '当前新增文件不会被删除' })
      }
    }
    for (const path of allUntracked) {
      if (changedPaths.has(path)) continue
      const move = pathOrAncestor(moves, path)
      if (move) files.push({ path, action: 'move_to_recovery', reason: `当前路径“${move}”会先移入恢复区` })
      else files.push({ path, action: 'preserve', reason: ignored.has(path) ? '本地忽略文件会原样保留' : '当前新增且未保存的文件会原样保留' })
    }

    const createdAt = new Date().toISOString()
    const preview: RestorePreview = {
      token: randomUUID(),
      projectId,
      targetCheckpointId,
      insuranceCheckpointId: insurance.id,
      createdAt,
      expiresAt: new Date(Date.now() + RESTORE_TOKEN_TTL_MS).toISOString(),
      stateTreeObjectId,
      ...repositoryState,
      ...(activeCheckpoint ? { activeCheckpointId: activeCheckpoint.id } : {}),
      conflictPaths,
      files,
      addCount: files.filter((file) => file.action === 'add').length,
      overwriteCount: files.filter((file) => file.action === 'overwrite').length,
      removeCount: files.filter((file) => file.action === 'remove').length,
      conflictCount: conflictPaths.length
    }
    this.database.insertRestore(randomUUID(), preview)
    return preview
  }

  async executeRestore(token: string): Promise<RestoreRecord> {
    const pending = this.database.getRestoreByToken(token)
    if (!pending) throw new VibeGitError('RESTORE_TOKEN_INVALID', '这次回退确认已失效，请重新预览')
    return await this.withProjectOperation(pending.record.projectId, async () => await this.executeRestoreLocked(token))
  }

  private async assertRestorePreviewIsCurrent(
    projectId: string,
    projectPath: string,
    preview: RestorePreview
  ): Promise<void> {
    const [currentRepositoryState, currentTree] = await Promise.all([
      this.git.getRepositoryStateFingerprint(projectPath),
      this.git.captureWorktreeTree(projectPath)
    ])
    const currentActiveCheckpoint = this.database.getActiveCheckpoint(projectId)
    if (
      currentRepositoryState.headObjectId !== preview.headObjectId ||
      currentRepositoryState.headRef !== preview.headRef ||
      currentRepositoryState.indexFingerprint !== preview.indexFingerprint ||
      currentActiveCheckpoint?.id !== preview.activeCheckpointId
    ) {
      throw new VibeGitError('RESTORE_REPOSITORY_STATE_CHANGED', '预览后 Git 分支或暂存状态发生了变化，已停止回退', {
        remediation: '重新打开回退预览，确认最新影响。'
      })
    }
    if (currentTree.treeObjectId !== preview.stateTreeObjectId) {
      throw new VibeGitError('RESTORE_STATE_CHANGED', '预览后项目又发生了变化，已停止回退', {
        remediation: '重新打开回退预览，VibeGit 会先建立一个新的保险点。'
      })
    }
  }

  private async executeRestoreLocked(token: string): Promise<RestoreRecord> {
    const pending = this.database.getRestoreByToken(token)
    if (!pending) throw new VibeGitError('RESTORE_TOKEN_INVALID', '这次回退确认已失效，请重新预览')
    if (Date.parse(pending.expiresAt) < Date.now()) throw new VibeGitError('RESTORE_TOKEN_EXPIRED', '回退预览已过期，请重新检查影响')
    if (!this.database.claimRestore(token)) throw new VibeGitError('RESTORE_ALREADY_USED', '这次回退已经执行或取消')

    const project = this.database.getProject(pending.record.projectId)
    const target = this.database.getCheckpoint(pending.record.targetCheckpointId)
    const insurance = this.database.getCheckpoint(pending.record.insuranceCheckpointId)
    if (!project || !target || !insurance) {
      this.database.updateRestore(pending.record.id, { status: 'failed', errorCode: 'RESTORE_METADATA_MISSING' })
      throw new VibeGitError('RESTORE_METADATA_MISSING', '回退所需的本地记录不完整')
    }
    try {
      await Promise.all([
        this.git.verifyCommit(project.path, target.gitObjectId),
        this.git.verifyCommit(project.path, insurance.gitObjectId)
      ])
      await this.assertRestorePreviewIsCurrent(project.id, project.path, pending.preview)
    } catch (error) {
      const code = error instanceof VibeGitError ? error.code : 'RESTORE_VALIDATION_FAILED'
      this.database.updateRestore(pending.record.id, { status: 'failed', errorCode: code })
      throw error
    }

    const restoreId = pending.record.id
    let stagingDirectory: string | undefined
    let recoveryDirectory: string | undefined

    try {
      recoveryDirectory = await this.git.createPrivateRecoveryDirectory(project.path, restoreId)
      // Persist this before any file can move so a crashed process still leaves
      // a recovery location the next app instance can surface.
      this.database.updateRestore(restoreId, { status: 'executing', recoveryDirectory })
      stagingDirectory = await mkdtemp(join(tmpdir(), 'vibegit-restore-'))
      const [targetEntries, insuranceEntries, tracked] = await Promise.all([
        this.git.listTree(project.path, target.gitObjectId),
        this.git.listTree(project.path, insurance.gitObjectId),
        this.git.listTrackedFiles(project.path)
      ])
      await this.stageTarget(project.path, target.gitObjectId, stagingDirectory, targetEntries)
      // Materializing the target may take time. Editors and Agents can keep
      // writing meanwhile, so validate once more immediately before any move or
      // overwrite; a stale preview must never silently win.
      await this.assertRestorePreviewIsCurrent(project.id, project.path, pending.preview)
      const untracked = await this.git.listUntrackedFiles(project.path)
      const currentConflictPaths = await restoreConflictPaths(
        this.git, project.path, [...untracked.ordinary, ...untracked.ignored],
        targetEntries, new Set(pending.preview.files.map((file) => file.path))
      )
      if (JSON.stringify(currentConflictPaths) !== JSON.stringify([...pending.preview.conflictPaths].sort())) {
        throw new VibeGitError('RESTORE_STATE_CHANGED', '预览后的文件冲突已变化，已停止回退', {
          remediation: '重新打开回退预览，确认最新影响。'
        })
      }
      this.assertProjectOperation(project.id)
      const manifest = await this.createRestoreManifest(
        restoreId,
        project.path,
        target,
        insurance,
        targetEntries,
        insuranceEntries,
        tracked,
        currentConflictPaths
      )
      await this.persistManifest(recoveryDirectory, manifest)
      this.database.updateRestoreManifest(restoreId, manifest)
      await this.moveUntrackedConflicts(project.id, project.path, recoveryDirectory, manifest)
      this.assertProjectOperation(project.id)
      manifest.status = 'restoring'
      await this.persistManifest(recoveryDirectory, manifest)
      this.database.updateRestoreManifest(restoreId, manifest)
      this.assertProjectOperation(project.id)
      // An empty target and empty user index have no Git paths to apply.
      // Git rejects "." in that case; recovery files still need normal undo.
      if (targetEntries.length || tracked.length) await this.git.restoreWorktree(project.path, target.gitObjectId)
      this.assertProjectOperation(project.id)
      await this.git.verifyWorktreeAgainstCommit(project.path, target.gitObjectId)
      manifest.status = 'applied'
      await this.persistManifest(recoveryDirectory, manifest)
      this.database.updateRestoreManifest(restoreId, manifest)

      const completedAt = new Date().toISOString()
      this.database.transaction(() => {
        this.assertProjectOperation(project.id)
        this.database.updateRestore(restoreId, {
          status: 'completed',
          completedAt,
          ...(recoveryDirectory ? { recoveryDirectory } : {})
        })
        this.database.setActiveCheckpoint(project.id, target.id)
      })
      return this.database.getRestore(restoreId) ?? {
        ...pending.record,
        status: 'completed',
        completedAt,
        recoveryDirectory
      }
    } catch (error) {
      const code = error instanceof VibeGitError ? error.code : 'RESTORE_FAILED'
      this.database.updateRestore(restoreId, {
        status: 'failed',
        errorCode: code,
        ...(recoveryDirectory ? { recoveryDirectory } : {})
      })
      throw new VibeGitError('RESTORE_FAILED', '回退没有完整执行，保险点仍然可用', {
        detail: error instanceof Error ? error.message : String(error),
        remediation: '不要删除 Git 私有目录中的 VibeGit 恢复区；可从时间线重新恢复“回退前保险点”。',
        cause: error
      })
    } finally {
      if (stagingDirectory) await rm(stagingDirectory, { recursive: true, force: true })
    }
  }

  async undoRestore(restoreId: string): Promise<RestoreRecord> {
    const original = this.database.getRestore(restoreId)
    if (!original) throw new VibeGitError('RESTORE_NOT_FOUND', '找不到这次回退记录')
    return await this.withProjectOperation(original.projectId, async () => await this.undoRestoreLocked(restoreId))
  }

  private async undoRestoreLocked(restoreId: string): Promise<RestoreRecord> {
    const original = this.database.getRestore(restoreId)
    if (!original) throw new VibeGitError('RESTORE_NOT_FOUND', '找不到这次回退记录')
    if (original.status !== 'completed') throw new VibeGitError('RESTORE_NOT_UNDOABLE', '这次回退当前不能撤销')
    const manifest = this.database.getRestoreManifest<RestoreManifest>(restoreId)
    const originalPreview = this.database.getRestorePreview(restoreId)
    if (!manifest || !original.recoveryDirectory || !originalPreview) {
      throw new VibeGitError('RESTORE_MANIFEST_MISSING', '缺少精确撤销所需的恢复清单', {
        remediation: '不要手动删除 Git 私有目录中的 VibeGit 恢复区；可从时间线恢复“回退前保险点”。'
      })
    }
    const project = this.database.getProject(original.projectId)
    if (!project) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
    if (!this.database.claimRestoreUndo(restoreId)) throw new VibeGitError('RESTORE_NOT_UNDOABLE', '这次回退已经在撤销或已撤销')
    let undoExecutionStarted = false
    let undoMutationCompleted = false
    let undoAttemptRestoreId: string | undefined
    try {
      const originals = await this.originalsForUndo(project.path, original.recoveryDirectory, manifest)
      const preview = await this.prepareRestoreLocked(original.projectId, original.insuranceCheckpointId)
      undoAttemptRestoreId = this.database.getRestoreByToken(preview.token)?.record.id
      undoExecutionStarted = true
      await this.executeRestoreLocked(preview.token)
      undoMutationCompleted = true
      const undoRecoveryDirectory = await this.git.createPrivateUndoDirectory(
        project.path,
        original.recoveryDirectory,
        randomUUID()
      )

      const restoredConflictPaths = new Set(manifest.conflicts.filter((entry) => entry.moved).map((entry) => entry.path))
      for (const entry of originals) {
        const current = this.git.resolveProjectFile(project.path, entry.path)
        if (entry.capturedInInsurance && entry.kind !== 'directory' && await this.git.fileExists(current) &&
          await this.matchesRecoveryEntry(current, entry)) continue
        await this.moveCurrentToUndoRecovery(project.id, current, this.safeJoin(undoRecoveryDirectory, `created-after-restore/${entry.path}`))
        const savedOriginal = this.safeJoin(original.recoveryDirectory, entry.recoveryRelativePath)
        if (!(await this.git.fileExists(savedOriginal))) throw new VibeGitError('RECOVERY_ENTRY_MISSING', `恢复区文件缺失：${entry.path}`)
        await this.verifyRecoveryEntry(savedOriginal, entry)
        await mkdir(dirname(current), { recursive: true })
        this.assertProjectOperation(project.id)
        await rename(savedOriginal, current)
        await this.verifyRecoveryEntry(current, entry)
      }
      for (const path of manifest.createdByRestore) {
        if ([...restoredConflictPaths].some((conflict) => path === conflict || path.startsWith(`${conflict}/`) || conflict.startsWith(`${path}/`))) continue
        const current = this.git.resolveProjectFile(project.path, path)
        await this.moveCurrentToUndoRecovery(project.id, current, this.safeJoin(undoRecoveryDirectory, `created-after-restore/${path}`))
      }

      manifest.status = 'undone'
      manifest.undoRecoveryDirectory = undoRecoveryDirectory
      await this.persistManifest(original.recoveryDirectory, manifest)
      this.database.transaction(() => {
        this.assertProjectOperation(project.id)
        this.database.updateRestoreManifest(restoreId, manifest)
        this.database.updateRestore(restoreId, { status: 'undone', undoneAt: new Date().toISOString() })
        this.database.setActiveCheckpoint(original.projectId, originalPreview.activeCheckpointId)
      })
      return this.database.getRestore(restoreId) ?? { ...original, status: 'undone', undoneAt: new Date().toISOString() }
    } catch (error) {
      const undoManifest = undoAttemptRestoreId
        ? this.database.getRestoreManifest<RestoreManifest>(undoAttemptRestoreId)
        : undefined
      const undoMovedConflicts = Boolean(undoManifest?.conflicts.some((entry) => entry.moved))
      const undoMayHaveMutatedWorktree = undoMutationCompleted || undoManifest?.status === 'restoring' || undoMovedConflicts
      if (undoExecutionStarted && undoMayHaveMutatedWorktree) {
        this.database.updateRestore(restoreId, { status: 'failed', errorCode: 'UNDO_FAILED' })
      } else {
        // A preflight or staging problem happened before any user file moved;
        // preserve the completed restore so the user can correct the condition
        // and retry “撤销本次回退”.
        this.database.updateRestore(restoreId, { status: 'completed' })
      }
      throw error
    }
  }

  async shelve(projectId: string, title: string): Promise<ShelvedChange> {
    return await this.withProjectOperation(projectId, async () => await this.shelveLocked(projectId, title))
  }

  private async shelveLocked(projectId: string, title: string): Promise<ShelvedChange> {
    const base = this.database.getActiveCheckpoint(projectId)
    if (!base) throw new VibeGitError('NO_CHECKPOINT_BASE', '请先创建一个保存点，再暂时收起修改')
    const shelfId = randomUUID()
    const checkpoint = await this.createLocked({
      projectId,
      type: 'manual',
      title: `暂时收起：${safeTitle(title)}`,
      agent: 'manual',
      summary: '暂时隐藏当前未完成修改，之后可以完整取回',
      metadata: { shelfId, purpose: 'shelf' }
    })
    if (!checkpoint) throw new VibeGitError('NO_CHANGES', '当前没有需要暂时收起的新修改')
    const preview = await this.prepareRestoreLocked(projectId, base.id)
    const restore = await this.executeRestoreLocked(preview.token)
    if (!restore.recoveryDirectory) throw new VibeGitError('SHELF_RECOVERY_UNAVAILABLE', '暂时收起缺少安全恢复区')
    const project = this.database.getProject(projectId)
    if (!project) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
    const [shelfEntries, baseEntries] = await Promise.all([
      this.git.listTree(project.path, checkpoint.gitObjectId),
      this.git.listTree(project.path, base.gitObjectId)
    ])
    // Include directories: a draft file can replace a baseline directory that
    // is already restored now. Preserve it without scanning the whole baseline
    // for every shelf entry in large projects.
    const basePaths = new Set(baseEntries.flatMap((entry) => {
      const parts = normalizeForVolume(entry.path).split('/')
      return parts.map((_, index) => parts.slice(0, index + 1).join('/'))
    }))
    const addedPaths = shelfEntries.filter((entry) => entry.type === 'blob' && !basePaths.has(normalizeForVolume(entry.path))).map((entry) => entry.path)
    for (const path of addedPaths) {
      const source = this.git.resolveProjectFile(project.path, path)
      const destination = this.safeJoin(restore.recoveryDirectory, `shelf-added/${path}`)
      await this.moveCurrentToUndoRecovery(project.id, source, destination)
    }
    const shelf: ShelvedChange = {
      id: shelfId,
      projectId,
      checkpointId: checkpoint.id,
      restoreId: restore.id,
      title: safeTitle(title),
      createdAt: new Date().toISOString(),
      status: 'active'
    }
    this.assertProjectOperation(project.id)
    this.database.insertShelf(shelf)
    return shelf
  }

  listShelves(projectId: string): ShelvedChange[] {
    if (!this.database.getProject(projectId)) throw new VibeGitError('PROJECT_NOT_FOUND', '找不到这个项目')
    return this.database.listShelves(projectId)
  }

  async retrieveShelf(shelfId: string): Promise<ShelvedChange> {
    const shelf = this.database.getShelf(shelfId)
    if (!shelf) throw new VibeGitError('SHELF_NOT_FOUND', '找不到暂时收起的修改')
    return await this.withProjectOperation(shelf.projectId, async () => await this.retrieveShelfLocked(shelfId))
  }

  private async retrieveShelfLocked(shelfId: string): Promise<ShelvedChange> {
    const shelf = this.database.getShelf(shelfId)
    if (!shelf) throw new VibeGitError('SHELF_NOT_FOUND', '找不到暂时收起的修改')
    if (shelf.status !== 'active') throw new VibeGitError('SHELF_ALREADY_RETRIEVED', '这组修改已经取回')
    await this.undoRestoreLocked(shelf.restoreId)
    const retrievedAt = new Date().toISOString()
    this.database.markShelfRetrieved(shelfId, retrievedAt)
    return this.database.getShelf(shelfId) ?? { ...shelf, status: 'retrieved', retrievedAt }
  }

  private async stageTarget(projectPath: string, objectId: string, stagingDirectory: string, entries: TreeEntry[]): Promise<void> {
    for (const entry of entries) {
      if (entry.type === 'commit') {
        throw new VibeGitError('SUBMODULE_RESTORE_UNSUPPORTED', `暂不能自动恢复子模块：${entry.path}`, {
          remediation: '请在高级 Git 工具中处理该子模块，普通文件不会被提前修改。'
        })
      }
      if (entry.mode === '120000') {
        const linkTarget = (await this.git.readBlob(projectPath, entry.objectId)).toString('utf8')
        const linkPath = this.git.resolveProjectFile(projectPath, entry.path)
        if (!linkTarget || !isPathInside(projectPath, resolve(dirname(linkPath), linkTarget))) {
          throw new VibeGitError('UNSAFE_SYMLINK', `保存点包含指向项目外的符号链接：${entry.path}`)
        }
      }
    }
    await this.git.materializeCommit(projectPath, objectId, stagingDirectory)
  }

  private async createRestoreManifest(
    restoreId: string,
    projectPath: string,
    target: Checkpoint,
    insurance: Checkpoint,
    targetEntries: TreeEntry[],
    insuranceEntries: TreeEntry[],
    tracked: string[],
    conflictPaths: string[]
  ): Promise<RestoreManifest> {
    const insurancePaths = new Set(insuranceEntries.map((entry) => entry.path))
    const insuranceBlobs = new Set(insuranceEntries.filter((entry) => entry.type === 'blob').map((entry) => entry.path))
    const trackedPaths = new Set(tracked)
    const createdByRestore = targetEntries
      .filter((entry) => entry.type === 'blob' && !insurancePaths.has(entry.path) && !trackedPaths.has(entry.path))
      .map((entry) => entry.path)
    const conflicts: RecoveryEntry[] = []
    for (const movePath of conflictPaths) {
      const source = this.git.resolveProjectFile(projectPath, movePath)
      if (!(await this.git.fileExists(source))) continue
      const description = await this.describeRecoveryEntry(source)
      const capturedInInsurance = description.kind !== 'directory' && insuranceBlobs.has(movePath)
      conflicts.push({
        path: movePath,
        recoveryRelativePath: `files/${movePath}`,
        ...description,
        capturedInInsurance,
        moved: false
      })
    }
    return {
      version: 1,
      restoreId,
      createdAt: new Date().toISOString(),
      targetCheckpointId: target.id,
      insuranceCheckpointId: insurance.id,
      targetObjectId: target.gitObjectId,
      insuranceObjectId: insurance.gitObjectId,
      createdByRestore,
      conflicts,
      status: 'planned'
    }
  }

  private async moveUntrackedConflicts(projectId: string, projectPath: string, recoveryDirectory: string, manifest: RestoreManifest): Promise<void> {
    for (const entry of manifest.conflicts) {
      const source = this.git.resolveProjectFile(projectPath, entry.path)
      if (!(await this.git.fileExists(source))) continue
      const destination = this.safeJoin(recoveryDirectory, entry.recoveryRelativePath)
      if (await this.git.fileExists(destination)) throw new VibeGitError('RECOVERY_PATH_CONFLICT', `恢复区路径已存在：${entry.path}`)
      await mkdir(dirname(destination), { recursive: true })
      this.assertProjectOperation(projectId)
      await rename(source, destination)
      entry.moved = true
      await this.persistManifest(recoveryDirectory, manifest)
      this.database.updateRestoreManifest(manifest.restoreId, manifest)
    }
  }

  private async describeRecoveryEntry(path: string): Promise<Pick<RecoveryEntry, 'kind' | 'size' | 'sha256' | 'mode'>> {
    const info = await lstat(path)
    if (info.isSymbolicLink()) {
      const link = await readlink(path)
      return { kind: 'symlink', size: Buffer.byteLength(link), sha256: createHash('sha256').update(link).digest('hex'), mode: info.mode }
    }
    if (info.isDirectory()) {
      const hash = createHash('sha256')
      let size = 0
      const visit = async (directory: string): Promise<void> => {
        const names = (await readdir(directory)).sort()
        for (const name of names) {
          const child = resolve(directory, name)
          const relativePath = relative(path, child).replaceAll('\\', '/')
          const childInfo = await lstat(child)
          hash.update(relativePath)
          if (childInfo.isDirectory()) await visit(child)
          else if (childInfo.isSymbolicLink()) hash.update(await readlink(child))
          else if (childInfo.isFile()) size += await this.hashRecoveryFile(child, hash)
          else throw new VibeGitError('UNSUPPORTED_RECOVERY_ENTRY', '恢复区只支持普通文件、目录或符号链接')
        }
      }
      await visit(path)
      return { kind: 'directory', size, sha256: hash.digest('hex'), mode: info.mode }
    }
    if (!info.isFile()) throw new VibeGitError('UNSUPPORTED_RECOVERY_ENTRY', '恢复区只支持普通文件、目录或符号链接')
    const hash = createHash('sha256')
    const size = await this.hashRecoveryFile(path, hash)
    return { kind: 'file', size, sha256: hash.digest('hex'), mode: info.mode }
  }

  private async hashRecoveryFile(path: string, hash: Hash): Promise<number> {
    let size = 0
    for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
      size += chunk.length
      hash.update(chunk)
    }
    return size
  }

  private async matchesRecoveryEntry(path: string, expected: RecoveryEntry): Promise<boolean> {
    const actual = await this.describeRecoveryEntry(path)
    return actual.kind === expected.kind && actual.size === expected.size &&
      actual.sha256 === expected.sha256 && actual.mode === expected.mode
  }

  private async verifyRecoveryEntry(path: string, expected: RecoveryEntry): Promise<void> {
    if (!(await this.matchesRecoveryEntry(path, expected))) {
      throw new VibeGitError('RECOVERY_ENTRY_CORRUPTED', `恢复区文件校验失败：${expected.path}`, {
        remediation: '保留恢复区，不要继续覆盖文件；请从恢复清单人工取回。'
      })
    }
  }

  private async originalsForUndo(projectPath: string, recoveryDirectory: string, manifest: RestoreManifest): Promise<RecoveryEntry[]> {
    const originals: RecoveryEntry[] = []
    const fromInsurance: RecoveryEntry[] = []
    for (const entry of manifest.conflicts) {
      if (!entry.moved) continue
      const path = this.safeJoin(recoveryDirectory, entry.recoveryRelativePath)
      try {
        if (!(await this.git.fileExists(path))) throw new VibeGitError('RECOVERY_ENTRY_MISSING', `恢复区文件缺失：${entry.path}`)
        await this.verifyRecoveryEntry(path, entry)
        originals.push(entry)
      } catch (error) {
        // Git cannot recreate an empty directory. For regular files and links,
        // a legacy manifest's path-only flag is insufficient to prove fidelity.
        if (entry.kind === 'directory' || !entry.capturedInInsurance || !(error instanceof VibeGitError) ||
          !['RECOVERY_ENTRY_CORRUPTED', 'RECOVERY_ENTRY_MISSING'].includes(error.code)) throw error
        fromInsurance.push(entry)
      }
    }
    if (fromInsurance.length) {
      const staging = await mkdtemp(join(tmpdir(), 'vibegit-undo-insurance-'))
      try {
        // Validate the bytes Git would actually check out, including its EOL
        // conversions, before an undo with a missing recovery copy can proceed.
        await this.git.materializeCommit(projectPath, manifest.insuranceObjectId, staging)
        for (const entry of fromInsurance) await this.verifyRecoveryEntry(this.safeJoin(staging, entry.path), entry)
      } finally {
        await rm(staging, { recursive: true, force: true })
      }
    }
    return originals
  }

  private async persistManifest(recoveryDirectory: string, manifest: RestoreManifest): Promise<void> {
    await mkdir(recoveryDirectory, { recursive: true })
    const destination = resolve(recoveryDirectory, 'manifest.json')
    const temporary = resolve(recoveryDirectory, `manifest-${randomUUID()}.tmp`)
    const backup = resolve(recoveryDirectory, `manifest-${randomUUID()}.bak`)
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    let movedPrevious = false
    try {
      await rename(destination, backup)
      movedPrevious = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      await rename(temporary, destination)
      if (movedPrevious) await rm(backup, { force: true })
    } catch (error) {
      if (movedPrevious) {
        try { await rename(backup, destination) } catch { /* Keep both recovery artifacts for diagnosis. */ }
      }
      throw error
    }
  }

  private async moveCurrentToUndoRecovery(projectId: string, source: string, destination: string): Promise<void> {
    if (!(await this.git.fileExists(source))) return
    if (await this.git.fileExists(destination)) throw new VibeGitError('UNDO_RECOVERY_CONFLICT', `撤销恢复区已存在：${destination}`)
    await mkdir(dirname(destination), { recursive: true })
    this.assertProjectOperation(projectId)
    await rename(source, destination)
  }

  private safeJoin(root: string, path: string): string {
    const target = resolve(root, path)
    if (!isPathInside(root, target)) {
      throw new VibeGitError('UNSAFE_PROJECT_PATH', '保存点包含越出恢复目录的路径')
    }
    return target
  }
}
