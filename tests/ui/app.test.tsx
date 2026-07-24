// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../apps/desktop/src/renderer/App'
import type {
  ApiResult,
  AgentEventRecord,
  AgentConnectionStatus,
  Checkpoint,
  CheckpointDiff,
  HealthStatus,
  Project,
  RestorePreview,
  RestoreRecord,
  ShelvedChange,
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

function mockApi(overrides: Partial<VibeGitApi> = {}): VibeGitApi {
  const completedRestore: RestoreRecord = { id: 'restore-1', projectId: project.id, targetCheckpointId: checkpoint.id, insuranceCheckpointId: 'insurance', createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), status: 'completed' }
  const undoneRestore: RestoreRecord = { id: 'restore-1', projectId: project.id, targetCheckpointId: checkpoint.id, insuranceCheckpointId: 'insurance', createdAt: new Date().toISOString(), undoneAt: new Date().toISOString(), status: 'undone' }
  const diff: CheckpointDiff = { fromObjectId: 'old', toObjectId: 'abc123', insertions: 2, deletions: 1, files: [{ path: 'src/app.ts', kind: 'modified', patch: '@@ -1 +1,2 @@\n-old\n+new\n+added', binary: false, insertions: 2, deletions: 1 }] }
  const agentStatus: AgentConnectionStatus = { codex: { installed: true, integration: 'template', detail: '已检测' }, claudeCode: { installed: false, integration: 'not_configured', detail: '未检测' } }
  const base: VibeGitApi = {
    health: vi.fn(() => success<HealthStatus>({ ready: true, database: 'ok', git: 'ok', version: '0.1.0' })),
    selectProjectDirectory: vi.fn(() => success(null)),
    listProjects: vi.fn(() => success([])),
    addProject: vi.fn(() => success(project)),
    removeProject: vi.fn(() => success({ projectId: project.id, removedCheckpoints: 1 })),
    refreshProject: vi.fn(() => success(project)),
    initializeProtection: vi.fn(() => success({ project, checkpoint })),
    listCheckpoints: vi.fn(() => success([])),
    createCheckpoint: vi.fn(() => success(checkpoint)),
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
          codex: { installed: true, integration: 'template' as const, detail: '已检测' },
          claudeCode: { installed: false, integration: 'not_configured' as const, detail: '未检测' }
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
