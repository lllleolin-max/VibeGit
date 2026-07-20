import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { VibeGitService } from '@vibegit/core'

test('built desktop app completes save → diff → restore → undo without a white screen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vibegit-desktop-e2e-'))
  const projectPath = join(root, '桌面 验收项目')
  const dataDirectory = join(root, 'app-data')
  await mkdir(projectPath, { recursive: true })
  await writeFile(join(projectPath, 'app.txt'), 'version one\n', 'utf8')
  const seed = new VibeGitService({ dataDirectory })
  const project = await seed.addProject({ path: projectPath })
  await seed.initializeProtection(project.id)
  seed.close()

  let app: ElectronApplication | undefined
  let page: Page | undefined
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  try {
    app = await electron.launch({
      args: ['.'],
      cwd: resolve('.'),
      env: { ...process.env, VIBEGIT_DATA_DIR: dataDirectory }
    })
    page = await app.firstWindow()
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    await page.waitForFunction(() => document.documentElement.dataset.vibegitReady === 'true')
    const health = await page.evaluate(async () => await window.vibegit.health())
    expect(health).toMatchObject({ ok: true, data: { ready: true, database: 'ok', git: 'ok' } })
    expect(await page.locator('body').innerText()).toContain('VibeGit')

    await page.getByRole('button', { name: /桌面 验收项目/ }).last().click()
    await expect(page.getByRole('heading', { name: '桌面 验收项目' })).toBeVisible()
    await expect(page.getByText('初始化项目')).toBeVisible()
    await page.screenshot({ path: resolve('test-results', 'vibegit-timeline.png'), fullPage: true })

    await writeFile(join(projectPath, 'app.txt'), 'version two\nnew feature\n', 'utf8')
    await page.getByRole('button', { name: '刷新项目状态' }).click()
    await expect(page.getByText('有新的修改')).toBeVisible()
    await page.getByRole('button', { name: '创建保存点' }).click()
    await page.getByLabel('给这个版本一个容易记住的名字').fill('桌面 E2E 功能版本')
    await page.getByRole('button', { name: '保存当前版本' }).click()
    await expect(page.getByText('桌面 E2E 功能版本')).toBeVisible()

    await page.getByRole('button', { name: /桌面 E2E 功能版本/ }).click()
    await expect(page.getByText('+new feature')).toBeVisible()
    await page.screenshot({ path: resolve('test-results', 'vibegit-diff.png'), fullPage: true })
    await page.getByRole('button', { name: '关闭详情' }).click()

    await page.getByRole('button', { name: /初始化项目/ }).click()
    await page.getByRole('button', { name: '回到这个版本' }).click()
    await page.getByRole('checkbox', { name: /我已了解这些文件变化/ }).check()
    await page.getByRole('button', { name: /确认并安全回退/ }).click()
    await expect(page.getByText('已回到所选版本；回退前内容仍可找回')).toBeVisible()
    expect((await readFile(join(projectPath, 'app.txt'), 'utf8')).replaceAll('\r\n', '\n')).toBe('version one\n')

    await page.getByRole('button', { name: /撤销本次回退/ }).click()
    await expect(page.getByText('已撤销本次回退，文件恢复到回退前状态')).toBeVisible()
    expect((await readFile(join(projectPath, 'app.txt'), 'utf8')).replaceAll('\r\n', '\n')).toBe('version two\nnew feature\n')
    await page.screenshot({ path: resolve('test-results', 'vibegit-desktop-e2e.png'), fullPage: true })
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  } finally {
    await app?.close()
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('built desktop app ignores an injected renderer URL and shows the local first-use state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vibegit-desktop-empty-'))
  const projectPath = join(root, '从界面添加的项目')
  await mkdir(projectPath, { recursive: true })
  await writeFile(join(projectPath, 'hello.txt'), 'hello from UI\n', 'utf8')
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      args: ['.'],
      cwd: resolve('.'),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ELECTRON_RENDERER_URL: 'https://example.com/untrusted-renderer',
        VIBEGIT_DATA_DIR: join(root, 'app-data')
      }
    })
    const page = await app.firstWindow()
    await page.waitForFunction(() => document.documentElement.dataset.vibegitReady === 'true')
    await expect(page.getByRole('heading', { name: '先选择一个正在用 AI 开发的文件夹' })).toBeVisible()
    await expect(page.getByRole('button', { name: /选择项目文件夹/ })).toBeEnabled()
    await page.screenshot({ path: resolve('test-results', 'vibegit-empty.png'), fullPage: true })
    await app.evaluate(({ dialog }, selectedPath) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [selectedPath] })
      })
    }, projectPath)
    await page.getByRole('button', { name: /选择项目文件夹/ }).click()
    await expect(page.getByRole('heading', { name: '从界面添加的项目' })).toBeVisible()
    await expect(page.getByText('为这个项目开启版本保护')).toBeVisible()
    await page.getByRole('button', { name: '开启版本保护' }).click()
    await expect(page.getByText('初始化项目')).toBeVisible()
    await expect(access(join(projectPath, '.git'))).resolves.toBeUndefined()
    await page.screenshot({ path: resolve('test-results', 'vibegit-first-use-protected.png'), fullPage: true })
  } finally {
    await app?.close()
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
