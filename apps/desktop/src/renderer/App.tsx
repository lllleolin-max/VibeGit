import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Cloud,
  Code2,
  FileCode2,
  FilePlus2,
  FolderHeart,
  FolderOpen,
  GitCompareArrows,
  HardDrive,
  History,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Undo2,
  X
} from 'lucide-react'
import appLogo from './assets/vibegit-app-logo.png'
import projectLogo from './assets/vibegit-project-logo.png'
import type {
  AgentEventRecord,
  AgentConnectionStatus,
  ApiResult,
  AppSettings,
  Checkpoint,
  CheckpointDiff,
  GitHubCliStatus,
  Project,
  PublicError,
  RestorePreview,
  RestoreRecord,
  SensitiveRisk,
  SensitiveScanResult,
  ShelvedChange
} from '@vibegit/shared'

type Page = 'projects' | 'project' | 'settings'
type Modal =
  | { kind: 'save' }
  | { kind: 'restore'; preview: RestorePreview; checkpoint: Checkpoint }
  | { kind: 'backup' }
  | { kind: 'shelf' }
  | null

class ApiError extends Error {
  constructor(readonly error: PublicError) {
    super(error.message)
  }
}

function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new ApiError(result.error)
  return result.data
}

function errorFrom(value: unknown): PublicError {
  if (value instanceof ApiError) return value.error
  return {
    code: 'UI_ERROR',
    message: value instanceof Error ? value.message : '操作没有完成',
    retryable: true
  }
}

