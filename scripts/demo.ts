import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VibeGitService } from '@vibegit/core'

const root = await mkdtemp(join(tmpdir(), 'vibegit-demo-'))
const projectPath = join(root, 'VibeGit 完整演示项目')
const dataDirectory = join(root, 'data')
await mkdir(join(projectPath, 'src'), { recursive: true })
const appPath = join(projectPath, 'src', 'app.ts')
await writeFile(appPath, 'export const version = 1\n', 'utf8')

const service = new VibeGitService({ dataDirectory, commandTimeoutMs: 20_000 })
try {
  const project = await service.addProject({ path: projectPath })
  const initial = (await service.initializeProtection(project.id)).checkpoint
  await service.handleAgentEvent({
    event: 'task-start',
    agent: 'codex',
    projectPath,
    sessionId: 'demo-session',
    taskText: '增加一个可见的功能开关',
    timestamp: new Date().toISOString()
  })
  await writeFile(appPath, 'export const version = 2\nexport const featureEnabled = true\n', 'utf8')
  const ended = await service.handleAgentEvent({
    event: 'task-end',
    agent: 'codex',
    projectPath,
    sessionId: 'demo-session',
    success: true,
    timestamp: new Date().toISOString()
  })
  if (!ended.checkpoint) throw new Error('Agent 结束事件未生成保存点')

  const diff = await service.getCheckpointDiff(ended.checkpoint.id)
  const preview = await service.prepareRestore(project.id, initial.id)
  const restore = await service.executeRestore(preview.token)
  const contentAfterRestore = await readFile(appPath, 'utf8')
  await service.undoRestore(restore.id)
  const contentAfterUndo = await readFile(appPath, 'utf8')
  const timeline = service.listCheckpoints(project.id)

  const result = {
    projectInitialized: true,
    gitRepository: await service.git.isRepository(projectPath),
    checkpointTypes: timeline.map((checkpoint) => checkpoint.type),
    agentCheckpoint: {
      agent: ended.checkpoint.agent,
      taskText: ended.checkpoint.taskText,
      changedFiles: diff.files.map((file) => file.path),
      insertions: diff.insertions,
      deletions: diff.deletions
    },
    restorePreview: {
      addCount: preview.addCount,
      overwriteCount: preview.overwriteCount,
      removeCount: preview.removeCount,
      conflictCount: preview.conflictCount,
      insuranceCheckpointCreated: Boolean(preview.insuranceCheckpointId)
    },
    restoredToVersionOne: contentAfterRestore.replaceAll('\r\n', '\n') === 'export const version = 1\n',
    undoRecoveredVersionTwo: contentAfterUndo.includes('version = 2') && contentAfterUndo.includes('featureEnabled = true'),
    temporaryProjectRemovedAfterRun: true
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  service.close()
  if (process.env.VIBEGIT_KEEP_DEMO === '1') process.stderr.write(`Demo kept at ${root}\n`)
  else await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
}
