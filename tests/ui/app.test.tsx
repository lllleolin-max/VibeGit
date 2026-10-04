// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../apps/desktop/src/renderer/App'
import type {
  ApiResult,
  AgentEventRecord,
  AgentConnectionStatus,
  Checkpoint,
  CheckpointDiff,
  GitHubAuthorizationState,
  GitHubOnboardingResult,
  GitHubSyncResult,
  HealthStatus,
  Project,
  RestorePreview,
  RestoreRecord,
  ShelvedChange,
  SensitiveScanResult,
  VibeGitApi
} from '@vibegit/shared'

const project: Project = {
  id: 'project-1',
  name: '我的 AI 项目',
  path: 'C:\\项目\\我的 AI 项目',
  createdAt: '2026-07-11T08:00:00.000Z',
  lastActivityAt: '2026-07-11T08:15:00.000Z',
  isGitRepository: true,
  protectionEnabled: true,
  hasUnsavedChanges: false,
  untrackedFiles: 0,
  lastAgent: 'codex',
  lastCheckpointAt: '2026-07-11T08:15:00.000Z',
  githubSyncStatus: 'not_configured'
}

const checkpoint: Checkpoint = {
  id: 'checkpoint-1', projectId: project.id, createdAt: '2026-07-11T08:15:00.000Z',
  type: 'post_agent', title: '邮箱验证码登录', agent: 'codex', taskText: '增加邮箱验证码登录',
  gitObjectId: 'abc123', changedFiles: [{ path: 'src/app.ts', kind: 'modified', insertions: 2, deletions: 1, binary: false }],
  insertions: 2, deletions: 1, testStatus: 'passed', githubSyncStatus: 'not_configured', isStable: false, metadata: {}
}

const preview: RestorePreview = {
  token: 'restore-token', projectId: project.id, targetCheckpointId: checkpoint.id,
  insuranceCheckpointId: 'insurance', createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(), stateTreeObjectId: 'tree', indexFingerprint: 'index', conflictPaths: [],
  files: [{ path: 'src/app.ts', action: 'overwrite', reason: '用所选保存点中的版本覆盖' }],
  addCount: 0, overwriteCount: 1, removeCount: 0, conflictCount: 0
}

function success<T>(data: T): Promise<ApiResult<T>> { return Promise.resolve({ ok: true, data }) }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

function mockApi(overrides: Partial<VibeGitApi> = {}): VibeGitApi {
  const completedRestore: RestoreRecord = { id: 'restore-1', projectId: project.id, targetCheckpointId: checkpoint.id, insuranceCheckpointId: 'insurance', createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), status: 'completed' }
  const undoneRestore: RestoreRecord = { id: 'restore-1', projectId: project.id, targetCheckpointId: checkpoint.id, insuranceCheckpointId: 'insurance', createdAt: new Date().toISOString(), undoneAt: new Date().toISOString(), status: 'undone' }
  const diff: CheckpointDiff = { fromObjectId: 'old', toObjectId: 'abc123', insertions: 2, deletions: 1, files: [{ path: 'src/app.ts', kind: 'modified', patch: '@@ -1 +1,2 @@\n-old\n+new\n+added', binary: false, insertions: 2, deletions: 1 }] }
  const agentStatus: AgentConnectionStatus = { codex: { installed: true, integration: 'template', detail: '已检测', detection: 'path' }, claudeCode: { installed: false, integration: 'not_configured', detail: '未检测', detection: 'not-found' } }
  const base: VibeGitApi = {
    health: vi.fn(() => success<HealthStatus>({ ready: true, database: 'ok', git: 'ok', version: '1.0.0' })),
    selectProjectDirectory: vi.fn(() => success(null)),
    listProjects: vi.fn(() => success([])),
    addProject: vi.fn(() => success(project)),
    removeProject: vi.fn(() => success({ projectId: project.id, removedCheckpoints: 1 })),
    refreshProject: vi.fn(() => success(project)),
    initializeProtection: vi.fn(() => success({ project, checkpoint })),
    listCheckpoints: vi.fn(() => success([])),
    createCheckpoint: vi.fn(() => success(checkpoint)),
    renameCheckpoint: vi.fn((_checkpointId, title) => success({ ...checkpoint, title })),
    deleteCheckpoint: vi.fn(() => success({ checkpointId: checkpoint.id, projectId: project.id })),
    getCheckpointDiff: vi.fn(() => success(diff)),
    prepareRestore: vi.fn(() => success(preview)),
    executeRestore: vi.fn(() => success(completedRestore)),
    undoRestore: vi.fn(() => success(undoneRestore)),
    failedRestoreForToken: vi.fn(() => success(null)),
    listFailedRestores: vi.fn(() => success([])),
    openRecoveryDirectory: vi.fn(() => success(true)),
    listShelves: vi.fn(() => success([])),
    createShelf: vi.fn(() => success<ShelvedChange>({ id: 'shelf-1', projectId: project.id, checkpointId: checkpoint.id, restoreId: 'restore-1', title: '未完成修改', createdAt: new Date().toISOString(), status: 'active' })),
    retrieveShelf: vi.fn(() => success<ShelvedChange>({ id: 'shelf-1', projectId: project.id, checkpointId: checkpoint.id, restoreId: 'restore-1', title: '未完成修改', createdAt: new Date().toISOString(), retrievedAt: new Date().toISOString(), status: 'retrieved' })),
    githubStatus: vi.fn(() => success({ installed: false, authenticated: false, message: '未安装' })),
    githubAuthorize: vi.fn(() => success({ username: 'test-user', sshKeyCreated: true, message: 'GitHub 已连接，已创建并注册 VibeGit 专用 SSH 密钥' })),
    githubAuthorizationStatus: vi.fn(() => success<GitHubAuthorizationState>({ phase: 'idle', message: '' })),
    githubScan: vi.fn(() => success({ scannedAt: new Date().toISOString(), scannedFiles: 1, blocked: false, risks: [] })),
    githubCreatePrivate: vi.fn(() => success(project)),
    githubConnect: vi.fn(() => success(project)),
    githubPush: vi.fn(() => success({ remoteUrl: 'https://github.com/test/repo.git', checkpointId: checkpoint.id, syncedAt: new Date().toISOString(), branch: 'vibegit-backup' })),
    githubIgnoreRisk: vi.fn(() => success({ scannedAt: new Date().toISOString(), scannedFiles: 1, blocked: false, risks: [] })),
    minimizeWindow: vi.fn(() => success(true)),
    toggleMaximizeWindow: vi.fn(() => success(true)),
    closeWindow: vi.fn(() => success(true)),
    agentStatus: vi.fn(() => success(agentStatus)),
    listAgentEvents: vi.fn(() => success([])),
    getSettings: vi.fn(() => success({ dataDirectory: 'C:\\VibeGit', commandTimeoutMs: 20_000 })),
    selectDataDirectory: vi.fn(() => success(null)),
    setDataDirectory: vi.fn((path) => success({ dataDirectory: path, restartRequired: true })),
    checkEnvironment: vi.fn(() => success({ github: { installed: true, authenticated: false, message: 'ready' }, agents: agentStatus, changeSummarySkill: { ready: true, codex: { available: true, installed: true }, claudeCode: { available: false, installed: false }, deploymentCommand: 'Install the VibeGit Change Summary skill.' }, githubCliInstallAttempted: false, githubCliInstalled: false, message: 'ready' })),
  }
  return { ...base, ...overrides }
}

