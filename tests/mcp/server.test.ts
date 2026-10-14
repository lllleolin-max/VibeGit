import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { saveDataDirectoryPreference, VibeGitService, type VibeGitServiceOptions } from '@vibegit/core'
import { VibeGitDatabase } from '@vibegit/database'
import type { Checkpoint, Project } from '@vibegit/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVibeGitMcpServer, type VibeGitMcpRuntime } from '../../apps/mcp/src/server'
import { cleanupSandbox, createSandbox, writeProjectFile, type TestSandbox } from '../helpers'

const require = createRequire(import.meta.url)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

interface SaveResult {
  ok: true
  project: Pick<Project, 'id' | 'path'>
  created: boolean
  checkpoint: Checkpoint
}

function body<T>(result: Awaited<ReturnType<Client['callTool']>>): T {
  const parsed = result as CallToolResult
  expect(parsed.isError).not.toBe(true)
  expect(parsed.structuredContent?.ok).toBe(true)
  expect(JSON.parse((parsed.content[0] as { text: string }).text)).toEqual(parsed.structuredContent)
  return parsed.structuredContent as T
}

function expectError(result: Awaited<ReturnType<Client['callTool']>>, code: string): void {
  expect(result.isError).toBe(true)
  expect(result.structuredContent).toMatchObject({ ok: false, error: { code, remediation: expect.any(String) } })
}

