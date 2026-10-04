import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { InstallationRunner } from '../../apps/desktop/src/main/installation-runner'

describe('desktop dependency installer lifecycle', () => {
  it('preserves the exit status and drains both output streams with a 4 KB tail', async () => {
    const runner = new InstallationRunner()
    const result = await runner.run(process.execPath, ['-e', `
      process.stdout.write('x'.repeat(1024 * 1024));
      process.stderr.write('y'.repeat(1024 * 1024));
      process.exitCode = 7;
    `], 10_000)
    expect(result.code).toBe(7)
    expect(Buffer.byteLength(result.output)).toBe(4_096)
    expect(result.output).toMatch(/^[xy]+$/)
    expect(await runner.run(process.execPath, ['-e', 'process.stdout.write("ready")'], 10_000)).toEqual({ code: 0, output: 'ready' })
  })

  it('limits UI waiting, retains installation ownership after timeout, and allows retry only after close', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibegit-installer-test-'))
    const ready = join(root, 'ready')
    const release = join(root, 'release')
    const finished = join(root, 'finished')
    const runner = new InstallationRunner()
    const started = Date.now()
    const operation = runner.run(process.execPath, ['-e', `
      const fs = require('node:fs');
      const [ready, release, finished] = process.argv.slice(1);
      fs.writeFileSync(ready, String(process.pid));
      const timer = setInterval(() => {
        process.stdout.write('a'.repeat(8192));
        process.stderr.write('b'.repeat(8192));
        if (fs.existsSync(release)) {
          clearInterval(timer);
          fs.writeFileSync(finished, 'finished without being killed');
        }
      }, 10);
    `, ready, release, finished], 100)
    try {
      await expect(runner.run(process.execPath, ['-e', 'process.exit(99)'])).rejects.toMatchObject({ code: 'DEPENDENCY_INSTALL_IN_PROGRESS' })
      await expect(operation).rejects.toMatchObject({ code: 'DEPENDENCY_INSTALL_TIMEOUT', message: expect.stringContaining('安装程序可能仍在运行') })
      expect(Date.now() - started).toBeLessThan(5_000)
      await vi.waitFor(() => access(ready), { timeout: 10_000 })
      await expect(runner.run(process.execPath, ['-e', 'process.exit(99)'])).rejects.toMatchObject({ code: 'DEPENDENCY_INSTALL_IN_PROGRESS' })
      await writeFile(release, '')
      await vi.waitFor(() => access(finished), { timeout: 10_000 })
      expect(await readFile(finished, 'utf8')).toBe('finished without being killed')
      await vi.waitFor(async () => {
        expect(await runner.run(process.execPath, ['-e', 'process.stdout.write("retry succeeded")'], 10_000)).toEqual({ code: 0, output: 'retry succeeded' })
      }, { timeout: 10_000 })
    } finally {
      await writeFile(release, '')
      try { await vi.waitFor(() => access(finished), { timeout: 10_000 }) }
      catch {
        // Only the explicitly created test fixture can require cleanup.
        try { process.kill(Number(await readFile(ready, 'utf8')), 'SIGKILL') } catch { /* Already exited or not started. */ }
      }
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 30_000)

  it('releases a failed spawn without allowing its later close event to unlock a newer operation', async () => {
    const runner = new InstallationRunner()
    await expect(runner.run(join(tmpdir(), 'vibegit-nonexistent-installer.exe'), [])).rejects.toMatchObject({ code: 'DEPENDENCY_INSTALL_UNAVAILABLE' })
    const running = runner.run(process.execPath, ['-e', 'setTimeout(() => process.stdout.write("done"), 200)'], 10_000)
    await new Promise<void>((resolve) => setImmediate(resolve))
    await expect(runner.run(process.execPath, ['-e', 'process.exit(99)'])).rejects.toMatchObject({ code: 'DEPENDENCY_INSTALL_IN_PROGRESS' })
    expect(await running).toEqual({ code: 0, output: 'done' })
  })
})
