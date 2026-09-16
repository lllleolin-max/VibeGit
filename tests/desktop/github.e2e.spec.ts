import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { VibeGitService } from '@vibegit/core'

test('packaged backup UI exposes authorization progress while its safety scan is pending', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vibegit-github-ui-'))
  const projectPath = join(root, 'GitHub 备份验收')
  const dataDirectory = join(root, 'app-data')
  await mkdir(projectPath, { recursive: true })
  await writeFile(join(projectPath, 'README.md'), '# Synthetic backup acceptance project\n')
  const seed = new VibeGitService({ dataDirectory })
  const project = await seed.addProject({ path: projectPath })
  await seed.initializeProtection(project.id)
  seed.close()
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      ...(process.env.VIBEGIT_DESKTOP_EXECUTABLE ? { executablePath: process.env.VIBEGIT_DESKTOP_EXECUTABLE } : {}),
      args: ['.', `--user-data-dir=${join(root, 'electron-profile')}`],
      cwd: resolve('.'),
      env: { ...process.env, VIBEGIT_DATA_DIR: dataDirectory }
    })
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(join(root, 'electron-profile'))
    const page = await app.firstWindow()
    await page.waitForFunction(() => document.documentElement.dataset.vibegitReady === 'true')
    // These handlers deliberately simulate GitHub. The real packaged preload,
    // renderer, dialogs and polling run, without authorizing or uploading data.
    await app.evaluate(({ ipcMain }) => {
      let authenticated = false
      let authorizing = false
      let completeAuthorization: (() => void) | undefined
      let completeScan: (() => void) | undefined
      const testState = globalThis as typeof globalThis & { completeGitHubAcceptance?: () => void }
      for (const channel of ['github:status', 'github:authorization-status', 'github:authorize', 'github:scan']) ipcMain.removeHandler(channel)
      ipcMain.handle('github:status', () => ({ ok: true, data: {
        installed: true, authenticated, sshKeyReady: authenticated,
        ...(authenticated ? { username: 'acceptance-user' } : {}),
        message: authenticated ? 'GitHub 已连接' : '尚未连接 GitHub'
      } }))
      ipcMain.handle('github:authorization-status', () => ({ ok: true, data: {
        phase: authorizing ? 'authorizing' : authenticated ? 'complete' : 'idle',
        message: authorizing ? '请在 GitHub 输入验证码' : '连接检查完成',
        ...(authorizing ? { verificationUri: 'https://github.com/login/device', userCode: 'ABCD-EFGH' } : {})
      } }))
      ipcMain.handle('github:authorize', () => {
        authorizing = true
        return new Promise((resolveAuthorization) => {
          completeAuthorization = () => {
            authenticated = true
            authorizing = false
            resolveAuthorization({ ok: true, data: { username: 'acceptance-user', sshKeyCreated: true, message: 'GitHub 已连接，已确认专用 SSH 密钥' } })
          }
        })
      })
      ipcMain.handle('github:scan', () => new Promise((resolveScan) => {
        completeScan = () => resolveScan({ ok: true, data: { scannedAt: new Date().toISOString(), scannedFiles: 1, blocked: false, risks: [] } })
      }))
      testState.completeGitHubAcceptance = () => { completeAuthorization?.(); completeScan?.() }
    })
    await page.getByRole('button', { name: /GitHub 备份验收/ }).last().click()
    await expect(page.getByText('初始化项目')).toBeVisible()
    await page.getByRole('button', { name: 'GitHub 备份', exact: true }).click()
    await expect(page.getByRole('button', { name: '连接 GitHub 并创建 SSH 密钥' })).toBeEnabled()
    await expect(page.getByRole('button', { name: '安全备份到 GitHub' })).toBeDisabled()
    await expect(page.getByText('未发现阻止备份的风险')).toHaveCount(0)
    await page.getByRole('button', { name: '连接 GitHub 并创建 SSH 密钥' }).click()
    await expect(page.getByText('ABCD-EFGH', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: /授权|GitHub/ })).toHaveAttribute('href', 'https://github.com/login/device')
    await page.screenshot({ path: resolve('test-results', 'vibegit-github-authorization.png'), fullPage: true })
    await app.evaluate(() => {
      const testState = globalThis as typeof globalThis & { completeGitHubAcceptance?: () => void }
      testState.completeGitHubAcceptance?.()
    })
    await expect(page.getByText('ABCD-EFGH', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '检查并修复 GitHub 连接', exact: true })).toBeEnabled()
  } finally {
    await app?.close()
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