function formatRelativeTime(value?: string): string {
  if (!value) return '还没有保存点'
  const delta = Date.now() - Date.parse(value)
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function checkpointType(type: Checkpoint['type']): { label: string; tone: string } {
  const labels: Record<Checkpoint['type'], { label: string; tone: string }> = {
    initial: { label: '初始保护', tone: 'sage' },
    manual: { label: '手动保存', tone: 'blue' },
    pre_agent: { label: '修改前保护', tone: 'amber' },
    post_agent: { label: '功能保存', tone: 'violet' },
    pre_restore: { label: '回退前保险', tone: 'rose' },
    pre_sync: { label: '备份前保护', tone: 'sky' },
    stable: { label: '稳定版本', tone: 'green' }
  }
  return labels[type]
}

function agentLabel(agent: Checkpoint['agent']): string {
  return ({ codex: 'Codex', 'claude-code': 'Claude Code', manual: '你', system: 'VibeGit', unknown: '未知' })[agent]
}

export function App(): ReactNode {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [agentEvents, setAgentEvents] = useState<AgentEventRecord[]>([])
  const [failedRestores, setFailedRestores] = useState<RestoreRecord[]>([])
  const [page, setPage] = useState<Page>('projects')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<PublicError>()
  const [notice, setNotice] = useState<{ message: string; restore?: RestoreRecord; tone?: 'success' | 'warning' }>()
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<Checkpoint>()
  const [diff, setDiff] = useState<CheckpointDiff>()
  const [diffLoading, setDiffLoading] = useState(false)
  const [modal, setModal] = useState<Modal>(null)

  const selectedProject = useMemo(() => projects.find((project) => project.id === selectedId), [projects, selectedId])

  const loadProjects = useCallback(async () => {
    const data = unwrap(await window.vibegit.listProjects())
    setProjects(data)
    return data
  }, [])

  const loadTimeline = useCallback(async (projectId: string) => {
    const [checkpointResult, agentEventResult, failedRestoreResult] = await Promise.all([
      window.vibegit.listCheckpoints(projectId),
      window.vibegit.listAgentEvents(projectId),
      window.vibegit.listFailedRestores(projectId)
    ])
    setCheckpoints(unwrap(checkpointResult))
    setAgentEvents(unwrap(agentEventResult))
    setFailedRestores(unwrap(failedRestoreResult))
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const data = await loadProjects()
        if (data[0]) setSelectedId(data[0].id)
      } catch (value) {
        setError(errorFrom(value))
      } finally {
        setLoading(false)
      }
    })()
  }, [loadProjects])

  useEffect(() => {
    if (!selectedId) return
    let active = true
    void Promise.all([
      window.vibegit.listCheckpoints(selectedId),
      window.vibegit.listAgentEvents(selectedId),
      window.vibegit.listFailedRestores(selectedId)
    ])
      .then(([checkpointResult, agentEventResult, failedRestoreResult]) => {
        if (!active) return
        setCheckpoints(unwrap(checkpointResult))
        setAgentEvents(unwrap(agentEventResult))
        setFailedRestores(unwrap(failedRestoreResult))
      })
      .catch((value: unknown) => { if (active) setError(errorFrom(value)) })
    return () => { active = false }
  }, [selectedId])

  const addProjectPath = async (path: string): Promise<void> => {
    setBusy('add-project')
    setError(undefined)
    try {
      const project = unwrap(await window.vibegit.addProject({ path }))
      await loadProjects()
      setSelectedId(project.id)
      setPage('project')
      setModal(null)
      setNotice({ message: project.protectionEnabled ? '项目已添加' : '项目已添加，下一步开启版本保护' })
    } catch (value) {
      setError(errorFrom(value))
    } finally {
      setBusy(undefined)
    }
  }

  const chooseProject = async (): Promise<void> => {
    setBusy('add-project')
    setError(undefined)
    try {
      const path = unwrap(await window.vibegit.selectProjectDirectory())
      if (!path) return
      await addProjectPath(path)
    } catch (value) {
      setError(errorFrom(value))
    } finally {
      setBusy(undefined)
    }
  }

  const selectProject = (project: Project): void => {
    setSelectedId(project.id)
    setSelectedCheckpoint(undefined)
    setDiff(undefined)
    setPage('project')
  }

  const initializeProtection = async (): Promise<void> => {
    if (!selectedProject) return
    setBusy('initialize')
    setError(undefined)
    try {
      unwrap(await window.vibegit.initializeProtection(selectedProject.id))
      await Promise.all([loadProjects(), loadTimeline(selectedProject.id)])
      setNotice({ message: '版本保护已开启，初始保存点创建成功' })
    } catch (value) {
      setError(errorFrom(value))
    } finally {
      setBusy(undefined)
    }
  }

  const refreshProject = async (): Promise<void> => {
    if (!selectedProject) return
    setBusy('refresh')
    try {
      unwrap(await window.vibegit.refreshProject(selectedProject.id))
      await Promise.all([loadProjects(), loadTimeline(selectedProject.id)])
    } catch (value) {
      setError(errorFrom(value))
    } finally {
      setBusy(undefined)
    }
  }

  const openCheckpoint = async (checkpoint: Checkpoint): Promise<void> => {
    setSelectedCheckpoint(checkpoint)
    setDiff(undefined)
    setDiffLoading(true)
    try { setDiff(unwrap(await window.vibegit.getCheckpointDiff(checkpoint.id))) }
    catch (value) { setError(errorFrom(value)) }
    finally { setDiffLoading(false) }
  }

  const prepareRestore = async (checkpoint: Checkpoint): Promise<void> => {
    if (!selectedProject) return
    setBusy(`restore-${checkpoint.id}`)
    setError(undefined)
    try {
      const preview = unwrap(await window.vibegit.prepareRestore(selectedProject.id, checkpoint.id))
      setModal({ kind: 'restore', preview, checkpoint })
      await loadTimeline(selectedProject.id)
    } catch (value) {
      setError(errorFrom(value))
    } finally {
      setBusy(undefined)
    }
  }

  const executeRestore = async (preview: RestorePreview): Promise<void> => {
    if (!selectedProject) return
    setBusy('execute-restore')
    try {
      const restore = unwrap(await window.vibegit.executeRestore(preview.token))
      setModal(null)
      setNotice({ message: '已回到所选版本；回退前内容仍可找回', restore })
      await Promise.all([loadProjects(), loadTimeline(selectedProject.id)])
    } catch (value) {
      setError(errorFrom(value))
      setModal(null)
      try {
        const failed = unwrap(await window.vibegit.failedRestoreForToken(preview.token))
        if (failed?.recoveryDirectory) {
          setNotice({
            message: '回退未完整执行；回退前保险点仍在，如有已移动的文件可从恢复区取回',
            restore: failed,
            tone: 'warning'
          })
        }
      } catch { /* Keep the original restore error visible. */ }
    } finally {
      setBusy(undefined)
    }
  }

  const undoRestore = async (restore: RestoreRecord): Promise<void> => {
    if (!selectedProject) return
    setBusy('undo-restore')
    try {
      unwrap(await window.vibegit.undoRestore(restore.id))
      setNotice({ message: '已撤销本次回退，文件恢复到回退前状态' })
      await Promise.all([loadProjects(), loadTimeline(selectedProject.id)])
    } catch (value) {
      setError(errorFrom(value))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects}
        selectedId={selectedId}
        page={page}
        busy={busy}
        onSelect={selectProject}
        onAdd={() => void chooseProject()}
        onProjects={() => setPage('projects')}
        onSettings={() => setPage('settings')}
      />
      <main className="main-area">
        {notice && (
          <div className={`toast ${notice.tone === 'warning' ? 'toast-warning' : 'toast-success'}`} role="status">
            {notice.tone === 'warning' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            <span>{notice.message}</span>
            {notice.restore?.status === 'completed' && <button onClick={() => void undoRestore(notice.restore!)} disabled={Boolean(busy)}><Undo2 size={15} />撤销本次回退</button>}
            {notice.restore?.recoveryDirectory && <button onClick={() => void window.vibegit.openRecoveryDirectory(notice.restore!.id)}><FolderOpen size={15} />打开恢复区</button>}
            <button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(undefined)}><X size={16} /></button>
          </div>
        )}
        {error && <ErrorBanner error={error} onClose={() => setError(undefined)} />}
        {loading ? (
          <LoadingView label="正在读取项目保护状态…" />
        ) : page === 'settings' ? (
          <SettingsView onBack={() => setPage(selectedProject ? 'project' : 'projects')} />
        ) : page === 'projects' || !selectedProject ? (
          <ProjectsHome projects={projects} busy={busy} onAdd={() => void chooseProject()} onSelect={selectProject} />
        ) : (
          <ProjectWorkspace
            project={selectedProject}
            checkpoints={checkpoints}
            agentEvents={agentEvents}
            failedRestores={failedRestores}
            busy={busy}
            onInitialize={() => void initializeProtection()}
            onRefresh={() => void refreshProject()}
            onSave={() => setModal({ kind: 'save' })}
            onShelf={() => setModal({ kind: 'shelf' })}
            onBackup={() => setModal({ kind: 'backup' })}
            onOpenCheckpoint={(checkpoint) => void openCheckpoint(checkpoint)}
          />
        )}
      </main>

      {selectedCheckpoint && (
        <CheckpointDrawer
          checkpoint={selectedCheckpoint}
          diff={diff}
          loading={diffLoading}
          busy={busy}
          onClose={() => { setSelectedCheckpoint(undefined); setDiff(undefined) }}
          onRestore={() => void prepareRestore(selectedCheckpoint)}
        />
      )}
      {modal?.kind === 'save' && selectedProject && (
        <SaveModal
          project={selectedProject}
          busy={busy === 'save'}
          onClose={() => setModal(null)}
          onSave={async (title, stable, note) => {
            setBusy('save')
            try {
              unwrap(await window.vibegit.createCheckpoint({
                projectId: selectedProject.id,
                type: stable ? 'stable' : 'manual',
                title,
                agent: 'manual',
                isStable: stable,
                ...(note ? { note } : {})
              }))
              setModal(null)
              setNotice({ message: '当前版本已安全保存' })
              await Promise.all([loadProjects(), loadTimeline(selectedProject.id)])
            } catch (value) { setError(errorFrom(value)) }
            finally { setBusy(undefined) }
          }}
        />
      )}
      {modal?.kind === 'restore' && (
        <RestoreModal
          preview={modal.preview}
          checkpoint={modal.checkpoint}
          busy={busy === 'execute-restore'}
          onClose={() => setModal(null)}
          onConfirm={() => void executeRestore(modal.preview)}
        />
      )}
      {modal?.kind === 'shelf' && selectedProject && (
        <ShelfModal
          project={selectedProject}
          onClose={() => setModal(null)}
          onChanged={async (message) => {
            await Promise.all([loadProjects(), loadTimeline(selectedProject.id)])
            setNotice({ message })
          }}
          onError={(value) => setError(errorFrom(value))}
        />
      )}
      {modal?.kind === 'backup' && selectedProject && (
        <BackupModal
          project={selectedProject}
          onClose={() => setModal(null)}
          onProjectChange={async () => {
            await loadProjects()
          }}
          onSuccess={(message) => setNotice({ message })}
          onError={(value) => setError(errorFrom(value))}
        />
      )}
    </div>
  )
}

