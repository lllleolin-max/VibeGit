import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type {
  AgentEventRecord,
  Checkpoint,
  Project,
  RestorePreview,
  RestoreRecord,
  ShelvedChange
} from '@vibegit/shared'
import { VibeGitError } from '@vibegit/shared'

// tsup/esbuild versions that predate node:sqlite rewrite the specifier to the
// non-existent bare package "sqlite". Resolve it at runtime so both the
// Electron main process and the standalone Node CLI load the real built-in.
const nodeSqlite = createRequire(import.meta.url)(['node', 'sqlite'].join(':')) as typeof import('node:sqlite')
const { DatabaseSync } = nodeSqlite
type NodeDatabaseSync = import('node:sqlite').DatabaseSync

type SqlValue = string | number | bigint | Uint8Array | null
const AGENT_EVENT_PROCESSING_MESSAGE = '__VIBEGIT_EVENT_PROCESSING__'

interface ProjectRow {
  id: string
  name: string
  path: string
  created_at: string
  last_activity_at: string
  is_git_repository: number
  protection_enabled: number
  last_agent: Project['lastAgent'] | null
  last_checkpoint_at: string | null
  github_remote_url: string | null
  github_sync_status: Project['githubSyncStatus']
  last_synced_at: string | null
  active_checkpoint_id: string | null
}

interface CheckpointRow {
  id: string
  project_id: string
  created_at: string
  type: Checkpoint['type']
  title: string
  agent: Checkpoint['agent']
  agent_session_id: string | null
  task_text: string | null
  summary: string | null
  git_object_id: string
  parent_checkpoint_id: string | null
  changed_files_json: string
  insertions: number
  deletions: number
  test_status: Checkpoint['testStatus']
  github_sync_status: Checkpoint['githubSyncStatus']
  is_stable: number
  note: string | null
  metadata_json: string
}

interface AgentEventRow {
  id: string
  project_id: string
  event: AgentEventRecord['event']
  agent: AgentEventRecord['agent']
  session_id: string | null
  source_event_id: string | null
  task_text: string | null
  created_at: string
  success: number | null
  checkpoint_id: string | null
  message: string
}

interface RestoreRow {
  id: string
  token: string
  project_id: string
  target_checkpoint_id: string
  insurance_checkpoint_id: string
  created_at: string
  expires_at: string
  completed_at: string | null
  undone_at: string | null
  recovery_directory: string | null
  status: RestoreRecord['status']
  error_code: string | null
  preview_json: string
  manifest_json: string | null
}

interface ProjectOperationRow {
  project_id: string
  owner_pid: number | null
  expires_at: number
}

function ownerProcessIsAlive(ownerPid: number | null): boolean {
  if (!ownerPid || ownerPid <= 0) return false
  try {
    process.kill(ownerPid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

interface ShelfRow {
  id: string
  project_id: string
  checkpoint_id: string
  restore_id: string
  title: string
  created_at: string
  retrieved_at: string | null
  status: ShelvedChange['status']
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    isGitRepository: Boolean(row.is_git_repository),
    protectionEnabled: Boolean(row.protection_enabled),
    hasUnsavedChanges: false,
    untrackedFiles: 0,
    ...(row.last_agent ? { lastAgent: row.last_agent } : {}),
    ...(row.last_checkpoint_at ? { lastCheckpointAt: row.last_checkpoint_at } : {}),
    ...(row.github_remote_url ? { githubRemoteUrl: row.github_remote_url } : {}),
    githubSyncStatus: row.github_sync_status,
    ...(row.last_synced_at ? { lastSyncedAt: row.last_synced_at } : {})
  }
}

function mapCheckpoint(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    projectId: row.project_id,
    createdAt: row.created_at,
    type: row.type,
    title: row.title,
    agent: row.agent,
    ...(row.agent_session_id ? { agentSessionId: row.agent_session_id } : {}),
    ...(row.task_text ? { taskText: row.task_text } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    gitObjectId: row.git_object_id,
    ...(row.parent_checkpoint_id ? { parentCheckpointId: row.parent_checkpoint_id } : {}),
    changedFiles: parseJson(row.changed_files_json, []),
    insertions: row.insertions,
    deletions: row.deletions,
    testStatus: row.test_status,
    githubSyncStatus: row.github_sync_status,
    isStable: Boolean(row.is_stable),
    ...(row.note ? { note: row.note } : {}),
    metadata: parseJson(row.metadata_json, {})
  }
}

function mapAgentEvent(row: AgentEventRow): AgentEventRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    event: row.event,
    agent: row.agent,
    createdAt: row.created_at,
    message: row.message,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.source_event_id ? { sourceEventId: row.source_event_id } : {}),
    ...(row.task_text ? { taskText: row.task_text } : {}),
    ...(row.success === null ? {} : { success: Boolean(row.success) }),
    ...(row.checkpoint_id ? { checkpointId: row.checkpoint_id } : {})
  }
}

