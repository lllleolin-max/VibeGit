import { afterEach, describe, expect, it, vi } from 'vitest'
import { VibeGitError } from '@vibegit/shared'
import { runBoundedProcess } from '../../packages/github-provider/src/bounded-process'

describe('GitHub tool process lifecycle', () => {
  const descendants = new Set<number>()
  afterEach(() => {
    // Only fixtures created by this test may need cleanup after a failed check.
    for (const pid of descendants) {
      try { process.kill(pid, 'SIGKILL') } catch { /* Already exited. */ }
    }
    descendants.clear()
  })

  it.each(['timeout', 'output'] as const)('terminates a live tool and its descendant before reporting %s failure', async (failure) => {
    let descendant: number | undefined
    const script = `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'inherit' });
      console.log('fixture-child:' + child.pid);
      ${failure === 'output' ? "setTimeout(() => process.stdout.write('x'.repeat(5 * 1024 * 1024)), 100);" : ''}
      setInterval(() => {}, 1000);
    `
    await expect(runBoundedProcess(process.execPath, ['-e', script], {
      cwd: process.cwd(), environment: { ...process.env }, timeoutMs: 1500,
      onOutput: (chunk) => {
        const match = chunk.match(/fixture-child:(\d+)/)
        if (match) { descendant = Number(match[1]); descendants.add(descendant) }
      },
      unavailable: () => new VibeGitError('UNAVAILABLE', 'unavailable'),
      timeout: () => new VibeGitError('TOOL_TIMEOUT', 'timeout'),
      outputLimit: () => new VibeGitError('TOOL_OUTPUT_LIMIT', 'output limit')
    })).rejects.toMatchObject({ code: failure === 'timeout' ? 'TOOL_TIMEOUT' : 'TOOL_OUTPUT_LIMIT' })
    expect(descendant).toBeDefined()
    await vi.waitFor(() => expect(() => process.kill(descendant!, 0)).toThrow(), { timeout: 2000 })
    descendants.delete(descendant!)
  })

  it('drains stdout and stderr and preserves the exit status for caller policy', async () => {
    await expect(runBoundedProcess(process.execPath, ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exitCode = 7;'], {
      cwd: process.cwd(), environment: { ...process.env }, timeoutMs: 5000,
      unavailable: () => new VibeGitError('UNAVAILABLE', 'unavailable'),
      timeout: () => new VibeGitError('TOOL_TIMEOUT', 'timeout'),
      outputLimit: () => new VibeGitError('TOOL_OUTPUT_LIMIT', 'output limit')
    })).resolves.toEqual({ exitCode: 7, stdout: 'out', stderr: 'err' })
  })

})