function Sidebar(props: {
  projects: Project[]
  selectedId?: string | undefined
  page: Page
  busy?: string | undefined
  onSelect(project: Project): void
  onAdd(): void
  onProjects(): void
  onSettings(): void
}): ReactNode {
  return (
    <aside className="sidebar">
      <button className="brand" onClick={props.onProjects}>
        <img className="brand-logo" src={projectLogo} alt="VibeGit" />
      </button>
      <nav className="primary-nav" aria-label="主导航">
        <button className={props.page === 'projects' ? 'active' : ''} onClick={props.onProjects}><FolderHeart size={17} />所有项目</button>
      </nav>
      <div className="sidebar-section-title"><span>最近项目</span><button aria-label="添加项目" onClick={props.onAdd}><Plus size={15} /></button></div>
      <div className="project-nav-list">
        {props.projects.length === 0 ? <p className="sidebar-empty">添加第一个项目后，它会出现在这里。</p> : props.projects.map((project) => (
          <button key={project.id} className={props.selectedId === project.id && props.page === 'project' ? 'active' : ''} onClick={() => props.onSelect(project)}>
            <span className={`project-dot ${project.hasUnsavedChanges ? 'unsaved' : 'safe'}`} />
            <span className="project-nav-copy"><strong>{project.name}</strong><small>{project.hasUnsavedChanges ? '有尚未保存的修改' : '当前版本已保存'}</small></span>
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        <button className={props.page === 'settings' ? 'active' : ''} onClick={props.onSettings}><Settings size={17} />设置与连接</button>
        <div className="safety-note"><LockKeyhole size={15} /><span>源码只保存在你的电脑和你选择的 GitHub 仓库</span></div>
      </div>
    </aside>
  )
}

function ProjectsHome(props: { projects: Project[]; busy?: string | undefined; onAdd(): void; onSelect(project: Project): void }): ReactNode {
  return (
    <section className="page projects-page">
      <header className="page-header">
        <div><p className="eyebrow">你的本地项目</p><h1>每次 AI 修改，都能放心找回来。</h1><p>VibeGit 在本机保存可理解的版本，并在你允许时备份到 GitHub。</p></div>
        <button className="button primary" onClick={props.onAdd} disabled={props.busy === 'add-project'}>
          {props.busy === 'add-project' ? <LoaderCircle className="spin" size={17} /> : <FolderOpen size={17} />}添加本地项目
        </button>
      </header>
      {props.projects.length === 0 ? (
        <div className="welcome-card">
          <div className="welcome-visual"><img className="welcome-app-logo" src={appLogo} alt="" /><Sparkles size={22} /></div>
          <div><span className="pill neutral">首次使用</span><h2>先选择一个正在用 AI 开发的文件夹</h2><p>我们不会上传或删除文件。开启保护后，会为当前状态建立第一个保存点。</p>
            <button className="button primary large" onClick={props.onAdd}><FolderOpen size={18} />选择项目文件夹</button>
          </div>
          <ol className="welcome-steps"><li><span>1</span>添加项目</li><li><span>2</span>开启版本保护</li><li><span>3</span>放心让 Agent 修改</li></ol>
        </div>
      ) : (
        <div className="project-grid">
          {props.projects.map((project) => <ProjectCard key={project.id} project={project} onClick={() => props.onSelect(project)} />)}
          <button className="add-project-card" onClick={props.onAdd}><Plus size={22} /><strong>添加另一个项目</strong><span>选择本地文件夹</span></button>
        </div>
      )}
    </section>
  )
}

function ProjectCard({ project, onClick }: { project: Project; onClick(): void }): ReactNode {
  return (
    <button className="project-card" onClick={onClick}>
      <div className="project-card-top"><span className="folder-icon"><FolderHeart size={21} /></span><ChevronRight size={18} /></div>
      <h3>{project.name}</h3><p className="path-text" title={project.path}>{project.path}</p>
      <div className="project-card-status">
        <span className={`status-line ${project.hasUnsavedChanges ? 'warning' : 'safe'}`}>{project.hasUnsavedChanges ? <Clock3 size={15} /> : <CheckCircle2 size={15} />}{project.hasUnsavedChanges ? '有尚未保存的修改' : '当前版本已保存'}</span>
        <span className="status-line muted"><Cloud size={15} />{project.githubSyncStatus === 'synced' ? '已备份到 GitHub' : project.githubRemoteUrl ? '有尚未备份的保存点' : '尚未设置 GitHub 备份'}</span>
      </div>
      <div className="project-card-meta"><span>最近保存 {formatRelativeTime(project.lastCheckpointAt)}</span><span>{project.lastAgent ? `由 ${agentLabel(project.lastAgent)}` : '尚无 Agent 记录'}</span></div>
    </button>
  )
}

function ProjectWorkspace(props: {
  project: Project
  checkpoints: Checkpoint[]
  agentEvents: AgentEventRecord[]
  failedRestores: RestoreRecord[]
  busy?: string | undefined
  onInitialize(): void
  onRefresh(): void
  onSave(): void
  onShelf(): void
  onBackup(): void
  onOpenCheckpoint(checkpoint: Checkpoint): void
}): ReactNode {
  const { project } = props
  const latestNoChange = props.agentEvents.find((event) => event.event === 'task-end' && !event.checkpointId)
  return (
    <section className="page workspace-page">
      <header className="workspace-header">
        <div className="workspace-title"><span className="folder-icon large"><FolderHeart size={23} /></span><div><div className="title-row"><h1>{project.name}</h1>{project.protectionEnabled && <span className="pill safe"><ShieldCheck size={13} />保护中</span>}</div><p title={project.path}>{project.path}</p></div></div>
        <div className="header-actions">
          <button className="button ghost" aria-label="刷新项目状态" onClick={props.onRefresh} disabled={props.busy === 'refresh'}><RefreshCw className={props.busy === 'refresh' ? 'spin' : ''} size={16} /></button>
          <button className="button ghost" onClick={props.onShelf} disabled={!project.protectionEnabled}><Archive size={16} />暂时收起</button>
          <button className="button secondary" onClick={props.onBackup}><Cloud size={16} />GitHub 备份</button>
          <button className="button primary" onClick={props.onSave} disabled={!project.protectionEnabled}><Save size={16} />创建保存点</button>
        </div>
      </header>

      {!project.protectionEnabled ? (
        <div className="protection-setup">
          <div className="protection-icon"><Shield size={34} /></div>
          <div><span className="pill warning">尚未保护</span><h2>为这个项目开启版本保护</h2><p>VibeGit 会初始化本地版本记录并创建初始保存点，不会上传文件，也不会改变你的工作方式。</p>
            <div className="setup-guarantees"><span><Check size={15} />文件安全不丢失</span><span><Check size={15} />Git 操作一键完成</span><span><Check size={15} />修改记录随时回退</span></div>
            <button className="button primary large" onClick={props.onInitialize} disabled={props.busy === 'initialize'}>{props.busy === 'initialize' ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}开启版本保护</button>
          </div>
        </div>
      ) : (
        <>
          <div className="status-strip">
            <div className={project.hasUnsavedChanges ? 'status-card amber' : 'status-card green'}>{project.hasUnsavedChanges ? <Clock3 size={20} /> : <ShieldCheck size={20} />}<span><strong>{project.hasUnsavedChanges ? '有新的修改' : '当前版本已保存'}</strong><small>{project.hasUnsavedChanges ? '建议在继续让 AI 修改前创建保存点' : `最近保存 ${formatRelativeTime(project.lastCheckpointAt)}`}</small></span></div>
            <div className="status-card neutral"><Sparkles size={20} /><span><strong>{project.lastAgent ? agentLabel(project.lastAgent) : 'Agent 尚未连接'}</strong><small>{project.lastAgent ? '最近修改来源' : '可在设置中查看连接方法'}</small></span></div>
            <button className="status-card neutral clickable" onClick={props.onBackup}><Cloud size={20} /><span><strong>{project.githubSyncStatus === 'synced' ? '已安全备份' : project.githubRemoteUrl ? '等待备份' : '尚未设置备份'}</strong><small>{project.githubSyncStatus === 'synced' ? formatRelativeTime(project.lastSyncedAt) : '备份到你的 GitHub 私有仓库'}</small></span><ChevronRight size={17} /></button>
          </div>
          <div className="timeline-layout">
            <div className="timeline-heading"><div><p className="eyebrow">项目时间线</p><h2>你的安全保存记录</h2></div><span>{props.checkpoints.length} 个保存点</span></div>
            {latestNoChange && <div className="agent-no-change" role="status"><CheckCircle2 size={17} /><div><strong>任务完成，但没有检测到文件变化</strong><small>{agentLabel(latestNoChange.agent)}{latestNoChange.taskText ? `：${latestNoChange.taskText}` : ' 本轮没有需要保存的新文件内容。'}</small></div></div>}
            {props.failedRestores.map((restore) => <div className="restore-recovery-alert" key={restore.id} role="alert"><AlertTriangle size={18} /><div><strong>有一次未完成的回退需要留意</strong><small>保险点仍在；如有已移动的文件，它们保存在恢复区，可随时打开查看。</small></div><button className="button ghost" onClick={() => void window.vibegit.openRecoveryDirectory(restore.id)}><FolderOpen size={15} />打开恢复区</button></div>)}
            {props.checkpoints.length === 0 ? <EmptyTimeline onSave={props.onSave} /> : <Timeline checkpoints={props.checkpoints} onOpen={props.onOpenCheckpoint} />}
          </div>
        </>
      )}
    </section>
  )
}

function Timeline({ checkpoints, onOpen }: { checkpoints: Checkpoint[]; onOpen(checkpoint: Checkpoint): void }): ReactNode {
  return (
    <div className="timeline">
      {checkpoints.map((checkpoint, index) => {
        const type = checkpointType(checkpoint.type)
        return (
          <button className="timeline-item" key={checkpoint.id} onClick={() => onOpen(checkpoint)}>
            <div className="timeline-rail"><span className={`timeline-node ${type.tone}`}>{checkpoint.type === 'post_agent' ? <Sparkles size={15} /> : checkpoint.type === 'pre_restore' ? <ShieldAlert size={15} /> : <Save size={15} />}</span>{index < checkpoints.length - 1 && <i />}</div>
            <div className="timeline-card">
              <div className="timeline-card-title"><div><h3>{checkpoint.title}</h3><span className={`pill ${type.tone}`}>{type.label}</span></div><MoreHorizontal size={18} /></div>
              {checkpoint.taskText && <p className="task-text">“{checkpoint.taskText}”</p>}
              <div className="timeline-meta"><span><Sparkles size={14} />{agentLabel(checkpoint.agent)}</span><span><Clock3 size={14} />{formatRelativeTime(checkpoint.createdAt)}</span><span><FileCode2 size={14} />{checkpoint.changedFiles.length} 个文件</span><span className="changes"><b>+{checkpoint.insertions}</b><em>−{checkpoint.deletions}</em></span></div>
              <div className="timeline-footer"><span className={checkpoint.testStatus === 'passed' ? 'good' : 'muted'}>{checkpoint.testStatus === 'passed' ? '测试通过' : checkpoint.testStatus === 'failed' ? '测试未通过' : '未关联测试'}</span><span className={checkpoint.githubSyncStatus === 'synced' ? 'good' : 'muted'}>{checkpoint.githubSyncStatus === 'synced' ? '已备份' : '仅保存在本机'}</span><span className="link-copy">查看这次改了什么 <ChevronRight size={14} /></span></div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function EmptyTimeline({ onSave }: { onSave(): void }): ReactNode {
  return <div className="empty-state"><History size={32} /><h3>时间线还很安静</h3><p>创建保存点后，你会在这里看到每轮修改和恢复记录。</p><button className="button secondary" onClick={onSave}><Save size={16} />创建第一个保存点</button></div>
}

function CheckpointDrawer(props: { checkpoint: Checkpoint; diff?: CheckpointDiff | undefined; loading: boolean; busy?: string | undefined; onClose(): void; onRestore(): void }): ReactNode {
  const [activeFile, setActiveFile] = useState<string>()
  const current = props.diff?.files.find((file) => file.path === activeFile) ?? props.diff?.files[0]
  const type = checkpointType(props.checkpoint.type)
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose() }}>
      <aside className="checkpoint-drawer" aria-label="保存点详情">
        <header className="drawer-header"><button className="icon-button" aria-label="关闭详情" onClick={props.onClose}><X size={18} /></button><div><span className={`pill ${type.tone}`}>{type.label}</span><h2>{props.checkpoint.title}</h2><p>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(props.checkpoint.createdAt))} · {agentLabel(props.checkpoint.agent)}</p></div><button className="button danger-soft" onClick={props.onRestore} disabled={props.busy === `restore-${props.checkpoint.id}`}><RotateCcw size={16} />回到这个版本</button></header>
        {props.checkpoint.taskText && <div className="task-summary"><Sparkles size={17} /><div><strong>当时交给 Agent 的任务</strong><p>{props.checkpoint.taskText}</p></div></div>}
        <div className="diff-summary"><span><FileCode2 size={16} />{props.checkpoint.changedFiles.length} 个文件</span><b>+{props.checkpoint.insertions}</b><em>−{props.checkpoint.deletions}</em></div>
        {props.loading ? <LoadingView label="正在整理这次修改…" compact /> : !props.diff || props.diff.files.length === 0 ? <div className="empty-diff"><CheckCircle2 size={26} /><strong>这个保存点没有文件内容变化</strong><span>它用于记录一个安全边界。</span></div> : (
          <div className="diff-workspace">
            <div className="file-list" role="listbox" aria-label="修改的文件">{props.diff.files.map((file) => <button key={file.path} className={(current?.path === file.path) ? 'active' : ''} onClick={() => setActiveFile(file.path)}><FileCode2 size={15} /><span>{file.path}</span><small className={file.kind}>{file.kind === 'added' ? '新增' : file.kind === 'deleted' ? '删除' : file.kind === 'renamed' ? '改名' : '修改'}</small></button>)}</div>
            <div className="patch-panel">{current && <><div className="patch-header"><span>{current.path}</span><span><b>+{current.insertions}</b> <em>−{current.deletions}</em></span></div>{current.binary ? <div className="binary-note">这是二进制文件，无法显示逐行差异。</div> : <PatchView patch={current.patch} />}</>}</div>
          </div>
        )}
      </aside>
    </div>
  )
}

function PatchView({ patch }: { patch: string }): ReactNode {
  if (!patch) return <div className="empty-diff"><Check size={22} /><span>没有可显示的文本差异</span></div>
  const lines = patch.split('\n').filter((line) =>
    !line.startsWith('diff --git ') &&
    !line.startsWith('index ') &&
    !line.startsWith('new file mode ') &&
    !line.startsWith('deleted file mode ') &&
    !line.startsWith('similarity index ') &&
    !line.startsWith('rename from ') &&
    !line.startsWith('rename to ') &&
    !line.startsWith('--- ') &&
    !line.startsWith('+++ ') &&
    !line.startsWith('@@ ')
  )
  return <pre className="patch-view">{lines.map((line, index) => <span key={`${index}-${line.slice(0, 8)}`} className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : ''}><i>{index + 1}</i><code>{line || ' '}</code></span>)}</pre>
}

function SaveModal(props: { project: Project; busy: boolean; onClose(): void; onSave(title: string, stable: boolean, note?: string): Promise<void> }): ReactNode {
  const [title, setTitle] = useState('当前可用版本')
  const [stable, setStable] = useState(false)
  const [note, setNote] = useState('')
  const submit = (event: FormEvent): void => { event.preventDefault(); if (title.trim()) void props.onSave(title.trim(), stable, note.trim() || undefined) }
  return <ModalFrame title="创建保存点" subtitle={`保存 ${props.project.name} 的当前状态，文件会继续留在原处。`} onClose={props.onClose}>
    <form onSubmit={submit} className="modal-form"><label>给这个版本一个容易记住的名字<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="例如：邮箱验证码登录完成" /></label><label>备注（可选）<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="记录为什么保存这个版本" /></label><label className="check-row"><input type="checkbox" checked={stable} onChange={(event) => setStable(event.target.checked)} /><span><strong>标记为稳定版本</strong><small>表示这是你确认可以正常使用的版本</small></span></label><div className="modal-actions"><button type="button" className="button ghost" onClick={props.onClose}>取消</button><button className="button primary" disabled={props.busy || !title.trim()}>{props.busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}保存当前版本</button></div></form>
  </ModalFrame>
}

function ShelfModal(props: { project: Project; onClose(): void; onChanged(message: string): Promise<void>; onError(value: unknown): void }): ReactNode {
  const [shelves, setShelves] = useState<ShelvedChange[]>([])
  const [title, setTitle] = useState('当前未完成修改')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string>()
  const { project, onError } = props
  const load = useCallback(async () => {
    try { setShelves(unwrap(await window.vibegit.listShelves(project.id))) }
    catch (value) { onError(value) }
    finally { setLoading(false) }
  }, [project.id, onError])
  useEffect(() => {
    let active = true
    void window.vibegit.listShelves(project.id)
      .then((result) => { if (active) setShelves(unwrap(result)) })
      .catch((value: unknown) => { if (active) onError(value) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [project.id, onError])

  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!title.trim()) return
    setBusy('create')
    try {
      unwrap(await window.vibegit.createShelf(project.id, title.trim()))
      await load()
      await props.onChanged('当前修改已暂时收起，随时可以取回')
    } catch (value) { onError(value) }
    finally { setBusy(undefined) }
  }
  const retrieve = async (shelf: ShelvedChange): Promise<void> => {
    setBusy(shelf.id)
    try {
      unwrap(await window.vibegit.retrieveShelf(shelf.id))
      await load()
      await props.onChanged(`已取回“${shelf.title}”`)
    } catch (value) { onError(value) }
    finally { setBusy(undefined) }
  }

  return <ModalFrame title="暂时收起修改" subtitle="把未完成的修改安全隐藏起来，之后可以完整取回；不会直接删除新增文件。" onClose={props.onClose}>
    <div className="shelf-content">
      <form className="shelf-create" onSubmit={(event) => void create(event)}><label>这组修改的名称<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} /></label><button className="button primary" disabled={!title.trim() || Boolean(busy)}>{busy === 'create' ? <LoaderCircle className="spin" size={16} /> : <Archive size={16} />}安全收起当前修改</button></form>
      <div className="shelf-note"><ShieldCheck size={17} /><p>收起前会先创建保存点；取回时如果当前项目又有变化，也会先建立保险点。</p></div>
      <div className="shelf-list"><div className="section-title"><div><h3>已经收起的修改</h3><p>只有“等待取回”的记录可以操作。</p></div></div>{loading ? <LoadingView compact label="正在读取…" /> : shelves.filter((shelf) => shelf.status === 'active').length === 0 ? <div className="empty-shelves"><Archive size={22} /><span>还没有暂时收起的修改</span></div> : shelves.filter((shelf) => shelf.status === 'active').map((shelf) => <div className="shelf-row" key={shelf.id}><ArchiveRestore size={18} /><div><strong>{shelf.title}</strong><small>{formatRelativeTime(shelf.createdAt)}</small></div><button className="button secondary small" disabled={Boolean(busy)} onClick={() => void retrieve(shelf)}>{busy === shelf.id ? <LoaderCircle className="spin" size={14} /> : <ArchiveRestore size={14} />}取回修改</button></div>)}</div>
      <div className="modal-actions"><button className="button ghost" onClick={props.onClose}>关闭</button></div>
    </div>
  </ModalFrame>
}

function RestoreModal(props: { preview: RestorePreview; checkpoint: Checkpoint; busy: boolean; onClose(): void; onConfirm(): void }): ReactNode {
  const [confirmed, setConfirmed] = useState(false)
  return <ModalFrame danger title={`回到“${props.checkpoint.title}”`} subtitle="VibeGit 已先保存当前状态。请确认下面的影响后再继续。" onClose={props.onClose}>
    <div className="restore-overview"><div><FilePlus2 size={19} /><strong>{props.preview.addCount}</strong><span>将恢复</span></div><div><GitCompareArrows size={19} /><strong>{props.preview.overwriteCount}</strong><span>将覆盖</span></div><div><AlertTriangle size={19} /><strong>{props.preview.removeCount}</strong><span>将移出当前版本</span></div><div><ShieldAlert size={19} /><strong>{props.preview.conflictCount}</strong><span>将移入恢复区</span></div></div>
    <div className="impact-list">{props.preview.files.length === 0 ? <p>两个版本的文件内容相同。</p> : props.preview.files.slice(0, 80).map((file) => <div key={`${file.action}-${file.path}`}><span className={`impact-icon ${file.action}`}>{file.action === 'add' ? '+' : file.action === 'remove' ? '−' : file.action === 'move_to_recovery' ? '!' : '↻'}</span><span><strong>{file.path}</strong><small>{file.reason}</small></span></div>)}</div>
    <div className="insurance-note"><ShieldCheck size={20} /><div><strong>当前状态已经存入“回退前保险点”</strong><p>回退后可点击“撤销本次回退”，不会永久丢失现在的代码。</p></div></div>
    <label className="confirm-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我已了解这些文件变化，确认回到这个版本</label>
    <div className="modal-actions"><button className="button ghost" onClick={props.onClose}>暂不回退</button><button className="button danger" disabled={!confirmed || props.busy} onClick={props.onConfirm}>{props.busy ? <LoaderCircle className="spin" size={17} /> : <RotateCcw size={17} />}确认并安全回退</button></div>
  </ModalFrame>
}

function BackupModal(props: { project: Project; onClose(): void; onProjectChange(): Promise<void>; onSuccess(message: string): void; onError(value: unknown): void }): ReactNode {
  const { project, onError } = props
  const [status, setStatus] = useState<GitHubCliStatus>()
  const [scan, setScan] = useState<SensitiveScanResult>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string>()
  const [repoName, setRepoName] = useState(project.name.replace(/[^A-Za-z0-9._-]/g, '-') || 'vibegit-project')
  const [remoteUrl, setRemoteUrl] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextStatus, nextScan] = await Promise.all([window.vibegit.githubStatus(), window.vibegit.githubScan(project.id)])
      setStatus(unwrap(nextStatus)); setScan(unwrap(nextScan))
    } catch (value) { onError(value) }
    finally { setLoading(false) }
  }, [project.id, onError])
  useEffect(() => {
    let active = true
    void Promise.all([window.vibegit.githubStatus(), window.vibegit.githubScan(project.id)])
      .then(([nextStatus, nextScan]) => {
        if (!active) return
        setStatus(unwrap(nextStatus))
        setScan(unwrap(nextScan))
      })
      .catch((value: unknown) => { if (active) onError(value) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [project.id, onError])

  const createPrivate = async (): Promise<void> => {
    setBusy('create')
    try { unwrap(await window.vibegit.githubCreatePrivate({ projectId: props.project.id, name: repoName })); await props.onProjectChange(); props.onSuccess('GitHub 私有仓库已创建并连接') }
    catch (value) { props.onError(value) } finally { setBusy(undefined) }
  }
  const connect = async (): Promise<void> => {
    setBusy('connect')
    try { unwrap(await window.vibegit.githubConnect({ projectId: props.project.id, remoteUrl })); await props.onProjectChange(); props.onSuccess('GitHub 备份位置已连接') }
    catch (value) { props.onError(value) } finally { setBusy(undefined) }
  }
  const authorize = async (): Promise<void> => {
    setBusy('authorize')
    try {
      const result = unwrap(await window.vibegit.githubAuthorize())
      await refresh()
      props.onSuccess(result.message)
    } catch (value) { props.onError(value) } finally { setBusy(undefined) }
  }
  const push = async (): Promise<void> => {
    setBusy('push')
    try {
      const currentScan = unwrap(await window.vibegit.githubScan(props.project.id)); setScan(currentScan)
      if (currentScan.blocked) return
      unwrap(await window.vibegit.githubPush(props.project.id)); await props.onProjectChange(); props.onSuccess('项目已安全备份到 GitHub'); props.onClose()
    } catch (value) { props.onError(value) } finally { setBusy(undefined) }
  }
  const ignore = async (item: SensitiveRisk): Promise<void> => {
    setBusy(`ignore-${item.path}`)
    try { setScan(unwrap(await window.vibegit.githubIgnoreRisk(props.project.id, item))) }
    catch (value) { props.onError(value) } finally { setBusy(undefined) }
  }

  return <ModalFrame wide title="GitHub 私有备份" subtitle="只会备份到你自己的 Private 仓库；每次上传前都会扫描风险。" onClose={props.onClose}>
    {loading ? <LoadingView label="正在检查 GitHub 和项目安全状态…" compact /> : <div className="backup-content">
      <div className={`connection-card ${status?.authenticated ? 'connected' : 'offline'}`}>
        <span>{status?.authenticated ? <CheckCircle2 size={20} /> : <TerminalSquare size={20} />}</span>
        <div>
          <strong>{status?.authenticated ? `GitHub 已连接${status.username ? ` · ${status.username}` : ''}` : status?.installed ? 'GitHub 尚未登录' : '尚未安装 GitHub CLI'}</strong>
          <p>{status?.message}</p>
          {status?.installed && !status?.sshKeyReady && <div className="connection-actions"><button className="button secondary small" disabled={Boolean(busy)} onClick={() => void authorize()}>{busy === 'authorize' ? <LoaderCircle className="spin" size={14} /> : <LockKeyhole size={14} />}{status.authenticated ? '创建并关联 SSH 密钥' : '连接 GitHub 并创建 SSH 密钥'}</button><small>会打开 GitHub 授权页面，并只向你的账户关联 VibeGit 专用公钥。</small></div>}
          {status?.sshKeyReady && <small className="connection-ready"><ShieldCheck size={14} />已使用 VibeGit 专用 SSH 密钥</small>}
          {!status?.installed && <small>安装 GitHub CLI 后，即可在这里一键完成浏览器授权。</small>}
        </div>
      </div>
      {!props.project.githubRemoteUrl ? <div className="backup-setup-grid"><form onSubmit={(event) => { event.preventDefault(); void createPrivate() }}><span className="pill safe">推荐</span><h3>创建新的私有仓库</h3><p>显式创建为 Private，不会公开你的源代码。</p><label>仓库名称<input value={repoName} onChange={(event) => setRepoName(event.target.value)} /></label><button className="button primary" disabled={!status?.authenticated || !status?.sshKeyReady || Boolean(busy)}>{busy === 'create' ? <LoaderCircle className="spin" size={16} /> : <LockKeyhole size={16} />}创建并连接</button></form><form onSubmit={(event) => { event.preventDefault(); void connect() }}><span className="pill neutral">已有仓库</span><h3>连接现有私有仓库</h3><p>登录后会验证仓库确实是 Private，再设置备份位置。</p><label>GitHub 备份位置<input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://github.com/you/project.git" /></label><button className="button secondary" disabled={!status?.authenticated || !status?.sshKeyReady || !remoteUrl.trim() || Boolean(busy)}>验证并连接</button></form></div> : <div className="remote-card"><Cloud size={20} /><div><strong>备份位置已设置</strong><p>{props.project.githubRemoteUrl}</p></div><span className={`pill ${props.project.githubSyncStatus === 'synced' ? 'safe' : 'warning'}`}>{props.project.githubSyncStatus === 'synced' ? '已同步' : '等待同步'}</span></div>}
      <div className="scan-section"><div className="section-title"><div><h3>上传前安全检查</h3><p>检查环境变量、私钥、访问令牌、数据库、大文件和生成目录。</p></div><button className="button ghost" onClick={() => void refresh()}><RefreshCw size={15} />重新扫描</button></div>{scan?.blocked ? <div className="risk-list"><div className="risk-heading"><ShieldAlert size={19} /><strong>发现 {scan.risks.length} 项风险，已阻止上传</strong></div>{scan.risks.map((item) => <div className="risk-item" key={`${item.kind}-${item.path}`}><AlertTriangle size={17} /><div><strong>{item.path}</strong><p>{item.message}</p></div>{item.ignoreSuggestion && <button className="button small" disabled={Boolean(busy)} onClick={() => void ignore(item)}>{busy === `ignore-${item.path}` ? <LoaderCircle className="spin" size={14} /> : null}加入忽略列表</button>}</div>)}</div> : <div className="scan-safe"><ShieldCheck size={20} /><span><strong>未发现阻止备份的风险</strong><small>已检查 {scan?.scannedFiles ?? 0} 个文件</small></span></div>}</div>
      <div className="modal-actions"><button className="button ghost" onClick={props.onClose}>关闭</button><button className="button primary" disabled={!props.project.githubRemoteUrl || !status?.authenticated || scan?.blocked || Boolean(busy)} onClick={() => void push()}>{busy === 'push' ? <LoaderCircle className="spin" size={17} /> : <Cloud size={17} />}安全备份到 GitHub</button></div>
    </div>}
  </ModalFrame>
}

function SettingsView({ onBack }: { onBack(): void }): ReactNode {
  const [settings, setSettings] = useState<AppSettings>()
  const [agents, setAgents] = useState<AgentConnectionStatus>()
  const [health, setHealth] = useState<string>('检查中')
  useEffect(() => { void Promise.all([window.vibegit.getSettings(), window.vibegit.agentStatus(), window.vibegit.health()]).then(([s, a, h]) => { setSettings(unwrap(s)); setAgents(unwrap(a)); const data = unwrap(h); setHealth(data.git === 'ok' ? '本地保存引擎正常' : '未找到 Git') }).catch(() => setHealth('状态检查失败')) }, [])
  return <section className="page settings-page"><header className="page-header compact"><div><button className="back-link" onClick={onBack}><ArrowLeft size={15} />返回</button><p className="eyebrow">设置与连接</p><h1>保护引擎状态</h1><p>这些信息用于确认 VibeGit 能否自动保存每轮 Agent 修改。</p></div></header><div className="settings-grid"><section className="settings-card"><div className="settings-card-title"><HardDrive size={19} /><div><h2>本地数据</h2><p>只存保存点说明和操作记录，源码仍在项目中。</p></div></div><dl><div><dt>状态</dt><dd><span className="status-dot safe" />{health}</dd></div><div><dt>记录位置</dt><dd title={settings?.dataDirectory}>{settings?.dataDirectory ?? '读取中…'}</dd></div><div><dt>命令超时</dt><dd>{settings ? `${settings.commandTimeoutMs / 1000} 秒` : '—'}</dd></div></dl></section><section className="settings-card"><div className="settings-card-title"><Sparkles size={19} /><div><h2>Agent 连接</h2><p>通过统一事件 CLI 在修改前后创建保护点。</p></div></div><AgentRow name="Codex" status={agents?.codex} /><AgentRow name="Claude Code" status={agents?.claudeCode} /><div className="command-note"><code>node dist/cli/index.js event --stdin</code><p>自包含的 vibegit 可执行文件和自动安装器属于下一阶段。</p></div></section><section className="settings-card span-2"><div className="settings-card-title"><ShieldCheck size={19} /><div><h2>默认安全规则</h2><p>这些规则始终生效，不能被普通操作绕过。</p></div></div><div className="safety-grid"><span><Check size={15} />回退前自动保险</span><span><Check size={15} />不删除未跟踪文件</span><span><Check size={15} />禁止强制推送</span><span><Check size={15} />上传前扫描敏感文件</span><span><Check size={15} />Renderer 无文件系统权限</span><span><Check size={15} />Git 命令有超时限制</span></div></section></div></section>
}

function AgentRow({ name, status }: { name: string; status?: AgentConnectionStatus['codex'] | undefined }): ReactNode {
  return <div className="agent-row"><span className={`agent-icon ${status?.installed ? 'online' : ''}`}><Code2 size={17} /></span><div><strong>{name}</strong><small>{status?.detail ?? '正在检测…'}</small></div><span className={`pill ${status?.installed ? 'safe' : 'neutral'}`}>{status?.installed ? '已检测' : '未连接'}</span></div>
}

function ModalFrame({ title, subtitle, onClose, danger, wide, children }: { title: string; subtitle: string; onClose(): void; danger?: boolean; wide?: boolean; children: ReactNode }): ReactNode {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className={`modal ${danger ? 'modal-danger' : ''} ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><div className={danger ? 'danger-symbol' : 'modal-symbol'}>{danger ? <ShieldAlert size={22} /> : <ShieldCheck size={22} />}</div><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>{children}</section></div>
}

function ErrorBanner({ error, onClose }: { error: PublicError; onClose(): void }): ReactNode {
  return <div className="toast toast-error" role="alert"><AlertTriangle size={18} /><span><strong>{error.message}</strong>{error.detail && <small>{error.detail}</small>}{error.remediation && <small>{error.remediation}</small>}</span><button className="icon-button" aria-label="关闭错误" onClick={onClose}><X size={16} /></button></div>
}

function LoadingView({ label, compact }: { label: string; compact?: boolean }): ReactNode {
  return <div className={`loading-view ${compact ? 'compact' : ''}`}><LoaderCircle className="spin" size={compact ? 22 : 30} /><span>{label}</span></div>
}