describe('VibeGit MCP tools over real MCP transports', () => {
  let sandbox: TestSandbox
  const connections: { client: Client; runtime?: VibeGitMcpRuntime }[] = []

  beforeEach(async () => { sandbox = await createSandbox() })
  afterEach(async () => {
    for (const connection of connections.splice(0)) {
      await connection.runtime?.close()
      await connection.client.close()
    }
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await cleanupSandbox(sandbox)
  })

  async function connect(options: VibeGitServiceOptions = { dataDirectory: sandbox.dataDirectory }) {
    const runtime = createVibeGitMcpServer(options)
    const client = new Client({ name: 'vibegit-test', version: '1.0.0' })
    connections.push({ client, runtime })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await runtime.server.connect(serverTransport)
    await client.connect(clientTransport)
    return { client, runtime }
  }

  async function initialize(): Promise<Project> {
    await writeProjectFile(sandbox, 'app.txt', 'initial\n')
    return await sandbox.service.addProject({ path: sandbox.projectPath, initialize: true })
  }

  it('discovers exactly the four tools without opening the data store or initializing a project', async () => {
    const unusedData = join(sandbox.root, 'not-created')
    const { client } = await connect({ dataDirectory: unusedData })
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name)).toEqual([
      'vibegit_status', 'vibegit_save', 'vibegit_list_checkpoints', 'vibegit_diff'
    ])
    expect(tools.every((tool) => tool.inputSchema.required?.includes('projectPath'))).toBe(true)
    expect(tools.find((tool) => tool.name === 'vibegit_save')?.annotations).toMatchObject({
      readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false
    })
    expect(existsSync(unusedData)).toBe(false)
    expect(existsSync(join(sandbox.projectPath, '.git'))).toBe(false)
  })

  it('saves a real checkpoint visible to the desktop service without changing HEAD, index or files', async () => {
    const project = await initialize()
    const git = sandbox.service.git.runner
    await git.run(project.path, ['add', '--', 'app.txt'])
    await git.run(project.path, ['-c', 'user.name=VibeGit Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'User branch commit'])
    await writeProjectFile(sandbox, 'app.txt', 'staged version\n')
    await git.run(project.path, ['add', '--', 'app.txt'])
    await writeProjectFile(sandbox, 'app.txt', 'current version\n')
    await writeProjectFile(sandbox, 'new.txt', 'untracked content\n')
    const headBefore = (await git.run(project.path, ['rev-parse', 'HEAD'])).stdout
    const indexBefore = await readFile(join(project.path, '.git', 'index'))
    const { client } = await connect()
    const saved = body<SaveResult>(await client.callTool({ name: 'vibegit_save', arguments: {
      projectPath: project.path, title: '完成登录功能', note: '用户主动要求保存'
    } }))
    expect(saved.created).toBe(true)
    expect(saved.checkpoint).toMatchObject({ title: '完成登录功能', note: '用户主动要求保存', projectId: project.id, type: 'manual' })
    expect(sandbox.service.database.getCheckpoint(saved.checkpoint.id)?.gitObjectId).toBe(saved.checkpoint.gitObjectId)
    expect(sandbox.service.listCheckpoints(project.id)).toHaveLength(2)
    expect((await git.run(project.path, ['show', `${saved.checkpoint.gitObjectId}:app.txt`])).stdout).toBe('current version\n')
    expect((await git.run(project.path, ['show', `${saved.checkpoint.gitObjectId}:new.txt`])).stdout).toBe('untracked content\n')
    expect((await git.run(project.path, ['rev-parse', 'HEAD'])).stdout).toBe(headBefore)
    expect(await readFile(join(project.path, '.git', 'index'))).toEqual(indexBefore)
    expect(await readFile(join(project.path, 'app.txt'), 'utf8')).toBe('current version\n')
    expect((await git.run(project.path, ['remote'])).stdout).toBe('')
  })

  it('returns the active checkpoint on no change and serializes overlapping saves across connections', async () => {
    const project = await initialize()
    const initial = sandbox.service.database.getActiveCheckpoint(project.id)!
    const { client } = await connect()
    const noChange = body<SaveResult>(await client.callTool({ name: 'vibegit_save', arguments: { projectPath: project.path } }))
    expect(noChange).toMatchObject({ created: false, checkpoint: { id: initial.id } })
    await writeProjectFile(sandbox, 'app.txt', 'changed\n')
    const { client: secondClient } = await connect()
    const saved = (await Promise.all([client, secondClient].map(async (connection) => await connection.callTool({
      name: 'vibegit_save', arguments: { projectPath: project.path }
    })))).map((result) => body<SaveResult>(result))
    expect(saved.filter((result) => result.created)).toHaveLength(1)
    expect(new Set(saved.map((result) => result.checkpoint.id)).size).toBe(1)
    expect(sandbox.service.listCheckpoints(project.id)).toHaveLength(2)
  })

  it('returns the restored active checkpoint instead of the newer insurance snapshot on no change', async () => {
    const project = await initialize()
    const initial = sandbox.service.database.getActiveCheckpoint(project.id)!
    await writeProjectFile(sandbox, 'app.txt', 'later version\n')
    await sandbox.service.createCheckpoint({ projectId: project.id, type: 'manual', title: 'Later version' })
    const preview = await sandbox.service.prepareRestore(project.id, initial.id)
    await sandbox.service.executeRestore(preview.token)
    const countBefore = sandbox.service.listCheckpoints(project.id).length
    const { client } = await connect()
    const saved = body<SaveResult>(await client.callTool({ name: 'vibegit_save', arguments: { projectPath: project.path } }))
    expect(saved).toMatchObject({ created: false, checkpoint: { id: initial.id } })
    expect(sandbox.service.listCheckpoints(project.id)).toHaveLength(countBefore)
    expect((await readFile(join(project.path, 'app.txt'), 'utf8')).replaceAll('\r\n', '\n')).toBe('initial\n')
  })

  it('keeps the no-change result bound to the baseline checked under the lease', async () => {
    const project = await initialize()
    const initial = sandbox.service.database.getActiveCheckpoint(project.id)!
    const insurance = await sandbox.service.createCheckpoint({ projectId: project.id, type: 'pre_restore', title: 'Insurance', allowEmpty: true })
    const release = VibeGitDatabase.prototype.releaseProjectOperation
    vi.spyOn(VibeGitDatabase.prototype, 'releaseProjectOperation').mockImplementation(function (this: VibeGitDatabase, projectId, ownerId) {
      release.call(this, projectId, ownerId)
      // Simulate another process selecting a different active snapshot at the
      // first moment it can acquire the just-released project lease.
      this.setActiveCheckpoint(projectId, insurance.id)
    })
    const { client } = await connect()
    const saved = body<SaveResult>(await client.callTool({ name: 'vibegit_save', arguments: { projectPath: project.path } }))
    expect(sandbox.service.database.getActiveCheckpoint(project.id)?.id).toBe(insurance.id)
    expect(saved).toMatchObject({ created: false, checkpoint: { id: initial.id } })
  })

  it('finishes an in-flight real save before closing its SQLite connection', async () => {
    const project = await initialize()
    await writeProjectFile(sandbox, 'app.txt', 'save while shutting down\n')
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolveGate) => { release = resolveGate })
    const started = new Promise<void>((resolveStarted) => { entered = resolveStarted })
    const original = VibeGitService.prototype.createCheckpointOrExisting
    vi.spyOn(VibeGitService.prototype, 'createCheckpointOrExisting').mockImplementation(async function (this: VibeGitService, input) {
      entered()
      await gate
      return await original.call(this, input)
    })
    const { client, runtime } = await connect()
    const request = client.callTool({ name: 'vibegit_save', arguments: { projectPath: project.path, title: 'Shutdown save' } })
    // Shutdown can close the transport before the response arrives, but the
    // checkpoint operation must complete and release its database lease.
    const settledRequest = request.catch(() => undefined)
    await started
    let closed = false
    const closing = runtime.close().then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    release()
    await Promise.all([closing, settledRequest])
    expect(sandbox.service.database.getActiveCheckpoint(project.id)?.title).toBe('Shutdown save')
    expect(await sandbox.service.checkpoints.hasPendingChanges(project.id)).toBe(false)
  })

  it('shows changes relative to the active checkpoint and returns bounded newest-first history', async () => {
    const project = await initialize()
    const initial = sandbox.service.database.getActiveCheckpoint(project.id)!
    const { client } = await connect()
    expect(body<{ project: Project }>(await client.callTool({ name: 'vibegit_status', arguments: { projectPath: project.path } })).project)
      .toMatchObject({ hasUnsavedChanges: false, worktreeStatus: 'checked' })
    await writeProjectFile(sandbox, 'app.txt', 'updated\n')
    expect(body<{ project: Project }>(await client.callTool({ name: 'vibegit_status', arguments: { projectPath: project.path } })).project)
      .toMatchObject({ hasUnsavedChanges: true })
    const saved = body<SaveResult>(await client.callTool({ name: 'vibegit_save', arguments: { projectPath: project.path } }))
    const listed = body<{ total: number; hasMore: boolean; checkpoints: Checkpoint[] }>(await client.callTool({
      name: 'vibegit_list_checkpoints', arguments: { projectPath: project.path, limit: 1 }
    }))
    expect(listed).toMatchObject({ total: 2, hasMore: true, checkpoints: [{ id: saved.checkpoint.id }] })
    const diffArguments = { projectPath: project.path, checkpointId: saved.checkpoint.id }
    const implicit = body<{ diff: { files: { patch: string }[]; truncated: boolean } }>(await client.callTool({ name: 'vibegit_diff', arguments: diffArguments }))
    const explicit = body<unknown>(await client.callTool({ name: 'vibegit_diff', arguments: { ...diffArguments, fromCheckpointId: initial.id } }))
    expect(implicit).toEqual(explicit)
    expect(implicit.diff.files[0]?.patch).toContain('+updated')
    expect(implicit.diff.truncated).toBe(false)
  })

  it('resolves canonical child directories and symlink aliases without matching sibling prefixes', async () => {
    const project = await initialize()
    const child = join(project.path, 'src')
    await mkdir(child)
    const alias = join(sandbox.root, 'project-alias')
    await symlink(project.path, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const { client } = await connect()
    for (const projectPath of [child, join(alias, 'src')]) {
      const status = body<{ project: Project }>(await client.callTool({ name: 'vibegit_status', arguments: { projectPath } }))
      expect(status.project.id).toBe(project.id)
      expect(status.project.path).toBe(await realpath(project.path))
    }
    const sibling = `${project.path}-other`
    await mkdir(sibling)
    expectError(await client.callTool({ name: 'vibegit_save', arguments: { projectPath: sibling } }), 'PROJECT_NOT_REGISTERED')
    const outside = join(sandbox.root, 'outside')
    await mkdir(outside)
    await symlink(outside, join(project.path, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    expectError(await client.callTool({ name: 'vibegit_save', arguments: { projectPath: join(project.path, 'escape') } }), 'PROJECT_NOT_REGISTERED')
  })

  it('rejects missing, relative, file, unregistered and unprotected paths without enabling protection', async () => {
    const { client } = await connect()
    for (const [projectPath, code] of [
      ['.', 'PROJECT_PATH_MUST_BE_ABSOLUTE'],
      [join(sandbox.root, 'missing'), 'PROJECT_PATH_UNAVAILABLE'],
      [sandbox.projectPath, 'PROJECT_NOT_REGISTERED']
    ]) {
      expectError(await client.callTool({ name: 'vibegit_save', arguments: { projectPath } }), code!)
    }
    await writeProjectFile(sandbox, 'app.txt', 'unchanged\n')
    expectError(await client.callTool({ name: 'vibegit_save', arguments: { projectPath: join(sandbox.projectPath, 'app.txt') } }), 'PROJECT_PATH_NOT_DIRECTORY')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    expectError(await client.callTool({ name: 'vibegit_save', arguments: { projectPath: project.path } }), 'PROTECTION_NOT_ENABLED')
    expect(existsSync(join(project.path, '.git'))).toBe(false)
    expect(sandbox.service.listCheckpoints(project.id)).toHaveLength(0)
    expect(await readFile(join(project.path, 'app.txt'), 'utf8')).toBe('unchanged\n')
    expect((await client.callTool({ name: 'vibegit_save', arguments: {} })).isError).toBe(true)
    if (process.platform === 'win32') {
      expectError(await client.callTool({ name: 'vibegit_save', arguments: { projectPath: '\\Windows' } }), 'PROJECT_PATH_MUST_BE_ABSOLUTE')
    }
    expect((await client.callTool({ name: 'vibegit_save', arguments: { projectPath: project.path, title: ' ' } })).isError).toBe(true)
    expect((await client.callTool({ name: 'vibegit_list_checkpoints', arguments: { projectPath: project.path, limit: 101 } })).isError).toBe(true)
  })

  it('rejects foreign checkpoint IDs for either side of a diff', async () => {
    const project = await initialize()
    const own = sandbox.service.database.getActiveCheckpoint(project.id)!
    const otherPath = join(sandbox.root, 'other project')
    await mkdir(otherPath)
    await writeFile(join(otherPath, 'private.txt'), 'other project content')
    const other = await sandbox.service.addProject({ path: otherPath, initialize: true })
    const foreign = sandbox.service.database.getActiveCheckpoint(other.id)!
    const { client } = await connect()
    expectError(await client.callTool({ name: 'vibegit_diff', arguments: { projectPath: project.path, checkpointId: foreign.id } }), 'CHECKPOINT_NOT_FOUND')
    expectError(await client.callTool({ name: 'vibegit_diff', arguments: { projectPath: project.path, checkpointId: own.id, fromCheckpointId: foreign.id } }), 'CHECKPOINT_NOT_FOUND')
  })

  it('reports truncated patches rather than silently returning an incomplete diff', async () => {
    const project = await initialize()
    await writeProjectFile(sandbox, 'large.txt', `${'large content line\n'.repeat(7_000)}`)
    const { client } = await connect()
    const saved = body<SaveResult>(await client.callTool({ name: 'vibegit_save', arguments: { projectPath: project.path } }))
    const result = body<{ diff: { truncated: boolean; totalFiles: number; files: { patch: string; patchTruncated: boolean }[] } }>(await client.callTool({
      name: 'vibegit_diff', arguments: { projectPath: project.path, checkpointId: saved.checkpoint.id }
    }))
    expect(result.diff.truncated).toBe(true)
    expect(result.diff.totalFiles).toBe(1)
    expect(result.diff.files[0]?.patch.length).toBe(100_000)
    expect(result.diff.files[0]?.patchTruncated).toBe(true)
  })

  it('uses desktop preferences by default and honors the existing environment override', async () => {
    const project = await initialize()
    vi.stubEnv('HOME', sandbox.root)
    vi.stubEnv('USERPROFILE', sandbox.root)
    vi.stubEnv('APPDATA', join(sandbox.root, 'appdata'))
    vi.stubEnv('XDG_CONFIG_HOME', join(sandbox.root, 'config'))
    vi.stubEnv('XDG_DATA_HOME', join(sandbox.root, 'data'))
    vi.stubEnv('VIBEGIT_DATA_DIR', '')
    await saveDataDirectoryPreference(sandbox.dataDirectory)
    const { client } = await connect({})
    expect(body<{ project: Project }>(await client.callTool({ name: 'vibegit_status', arguments: { projectPath: project.path } })).project.id).toBe(project.id)
    vi.stubEnv('VIBEGIT_DATA_DIR', join(sandbox.root, 'override'))
    const { client: overridden } = await connect({})
    expectError(await overridden.callTool({ name: 'vibegit_status', arguments: { projectPath: project.path } }), 'PROJECT_NOT_REGISTERED')
  })

  it('runs the stdio entry point from an unrelated cwd and saves into the shared desktop data store', async () => {
    const project = await initialize()
    await writeProjectFile(sandbox, 'app.txt', 'stdio saved\n')
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [require.resolve('tsx/cli'), '--tsconfig', join(repositoryRoot, 'tsconfig.json'), join(repositoryRoot, 'apps/mcp/src/index.ts')],
      cwd: sandbox.root,
      env: { ...getDefaultEnvironment(), VIBEGIT_DATA_DIR: sandbox.dataDirectory },
      stderr: 'pipe'
    })
    const client = new Client({ name: 'stdio-test', version: '1.0.0' })
    connections.push({ client })
    const protocolErrors: Error[] = []
    client.onerror = (error) => { protocolErrors.push(error) }
    await client.connect(transport)
    expect((await client.listTools()).tools).toHaveLength(4)
    const saved = body<SaveResult>(await client.callTool({ name: 'vibegit_save', arguments: { projectPath: project.path, title: '真实 stdio 存档' } }))
    expect(saved.created).toBe(true)
    expect(sandbox.service.database.getCheckpoint(saved.checkpoint.id)?.title).toBe('真实 stdio 存档')
    expect(protocolErrors).toEqual([])
    expect(existsSync(join(sandbox.root, '.git'))).toBe(false)
  })
})
