import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { VibeGitError } from '@vibegit/shared'

interface ProcessResult {
  exitCode: number
  stdout: string
  stderr: string
}

interface ProcessOptions {
  cwd: string
  environment: NodeJS.ProcessEnv
  timeoutMs: number
  onOutput?: (chunk: string) => void
  unavailable: (error: Error) => VibeGitError
  timeout: () => VibeGitError
  outputLimit: () => VibeGitError
}

// gh and ssh-keygen may run wrappers or helpers. Do not release an operation
// while those children can still mutate authentication or managed-key files.
export async function runBoundedProcess(executable: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
  return await new Promise((resolvePromise, reject) => {
    let settled = false
    let terminationError: VibeGitError | undefined
    let terminationTimer: ReturnType<typeof setTimeout> | undefined
    let outputBytes = 0
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let child
    try {
      child = spawn(executable, args, {
        cwd: resolve(options.cwd),
        env: options.environment,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      reject(options.unavailable(error instanceof Error ? error : new Error(String(error))))
      return
    }
    const terminate = (error: VibeGitError): void => {
      if (settled || terminationError) return
      terminationError = error
      clearTimeout(timer)
      terminationTimer = setTimeout(() => {
        if (settled) return
        settled = true
        child.stdout.destroy()
        child.stderr.destroy()
        child.unref()
        reject(new VibeGitError(error.code, '操作已停止等待，但无法确认工具子进程已全部退出', {
          remediation: '请先关闭本次 GitHub 或 SSH 操作关联的进程后重试；本地保存点未受影响。',
          retryable: true,
          cause: error
        }))
      }, 5000)
      if (process.platform === 'win32') {
        // Once the root exits its PID may be reused: never target it then.
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
        const fallback = (): void => {
          if (child.exitCode === null && child.signalCode === null) child.kill()
        }
        try {
          const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), [
            '/PID', String(child.pid), '/T', '/F'
          ], { windowsHide: true, shell: false, stdio: 'ignore', timeout: 4000 })
          killer.once('error', fallback)
          killer.once('close', (code) => { if (code !== 0) fallback() })
        } catch { fallback() }
      } else if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      }
    }
    const timer = setTimeout(() => terminate(options.timeout()), options.timeoutMs)
    const append = (target: Buffer[], chunk: Buffer): void => {
      if (settled || terminationError) return
      outputBytes += chunk.length
      if (outputBytes > 4 * 1024 * 1024) {
        terminate(options.outputLimit())
        return
      }
      target.push(chunk)
      options.onOutput?.(chunk.toString('utf8'))
    }
    child.stdout.on('data', (chunk: Buffer) => append(stdout, chunk))
    child.stderr.on('data', (chunk: Buffer) => append(stderr, chunk))
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(terminationTimer)
      reject(terminationError ?? options.unavailable(error))
    })
    child.once('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(terminationTimer)
      if (terminationError) reject(terminationError)
      else resolvePromise({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      })
    })
  })
}
