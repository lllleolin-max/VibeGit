#!/usr/bin/env node
import { stdin, stdout, stderr } from 'node:process'
import { VibeGitService } from '@vibegit/core'
import { parseAgentEvent, toPublicError, VibeGitError, type ApiResult } from '@vibegit/shared'
import { adaptHookEvent } from '@vibegit/agent-events'

const MAX_STDIN_BYTES = 1024 * 1024

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.length
    if (length > MAX_STDIN_BYTES) throw new Error('stdin 超过 1 MB 限制')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function print(result: ApiResult<unknown>): void {
  stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

function help(): void {
  stdout.write(`VibeGit CLI\n\n`)
  stdout.write(`用法:\n`)
  stdout.write(`  vibegit event --stdin       从 JSON stdin 接收 task-start/task-end\n`)
  stdout.write(`  vibegit hook <agent> --stdin 适配 Codex/Claude Code Hook JSON\n`)
  stdout.write(`  vibegit projects            列出本地项目\n`)
  stdout.write(`  vibegit checkpoints <id>    列出项目保存点\n`)
  stdout.write(`  vibegit github-status       检查 GitHub CLI 登录状态\n`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    help()
    return
  }
  const hookMode = args[0] === 'hook' && (args[1] === 'codex' || args[1] === 'claude-code') && args[2] === '--stdin' && args.length === 3
  let service: VibeGitService | undefined
  try {
    service = new VibeGitService()
    if (args[0] === 'event' && args[1] === '--stdin' && args.length === 2) {
      const raw = await readStdin()
      const event = parseAgentEvent(JSON.parse(raw) as unknown)
      print({ ok: true, data: await service.handleAgentEvent(event) })
      return
    }
    if (hookMode) {
      const raw = await readStdin()
      const event = adaptHookEvent(JSON.parse(raw) as unknown, args[1] as 'codex' | 'claude-code')
      if (event) {
        try {
          await service.handleAgentEvent(event)
        } catch (error) {
          if (!(error instanceof VibeGitError) || ![
            'PROJECT_NOT_REGISTERED',
            'PROTECTION_NOT_ENABLED',
            'PROJECT_PATH_UNAVAILABLE'
          ].includes(error.code)) throw error
        }
      }
      stdout.write('{}\n')
      return
    }
    if (args[0] === 'projects' && args.length === 1) {
      print({ ok: true, data: await service.listProjects() })
      return
    }
    if (args[0] === 'checkpoints' && typeof args[1] === 'string' && args.length === 2) {
      print({ ok: true, data: service.listCheckpoints(args[1]) })
      return
    }
    if (args[0] === 'github-status' && args.length === 1) {
      print({ ok: true, data: await service.githubStatus() })
      return
    }
    throw new Error('未知命令；运行 vibegit --help 查看用法')
  } catch (error) {
    const publicError = toPublicError(error)
    stderr.write(`${publicError.message}${publicError.detail ? `: ${publicError.detail}` : ''}\n`)
    if (hookMode) stdout.write('{}\n')
    else print({ ok: false, error: publicError })
    process.exitCode = 1
  } finally {
    service?.close()
  }
}

void main()
