import {
  VibeGitError,
  fail,
  type ApiResult,
  type VibeGitApi
} from '@vibegit/shared'

async function invoke<T>(method: keyof VibeGitApi, args: unknown[] = []): Promise<ApiResult<T>> {
  try {
    const response = await fetch('/api/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, args })
    })
    if (!response.ok) {
      throw new VibeGitError('BROWSER_API_UNAVAILABLE', '本机 VibeGit 服务暂时无法访问', {
        remediation: '请保留启动窗口并刷新页面。',
        retryable: true
      })
    }
    return await response.json() as ApiResult<T>
  } catch (error) {
    return fail(error)
  }
}

const browserWindow = window as unknown as Window & { vibegit?: VibeGitApi }

if (!browserWindow.vibegit) {
  const api: VibeGitApi = {
    health: () => invoke('health'),
    selectProjectDirectory: () => invoke('selectProjectDirectory'),
    listProjects: () => invoke('listProjects'),
    addProject: (input) => invoke('addProject', [input]),
    refreshProject: (projectId) => invoke('refreshProject', [projectId]),
    initializeProtection: (projectId) => invoke('initializeProtection', [projectId]),
    listCheckpoints: (projectId) => invoke('listCheckpoints', [projectId]),
    createCheckpoint: (input) => invoke('createCheckpoint', [input]),
    getCheckpointDiff: (checkpointId) => invoke('getCheckpointDiff', [checkpointId]),
    prepareRestore: (projectId, checkpointId) => invoke('prepareRestore', [projectId, checkpointId]),
    executeRestore: (token) => invoke('executeRestore', [token]),
    undoRestore: (restoreId) => invoke('undoRestore', [restoreId]),
    failedRestoreForToken: (token) => invoke('failedRestoreForToken', [token]),
    listFailedRestores: (projectId) => invoke('listFailedRestores', [projectId]),
    openRecoveryDirectory: (restoreId) => invoke('openRecoveryDirectory', [restoreId]),
    listShelves: (projectId) => invoke('listShelves', [projectId]),
    createShelf: (projectId, title) => invoke('createShelf', [projectId, title]),
    retrieveShelf: (shelfId) => invoke('retrieveShelf', [shelfId]),
    githubStatus: () => invoke('githubStatus'),
    githubAuthorize: () => invoke('githubAuthorize'),
    githubScan: (projectId) => invoke('githubScan', [projectId]),
    githubCreatePrivate: (input) => invoke('githubCreatePrivate', [input]),
    githubConnect: (input) => invoke('githubConnect', [input]),
    githubPush: (projectId) => invoke('githubPush', [projectId]),
    githubIgnoreRisk: (projectId, risk) => invoke('githubIgnoreRisk', [projectId, risk]),
    agentStatus: () => invoke('agentStatus'),
    listAgentEvents: (projectId) => invoke('listAgentEvents', [projectId]),
    getSettings: () => invoke('getSettings')
  }
  browserWindow.vibegit = api
}
