import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defaultDataDirectory, saveDataDirectoryPreference, VibeGitService } from '@vibegit/core'
import {
  fail,
  IPC_CHANNELS,
  ok,
  toPublicError,
  type AddProjectInput,
  type ConnectRemoteInput,
  type CreateCheckpointInput,
  type CreatePrivateRepositoryInput,
  type EnvironmentCheckResult,
  type SensitiveRisk,
  type VibeGitApi
} from '@vibegit/shared'

import { validateApiArguments } from '../api-validation'
import { ServiceLifecycle } from './service-lifecycle'
import { InstallationRunner } from './installation-runner'

const services = new ServiceLifecycle<VibeGitService>()
const installation = new InstallationRunner()
let mainWindow: BrowserWindow | undefined
let diagnosticsPath = ''

async function installGitHubCli(): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Automatic GitHub CLI installation is currently available on Windows only')
  const result = await installation.run('winget.exe', [
    'install', '--id', 'GitHub.cli', '--exact', '--silent',
    '--accept-package-agreements', '--accept-source-agreements'
  ])
  const alreadyInstalled = /already installed|no available upgrade/i.test(result.output)
  if (result.code !== 0 && !alreadyInstalled) throw new Error(`GitHub CLI installation failed: ${result.output || `exit code ${result.code}`}`)
}

function rendererEntryPath(): string {
  return join(__dirname, '../renderer/index.html')
}

function applicationIconPath(): string {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(root, 'assets', 'branding', 'vibegit-app-icon-rounded.png')
}

function developmentRendererUrl(): URL | undefined {
  if (app.isPackaged || process.env.NODE_ENV !== 'development' || !process.env.ELECTRON_RENDERER_URL) return undefined
  try {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
    return loopback && (url.protocol === 'http:' || url.protocol === 'https:') ? url : undefined
  } catch {
    return undefined
  }
}

function allowedRendererUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    url.hash = ''
    const developmentUrl = developmentRendererUrl()
    if (developmentUrl) return url.origin === developmentUrl.origin
    return url.href === pathToFileURL(rendererEntryPath()).href
  } catch {
    return false
  }
}

function trustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  const trusted = Boolean(
    mainWindow &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === event.sender.mainFrame &&
    allowedRendererUrl(url)
  )
  if (!trusted) throw new Error('Rejected IPC from an untrusted renderer')
}

async function diagnostic(event: string, detail: Record<string, unknown> = {}): Promise<void> {
  if (!diagnosticsPath) return
  const safe = JSON.stringify({ timestamp: new Date().toISOString(), event, ...detail }, (_key, value) => {
    if (typeof value === 'string' && value.length > 2_000) return `${value.slice(0, 2_000)}…`
    return value
  })
  try { await appendFile(diagnosticsPath, `${safe}\n`, 'utf8') } catch { /* Diagnostics must not crash the app. */ }
}

function registerHandler<TArgs extends unknown[], TResult>(
  method: keyof VibeGitApi,
  operation: (current: VibeGitService, ...args: TArgs) => Promise<TResult> | TResult
): void {
  const channel = IPC_CHANNELS[method]
  ipcMain.handle(channel, async (event, ...args: TArgs) => {
    try {
      trustedSender(event)
      const input = validateApiArguments(method, args) as TArgs
      return ok(await services.run((current) => operation(current, ...input)))
    } catch (error) {
      const publicError = toPublicError(error)
      await diagnostic('ipc-error', { channel, code: publicError.code, message: publicError.message })
      return fail(error)
    }
  })
}