function mapRestore(row: RestoreRow): RestoreRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    targetCheckpointId: row.target_checkpoint_id,
    insuranceCheckpointId: row.insurance_checkpoint_id,
    createdAt: row.created_at,
    status: row.status,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.undone_at ? { undoneAt: row.undone_at } : {}),
    ...(row.recovery_directory ? { recoveryDirectory: row.recovery_directory } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {})
  }
}

function mapShelf(row: ShelfRow): ShelvedChange {
  return {
    id: row.id,
    projectId: row.project_id,
    checkpointId: row.checkpoint_id,
    restoreId: row.restore_id,
    title: row.title,
    createdAt: row.created_at,
    status: row.status,
    ...(row.retrieved_at ? { retrievedAt: row.retrieved_at } : {})
  }
}

export class VibeGitDatabase {
  readonly filePath: string
  private readonly db: NodeDatabaseSync

  constructor(filePath: string) {
    this.filePath = resolve(filePath)
    mkdirSync(dirname(this.filePath), { recursive: true })
    this.db = new DatabaseSync(this.filePath)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.migrate()
    this.reconcileExpiredOperations()
  }

  private migrate(): void {
    this.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS schema_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          last_activity_at TEXT NOT NULL,
          is_git_repository INTEGER NOT NULL DEFAULT 0,
          protection_enabled INTEGER NOT NULL DEFAULT 0,
          last_agent TEXT,
          last_checkpoint_at TEXT,
          github_remote_url TEXT,
          github_sync_status TEXT NOT NULL DEFAULT 'not_configured',
          last_synced_at TEXT,
          last_synced_checkpoint_id TEXT,
          active_checkpoint_id TEXT
        );
        CREATE TABLE IF NOT EXISTS checkpoints (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          agent TEXT NOT NULL,
          agent_session_id TEXT,
          task_text TEXT,
          summary TEXT,
          git_object_id TEXT NOT NULL,
          parent_checkpoint_id TEXT REFERENCES checkpoints(id),
          changed_files_json TEXT NOT NULL,
          insertions INTEGER NOT NULL DEFAULT 0,
          deletions INTEGER NOT NULL DEFAULT 0,
          test_status TEXT NOT NULL DEFAULT 'not_run',
          github_sync_status TEXT NOT NULL DEFAULT 'pending',
          is_stable INTEGER NOT NULL DEFAULT 0,
          note TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS checkpoints_project_created
          ON checkpoints(project_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS agent_events (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          event TEXT NOT NULL,
          agent TEXT NOT NULL,
          session_id TEXT,
          source_event_id TEXT,
          task_text TEXT,
          created_at TEXT NOT NULL,
          success INTEGER,
          checkpoint_id TEXT REFERENCES checkpoints(id),
          message TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS agent_events_session
          ON agent_events(project_id, session_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS restores (
          id TEXT PRIMARY KEY,
          token TEXT NOT NULL UNIQUE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          target_checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id),
          insurance_checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id),
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          completed_at TEXT,
          undone_at TEXT,
          recovery_directory TEXT,
          status TEXT NOT NULL,
          error_code TEXT,
          preview_json TEXT NOT NULL,
          manifest_json TEXT
        );
        CREATE TABLE IF NOT EXISTS project_operations (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          owner_id TEXT NOT NULL,
          owner_pid INTEGER,
          operation TEXT NOT NULL,
          acquired_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS shelves (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id),
          restore_id TEXT NOT NULL REFERENCES restores(id),
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          retrieved_at TEXT,
          status TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS shelves_project_status
          ON shelves(project_id, status, created_at DESC);
      `)
      const restoreColumns = this.db.prepare('PRAGMA table_info(restores)').all() as unknown as Array<{ name: string }>
      if (!restoreColumns.some((column) => column.name === 'manifest_json')) {
        this.db.exec('ALTER TABLE restores ADD COLUMN manifest_json TEXT')
      }
      const projectColumns = this.db.prepare('PRAGMA table_info(projects)').all() as unknown as Array<{ name: string }>
      if (!projectColumns.some((column) => column.name === 'active_checkpoint_id')) {
        this.db.exec('ALTER TABLE projects ADD COLUMN active_checkpoint_id TEXT')
      }
      const eventColumns = this.db.prepare('PRAGMA table_info(agent_events)').all() as unknown as Array<{ name: string }>
      if (!eventColumns.some((column) => column.name === 'source_event_id')) {
        this.db.exec('ALTER TABLE agent_events ADD COLUMN source_event_id TEXT')
      }
      const operationColumns = this.db.prepare('PRAGMA table_info(project_operations)').all() as unknown as Array<{ name: string }>
      if (!operationColumns.some((column) => column.name === 'owner_pid')) {
        this.db.exec('ALTER TABLE project_operations ADD COLUMN owner_pid INTEGER')
      }
      this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS agent_events_source_unique
        ON agent_events(project_id, agent, event, source_event_id) WHERE source_event_id IS NOT NULL`)
      this.db.prepare(`INSERT INTO schema_meta(key, value) VALUES('version', '3') ON CONFLICT(key) DO UPDATE SET value='3'`).run()
    })
  }

  private reconcileExpiredOperations(now = Date.now()): void {
    this.transaction(() => {
      this.reconcileProjectOperationsUnsafe(now)
    })
  }

  private reconcileProjectOperationsUnsafe(now: number, projectId?: string): void {
    const rows = projectId
      ? this.db.prepare('SELECT project_id, owner_pid, expires_at FROM project_operations WHERE project_id = ?').all(projectId) as unknown as ProjectOperationRow[]
      : this.db.prepare('SELECT project_id, owner_pid, expires_at FROM project_operations').all() as unknown as ProjectOperationRow[]
    for (const row of rows) {
      if (row.expires_at > now && (row.owner_pid === null || ownerProcessIsAlive(row.owner_pid))) continue
      this.db.prepare(`
        UPDATE restores SET status = 'failed', error_code = 'INTERRUPTED_OPERATION'
        WHERE project_id = ? AND status IN ('executing', 'undoing')
      `).run(row.project_id)
      this.db.prepare('DELETE FROM project_operations WHERE project_id = ?').run(row.project_id)
    }
  }

  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = operation()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // Preserve the original error.
      }
      throw new VibeGitError('DATABASE_TRANSACTION_FAILED', '本地记录未能安全保存', {
        detail: error instanceof Error ? error.message : String(error),
        remediation: '项目文件没有被删除。请关闭占用数据库的进程后重试。',
        retryable: true,
        cause: error
      })
    }
  }

  close(): void {
    this.db.close()
  }

  health(): boolean {
    const row = this.db.prepare('SELECT 1 AS value').get() as { value: number } | undefined
    return row?.value === 1
  }

  upsertProject(project: Project): void {
    this.db.prepare(`
      INSERT INTO projects(
        id, name, path, created_at, last_activity_at, is_git_repository,
        protection_enabled, last_agent, last_checkpoint_at, github_remote_url,
        github_sync_status, last_synced_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        path=excluded.path,
        last_activity_at=excluded.last_activity_at,
        is_git_repository=excluded.is_git_repository,
        protection_enabled=excluded.protection_enabled,
        last_agent=excluded.last_agent,
        last_checkpoint_at=excluded.last_checkpoint_at,
        github_remote_url=excluded.github_remote_url,
        github_sync_status=excluded.github_sync_status,
        last_synced_at=excluded.last_synced_at
    `).run(
      project.id,
      project.name,
      project.path,
      project.createdAt,
      project.lastActivityAt,
      project.isGitRepository ? 1 : 0,
      project.protectionEnabled ? 1 : 0,
      project.lastAgent ?? null,
      project.lastCheckpointAt ?? null,
      project.githubRemoteUrl ?? null,
      project.githubSyncStatus,
      project.lastSyncedAt ?? null
    )
  }

  getProject(id: string): Project | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
    return row ? mapProject(row) : undefined
  }

  getProjectByPath(path: string): Project | undefined {
    const query = process.platform === 'win32'
      ? 'SELECT * FROM projects WHERE path = ? COLLATE NOCASE'
      : 'SELECT * FROM projects WHERE path = ?'
    const row = this.db.prepare(query).get(path) as ProjectRow | undefined
    return row ? mapProject(row) : undefined
  }

  listProjects(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY last_activity_at DESC').all() as unknown as ProjectRow[]
    return rows.map(mapProject)
  }

  getActiveCheckpoint(projectId: string): Checkpoint | undefined {
    const row = this.db.prepare('SELECT active_checkpoint_id FROM projects WHERE id = ?').get(projectId) as { active_checkpoint_id: string | null } | undefined
    if (row?.active_checkpoint_id) {
      const active = this.getCheckpoint(row.active_checkpoint_id)
      if (active?.projectId === projectId) return active
    }
    const fallback = this.listCheckpoints(projectId).find((checkpoint) =>
      checkpoint.type !== 'pre_restore' &&
      checkpoint.type !== 'pre_sync' &&
      checkpoint.metadata.purpose !== 'shelf'
    )
    if (fallback) this.setActiveCheckpoint(projectId, fallback.id)
    return fallback
  }

  setActiveCheckpoint(projectId: string, checkpointId: string | undefined): void {
    if (checkpointId) {
      const checkpoint = this.getCheckpoint(checkpointId)
      if (!checkpoint || checkpoint.projectId !== projectId) {
        throw new VibeGitError('CHECKPOINT_NOT_FOUND', '找不到项目当前使用的保存点')
      }
    }
    this.db.prepare('UPDATE projects SET active_checkpoint_id = ? WHERE id = ?').run(checkpointId ?? null, projectId)
  }

  acquireProjectOperation(
    projectId: string,
    ownerId: string,
    operation: string,
    now: number,
    expiresAt: number,
    ownerPid = process.pid
  ): boolean {
    return this.transaction(() => {
      this.reconcileProjectOperationsUnsafe(now, projectId)
      const result = this.db.prepare(`
        INSERT OR IGNORE INTO project_operations(project_id, owner_id, owner_pid, operation, acquired_at, expires_at)
        VALUES(?, ?, ?, ?, ?, ?)
      `).run(projectId, ownerId, ownerPid, operation, now, expiresAt)
      return Number(result.changes) === 1
    })
  }

  renewProjectOperation(projectId: string, ownerId: string, expiresAt: number): boolean {
    const result = this.db.prepare(`
      UPDATE project_operations SET expires_at = ?
      WHERE project_id = ? AND owner_id = ?
    `).run(expiresAt, projectId, ownerId)
    return Number(result.changes) === 1
  }

  hasProjectOperation(projectId: string, ownerId: string, now = Date.now()): boolean {
    const row = this.db.prepare(`
      SELECT 1 AS value FROM project_operations
      WHERE project_id = ? AND owner_id = ? AND expires_at > ?
    `).get(projectId, ownerId, now) as { value: number } | undefined
    return row?.value === 1
  }

  releaseProjectOperation(projectId: string, ownerId: string): void {
    this.db.prepare('DELETE FROM project_operations WHERE project_id = ? AND owner_id = ?').run(projectId, ownerId)
  }

  insertCheckpoint(checkpoint: Checkpoint): void {
    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO checkpoints(
          id, project_id, created_at, type, title, agent, agent_session_id,
          task_text, summary, git_object_id, parent_checkpoint_id,
          changed_files_json, insertions, deletions, test_status,
          github_sync_status, is_stable, note, metadata_json
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        checkpoint.id,
        checkpoint.projectId,
        checkpoint.createdAt,
        checkpoint.type,
        checkpoint.title,
        checkpoint.agent,
        checkpoint.agentSessionId ?? null,
        checkpoint.taskText ?? null,
        checkpoint.summary ?? null,
        checkpoint.gitObjectId,
        checkpoint.parentCheckpointId ?? null,
        JSON.stringify(checkpoint.changedFiles),
        checkpoint.insertions,
        checkpoint.deletions,
        checkpoint.testStatus,
        checkpoint.githubSyncStatus,
        checkpoint.isStable ? 1 : 0,
        checkpoint.note ?? null,
        JSON.stringify(checkpoint.metadata)
      )
      const advancesActiveCheckpoint = checkpoint.type !== 'pre_restore' &&
        checkpoint.type !== 'pre_sync' &&
        checkpoint.metadata.purpose !== 'shelf'
      this.db.prepare(`
        UPDATE projects SET
          last_activity_at = ?, last_checkpoint_at = ?, last_agent = ?,
          protection_enabled = 1, is_git_repository = 1,
          active_checkpoint_id = CASE WHEN ? = 1 THEN ? ELSE active_checkpoint_id END,
          github_sync_status = CASE WHEN github_remote_url IS NULL THEN github_sync_status ELSE 'pending' END
        WHERE id = ?
      `).run(
        checkpoint.createdAt,
        checkpoint.createdAt,
        checkpoint.agent,
        advancesActiveCheckpoint ? 1 : 0,
        checkpoint.id,
        checkpoint.projectId
      )
    })
  }

  getCheckpoint(id: string): Checkpoint | undefined {
    const row = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(id) as CheckpointRow | undefined
    return row ? mapCheckpoint(row) : undefined
  }

  getLatestCheckpoint(projectId: string): Checkpoint | undefined {
    const row = this.db.prepare('SELECT * FROM checkpoints WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(projectId) as CheckpointRow | undefined
    return row ? mapCheckpoint(row) : undefined
  }

  listCheckpoints(projectId: string): Checkpoint[] {
    const rows = this.db.prepare('SELECT * FROM checkpoints WHERE project_id = ? ORDER BY created_at DESC, rowid DESC').all(projectId) as unknown as CheckpointRow[]
    return rows.map(mapCheckpoint)
  }

  markCheckpointSynced(checkpointId: string, syncedAt: string): void {
    this.transaction(() => {
      const checkpoint = this.getCheckpoint(checkpointId)
      if (!checkpoint) throw new VibeGitError('CHECKPOINT_NOT_FOUND', '找不到要标记的保存点')
      this.db.prepare(`UPDATE checkpoints SET github_sync_status = 'synced' WHERE id = ?`).run(checkpointId)
      this.db.prepare(`
        UPDATE projects SET github_sync_status = 'synced', last_synced_at = ?, last_synced_checkpoint_id = ?
        WHERE id = ?
      `).run(syncedAt, checkpointId, checkpoint.projectId)
    })
  }

  updateProjectRemote(projectId: string, remoteUrl: string): void {
    this.db.prepare(`UPDATE projects SET github_remote_url = ?, github_sync_status = 'pending' WHERE id = ?`).run(remoteUrl, projectId)
  }

  updateProjectSyncFailure(projectId: string): void {
    this.db.prepare(`UPDATE projects SET github_sync_status = 'failed' WHERE id = ?`).run(projectId)
  }

  insertAgentEvent(event: AgentEventRecord): void {
    this.db.prepare(`
      INSERT INTO agent_events(id, project_id, event, agent, session_id, source_event_id, task_text, created_at, success, checkpoint_id, message)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.projectId,
      event.event,
      event.agent,
      event.sessionId ?? null,
      event.sourceEventId ?? null,
      event.taskText ?? null,
      event.createdAt,
      event.success === undefined ? null : event.success ? 1 : 0,
      event.checkpointId ?? null,
      event.message
    )
  }

  reserveAgentEvent(event: AgentEventRecord): boolean {
    if (!event.sourceEventId) throw new VibeGitError('AGENT_EVENT_ID_REQUIRED', '幂等事件缺少来源标识')
    const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    this.db.prepare(`
      DELETE FROM agent_events
      WHERE project_id = ? AND agent = ? AND event = ? AND source_event_id = ?
        AND message = ? AND checkpoint_id IS NULL AND created_at < ?
        AND NOT EXISTS (
          SELECT 1 FROM project_operations
          WHERE project_id = ? AND expires_at > ?
        )
    `).run(
      event.projectId,
      event.agent,
      event.event,
      event.sourceEventId,
      AGENT_EVENT_PROCESSING_MESSAGE,
      staleBefore,
      event.projectId,
      Date.now()
    )
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO agent_events(
        id, project_id, event, agent, session_id, source_event_id,
        task_text, created_at, success, checkpoint_id, message
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      event.id,
      event.projectId,
      event.event,
      event.agent,
      event.sessionId ?? null,
      event.sourceEventId,
      event.taskText ?? null,
      new Date().toISOString(),
      event.success === undefined ? null : event.success ? 1 : 0,
      AGENT_EVENT_PROCESSING_MESSAGE
    )
    return Number(result.changes) === 1
  }

  completeReservedAgentEvent(event: AgentEventRecord): void {
    const result = this.db.prepare(`
      UPDATE agent_events SET
        session_id = ?, task_text = ?, created_at = ?, success = ?,
        checkpoint_id = ?, message = ?
      WHERE id = ? AND message = ?
    `).run(
      event.sessionId ?? null,
      event.taskText ?? null,
      event.createdAt,
      event.success === undefined ? null : event.success ? 1 : 0,
      event.checkpointId ?? null,
      event.message,
      event.id,
      AGENT_EVENT_PROCESSING_MESSAGE
    )
    if (Number(result.changes) !== 1) throw new VibeGitError('AGENT_EVENT_RESERVATION_LOST', 'Agent 事件的幂等认领已失效')
  }

  isAgentEventReservation(id: string): boolean {
    const row = this.db.prepare('SELECT message FROM agent_events WHERE id = ?').get(id) as { message: string } | undefined
    return row?.message === AGENT_EVENT_PROCESSING_MESSAGE
  }

  deleteAgentEventReservation(id: string): void {
    this.db.prepare('DELETE FROM agent_events WHERE id = ? AND message = ?').run(id, AGENT_EVENT_PROCESSING_MESSAGE)
  }

  getLatestAgentEvent(projectId: string, sessionId?: string): AgentEventRecord | undefined {
    const row = sessionId
      ? this.db.prepare('SELECT * FROM agent_events WHERE project_id = ? AND session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(projectId, sessionId)
      : this.db.prepare('SELECT * FROM agent_events WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(projectId)
    return row ? mapAgentEvent(row as unknown as AgentEventRow) : undefined
  }

  getAgentEventBySource(projectId: string, agent: AgentEventRecord['agent'], event: AgentEventRecord['event'], sourceEventId: string): AgentEventRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM agent_events WHERE project_id = ? AND agent = ? AND event = ? AND source_event_id = ? LIMIT 1
    `).get(projectId, agent, event, sourceEventId) as unknown as AgentEventRow | undefined
    return row ? mapAgentEvent(row) : undefined
  }

  getLatestAgentStart(
    projectId: string,
    agent: AgentEventRecord['agent'],
    sessionId?: string
  ): AgentEventRecord | undefined {
    const row = sessionId
      ? this.db.prepare(`
          SELECT * FROM agent_events
          WHERE project_id = ? AND agent = ? AND session_id = ?
            AND event = 'task-start' AND message <> ?
          ORDER BY created_at DESC, rowid DESC LIMIT 1
        `).get(projectId, agent, sessionId, AGENT_EVENT_PROCESSING_MESSAGE)
      : this.db.prepare(`
          SELECT * FROM agent_events
          WHERE project_id = ? AND agent = ?
            AND event = 'task-start' AND message <> ?
          ORDER BY created_at DESC, rowid DESC LIMIT 1
        `).get(projectId, agent, AGENT_EVENT_PROCESSING_MESSAGE)
    return row ? mapAgentEvent(row as unknown as AgentEventRow) : undefined
  }

  listAgentEvents(projectId: string): AgentEventRecord[] {
    const rows = this.db.prepare('SELECT * FROM agent_events WHERE project_id = ? ORDER BY created_at DESC, rowid DESC').all(projectId) as unknown as AgentEventRow[]
    return rows.map(mapAgentEvent)
  }

  insertRestore(id: string, preview: RestorePreview): void {
    this.db.prepare(`
      INSERT INTO restores(
        id, token, project_id, target_checkpoint_id, insurance_checkpoint_id,
        created_at, expires_at, status, preview_json
      ) VALUES(?, ?, ?, ?, ?, ?, ?, 'prepared', ?)
    `).run(
      id,
      preview.token,
      preview.projectId,
      preview.targetCheckpointId,
      preview.insuranceCheckpointId,
      preview.createdAt,
      preview.expiresAt,
      JSON.stringify(preview)
    )
  }

  getRestoreByToken(token: string): { record: RestoreRecord; preview: RestorePreview; expiresAt: string } | undefined {
    const row = this.db.prepare('SELECT * FROM restores WHERE token = ?').get(token) as RestoreRow | undefined
    return row ? { record: mapRestore(row), preview: parseJson(row.preview_json, {} as RestorePreview), expiresAt: row.expires_at } : undefined
  }

  claimRestore(token: string): boolean {
    const result = this.db.prepare(`
      UPDATE restores SET status = 'executing'
      WHERE token = ? AND status = 'prepared'
    `).run(token)
    return Number(result.changes) === 1
  }

  claimRestoreUndo(id: string): boolean {
    const result = this.db.prepare(`
      UPDATE restores SET status = 'undoing'
      WHERE id = ? AND status = 'completed'
    `).run(id)
    return Number(result.changes) === 1
  }

  getRestore(id: string): RestoreRecord | undefined {
    const row = this.db.prepare('SELECT * FROM restores WHERE id = ?').get(id) as RestoreRow | undefined
    return row ? mapRestore(row) : undefined
  }

  listFailedRestoresWithRecovery(projectId: string): RestoreRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM restores
      WHERE project_id = ? AND status = 'failed' AND recovery_directory IS NOT NULL
      ORDER BY rowid DESC
    `).all(projectId) as unknown as RestoreRow[]
    return rows.map(mapRestore)
  }

  getRestorePreview(id: string): RestorePreview | undefined {
    const row = this.db.prepare('SELECT preview_json FROM restores WHERE id = ?').get(id) as { preview_json: string } | undefined
    return row ? parseJson(row.preview_json, {} as RestorePreview) : undefined
  }

  getRestoreManifest<T>(id: string): T | undefined {
    const row = this.db.prepare('SELECT manifest_json FROM restores WHERE id = ?').get(id) as { manifest_json: string | null } | undefined
    return row?.manifest_json ? parseJson<T | undefined>(row.manifest_json, undefined) : undefined
  }

  updateRestoreManifest(id: string, manifest: unknown): void {
    this.db.prepare('UPDATE restores SET manifest_json = ? WHERE id = ?').run(JSON.stringify(manifest), id)
  }

  updateRestore(
    id: string,
    update: {
      status: RestoreRecord['status']
      completedAt?: string
      undoneAt?: string
      recoveryDirectory?: string
      errorCode?: string
    }
  ): void {
    const assignments: string[] = ['status = ?']
    const values: SqlValue[] = [update.status]
    if (update.completedAt) { assignments.push('completed_at = ?'); values.push(update.completedAt) }
    if (update.undoneAt) { assignments.push('undone_at = ?'); values.push(update.undoneAt) }
    if (update.recoveryDirectory) { assignments.push('recovery_directory = ?'); values.push(update.recoveryDirectory) }
    if (update.errorCode) { assignments.push('error_code = ?'); values.push(update.errorCode) }
    values.push(id)
    this.db.prepare(`UPDATE restores SET ${assignments.join(', ')} WHERE id = ?`).run(...values)
  }

  insertShelf(shelf: ShelvedChange): void {
    this.db.prepare(`
      INSERT INTO shelves(id, project_id, checkpoint_id, restore_id, title, created_at, retrieved_at, status)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      shelf.id, shelf.projectId, shelf.checkpointId, shelf.restoreId,
      shelf.title, shelf.createdAt, shelf.retrievedAt ?? null, shelf.status
    )
  }

  getShelf(id: string): ShelvedChange | undefined {
    const row = this.db.prepare('SELECT * FROM shelves WHERE id = ?').get(id) as unknown as ShelfRow | undefined
    return row ? mapShelf(row) : undefined
  }

  listShelves(projectId: string): ShelvedChange[] {
    const rows = this.db.prepare('SELECT * FROM shelves WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as unknown as ShelfRow[]
    return rows.map(mapShelf)
  }

  markShelfRetrieved(id: string, retrievedAt: string): void {
    this.db.prepare(`UPDATE shelves SET status = 'retrieved', retrieved_at = ? WHERE id = ?`).run(retrievedAt, id)
  }

  getSetting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value
  }

  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
  }
}
