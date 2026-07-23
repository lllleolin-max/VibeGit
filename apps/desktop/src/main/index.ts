import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defaultDataDirectory, VibeGitService } from '@vibegit/core'
import {
  fail,
  IPC_CHANNELS,
  ok,
  toPublicError,
  type AddProjectInput,
  type ConnectRemoteInput,
  type CreateCheckpointInput,
  type CreatePrivateRepositoryInput,
  type SensitiveRisk
} from '@vibegit/shared'

let service: VibeGitService | undefined
let mainWindow: BrowserWindow | undefined
let diagnosticsPath = ''

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
  channel: string,
  operation: (...args: TArgs) => Promise<TResult> | TResult
): void {
  ipcMain.handle(channel, async (event, ...args: TArgs) => {
    try {
      trustedSender(event)
      return ok(await operation(...args))
    } catch (error) {
      const publicError = toPublicError(error)
      await diagnostic('ipc-error', { channel, code: publicError.code, message: publicError.message })
      return fail(error)
    }
  })
}

function requiredService(): VibeGitService {
  if (!service) throw new Error('VibeGit service is not ready')
  return service
}

function requireString(value: unknown, field: string, maxLength = 10_000): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) throw new Error(`${field} is invalid`)
  return value
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} is invalid`)
  return value as Record<string, unknown>
}

function requireOptionalString(value: unknown, field: string, maxLength: number): string | undefined {
  return value === undefined ? undefined : requireString(value, field, maxLength)
}

function registerIpc(): void {
  registerHandler(IPC_CHANNELS.health, () => requiredService().health())
  registerHandler(IPC_CHANNELS.selectProjectDirectory, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择要保护的项目文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  registerHandler(IPC_CHANNELS.listProjects, () => requiredService().listProjects())
  registerHandler(IPC_CHANNELS.addProject, (input: AddProjectInput) => {
    const record = requireRecord(input, 'input')
    const path = requireString(record.path, 'path')
    if (record.initialize !== undefined && typeof record.initialize !== 'boolean') throw new Error('initialize is invalid')
    return requiredService().addProject({ path, ...(record.initialize === true ? { initialize: true } : {}) })
  })
  registerHandler(IPC_CHANNELS.refreshProject, (projectId: string) => requiredService().refreshProject(requireString(projectId, 'projectId', 100)))
  registerHandler(IPC_CHANNELS.initializeProtection, (projectId: string) => requiredService().initializeProtection(requireString(projectId, 'projectId', 100)))
  registerHandler(IPC_CHANNELS.listCheckpoints, (projectId: string) => requiredService().listCheckpoints(requireString(projectId, 'projectId', 100)))
  registerHandler(IPC_CHANNELS.createCheckpoint, (input: CreateCheckpointInput) => {
    const record = requireRecord(input, 'input')
    const projectId = requireString(record.projectId, 'projectId', 100)
    const title = requireString(record.title, 'title', 160)
    if (record.type !== 'manual' && record.type !== 'stable') throw new Error('type is invalid')
    const note = requireOptionalString(record.note, 'note', 2_000)
    return requiredService().createCheckpoint({
      projectId,
      type: record.type,
      title,
      agent: 'manual',
      isStable: record.type === 'stable',
      ...(note ? { note } : {})
    })
  })
  registerHandler(IPC_CHANNELS.getCheckpointDiff, (checkpointId: string) => requiredService().getCheckpointDiff(requireString(checkpointId, 'checkpointId', 100)))
  registerHandler(IPC_CHANNELS.prepareRestore, (projectId: string, checkpointId: string) => requiredService().prepareRestore(
    requireString(projectId, 'projectId', 100),
    requireString(checkpointId, 'checkpointId', 100)
  ))
  registerHandler(IPC_CHANNELS.executeRestore, (token: string) => requiredService().executeRestore(requireString(token, 'token', 100)))
  registerHandler(IPC_CHANNELS.undoRestore, (restoreId: string) => requiredService().undoRestore(requireString(restoreId, 'restoreId', 100)))
  registerHandler(IPC_CHANNELS.failedRestoreForToken, (token: string) => requiredService().getFailedRestoreForToken(requireString(token, 'token', 100)))
  registerHandler(IPC_CHANNELS.listFailedRestores, (projectId: string) => requiredService().listFailedRestores(requireString(projectId, 'projectId', 100)))
  registerHandler(IPC_CHANNELS.openRecoveryDirectory, async (restoreId: string) => {
    const record = requiredService().getRestore(requireString(restoreId, 'restoreId', 100))
    if (!record.recoveryDirectory) return false
    return (await shell.openPath(record.recoveryDirectory)) === ''
  })
  registerHandler(IPC_CHANNELS.listShelves, (projectId: string) => requiredService().listShelves(requireString(projectId, 'projectId', 100)))
  registerHandler(IPC_CHANNELS.createShelf, (projectId: string, title: string) => requiredService().createShelf(
    requireString(projectId, 'projectId', 100),
    requireString(title, 'title', 160)
  ))
  registerHandler(IPC_CHANNELS.retrieveShelf, (shelfId: string) => requiredService().retrieveShelf(requireString(shelfId, 'shelfId', 100)))
  registerHandler(IPC_CHANNELS.githubStatus, () => requiredService().githubStatus())
  registerHandler(IPC_CHANNELS.githubAuthorize, () => requiredService().authorizeGitHub())
  registerHandler(IPC_CHANNELS.githubScan, (projectId: string) => requiredService().scanSensitiveFiles(requireString(projectId, 'projectId', 100)))
  registerHandler(IPC_CHANNELS.githubCreatePrivate, (input: CreatePrivateRepositoryInput) => {
    const record = requireRecord(input, 'input')
    const projectId = requireString(record.projectId, 'projectId', 100)
    const name = requireString(record.name, 'name', 100)
    const owner = requireOptionalString(record.owner, 'owner', 100)
    return requiredService().createPrivateRepository({ projectId, name, ...(owner ? { owner } : {}) })
  })
  registerHandler(IPC_CHANNELS.githubConnect, (input: ConnectRemoteInput) => {
    const record = requireRecord(input, 'input')
    return requiredService().connectRemote({
      projectId: requireString(record.projectId, 'projectId', 100),
      remoteUrl: requireString(record.remoteUrl, 'remoteUrl', 2_000)
    })
  })
  registerHandler(IPC_CHANNELS.githubPush, (projectId: string) => requiredService().pushToGitHub(requireString(projectId, 'projectId', 100)))
  registerHandler(IPC_CHANNELS.githubIgnoreRisk, (projectId: string, risk: SensitiveRisk) => {
    requireString(projectId, 'projectId', 100)
    const record = requireRecord(risk, 'risk')
    const kind = record.kind
    const allowedKinds = new Set([
      'sensitive_path', 'private_key', 'api_key', 'access_token', 'credentials',
      'database', 'large_file', 'lfs_pointer', 'dependency_directory', 'build_artifact'
    ])
    if (typeof kind !== 'string' || !allowedKinds.has(kind)) throw new Error('risk.kind is invalid')
    return requiredService().ignoreSensitiveRisk(projectId, {
      path: requireString(record.path, 'risk.path', 10_000),
      kind: kind as SensitiveRisk['kind'],
      severity: 'blocked',
      message: '由主进程重新扫描确认'
    })
  })
  registerHandler(IPC_CHANNELS.minimizeWindow, () => { mainWindow?.minimize(); return true })
  registerHandler(IPC_CHANNELS.toggleMaximizeWindow, () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return true
  })
  registerHandler(IPC_CHANNELS.closeWindow, () => { mainWindow?.close(); return true })
  registerHandler(IPC_CHANNELS.agentStatus, () => requiredService().agentStatus())
  registerHandler(IPC_CHANNELS.listAgentEvents, (projectId: string) => requiredService().listAgentEvents(requireString(projectId, 'projectId', 100)))
  registerHandler(IPC_CHANNELS.getSettings, () => requiredService().settings)
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
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
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
    const dataDirectory = process.env.VIBEGIT_DATA_DIR || defaultDataDirectory()
    await mkdir(join(dataDirectory, 'logs'), { recursive: true })
    diagnosticsPath = join(dataDirectory, 'logs', 'diagnostics.jsonl')
    service = new VibeGitService({ dataDirectory })
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
  service?.close()
  service = undefined
})