function registerIpc(): void {
  registerHandler('health', (current) => current.health())
  registerHandler('selectProjectDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择要保护的项目文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  registerHandler('listProjects', (current) => current.listProjects())
  registerHandler('addProject', (current, input: AddProjectInput) => current.addProject(input))
  registerHandler('removeProject', (current, projectId: string) => current.removeProject(projectId))
  registerHandler('refreshProject', (current, projectId: string) => current.refreshProject(projectId))
  registerHandler('initializeProtection', (current, projectId: string) => current.initializeProtection(projectId))
  registerHandler('listCheckpoints', (current, projectId: string) => current.listCheckpoints(projectId))
  registerHandler('createCheckpoint', (current, input: CreateCheckpointInput) => current.createCheckpoint(input))
  registerHandler('renameCheckpoint', (current, checkpointId: string, title: string) => current.renameCheckpoint(checkpointId, title))
  registerHandler('deleteCheckpoint', (current, checkpointId: string) => current.deleteCheckpoint(checkpointId))
  registerHandler('getCheckpointDiff', (current, checkpointId: string) => current.getCheckpointDiff(checkpointId))
  registerHandler('prepareRestore', (current, projectId: string, checkpointId: string) => current.prepareRestore(projectId, checkpointId))
  registerHandler('executeRestore', (current, token: string) => current.executeRestore(token))
  registerHandler('undoRestore', (current, restoreId: string) => current.undoRestore(restoreId))
  registerHandler('failedRestoreForToken', (current, token: string) => current.getFailedRestoreForToken(token))
  registerHandler('listFailedRestores', (current, projectId: string) => current.listFailedRestores(projectId))
  registerHandler('openRecoveryDirectory', async (current, restoreId: string) => {
    const record = current.getRestore(restoreId)
    if (!record.recoveryDirectory) return false
    return (await shell.openPath(record.recoveryDirectory)) === ''
  })
  registerHandler('listShelves', (current, projectId: string) => current.listShelves(projectId))
  registerHandler('createShelf', (current, projectId: string, title: string) => current.createShelf(projectId, title))
  registerHandler('retrieveShelf', (current, shelfId: string) => current.retrieveShelf(shelfId))
  registerHandler('githubStatus', (current) => current.githubStatus())
  registerHandler('githubAuthorize', (current) => current.authorizeGitHub())
  registerHandler('githubAuthorizationStatus', (current) => current.githubAuthorizationStatus())
  registerHandler('githubScan', (current, projectId: string) => current.scanSensitiveFiles(projectId))
  registerHandler('githubCreatePrivate', (current, input: CreatePrivateRepositoryInput) => current.createPrivateRepository(input))
  registerHandler('githubConnect', (current, input: ConnectRemoteInput) => current.connectRemote(input))
  registerHandler('githubPush', (current, projectId: string) => current.pushToGitHub(projectId))
  registerHandler('githubIgnoreRisk', (current, projectId: string, risk: SensitiveRisk) => current.ignoreSensitiveRisk(projectId, risk))
  registerHandler('minimizeWindow', () => { mainWindow?.minimize(); return true })
  registerHandler('toggleMaximizeWindow', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return true
  })
  registerHandler('closeWindow', () => { mainWindow?.close(); return true })
  registerHandler('agentStatus', (current) => current.agentStatus())
  registerHandler('listAgentEvents', (current, projectId: string) => current.listAgentEvents(projectId))
  registerHandler('getSettings', (current) => current.settings)
  registerHandler('selectDataDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择 VibeGit 本地记录位置',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  registerHandler('setDataDirectory', async (current, path: string) => {
    const dataDirectory = resolve(path)
    await mkdir(dataDirectory, { recursive: true })
    await saveDataDirectoryPreference(dataDirectory)
    return { dataDirectory, restartRequired: dataDirectory !== current.settings.dataDirectory }
  })
  let environmentCheck: Promise<EnvironmentCheckResult> | undefined
  registerHandler('checkEnvironment', (current) => {
    environmentCheck ??= (async () => {
      const githubBefore = await current.githubStatus()
      const githubCliInstallAttempted = !githubBefore.installed
      if (githubCliInstallAttempted) {
        await installGitHubCli()
        const { dataDirectory, commandTimeoutMs } = current.settings
        services.replace(new VibeGitService({ dataDirectory, commandTimeoutMs }))
      }
      return await services.run(async (updated) => {
        const github = githubCliInstallAttempted ? await updated.githubStatus() : githubBefore
        const agents = await updated.agentStatus({ scanAllDrives: true })
        const changeSummarySkill = await updated.changeSummarySkillStatus(agents)
        return {
          github, agents, changeSummarySkill, githubCliInstallAttempted,
          githubCliInstalled: githubCliInstallAttempted && github.installed,
          message: github.installed ? 'Environment check completed.' : 'GitHub CLI is not available.'
        }
      })
    })().finally(() => { environmentCheck = undefined })
    return environmentCheck
  })
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    backgroundColor: '#f4f2ed',
    title: 'VibeGit',
    icon: applicationIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'https://github.com/login/device') {
      void shell.openExternal(url).catch(() => diagnostic('github-authorization-page-open-failed'))
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!allowedRendererUrl(url)) event.preventDefault()
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => void diagnostic('did-fail-load', { code, description }))
  mainWindow.webContents.on('preload-error', (_event, _path, error) => void diagnostic('preload-error', { message: error.message }))
  mainWindow.webContents.on('render-process-gone', (_event, details) => void diagnostic('render-process-gone', { reason: details.reason }))
  mainWindow.on('unresponsive', () => void diagnostic('window-unresponsive'))

  const developmentUrl = developmentRendererUrl()
  if (developmentUrl) await mainWindow.loadURL(developmentUrl.href)
  else await mainWindow.loadFile(rendererEntryPath())
}

const ownsSingleInstanceLock = app.requestSingleInstanceLock()

if (!ownsSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.vibegit.desktop')
    const dataDirectory = defaultDataDirectory()
    await mkdir(join(dataDirectory, 'logs'), { recursive: true })
    diagnosticsPath = join(dataDirectory, 'logs', 'diagnostics.jsonl')
    services.replace(new VibeGitService({ dataDirectory }))
    registerIpc()
    await createWindow()
    await diagnostic('app-ready', { version: app.getVersion() })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  }).catch((error) => {
    void diagnostic('startup-failed', { message: error instanceof Error ? error.message : String(error) })
    app.quit()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  services.close()
})
