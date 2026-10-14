import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import { VibeGitService, type VibeGitServiceOptions } from '@vibegit/core'
import { toPublicError, VibeGitError, type Checkpoint, type Project } from '@vibegit/shared'
import packageMetadata from '../../../package.json' with { type: 'json' }

const projectPathSchema = z.string().min(1).max(32_768)
  .describe('Absolute path to the user-selected local project directory or a directory inside it. Obtain it from the current workspace, never from the MCP server working directory.')
const checkpointIdSchema = z.string().uuid().describe('VibeGit checkpoint ID returned by save or list_checkpoints; not a Git SHA.')
const readOnlyAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
const localWriteAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
const MAX_CHANGED_FILES = 200
const MAX_PATCH_CHARACTERS = 100_000

function normalizedPath(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

function containsPath(root: string, target: string): boolean {
  const child = relative(normalizedPath(root), normalizedPath(target))
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
}

async function resolveProject(service: VibeGitService, requestedPath: string): Promise<Project> {
  // On Windows, isAbsolute('\\project') is true but still borrows the server's
  // current drive. Require a drive-qualified or UNC path there.
  const fullyQualified = process.platform !== 'win32'
    || /^[a-z]:[/\\]/i.test(requestedPath)
    || /^[/\\]{2}[^/\\]+[/\\][^/\\]+/.test(requestedPath)
  if (!isAbsolute(requestedPath) || !fullyQualified || requestedPath.includes('\0')) {
    throw new VibeGitError('PROJECT_PATH_MUST_BE_ABSOLUTE', '请提供当前项目的绝对文件夹路径', {
      remediation: '从当前 Agent 工作区确认项目路径，不要使用 MCP 服务的启动目录。'
    })
  }
  let canonicalPath: string
  try {
    if (!(await stat(requestedPath)).isDirectory()) {
      throw new VibeGitError('PROJECT_PATH_NOT_DIRECTORY', '项目路径必须是文件夹', {
        remediation: '使用当前项目的根目录或其中一个现有子目录。'
      })
    }
    canonicalPath = await realpath(requestedPath)
  } catch (error) {
    if (error instanceof VibeGitError) throw error
    throw new VibeGitError('PROJECT_PATH_UNAVAILABLE', '项目文件夹不存在或无法访问', {
      remediation: '确认当前工作区的绝对路径存在，且 VibeGit 在同一台电脑运行。', cause: error
    })
  }
  const projects = await service.listProjects()
  const candidates = projects.filter((project) => containsPath(project.path, canonicalPath))
    .sort((left, right) => right.path.length - left.path.length)
  for (const project of candidates) {
    // Registration stores the canonical root. A replaced root must not silently
    // redirect the saved project to another directory through a symlink.
    const currentRoot = await realpath(project.path)
    if (normalizedPath(currentRoot) !== normalizedPath(project.path)) {
      throw new VibeGitError('PROJECT_PATH_CHANGED', '已登记项目的实际位置发生变化', {
        remediation: '在 VibeGit 桌面端重新确认项目位置后再试。'
      })
    }
    return project
  }
  throw new VibeGitError('PROJECT_NOT_REGISTERED', '这个文件夹尚未添加到 VibeGit', {
    remediation: '在 VibeGit 桌面端添加该项目并开启版本保护，然后重试。插件不会自动登记其他文件夹。'
  })
}

function checkpointSummary(checkpoint: Checkpoint) {
  return {
    id: checkpoint.id,
    projectId: checkpoint.projectId,
    createdAt: checkpoint.createdAt,
    title: checkpoint.title,
    type: checkpoint.type,
    agent: checkpoint.agent,
    gitObjectId: checkpoint.gitObjectId,
    parentCheckpointId: checkpoint.parentCheckpointId ?? null,
    summary: checkpoint.summary ?? null,
    note: checkpoint.note ?? null,
    changedFileCount: checkpoint.changedFiles.length,
    insertions: checkpoint.insertions,
    deletions: checkpoint.deletions,
    githubSyncStatus: checkpoint.githubSyncStatus
  }
}

function checkpointDetails(checkpoint: Checkpoint) {
  return {
    ...checkpointSummary(checkpoint),
    changedFiles: checkpoint.changedFiles.slice(0, MAX_CHANGED_FILES),
    changedFilesTruncated: checkpoint.changedFiles.length > MAX_CHANGED_FILES
  }
}

function projectSummary(project: Project) {
  return { id: project.id, name: project.name, path: project.path, protectionEnabled: project.protectionEnabled }
}

function toolResult(data: Record<string, unknown>, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
    ...(isError ? { isError: true } : {})
  }
}

export interface VibeGitMcpRuntime {
  server: McpServer
  close(): Promise<void>
}

