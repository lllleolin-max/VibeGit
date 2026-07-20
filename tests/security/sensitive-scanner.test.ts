import { access, readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { TestSandbox } from '../helpers'
import { cleanupSandbox, createSandbox, writeProjectFile } from '../helpers'

const fakeSecret = () => ['abcdefghijklm', 'nopqrstuvwxyz123456'].join('')
const fakeAssignment = (key: string) => `${key}=${fakeSecret()}\n`

describe('Sensitive file protection', () => {
  let sandbox: TestSandbox | undefined
  afterEach(async () => { if (sandbox) await cleanupSandbox(sandbox); sandbox = undefined })

  it('blocks .env and token-like content without deleting files, then re-scans after ignore', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'app.ts', 'export const ok = true\n')
    await writeProjectFile(sandbox, '.env', fakeAssignment('API_KEY'))
    await writeProjectFile(sandbox, 'config.txt', fakeAssignment('access_token'))
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const scan = await sandbox.service.scanSensitiveFiles(project.id)
    expect(scan.blocked).toBe(true)
    expect(scan.risks.map((item) => item.path)).toEqual(expect.arrayContaining(['.env', 'config.txt']))
    await expect(access(`${sandbox.projectPath}/.env`)).resolves.toBeUndefined()

    const envRisk = scan.risks.find((item) => item.path === '.env' && item.ignoreSuggestion)
    expect(envRisk).toBeDefined()
    const rescanned = await sandbox.service.ignoreSensitiveRisk(project.id, envRisk!)
    expect(await readFile(`${sandbox.projectPath}/.gitignore`, 'utf8')).toContain('/.env')
    expect(rescanned.risks.some((item) => item.path === '.env')).toBe(false)
    expect(rescanned.blocked).toBe(true) // config.txt still contains a token.
  })

  it('never trusts a renderer-supplied gitignore rule', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, '.env', fakeAssignment('API_KEY'))
    await writeProjectFile(sandbox, 'keep.txt', 'keep me\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const scan = await sandbox.service.scanSensitiveFiles(project.id)
    const envRisk = scan.risks.find((item) => item.path === '.env' && item.ignoreSuggestion)
    expect(envRisk).toBeDefined()

    await sandbox.service.ignoreSensitiveRisk(project.id, { ...envRisk!, ignoreSuggestion: '*' })
    const ignore = await readFile(`${sandbox.projectPath}/.gitignore`, 'utf8')
    expect(ignore).toContain('/.env')
    expect(ignore.split(/\r?\n/)).not.toContain('*')
  })

  it('reports a missing GitHub CLI without blocking local protection', async () => {
    sandbox = await createSandbox()
    const isolated = new (await import('@vibegit/core')).VibeGitService({
      dataDirectory: `${sandbox.root}/other-data`,
      ghExecutable: `${sandbox.root}/missing-gh.exe`
    })
    expect(await isolated.githubStatus()).toMatchObject({ installed: false, authenticated: false })
    isolated.close()
  })

  it('blocks files larger than the remote-backup safety limit', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'assets/large.bin', Buffer.alloc(10 * 1024 * 1024 + 1, 0x61))
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)

    const scan = await sandbox.service.scanSensitiveFiles(project.id)
    expect(scan.blocked).toBe(true)
    expect(scan.risks).toContainEqual(expect.objectContaining({
      path: 'assets/large.bin',
      kind: 'large_file',
      severity: 'blocked'
    }))
  })

  it('scans multi-megabyte text, blocks LFS pointers, and suggests only the matched dependency directory', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(
      sandbox,
      'large-config.txt',
      `${'x'.repeat(3 * 1024 * 1024)}\n${fakeAssignment('access_token')}`
    )
    await writeProjectFile(
      sandbox,
      'video.dat',
      'version https://git-lfs.github.com/spec/v1\noid sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\nsize 123456\n'
    )
    await writeProjectFile(sandbox, 'packages/app/node_modules/example/index.js', 'module.exports = true\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)

    const scan = await sandbox.service.scanSensitiveFiles(project.id)
    expect(scan.risks).toContainEqual(expect.objectContaining({ path: 'large-config.txt', kind: 'access_token' }))
    expect(scan.risks).toContainEqual(expect.objectContaining({ path: 'video.dat', kind: 'lfs_pointer' }))
    expect(scan.risks).toContainEqual(expect.objectContaining({
      path: 'packages/app/node_modules/example/index.js',
      kind: 'dependency_directory',
      ignoreSuggestion: '/packages/app/node_modules/'
    }))
  })

  it('scans UTF-16 credentials and blocks common package-manager credential files', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(
      sandbox,
      'config.txt',
      Buffer.from(fakeAssignment('access_token'), 'utf16le')
    )
    await writeProjectFile(
      sandbox,
      '.npmrc',
      `//registry.npmjs.org/:_authToken=${['npm', '_'].join('')}${fakeSecret()}\n`
    )
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)

    const scan = await sandbox.service.scanSensitiveFiles(project.id)
    expect(scan.risks).toContainEqual(expect.objectContaining({ path: 'config.txt', kind: 'access_token' }))
    expect(scan.risks).toContainEqual(expect.objectContaining({ path: '.npmrc', kind: 'credentials' }))
    expect(scan.risks).toContainEqual(expect.objectContaining({ path: '.npmrc', kind: 'access_token' }))
  })
})