describe('VibeGit UI flow', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.lang = 'zh-CN'
    document.documentElement.dir = 'ltr'
    window.vibegit = mockApi()
  })
  afterEach(() => {
    cleanup()
  })

  it('shows a clear first-use empty state', async () => {
    render(<App />)
    expect(await screen.findByText('先选择一个正在用 AI 开发的文件夹')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /选择项目文件夹/ })).toBeEnabled()
  })

  it('does not claim an unprotected project has been safely saved', async () => {
    window.vibegit = mockApi({ listProjects: vi.fn(() => success([{ ...project, protectionEnabled: false }])), refreshProject: vi.fn(() => success({ ...project, protectionEnabled: false })) })
    render(<App />)
    expect((await screen.findAllByText('尚未开启版本保护')).length).toBeGreaterThan(0)
    expect(screen.queryByText('当前版本已保存')).not.toBeInTheDocument()
  })

  it('shows cached projects and the backup entry while a worktree check is still pending', async () => {
    const pendingCheck = deferred<ApiResult<Project>>()
    const api = mockApi({ listProjects: vi.fn(() => success([project])), refreshProject: vi.fn(() => pendingCheck.promise) })
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)
    expect((await screen.findAllByText('正在检查工作区…')).length).toBeGreaterThan(0)
    expect(screen.queryByText('当前版本已保存')).not.toBeInTheDocument()
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    expect(screen.getByRole('button', { name: 'GitHub 备份' })).toBeEnabled()
    expect(api.refreshProject).toHaveBeenCalledTimes(1)
    await act(async () => pendingCheck.resolve({ ok: true, data: { ...project, hasUnsavedChanges: true, worktreeStatus: 'checked' } }))
    expect(screen.getAllByText('有尚未保存的修改').length).toBeGreaterThan(0)
    expect(screen.queryByText('当前版本已保存')).not.toBeInTheDocument()
  })

  it('keeps an inconclusive worktree check pending until the user retries', async () => {
    const refreshProject = vi.fn()
      .mockImplementationOnce(() => success<Project>({ ...project, worktreeStatus: 'unknown' }))
      .mockImplementation(() => success<Project>({ ...project, worktreeStatus: 'checked' }))
    window.vibegit = mockApi({ listProjects: vi.fn(() => success([project])), refreshProject })
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(refreshProject).toHaveBeenCalledTimes(1))
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    expect(screen.getAllByText('工作区状态待检查').length).toBeGreaterThan(0)
    expect(screen.queryByText('当前版本已保存')).not.toBeInTheDocument()
    expect(refreshProject).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '刷新项目状态' }))
    await waitFor(() => expect(refreshProject).toHaveBeenCalledTimes(2))
    expect((await screen.findAllByText('当前版本已保存')).length).toBeGreaterThan(0)
    expect(screen.queryByText('工作区状态待检查')).not.toBeInTheDocument()
  })

  it('keeps an explicitly checked dirty project dirty after saving a different project', async () => {
    const otherProject: Project = { ...project, id: 'project-2', name: '第二个项目', path: 'C:/second-project', worktreeStatus: 'unknown' }
    const api = mockApi({
      listProjects: vi.fn(() => success<Project[]>([{ ...project, worktreeStatus: 'unknown' }, otherProject])),
      refreshProject: vi.fn((id) => success<Project>(id === project.id ? { ...project, hasUnsavedChanges: true, worktreeStatus: 'checked' } : { ...otherProject, worktreeStatus: 'checked' }))
    })
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)
    expect((await screen.findAllByText('有尚未保存的修改')).length).toBeGreaterThan(0)
    await user.click((await screen.findAllByRole('button', { name: /第二个项目/ })).at(-1)!)
    await user.click(screen.getByRole('button', { name: '创建保存点' }))
    await user.click(screen.getByRole('button', { name: '保存当前版本' }))
    await waitFor(() => expect(api.listProjects).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: '所有项目' }))
    const dirtyCard = screen.getAllByRole('button', { name: /我的 AI 项目/ }).at(-1)!
    expect(within(dirtyCard).getByText('有尚未保存的修改')).toBeInTheDocument()
    expect(within(dirtyCard).queryByText('当前版本已保存')).not.toBeInTheDocument()
  })

  it('clears the previous project timeline and ignores a late refresh after switching projects', async () => {
    const otherProject = { ...project, id: 'project-2', name: '第二个项目', path: 'C:/second-project' }
    const otherCheckpoint = { ...checkpoint, id: 'checkpoint-2', projectId: otherProject.id, title: '第二个项目的保存点', taskText: '另一个项目的任务' }
    const oldRefresh = deferred<ApiResult<Checkpoint[]>>()
    const otherTimeline = deferred<ApiResult<Checkpoint[]>>()
    const listCheckpoints = vi.fn()
      .mockImplementationOnce(() => success([checkpoint]))
      .mockImplementationOnce(() => oldRefresh.promise)
      .mockImplementationOnce(() => otherTimeline.promise)
    window.vibegit = mockApi({ listProjects: vi.fn(() => success([project, otherProject])), refreshProject: vi.fn((id) => success(id === project.id ? project : otherProject)), listCheckpoints })
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    expect(await screen.findByRole('button', { name: /邮箱验证码登录/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '刷新项目状态' }))
    await waitFor(() => expect(listCheckpoints).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: /第二个项目/ }))
    expect(screen.queryByRole('button', { name: /邮箱验证码登录/ })).not.toBeInTheDocument()
    expect(screen.getByText('正在读取保存记录…')).toBeInTheDocument()
    await act(async () => otherTimeline.resolve({ ok: true, data: [otherCheckpoint] }))
    expect(await screen.findByRole('button', { name: /第二个项目的保存点/ })).toBeInTheDocument()
    await act(async () => oldRefresh.resolve({ ok: true, data: [checkpoint] }))
    expect(screen.getByRole('button', { name: /第二个项目的保存点/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /邮箱验证码登录/ })).not.toBeInTheDocument()
  })

  it('shows a retryable timeline error instead of claiming there are no checkpoints', async () => {
    const listCheckpoints = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error('保存记录读取失败')))
      .mockImplementation(() => success([checkpoint]))
    window.vibegit = mockApi({ listProjects: vi.fn(() => success([project])), listCheckpoints })
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    expect(await screen.findByRole('alert')).toHaveTextContent('保存记录暂时无法读取')
    expect(screen.queryByText('时间线还很安静')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新读取' }))
    expect(await screen.findByRole('button', { name: /邮箱验证码登录/ })).toBeInTheDocument()
  })

  it('keeps a newly opened checkpoint diff when an earlier request finishes late', async () => {
    window.localStorage.setItem('vibegit.change-presentation', 'code')
    const otherCheckpoint = { ...checkpoint, id: 'checkpoint-2', title: '后来的保存点', taskText: '第二轮修改' }
    const firstDiff = deferred<ApiResult<CheckpointDiff>>()
    const makeDiff = (patch: string): CheckpointDiff => ({ fromObjectId: 'old', toObjectId: 'new', insertions: 1, deletions: 0, files: [{ path: 'src/app.ts', kind: 'modified', patch, binary: false, insertions: 1, deletions: 0 }] })
    window.vibegit = mockApi({
      listProjects: vi.fn(() => success([project])), listCheckpoints: vi.fn(() => success([checkpoint, otherCheckpoint])),
      getCheckpointDiff: vi.fn((id) => id === checkpoint.id ? firstDiff.promise : success(makeDiff('+正确的后一个保存点')))
    })
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    await user.click(await screen.findByRole('button', { name: /邮箱验证码登录/ }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /后来的保存点/ }))
    expect(await screen.findByText('+正确的后一个保存点')).toBeInTheDocument()
    await act(async () => firstDiff.resolve({ ok: true, data: makeDiff('+过期的前一个保存点') }))
    expect(screen.getByText('+正确的后一个保存点')).toBeInTheDocument()
    expect(screen.queryByText('+过期的前一个保存点')).not.toBeInTheDocument()
  })

  it('lets users inspect code directly when a feature summary is unavailable and retry a failed diff', async () => {
    const getCheckpointDiff = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error('暂时无法读取差异')))
      .mockImplementation(() => success<CheckpointDiff>({ fromObjectId: 'old', toObjectId: 'new', insertions: 0, deletions: 0, files: [] }))
    window.vibegit = mockApi({ listProjects: vi.fn(() => success([project])), listCheckpoints: vi.fn(() => success([checkpoint])), getCheckpointDiff })
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    await user.click(await screen.findByRole('button', { name: /邮箱验证码登录/ }))
    expect(await screen.findByText('这次还没有功能说明')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '代码变更' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取差异')
    expect(screen.queryByText('这个保存点没有文件内容变化')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新读取代码变更' }))
    expect(await screen.findByText('这个保存点没有文件内容变化')).toBeInTheDocument()
  })

  it('traps dialog focus, restores it on Escape, and prevents dismissing an in-flight save', async () => {
    const pendingSave = deferred<ApiResult<Checkpoint>>()
    const api = mockApi({ listProjects: vi.fn(() => success([project])), createCheckpoint: vi.fn(() => pendingSave.promise) })
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    const trigger = screen.getByRole('button', { name: '创建保存点' })
    await user.click(trigger)
    let dialog = screen.getByRole('dialog', { name: '创建保存点' })
    expect(within(dialog).getByRole('textbox', { name: '给这个版本一个容易记住的名字' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(within(dialog).getByRole('button', { name: '关闭' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(within(dialog).getByRole('button', { name: '保存当前版本' })).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: '关闭' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    dialog = screen.getByRole('dialog', { name: '创建保存点' })
    await user.click(within(dialog).getByRole('button', { name: '保存当前版本' }))
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: '关闭' })).toBeDisabled()
    await user.keyboard('{Escape}')
    fireEvent.mouseDown(dialog.parentElement!)
    expect(screen.getByRole('dialog', { name: '创建保存点' })).toBeInTheDocument()
    expect(api.createCheckpoint).toHaveBeenCalledTimes(1)
    await act(async () => pendingSave.resolve({ ok: true, data: checkpoint }))
    expect(await screen.findByText('当前版本已安全保存')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not report a failed safety scan as safe or retry without user action', async () => {
    const githubScan = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error('安全扫描失败')))
      .mockImplementation(() => success({ scannedAt: new Date().toISOString(), scannedFiles: 1, blocked: false, risks: [] }))
    window.vibegit = mockApi({
      listProjects: vi.fn(() => success([{ ...project, githubRemoteUrl: 'git@github.com:test/repo.git' }])),
      refreshProject: vi.fn(() => success({ ...project, githubRemoteUrl: 'git@github.com:test/repo.git' })),
      githubStatus: vi.fn(() => success({ installed: true, authenticated: true, sshKeyReady: true, message: '已连接' })), githubScan
    })
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    await user.click(screen.getByRole('button', { name: 'GitHub 备份' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('备份安全检查未完成')
    expect(screen.queryByText('未发现阻止备份的风险')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '安全备份到 GitHub' })).toBeDisabled()
    expect(githubScan).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '重新检查' }))
    expect(await screen.findByText('未发现阻止备份的风险')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '安全备份到 GitHub' })).toBeEnabled()
    expect(githubScan).toHaveBeenCalledTimes(2)
  })

  it('surfaces data-directory read failures without leaving a permanent loading label', async () => {
    window.vibegit = mockApi({ getSettings: vi.fn(() => Promise.reject(new Error('无法读取记录位置'))) })
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /设置与连接/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取记录位置')
    expect(screen.getByText('读取失败')).toBeInTheDocument()
  })

  it('supports keyboard navigation and dismissal in checkpoint action menus', async () => {
    window.vibegit = mockApi({ listProjects: vi.fn(() => success([project])), listCheckpoints: vi.fn(() => success([checkpoint])) })
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    const trigger = await screen.findByRole('button', { name: '打开保存点操作菜单' })
    await user.click(trigger)
    expect(screen.getByRole('menuitem', { name: '重命名保存点' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: '删除保存点' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('reports unavailable window controls instead of silently succeeding', async () => {
    window.vibegit = mockApi({ minimizeWindow: vi.fn(() => Promise.resolve<ApiResult<boolean>>({ ok: false, error: { code: 'BROWSER_WINDOW_CONTROL_UNAVAILABLE', message: '浏览器兼容模式不支持桌面窗口操作', retryable: false } })) })
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: '最小化窗口' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('浏览器兼容模式不支持桌面窗口操作')
  })

  it('provides custom frameless window controls', async () => {
    const api = mockApi()
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '最小化窗口' }))
    await user.click(screen.getByRole('button', { name: '最大化或还原窗口' }))
    await user.click(screen.getByRole('button', { name: '关闭窗口' }))

    expect(api.minimizeWindow).toHaveBeenCalledTimes(1)
    expect(api.toggleMaximizeWindow).toHaveBeenCalledTimes(1)
    expect(api.closeWindow).toHaveBeenCalledTimes(1)
  })

  it('persists the selected display language and switches Arabic to right-to-left layout', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /设置与连接/ }))
    const languageSelect = await screen.findByLabelText('显示语言')
    expect(languageSelect).toHaveValue('zh-CN')

    await user.selectOptions(languageSelect, 'ar')
    expect(window.localStorage.getItem('vibegit.display-language')).toBe('ar')
    expect(document.documentElement.lang).toBe('ar')
    expect(document.documentElement.dir).toBe('rtl')
  })

  it('translates visible interface labels when English is selected', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /设置与连接/ }))
    await user.selectOptions(await screen.findByLabelText('显示语言'), 'en')

    expect(await screen.findByText('All projects')).toBeInTheDocument()
    expect(await screen.findByText('Environment setup')).toBeInTheDocument()
    expect(await screen.findByText('Local save engine is ready')).toBeInTheDocument()
    expect(await screen.findByText('Block force pushes')).toBeInTheDocument()
  })

  it('translates the timeline labels and dynamic counts after changing language', async () => {
    window.vibegit = mockApi({ listProjects: vi.fn(() => success([project])), listCheckpoints: vi.fn(() => success([checkpoint])) })
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /设置与连接/ }))
    await user.selectOptions(await screen.findByLabelText('显示语言'), 'en')
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    expect(await screen.findByText('Project timeline')).toBeInTheDocument()
    expect(await screen.findByText('1 checkpoints')).toBeInTheDocument()
  })

  it('applies a saved language when the app starts', () => {
    window.localStorage.setItem('vibegit.display-language', 'ar')
    render(<App />)

    expect(document.documentElement.lang).toBe('ar')
    expect(document.documentElement.dir).toBe('rtl')
  })

  it('lets a user choose the next local record directory', async () => {
    const api = mockApi({ selectDataDirectory: vi.fn(() => success('D:\\VibeGit Records')) })
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /设置与连接/ }))
    await user.click(await screen.findByRole('button', { name: '选择文件夹' }))

    expect(api.setDataDirectory).toHaveBeenCalledWith('D:\\VibeGit Records')
    expect(await screen.findByText(/重启 VibeGit 后会使用该位置/)).toBeInTheDocument()
  })

  it('shows project backup removal controls only in management mode and requires confirmation', async () => {
    const api = mockApi({ listProjects: vi.fn(() => success([project])) })
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '管理项目备份' }))
    await user.click(screen.getByRole('button', { name: `删除 ${project.name} 的本地备份` }))
    expect(await screen.findByRole('dialog', { name: /移除/ })).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: '删除本地备份' })
    expect(confirm).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /我了解/ }))
    await user.click(confirm)
    expect(api.removeProject).toHaveBeenCalledWith(project.id)
  })

  it('checks the environment and reports detected tools', async () => {
    const api = mockApi()
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /设置与连接/ }))
    await user.click(await screen.findByRole('button', { name: '检测配置环境' }))

    expect(api.checkEnvironment).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/GitHub CLI：已就绪/)).toBeInTheDocument()
  })

  it('prompts for the VibeGit change-summary skill when an installed Agent is missing it', async () => {
    const api = mockApi({
      checkEnvironment: vi.fn(() => success({
        github: { installed: true, authenticated: false, message: 'ready' },
        agents: {
          codex: { installed: true, integration: 'template' as const, detail: '已检测', detection: 'path' as const },
          claudeCode: { installed: false, integration: 'not_configured' as const, detail: '未检测', detection: 'not-found' as const }
        },
        changeSummarySkill: {
          ready: false,
          codex: { available: true, installed: false },
          claudeCode: { available: false, installed: false },
          deploymentCommand: 'Install the VibeGit Change Summary skill for Codex.'
        },
        githubCliInstallAttempted: false,
        githubCliInstalled: false,
        message: 'ready'
      }))
    })
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /设置与连接/ }))
    await user.click(await screen.findByRole('button', { name: '检测配置环境' }))

    expect(api.checkEnvironment).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/待部署|Needs installation/)).toBeInTheDocument()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('VibeGit Change Summary skill for Codex.')
    expect(screen.getByRole('button', { name: /英文部署指令|English deployment instruction/ })).toBeInTheDocument()
  })

  it('explains that browser compatibility mode cannot select a local folder', async () => {
    const api = mockApi({
      selectProjectDirectory: vi.fn(() => Promise.resolve<ApiResult<string | null>>({
        ok: false,
        error: {
          code: 'BROWSER_FOLDER_PICKER_UNAVAILABLE',
          message: '浏览器兼容模式无法安全读取电脑中的文件夹路径',
          remediation: '请使用 VibeGit 桌面版启动程序，然后点击“选择项目文件夹”。',
          retryable: false
        }
      }))
    })
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /选择项目文件夹/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('浏览器兼容模式无法安全读取电脑中的文件夹路径')
    expect(api.addProject).not.toHaveBeenCalled()
  })

  it('starts GitHub browser authorization and SSH setup from one button', async () => {
    const api = mockApi({
      listProjects: vi.fn(() => success([project])),
      listCheckpoints: vi.fn(() => success([checkpoint])),
      githubStatus: vi.fn(() => success({
        installed: true,
        authenticated: false,
        sshKeyReady: false,
        message: '尚未连接 GitHub；点击下方按钮即可在浏览器中授权'
      }))
    })
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)

    const projectButtons = await screen.findAllByRole('button', { name: /我的 AI 项目/ })
    await user.click(projectButtons.at(-1)!)
    await user.click(screen.getByRole('button', { name: 'GitHub 备份' }))
    await user.click(await screen.findByRole('button', { name: '连接 GitHub 并创建 SSH 密钥' }))

    await waitFor(() => expect(api.githubAuthorize).toHaveBeenCalledTimes(1))
  })

  it('keeps GitHub authorization available during a slow scan and shows only safe device instructions', async () => {
    const pendingScan = deferred<ApiResult<SensitiveScanResult>>()
    const pendingAuthorization = deferred<ApiResult<GitHubOnboardingResult>>()
    const api = mockApi({
      listProjects: vi.fn(() => success([project])),
      githubStatus: vi.fn(() => success({ installed: true, authenticated: false, sshKeyReady: false, message: '尚未登录' })),
      githubScan: vi.fn(() => pendingScan.promise),
      githubAuthorize: vi.fn(() => pendingAuthorization.promise),
      githubAuthorizationStatus: vi.fn(() => success<GitHubAuthorizationState>({ phase: 'authorizing', message: 'RAW_OUTPUT_DO_NOT_RENDER', userCode: 'ABCD-1234', verificationUri: 'https://untrusted.example/device' }))
    })
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    await user.click(screen.getByRole('button', { name: 'GitHub 备份' }))
    const connect = await screen.findByRole('button', { name: '连接 GitHub 并创建 SSH 密钥' })
    expect(connect).toBeEnabled()
    expect(screen.getByText('正在扫描项目文件，连接 GitHub 无需等待扫描完成…')).toBeInTheDocument()
    expect(screen.queryByText('未发现阻止备份的风险')).not.toBeInTheDocument()
    await user.click(connect)
    expect(await screen.findByText('ABCD-1234')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开 GitHub 授权页面' })).toHaveAttribute('href', 'https://github.com/login/device')
    expect(screen.queryByText('RAW_OUTPUT_DO_NOT_RENDER')).not.toBeInTheDocument()
    await user.click(connect)
    await user.keyboard('{Escape}')
    expect(api.githubAuthorize).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'GitHub 私有备份' })).toBeInTheDocument()
    await act(async () => pendingAuthorization.resolve({ ok: true, data: { username: 'test-user', sshKeyCreated: true, message: 'GitHub 已连接' } }))
    await waitFor(() => expect(screen.queryByText('ABCD-1234')).not.toBeInTheDocument())
    expect(api.githubScan).toHaveBeenCalledTimes(1)
  })

  it('keeps a repair action for an already prepared SSH connection', async () => {
    window.vibegit = mockApi({
      listProjects: vi.fn(() => success([project])),
      githubStatus: vi.fn(() => success({ installed: true, authenticated: true, sshKeyReady: true, username: 'test-user', message: '已准备好' }))
    })
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    await user.click(screen.getByRole('button', { name: 'GitHub 备份' }))
    await user.click(await screen.findByRole('button', { name: '检查并修复 GitHub 连接' }))
    await waitFor(() => expect(window.vibegit.githubAuthorize).toHaveBeenCalledTimes(1))
  })

  it('does not misreport or repeat a successful upload when refreshing the local list fails', async () => {
    const connectedProject: Project = { ...project, githubRemoteUrl: 'git@github.com:test/repo.git', githubSyncStatus: 'pending' }
    const pendingPush = deferred<ApiResult<GitHubSyncResult>>()
    const listProjects = vi.fn()
      .mockImplementationOnce(() => success([connectedProject]))
      .mockImplementation(() => Promise.reject(new Error('本地列表读取失败')))
    const api = mockApi({
      listProjects,
      refreshProject: vi.fn(() => success(connectedProject)),
      githubStatus: vi.fn(() => success({ installed: true, authenticated: true, sshKeyReady: true, message: '已连接' })),
      githubPush: vi.fn(() => pendingPush.promise)
    })
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    await user.click(screen.getByRole('button', { name: 'GitHub 备份' }))
    const push = await screen.findByRole('button', { name: '安全备份到 GitHub' })
    await waitFor(() => expect(push).toBeEnabled())
    await user.click(push)
    await user.click(push)
    await user.keyboard('{Escape}')
    expect(api.githubPush).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'GitHub 私有备份' })).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getAllByRole('button', { name: '关闭' }).every((button) => button.hasAttribute('disabled'))).toBe(true)
    await act(async () => pendingPush.resolve({ ok: true, data: { remoteUrl: connectedProject.githubRemoteUrl!, checkpointId: checkpoint.id, syncedAt: new Date().toISOString(), branch: 'vibegit-backup' } }))
    expect(await screen.findByText(/但本地列表暂未刷新；操作已完成，无需重复提交/)).toBeInTheDocument()
    expect(screen.getByText('本次备份已完成，已同步到 GitHub。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '本次备份已完成' })).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(api.githubPush).toHaveBeenCalledTimes(1)
    expect(api.githubScan).toHaveBeenCalledTimes(1)
  })

  it('shows a failed backup separately from pending or successful synchronization', async () => {
    const failedProject: Project = { ...project, githubRemoteUrl: 'git@github.com:test/repo.git', githubSyncStatus: 'failed' }
    window.vibegit = mockApi({ listProjects: vi.fn(() => success([failedProject])), refreshProject: vi.fn(() => success(failedProject)) })
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('上次 GitHub 备份失败')).toBeInTheDocument()
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    expect(screen.getByText('上次备份失败')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'GitHub 备份' }))
    expect(within(screen.getByRole('dialog')).getByText('上次备份失败')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).queryByText('等待同步')).not.toBeInTheDocument()
  })

  it('opens a real checkpoint diff and completes the confirmed restore/undo flow', async () => {
    window.localStorage.setItem('vibegit.change-presentation', 'code')
    const api = mockApi({
      listProjects: vi.fn(() => success([project])),
      listCheckpoints: vi.fn(() => success([checkpoint]))
    })
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)
    const projectButtons = await screen.findAllByRole('button', { name: /我的 AI 项目/ })
    await user.click(projectButtons.at(-1)!)
    await user.click(await screen.findByRole('button', { name: /邮箱验证码登录/ }))
    expect(await screen.findByText('当时交给 Agent 的任务')).toBeInTheDocument()
    expect(await screen.findByText('+added')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '回到这个版本' }))
    expect(await screen.findByRole('dialog', { name: /回到“邮箱验证码登录”/ })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /我已了解/ }))
    await user.click(screen.getByRole('button', { name: /确认并安全回退/ }))
    expect(await screen.findByText('已回到所选版本；回退前内容仍可找回')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /撤销本次回退/ }))
    expect(await screen.findByText('已撤销本次回退，文件恢复到回退前状态')).toBeInTheDocument()
    await waitFor(() => expect(api.executeRestore).toHaveBeenCalledWith('restore-token'))
    expect(api.undoRestore).toHaveBeenCalledWith('restore-1')
  })

  it('refreshes the restored project when undo is used after switching projects', async () => {
    const otherProject = { ...project, id: 'project-2', name: '第二个项目', path: 'C:/second-project' }
    const refreshProject = vi.fn((id: string) => success(id === project.id ? project : otherProject))
    const api = mockApi({
      listProjects: vi.fn(() => success([project, otherProject])), refreshProject,
      listCheckpoints: vi.fn((id) => success(id === project.id ? [checkpoint] : []))
    })
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    await user.click(await screen.findByRole('button', { name: /邮箱验证码登录/ }))
    await user.click(screen.getByRole('button', { name: '回到这个版本' }))
    await user.click(await screen.findByRole('checkbox', { name: /我已了解/ }))
    await user.click(screen.getByRole('button', { name: /确认并安全回退/ }))
    await screen.findByText('已回到所选版本；回退前内容仍可找回')
    await user.click(screen.getByRole('button', { name: '关闭详情' }))
    await user.click(screen.getByRole('button', { name: /第二个项目/ }))
    await waitFor(() => expect(refreshProject).toHaveBeenCalledWith(otherProject.id))
    refreshProject.mockClear()
    await user.click(screen.getByRole('button', { name: /撤销本次回退/ }))
    await waitFor(() => expect(refreshProject).toHaveBeenCalledWith(project.id))
    expect(refreshProject).not.toHaveBeenCalledWith(otherProject.id)
    expect(screen.getByRole('heading', { name: '第二个项目' })).toBeInTheDocument()
  })

  it('keeps failed shelf reads distinct from an empty shelf and allows an explicit retry', async () => {
    const shelf: ShelvedChange = { id: 'shelf-1', projectId: project.id, checkpointId: checkpoint.id, restoreId: 'restore-1', title: '稍后取回的修改', createdAt: new Date().toISOString(), status: 'active' }
    const listShelves = vi.fn().mockRejectedValueOnce(new Error('暂存数据库忙')).mockImplementation(() => success([shelf]))
    window.vibegit = mockApi({ listProjects: vi.fn(() => success([project])), listShelves })
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    await user.click(screen.getByRole('button', { name: '暂时收起' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('暂存记录暂时无法读取')
    expect(screen.queryByText('还没有暂时收起的修改')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新读取暂存记录' }))
    expect(await screen.findByText('稍后取回的修改')).toBeInTheDocument()
    expect(listShelves).toHaveBeenCalledTimes(2)
  })

  it('keeps a successful shelf retrieval successful when the project list refresh fails', async () => {
    const shelf: ShelvedChange = { id: 'shelf-1', projectId: project.id, checkpointId: checkpoint.id, restoreId: 'restore-1', title: '稍后取回的修改', createdAt: new Date().toISOString(), status: 'active' }
    const api = mockApi({
      listProjects: vi.fn().mockImplementationOnce(() => success([project])).mockRejectedValue(new Error('列表读取失败')),
      listShelves: vi.fn().mockImplementationOnce(() => success([shelf])).mockImplementation(() => success([]))
    })
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    await user.click(screen.getByRole('button', { name: '暂时收起' }))
    await user.click(await screen.findByRole('button', { name: '取回修改' }))
    expect(await screen.findByText('已取回“稍后取回的修改”')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('修改操作已完成，但项目列表暂未刷新')
    expect(screen.queryByRole('button', { name: '取回修改' })).not.toBeInTheDocument()
    expect(api.retrieveShelf).toHaveBeenCalledTimes(1)
  })

  it('opens checkpoint management without opening the diff, then renames and confirms deletion', async () => {
    const api = mockApi({
      listProjects: vi.fn(() => success([project])),
      listCheckpoints: vi.fn(() => success([checkpoint]))
    })
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)

    const projectButtons = await screen.findAllByRole('button', { name: /我的 AI 项目/ })
    await user.click(projectButtons.at(-1)!)
    await user.click(await screen.findByRole('button', { name: '打开保存点操作菜单' }))
    expect(api.getCheckpointDiff).not.toHaveBeenCalled()

    await user.click(screen.getByRole('menuitem', { name: '重命名保存点' }))
    const title = await screen.findByRole('textbox', { name: '保存点名称' })
    await user.clear(title)
    await user.type(title, '登录体验优化')
    await user.click(screen.getByRole('button', { name: '保存名称' }))
    await waitFor(() => expect(api.renameCheckpoint).toHaveBeenCalledWith(checkpoint.id, '登录体验优化'))

    await user.click(await screen.findByRole('button', { name: '打开保存点操作菜单' }))
    await user.click(screen.getByRole('menuitem', { name: '删除保存点' }))
    const deleteButton = await screen.findByRole('button', { name: '确认删除保存点' })
    expect(deleteButton).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: '我已了解，确认删除这个保存点' }))
    await user.click(deleteButton)
    await waitFor(() => expect(api.deleteCheckpoint).toHaveBeenCalledWith(checkpoint.id))
  })

  it('shows a plain-language feature summary by default and lets users switch to code changes', async () => {
    const summaryCheckpoint: Checkpoint = {
      ...checkpoint,
      metadata: { featureSummary: { overview: '用户现在可以用邮箱验证码登录。', added: ['邮箱验证码登录'], improved: ['登录失败提示'], removed: ['旧的临时登录入口'] } }
    }
    window.vibegit = mockApi({
      listProjects: vi.fn(() => success([project])),
      listCheckpoints: vi.fn(() => success([summaryCheckpoint]))
    })
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: /我的 AI 项目/ })).at(-1)!)
    await user.click(await screen.findByRole('button', { name: /邮箱验证码登录/ }))
    expect((await screen.findAllByText('用户现在可以用邮箱验证码登录。')).length).toBeGreaterThan(0)
    expect(screen.queryByText('+added')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /设置与连接/ }))
    await user.click(await screen.findByRole('radio', { name: /代码变更/ }))
    expect(window.localStorage.getItem('vibegit.change-presentation')).toBe('code')
    expect(await screen.findByText('+added')).toBeInTheDocument()
  })

  it('renders a safe error state instead of failing silently', async () => {
    window.vibegit = mockApi({
      selectProjectDirectory: vi.fn(() => Promise.resolve<ApiResult<string | null>>({ ok: false, error: { code: 'DIALOG_FAILED', message: '无法打开文件夹选择器', remediation: '请重试', retryable: true } }))
    })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /选择项目文件夹/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('无法打开文件夹选择器')
  })

  it('shows an Agent task that completed without file changes', async () => {
    const noChangeEvent: AgentEventRecord = {
      id: 'event-no-change',
      projectId: project.id,
      event: 'task-end',
      agent: 'codex',
      taskText: '检查登录流程',
      createdAt: new Date().toISOString(),
      message: '任务完成，但没有检测到文件变化'
    }
    const api = mockApi({
      listProjects: vi.fn(() => success([project])),
      listCheckpoints: vi.fn(() => success([checkpoint])),
      listAgentEvents: vi.fn(() => success([noChangeEvent]))
    })
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)
    const projectButtons = await screen.findAllByRole('button', { name: /我的 AI 项目/ })
    await user.click(projectButtons.at(-1)!)
    await waitFor(() => expect(api.listAgentEvents).toHaveBeenCalledWith(project.id))
    expect(await screen.findByText('任务完成，但没有检测到文件变化')).toBeInTheDocument()
    expect(screen.getByText(/检查登录流程/)).toBeInTheDocument()
  })

  it('keeps a failed restore recovery area reachable from the project screen', async () => {
    const failedRestore: RestoreRecord = {
      id: 'failed-restore', projectId: project.id, targetCheckpointId: checkpoint.id,
      insuranceCheckpointId: 'insurance', createdAt: new Date().toISOString(),
      status: 'failed', recoveryDirectory: 'C:\\VibeGit\\recovery\\failed-restore', errorCode: 'RESTORE_FAILED'
    }
    const api = mockApi({
      listProjects: vi.fn(() => success([project])),
      listCheckpoints: vi.fn(() => success([checkpoint])),
      listFailedRestores: vi.fn(() => success([failedRestore]))
    })
    window.vibegit = api
    const user = userEvent.setup()
    render(<App />)
    const projectButtons = await screen.findAllByRole('button', { name: /我的 AI 项目/ })
    await user.click(projectButtons.at(-1)!)
    await waitFor(() => expect(api.listFailedRestores).toHaveBeenCalledWith(project.id))
    await user.click(await screen.findByRole('button', { name: '打开恢复区' }))
    expect(api.openRecoveryDirectory).toHaveBeenCalledWith('failed-restore')
  })
})