/** One local connection; construction and tool discovery never open the data store. */
export function createVibeGitMcpServer(options: VibeGitServiceOptions = {}): VibeGitMcpRuntime {
  const server = new McpServer(
    { name: 'VibeGit', version: packageMetadata.version },
    {
      instructions: 'VibeGit saves local checkpoints for registered projects. Always pass the actual user-selected workspace as an absolute projectPath. Saving does not commit to the user branch or push to GitHub. Never claim a save succeeded unless vibegit_save returns ok: true. On PROJECT_NOT_REGISTERED or PROTECTION_NOT_ENABLED, direct the user to the VibeGit desktop app.',
      maxToolInputElements: 20
    }
  )
  let service: VibeGitService | undefined
  let closing: Promise<void> | undefined
  const pending = new Set<Promise<CallToolResult>>()

  const run = (operation: (current: VibeGitService) => Promise<Record<string, unknown>>): Promise<CallToolResult> => {
    const task = (async () => {
      try {
        if (closing) throw new VibeGitError('SERVER_CLOSING', 'VibeGit 服务正在关闭，请重新连接后重试', { retryable: true })
        service ??= new VibeGitService(options)
        return toolResult({ ok: true, ...await operation(service) })
      } catch (error) {
        return toolResult({ ok: false, error: toPublicError(error) }, true)
      }
    })()
    pending.add(task)
    void task.finally(() => pending.delete(task))
    return task
  }

  server.registerTool('vibegit_status', {
    title: '查看 VibeGit 项目状态',
    description: 'Refresh the selected registered project status against its active VibeGit checkpoint. Reports unsaved changes, protection and sync status. Refreshes local metadata and Git object cache; never saves a checkpoint or contacts GitHub.',
    inputSchema: { projectPath: projectPathSchema },
    annotations: localWriteAnnotations
  }, async ({ projectPath }) => await run(async (current) => {
    const project = await resolveProject(current, projectPath)
    const refreshed = await current.refreshProject(project.id)
    const latest = current.database.getLatestCheckpoint(project.id)
    const active = current.database.getActiveCheckpoint(project.id) ?? latest
    return {
      project: refreshed,
      latestCheckpoint: latest ? checkpointSummary(latest) : null,
      activeCheckpoint: active ? checkpointSummary(active) : null,
      checkpointCount: current.listCheckpoints(project.id).length
    }
  }))

  server.registerTool('vibegit_save', {
    title: '保存一次 VibeGit 存档',
    description: 'Save the current local files of a registered, protected project as a VibeGit checkpoint. Leaves the user Git branch and index intact and does not push to GitHub. With no changes, returns created:false and the existing active checkpoint. Files excluded by Git ignore rules are not included unless already tracked.',
    inputSchema: {
      projectPath: projectPathSchema,
      title: z.string().trim().min(1).max(160).optional().describe('Short checkpoint title, preferably in the user language.'),
      note: z.string().trim().max(2_000).optional().describe('Optional user-requested context for this save.')
    },
    annotations: localWriteAnnotations
  }, async ({ projectPath, title, note }) => await run(async (current) => {
    const project = await resolveProject(current, projectPath)
    if (!project.protectionEnabled) {
      throw new VibeGitError('PROTECTION_NOT_ENABLED', '这个项目尚未开启版本保护', {
        remediation: '在 VibeGit 桌面端为这个项目开启版本保护，然后重试。'
      })
    }
    const { checkpoint, created } = await current.createCheckpointOrExisting({
      projectId: project.id, type: 'manual', agent: 'manual', title: title ?? 'Agent 手动存档',
      ...(note ? { note } : {}), metadata: { source: 'mcp' }
    })
    return {
      project: projectSummary(project), created, checkpoint: checkpointDetails(checkpoint),
      message: created ? '已保存本地存档，未推送到 GitHub。' : '当前文件与已有存档相同，没有创建重复存档。'
    }
  }))

  server.registerTool('vibegit_list_checkpoints', {
    title: '查看 VibeGit 存档历史',
    description: 'List recent local checkpoints for the selected registered project, newest first. Returns IDs usable with vibegit_diff.',
    inputSchema: {
      projectPath: projectPathSchema,
      limit: z.number().int().min(1).max(100).default(20).describe('Maximum number of recent checkpoints to return.')
    },
    annotations: readOnlyAnnotations
  }, async ({ projectPath, limit }) => await run(async (current) => {
    const project = await resolveProject(current, projectPath)
    const checkpoints = current.listCheckpoints(project.id)
    return {
      project: projectSummary(project), total: checkpoints.length,
      checkpoints: checkpoints.slice(0, limit).map(checkpointSummary), hasMore: checkpoints.length > limit
    }
  }))

  server.registerTool('vibegit_diff', {
    title: '比较 VibeGit 存档',
    description: 'Read the changes in a checkpoint relative to its parent, or to another checkpoint in the same project. Returns bounded patches with explicit truncation flags. Checkpoint IDs must belong to the selected project.',
    inputSchema: {
      projectPath: projectPathSchema,
      checkpointId: checkpointIdSchema,
      fromCheckpointId: checkpointIdSchema.optional()
    },
    annotations: readOnlyAnnotations
  }, async ({ projectPath, checkpointId, fromCheckpointId }) => await run(async (current) => {
    const project = await resolveProject(current, projectPath)
    const requireCheckpoint = (id: string): Checkpoint => {
      const checkpoint = current.database.getCheckpoint(id)
      if (!checkpoint || checkpoint.projectId !== project.id) {
        throw new VibeGitError('CHECKPOINT_NOT_FOUND', '所选项目中找不到这个存档', {
          remediation: '先调用 vibegit_list_checkpoints 获取当前项目的存档编号。'
        })
      }
      return checkpoint
    }
    const checkpoint = requireCheckpoint(checkpointId)
    const fromId = fromCheckpointId ?? checkpoint.parentCheckpointId
    const from = fromId ? requireCheckpoint(fromId) : undefined
    const diff = await current.git.getDiff(project.path, from?.gitObjectId, checkpoint.gitObjectId, {
      maxFiles: MAX_CHANGED_FILES, maxPatchCharacters: MAX_PATCH_CHARACTERS
    })
    return {
      project: projectSummary(project), checkpointId, fromCheckpointId: from?.id ?? null, diff
    }
  }))

  return {
    server,
    close() {
      closing ??= (async () => {
        // A disconnected client must not close SQLite underneath an ongoing save.
        await Promise.allSettled([...pending])
        try { await server.close() } finally { service?.close() }
      })()
      return closing
    }
  }
}
