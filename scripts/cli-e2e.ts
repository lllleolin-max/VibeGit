import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { VibeGitService } from '@vibegit/core'

const root = await mkdtemp(join(tmpdir(), 'vibegit-cli-e2e-'))
const projectPath = join(root, 'CLI 事件项目')
const nestedProjectPath = join(projectPath, 'packages', 'app')
const dataDirectory = join(root, 'data')
const cliPath = resolve('dist/cli/index.js')
await mkdir(projectPath, { recursive: true })
await mkdir(nestedProjectPath, { recursive: true })
await writeFile(join(projectPath, 'app.txt'), 'before\n', 'utf8')

function runEvent(event: Record<string, unknown>): Record<string, unknown> {
  const result = spawnSync(process.execPath, [cliPath, 'event', '--stdin'], {
    input: JSON.stringify(event),
    encoding: 'utf8',
    env: { ...process.env, VIBEGIT_DATA_DIR: dataDirectory },
    maxBuffer: 4 * 1024 * 1024
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'CLI event failed')
  return JSON.parse(result.stdout) as Record<string, unknown>
}

function runHook(payload: Record<string, unknown>): Record<string, unknown> {
  const result = spawnSync(process.execPath, [cliPath, 'hook', 'codex', '--stdin'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, VIBEGIT_DATA_DIR: dataDirectory },
    maxBuffer: 4 * 1024 * 1024
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'CLI hook failed')
  }
  return JSON.parse(result.stdout) as Record<string, unknown>
}

const seed = new VibeGitService({ dataDirectory })
const project = await seed.addProject({ path: projectPath })
await seed.initializeProtection(project.id)
seed.close()

try {
  const startHook = runHook({
    hook_event_name: 'UserPromptSubmit',
    cwd: nestedProjectPath,
    session_id: 'nested-hook-session',
    turn_id: 'nested-hook-turn',
    prompt: '从子目录启动的 Codex Hook'
  })
  if (!(startHook.hookSpecificOutput as Record<string, unknown> | undefined)?.additionalContext) {
    throw new Error('Protected Hook did not inject VibeGit summary context')
  }
  const started = runEvent({
    event: 'task-start',
    agent: 'codex',
    projectPath,
    sessionId: 'built-cli-session',
    taskText: '验证真实 CLI 产物',
    timestamp: new Date().toISOString()
  })
  await writeFile(join(projectPath, 'app.txt'), 'after\nnew feature\n', 'utf8')
  const stopHook = runHook({
    hook_event_name: 'Stop',
    cwd: projectPath,
    session_id: 'nested-hook-session',
    turn_id: 'nested-hook-stop'
  })
  if (stopHook.decision !== 'block') {
    throw new Error('Protected Hook did not require a missing VibeGit summary')
  }
  const ended = runEvent({
    event: 'task-end',
    agent: 'codex',
    projectPath,
    sessionId: 'built-cli-session',
    success: true,
    timestamp: new Date().toISOString()
  })

  const verify = new VibeGitService({ dataDirectory })
  try {
    const checkpoints = verify.listCheckpoints(project.id)
    const preAgent = checkpoints.find((checkpoint) => checkpoint.type === 'pre_agent')
    const nestedPreAgent = checkpoints.find((checkpoint) => checkpoint.taskText === '从子目录启动的 Codex Hook')
    const postAgent = checkpoints.find((checkpoint) => checkpoint.type === 'post_agent')
    if (!preAgent || !nestedPreAgent || !postAgent || postAgent.agent !== 'codex' || postAgent.taskText !== '验证真实 CLI 产物') {
      throw new Error('Built CLI did not persist the expected Agent checkpoints')
    }
    process.stdout.write(`${JSON.stringify({
      startOk: started.ok === true,
      endOk: ended.ok === true,
      nestedHook: 'passed',
      stopSummaryGuard: 'passed',
      checkpointTypes: checkpoints.map((checkpoint) => checkpoint.type),
      postAgentFiles: postAgent.changedFiles.map((file) => file.path)
    })}\n`)
  } finally {
    verify.close()
  }
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
}
