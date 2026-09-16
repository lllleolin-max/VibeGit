import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultDataDirectory, saveDataDirectoryPreference, VibeGitService } from '@vibegit/core'

describe('Shared desktop and CLI data directory', () => {
  let root: string
  let configRoot: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vibegit-preferences-test-'))
    // Never read or write the real user's preferences on any supported platform.
    vi.stubEnv('HOME', root)
    vi.stubEnv('USERPROFILE', root)
    vi.stubEnv('APPDATA', join(root, 'appdata'))
    vi.stubEnv('XDG_CONFIG_HOME', join(root, 'config'))
    vi.stubEnv('XDG_DATA_HOME', join(root, 'data'))
    vi.stubEnv('VIBEGIT_DATA_DIR', '')
    configRoot = process.platform === 'win32'
      ? join(root, 'appdata')
      : process.platform === 'darwin'
        ? join(root, 'Library', 'Application Support')
        : join(root, 'config')
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  it('opens the same project registry from a fresh default CLI service after the desktop saves a preference', async () => {
    const chosen = join(root, 'chosen records')
    await saveDataDirectoryPreference(chosen)
    const projectPath = join(root, 'project')
    await mkdir(projectPath)
    const desktop = new VibeGitService({ dataDirectory: defaultDataDirectory() })
    let projectId: string
    try {
      projectId = (await desktop.addProject({ path: projectPath, initialize: true })).id
    } finally {
      desktop.close()
    }

    const cli = new VibeGitService()
    try {
      expect(cli.settings.dataDirectory).toBe(resolve(chosen))
      expect(cli.database.getProject(projectId!)?.protectionEnabled).toBe(true)
      const event = await cli.handleAgentEvent({
        event: 'task-start', agent: 'codex', projectPath,
        sessionId: 'shared-config', timestamp: new Date().toISOString()
      })
      expect(event.checkpoint?.projectId).toBe(projectId!)
    } finally {
      cli.close()
    }
  })

  it('keeps an explicit environment override ahead of saved preferences without rewriting either location', async () => {
    const chosen = join(root, 'chosen records')
    await saveDataDirectoryPreference(chosen)
    const override = join(root, 'environment records')
    vi.stubEnv('VIBEGIT_DATA_DIR', override)
    expect(defaultDataDirectory()).toBe(resolve(override))
    const cli = new VibeGitService()
    try { expect(cli.settings.dataDirectory).toBe(resolve(override)) } finally { cli.close() }
    vi.stubEnv('VIBEGIT_DATA_DIR', '')
    expect(defaultDataDirectory()).toBe(resolve(chosen))
  })

  it.each(['vibegit', 'VibeGit'])('reads an existing Electron preference under %s', async (appName) => {
    const legacyDirectory = join(configRoot, appName)
    const chosen = join(root, 'legacy records')
    await mkdir(legacyDirectory, { recursive: true })
    const path = join(legacyDirectory, 'vibegit-preferences.json')
    const content = JSON.stringify({ dataDirectory: chosen })
    await writeFile(path, content)
    expect(defaultDataDirectory()).toBe(resolve(chosen))
    expect(await readFile(path, 'utf8')).toBe(content)
  })

  it('updates a preference without moving old records and recovers from malformed preferences', async () => {
    const before = join(root, 'before')
    const after = join(root, 'after')
    await mkdir(before)
    await writeFile(join(before, 'existing-record.txt'), 'preserve')
    await saveDataDirectoryPreference(before)
    await saveDataDirectoryPreference(after)
    expect(defaultDataDirectory()).toBe(resolve(after))
    expect(await readFile(join(before, 'existing-record.txt'), 'utf8')).toBe('preserve')

    const appName = process.platform === 'linux' ? 'vibegit' : 'VibeGit'
    await writeFile(join(configRoot, appName, 'vibegit-preferences.json'), '{invalid json')
    const fallback = process.platform === 'win32'
      ? join(root, 'appdata', 'VibeGit')
      : process.platform === 'darwin'
        ? join(root, 'Library', 'Application Support', 'VibeGit')
        : join(root, 'data', 'vibegit')
    expect(defaultDataDirectory()).toBe(resolve(fallback))
  })
})
