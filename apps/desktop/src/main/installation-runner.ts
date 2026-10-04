import { spawn } from 'node:child_process'
import { VibeGitError } from '@vibegit/shared'

export class InstallationRunner {
  private active: symbol | undefined

  async run(executable: string, args: string[], timeoutMs = 5 * 60_000): Promise<{ code: number; output: string }> {
    if (this.active) throw new VibeGitError('DEPENDENCY_INSTALL_IN_PROGRESS', '已有安装程序正在运行', {
      remediation: '请等待安装程序结束，再重新检测环境。', retryable: true
    })
    const operation = Symbol('installation')
    this.active = operation
    return await new Promise((resolve, reject) => {
      let settled = false
      let output: Buffer = Buffer.alloc(0)
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        output = Buffer.alloc(0)
        reject(new VibeGitError('DEPENDENCY_INSTALL_TIMEOUT', '安装等待超时，安装程序可能仍在运行', {
          remediation: '请稍后重新检测环境；等待期间不会重复启动安装程序。', retryable: true
        }))
        // MSI may already be updating files. Keep draining its pipes and retain
        // ownership until close/error rather than terminating the installer.
      }, timeoutMs)
      const finish = (error?: Error, code = -1): void => {
        clearTimeout(timer)
        if (this.active === operation) this.active = undefined
        if (settled) return
        settled = true
        if (error) reject(new VibeGitError('DEPENDENCY_INSTALL_UNAVAILABLE', '无法启动安装程序', {
          remediation: '请确认 Windows 包管理器可用，或手动安装 GitHub CLI 后重新检测。', cause: error
        }))
        else resolve({ code, output: output.toString('utf8') })
      }
      try {
        const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        const append = (chunk: Buffer): void => {
          if (!settled) output = Buffer.concat([output, chunk.subarray(-4_096)]).subarray(-4_096)
        }
        child.stdout.on('data', append)
        child.stderr.on('data', append)
        child.once('error', (error) => finish(error))
        child.once('close', (code) => finish(undefined, code ?? -1))
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
    })
  }
}
