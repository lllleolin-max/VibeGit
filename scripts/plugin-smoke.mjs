import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { VibeGitService } from '../packages/core/src/index.ts'
import { pluginHosts, writeHostConfiguration } from './build-plugins.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = await mkdtemp(join(tmpdir(), 'vibegit-plugin-smoke-'))
const dataDirectory = join(root, 'data')
const projectPath = join(root, '真实项目 with spaces')
const nestedPath = join(projectPath, 'packages', 'app')
const unregisteredPath = join(root, 'not-registered')
const toolNames = ['vibegit_diff', 'vibegit_list_checkpoints', 'vibegit_save', 'vibegit_status']
let seed
let activeClient
let diagnostics = ''

function git(args) {
  const result = spawnSync('git', ['-C', projectPath, ...args], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

function data(result) {
  const value = result.structuredContent ?? JSON.parse(result.content.find((item) => item.type === 'text').text)
  assert.equal(result.isError, undefined, JSON.stringify(value))
  assert.equal(value.ok, true, JSON.stringify(value))
  return value
}

async function connect(host) {
  // A copy outside the checkout cannot resolve project node_modules. This checks
  // the distributed server, rather than letting source dependencies mask a bad bundle.
  const packageDirectory = join(root, 'isolated', host, 'vibegit')
  await cp(join(projectRoot, 'dist', 'plugins', host, 'vibegit'), packageDirectory, { recursive: true })
  // Exercise each generated host configuration, including plugin-root expansion
  // and Codex's relative cwd, rather than silently fixing a bad launch command.
  await writeHostConfiguration(host, packageDirectory)
  let launch
  if (host === 'deepseek-harness') {
    launch = JSON.parse(await readFile(join(packageDirectory, 'vibegit.cordis.yml'), 'utf8'))[0].insert[0].config
  } else {
    const configFile = host === 'workbuddy' ? 'mcp.json' : '.mcp.json'
    launch = JSON.parse(await readFile(join(packageDirectory, configFile), 'utf8')).mcpServers.vibegit
  }
  const args = launch.args.map((argument) => argument.replaceAll('${CLAUDE_PLUGIN_ROOT}', packageDirectory))
  const transport = new StdioClientTransport({
    command: launch.command, args, cwd: launch.cwd ? resolve(packageDirectory, launch.cwd) : root,
    env: { ...process.env, VIBEGIT_DATA_DIR: dataDirectory }, stderr: 'pipe'
  })
  transport.stderr?.on('data', (chunk) => { diagnostics = `${diagnostics}${chunk}`.slice(-8_000) })
  const client = new Client({ name: 'vibegit-portable-smoke', version: '1.0.0' })
  activeClient = client
  await client.connect(transport, { timeout: 15_000 })
  const listed = await client.listTools()
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), toolNames)
  return client
}

try {
  await mkdir(nestedPath, { recursive: true })
  await mkdir(unregisteredPath)
  await writeFile(join(projectPath, 'app.txt'), 'before\n')
  // Startup and tools/list must not create a database or initialize any project.
  for (const host of pluginHosts) {
    const client = await connect(host)
    assert.equal((await readdir(root)).includes('data'), false, `${host} modified storage on discovery`)
    await client.close()
    activeClient = undefined
  }

  seed = new VibeGitService({ dataDirectory })
  const project = await seed.addProject({ path: projectPath, initialize: true })
  const initial = seed.listCheckpoints(project.id)[0]
  assert.ok(initial)
  seed.close()
  seed = undefined
  await writeFile(join(projectPath, 'app.txt'), 'after\nfeature complete\n')
  await writeFile(join(projectPath, 'staged.txt'), 'staged content\n')
  git(['add', 'staged.txt'])
  const originalIndex = await readFile(join(projectPath, '.git', 'index'))
  const originalHead = await readFile(join(projectPath, '.git', 'HEAD'), 'utf8')
  const originalStatus = git(['status', '--porcelain=v1', '-z'])

  const client = await connect('codex')
  const status = data(await client.callTool({ name: 'vibegit_status', arguments: { projectPath: nestedPath } }))
  assert.equal(status.project.id, project.id)
  const saved = data(await client.callTool({
    name: 'vibegit_save', arguments: { projectPath: nestedPath, title: '插件真实存档', note: 'Portable MCP smoke' }
  }))
  assert.equal(saved.created, true)
  assert.equal(saved.checkpoint.title, '插件真实存档')
  assert.ok(saved.checkpoint.changedFiles.some((file) => file.path === 'app.txt'))
  const repeated = data(await client.callTool({ name: 'vibegit_save', arguments: { projectPath } }))
  assert.equal(repeated.created, false)
  assert.equal(repeated.checkpoint.id, saved.checkpoint.id)
  const listed = data(await client.callTool({ name: 'vibegit_list_checkpoints', arguments: { projectPath, limit: 2 } }))
  assert.equal(listed.checkpoints[0].id, saved.checkpoint.id)
  const diff = data(await client.callTool({
    name: 'vibegit_diff', arguments: { projectPath, checkpointId: saved.checkpoint.id, fromCheckpointId: initial.id }
  }))
  assert.ok(diff.diff.files.some((file) => file.path === 'app.txt' && file.patch.includes('feature complete')))
  const rejected = await client.callTool({ name: 'vibegit_save', arguments: { projectPath: unregisteredPath } })
  assert.equal(rejected.isError, true)
  assert.equal(rejected.structuredContent.error.code, 'PROJECT_NOT_REGISTERED')
  await client.close()
  activeClient = undefined

  assert.deepEqual(await readFile(join(projectPath, '.git', 'index')), originalIndex)
  assert.equal(await readFile(join(projectPath, '.git', 'HEAD'), 'utf8'), originalHead)
  assert.equal(git(['status', '--porcelain=v1', '-z']), originalStatus)
  seed = new VibeGitService({ dataDirectory })
  assert.equal(seed.listCheckpoints(project.id)[0].id, saved.checkpoint.id, 'Desktop service must read the same checkpoint')
  assert.equal(seed.listCheckpoints(project.id).length, 2)
  process.stdout.write(`${JSON.stringify({
    portableTransports: pluginHosts, discoveryHasNoSideEffects: true, save: 'passed',
    nestedWorkspace: 'passed', duplicateSave: 'passed', historyAndDiff: 'passed',
    unregisteredProjectRejected: true, gitIndexAndHeadPreserved: true, sharedDesktopStore: true
  })}\n`)
} catch (error) {
  process.stderr.write(`${error.stack}\n${diagnostics}\n`)
  process.exitCode = 1
} finally {
  await activeClient?.close()
  seed?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
