import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { defaultDataDirectory, VibeGitService } from '@vibegit/core'
import {
  VibeGitError,
  fail,
  ok,
  type AddProjectInput,
  type ConnectRemoteInput,
  type CreateCheckpointInput,
  type CreatePrivateRepositoryInput,
  type SensitiveRisk,
  type VibeGitApi
} from '@vibegit/shared'

const host = '127.0.0.1'
const rendererDirectory = resolve(process.cwd(), 'out/renderer')
const service = new VibeGitService({
  dataDirectory: process.env.VIBEGIT_DATA_DIR || defaultDataDirectory()
})

let origin = ''

function argument<T>(args: unknown[], index: number): T {
  return args[index] as T
}

async function openDirectory(path: string): Promise<boolean> {
  const executable = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  return await new Promise<boolean>((resolveResult, reject) => {
    const child = spawn(executable, [path], { detached: true, stdio: 'ignore', windowsHide: false })
    child.once('spawn', () => {
      child.unref()
      resolveResult(true)
    })
    child.once('error', reject)
  })
}

const actions: Record<keyof VibeGitApi, (args: unknown[]) => unknown | Promise<unknown>> = {
  health: () => service.health(),
  selectProjectDirectory: () => null,
  listProjects: () => service.listProjects(),
  addProject: (args) => service.addProject(argument<AddProjectInput>(args, 0)),
  refreshProject: (args) => service.refreshProject(argument<string>(args, 0)),
  initializeProtection: (args) => service.initializeProtection(argument<string>(args, 0)),
  listCheckpoints: (args) => service.listCheckpoints(argument<string>(args, 0)),
  createCheckpoint: (args) => service.createCheckpoint(argument<CreateCheckpointInput>(args, 0)),
  getCheckpointDiff: (args) => service.getCheckpointDiff(argument<string>(args, 0)),
  prepareRestore: (args) => service.prepareRestore(argument<string>(args, 0), argument<string>(args, 1)),
  executeRestore: (args) => service.executeRestore(argument<string>(args, 0)),
  undoRestore: (args) => service.undoRestore(argument<string>(args, 0)),
  failedRestoreForToken: (args) => service.getFailedRestoreForToken(argument<string>(args, 0)),
  listFailedRestores: (args) => service.listFailedRestores(argument<string>(args, 0)),
  openRecoveryDirectory: async (args) => {
    const restore = service.getRestore(argument<string>(args, 0))
    return restore.recoveryDirectory ? await openDirectory(restore.recoveryDirectory) : false
  },
  listShelves: (args) => service.listShelves(argument<string>(args, 0)),
  createShelf: (args) => service.createShelf(argument<string>(args, 0), argument<string>(args, 1)),
  retrieveShelf: (args) => service.retrieveShelf(argument<string>(args, 0)),
  githubStatus: () => service.githubStatus(),
  githubScan: (args) => service.scanSensitiveFiles(argument<string>(args, 0)),
  githubCreatePrivate: (args) => service.createPrivateRepository(argument<CreatePrivateRepositoryInput>(args, 0)),
  githubConnect: (args) => service.connectRemote(argument<ConnectRemoteInput>(args, 0)),
  githubPush: (args) => service.pushToGitHub(argument<string>(args, 0)),
  githubIgnoreRisk: (args) => service.ignoreSensitiveRisk(argument<string>(args, 0), argument<SensitiveRisk>(args, 1)),
  agentStatus: () => service.agentStatus(),
  listAgentEvents: (args) => service.listAgentEvents(argument<string>(args, 0)),
  getSettings: () => service.settings
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  response.end(JSON.stringify(body))
}

async function readInvocation(request: IncomingMessage): Promise<{ method: keyof VibeGitApi; args: unknown[] }> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > 1_048_576) throw new VibeGitError('REQUEST_TOO_LARGE', '请求内容过大')
    chunks.push(buffer)
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  if (typeof parsed.method !== 'string' || !(parsed.method in actions) || !Array.isArray(parsed.args)) {
    throw new VibeGitError('INVALID_BROWSER_REQUEST', '本机界面发送了无效请求')
  }
  return { method: parsed.method as keyof VibeGitApi, args: parsed.args }
}

async function handleApi(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'POST' || request.headers.origin !== origin) {
    sendJson(response, 403, fail(new VibeGitError('BROWSER_REQUEST_REJECTED', '已拒绝非本机界面的请求')))
    return
  }
  try {
    const invocation = await readInvocation(request)
    sendJson(response, 200, ok(await actions[invocation.method](invocation.args)))
  } catch (error) {
    sendJson(response, 200, fail(error))
  }
}

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
}

async function handleStatic(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end()
    return
  }
  const requestUrl = new URL(request.url ?? '/', origin)
  const pathname = requestUrl.pathname === '/' ? '/index.html' : decodeURIComponent(requestUrl.pathname)
  const filePath = resolve(rendererDirectory, `.${pathname}`)
  const relativePath = relative(rendererDirectory, filePath)
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    response.writeHead(403).end()
    return
  }
  try {
    const fileInfo = await stat(filePath)
    if (!fileInfo.isFile()) throw new Error('Not a file')
    const body = await readFile(filePath)
    response.writeHead(200, {
      'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': pathname === '/index.html' ? 'no-store' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer'
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('VibeGit 页面文件不存在，请重新运行启动文件。')
  }
}

const server = createServer((request, response) => {
  void (request.url?.startsWith('/api/') ? handleApi(request, response) : handleStatic(request, response))
    .catch((error: unknown) => sendJson(response, 500, fail(error)))
})

await new Promise<void>((resolveReady, reject) => {
  server.once('error', reject)
  server.listen(0, host, () => resolveReady())
})

const address = server.address()
if (!address || typeof address === 'string') throw new Error('VibeGit browser server did not start')
origin = `http://${host}:${address.port}`
console.log(`[VibeGit] 本机界面已启动：${origin}`)
console.log('[VibeGit] 请保留此窗口；关闭窗口会停止应用。')

if (!process.argv.includes('--no-open')) {
  try {
    await openDirectory(origin)
  } catch {
    console.log(`[VibeGit] 未能自动打开浏览器，请手动访问：${origin}`)
  }
}

let closing = false
function close(): void {
  if (closing) return
  closing = true
  server.close(() => {
    service.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 2_000).unref()
}

process.once('SIGINT', close)
process.once('SIGTERM', close)
process.once('SIGHUP', close)
