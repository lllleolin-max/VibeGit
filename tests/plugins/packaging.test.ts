import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const buildModule = pathToFileURL(resolve('scripts/build-plugins.mjs')).href
const installModule = pathToFileURL(resolve('scripts/install-agent.mjs')).href
const { buildPlugins, pluginHosts } = await import(buildModule) as {
  buildPlugins(root: string): Promise<{ hosts: string[] }>
  pluginHosts: string[]
}
const { installAgent } = await import(installModule) as {
  installAgent(options: { host: string; destination: string; root: string; configPath?: string }): Promise<{ directory: string }>
}
const temporaryRoots: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'vibegit-package-test-'))
  temporaryRoots.push(root)
  await mkdir(join(root, 'dist', 'mcp'), { recursive: true })
  await writeFile(join(root, 'dist', 'mcp', 'index.js'), 'process.stdin.resume()\n')
  await writeFile(join(root, 'dist', 'mcp', 'THIRD_PARTY_NOTICES.txt'), 'Bundled dependency licenses\n')
  for (const host of pluginHosts) {
    const template = join(root, 'integrations', host, 'vibegit')
    await mkdir(join(template, 'skills', 'vibegit-save'), { recursive: true })
    await writeFile(join(template, 'skills', 'vibegit-save', 'SKILL.md'), '---\nname: vibegit-save\n---\nSave a checkpoint.\n')
  }
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3 })))
})

describe('agent plugin packaging', () => {
  it('stages all packages with the same bundled server and concrete host configuration', async () => {
    const root = await fixture()
    const result = await buildPlugins(root)
    expect(result.hosts).toEqual(pluginHosts)
    for (const host of pluginHosts) {
      expect(await readFile(join(root, 'dist', 'plugins', host, 'vibegit', 'server', 'server.mjs'), 'utf8')).toBe('process.stdin.resume()\n')
      expect(await readFile(join(root, 'dist', 'plugins', host, 'vibegit', 'THIRD_PARTY_NOTICES.txt'), 'utf8')).toBe('Bundled dependency licenses\n')
    }
    const workBuddy = JSON.parse(await readFile(join(root, 'dist', 'plugins', 'workbuddy', 'vibegit', 'mcp.json'), 'utf8'))
    expect(workBuddy.mcpServers.vibegit).toEqual({
      command: process.execPath,
      args: [join(root, 'dist', 'plugins', 'workbuddy', 'vibegit', 'server', 'server.mjs')]
    })
    const deepSeek = JSON.parse(await readFile(join(root, 'dist', 'plugins', 'deepseek-harness', 'vibegit', 'vibegit.cordis.yml'), 'utf8'))
    expect(deepSeek[0].insert[0].name).toBe('@deepseek-ai/dsh-mcp-client')
    expect(deepSeek[0].insert[0].config.args).toEqual([join(root, 'dist', 'plugins', 'deepseek-harness', 'vibegit', 'server', 'server.mjs')])
  })

  it('installs the Codex marketplace and refuses an existing destination', async () => {
    const root = await fixture()
    await buildPlugins(root)
    const destination = join(root, 'installed marketplace')
    await installAgent({ host: 'codex', destination, root })
    const marketplace = JSON.parse(await readFile(join(destination, '.agents', 'plugins', 'marketplace.json'), 'utf8'))
    expect(marketplace.name).toBe('vibegit-local')
    expect(marketplace.plugins[0].source.path).toBe('./vibegit')
    expect(await readFile(join(destination, 'vibegit', 'server', 'server.mjs'), 'utf8')).toBe('process.stdin.resume()\n')
    await expect(installAgent({ host: 'codex', destination, root })).rejects.toThrow('Destination already exists')
  })

  it('merges WorkBuddy configuration while preserving unrelated entries', async () => {
    const root = await fixture()
    await buildPlugins(root)
    const destination = join(root, 'installed workbuddy')
    const configPath = join(root, 'settings', 'mcp.json')
    await mkdir(dirname(configPath))
    const unrelated = { command: 'existing-server', args: ['--flag'], env: { EXAMPLE: 'preserve-me' } }
    await writeFile(configPath, JSON.stringify({ theme: 'dark', mcpServers: { unrelated } }))
    await installAgent({ host: 'workbuddy', destination, configPath, root })
    const merged = JSON.parse(await readFile(configPath, 'utf8'))
    expect(merged.theme).toBe('dark')
    expect(merged.mcpServers.unrelated).toEqual(unrelated)
    expect(merged.mcpServers.vibegit).toEqual({ command: process.execPath, args: [join(destination, 'server', 'server.mjs')] })
    const generated = JSON.parse(await readFile(join(destination, 'mcp.json'), 'utf8'))
    expect(generated.mcpServers.vibegit).toEqual(merged.mcpServers.vibegit)
  })

  it.each([null, { command: 'old-server', args: [] }, { command: 'node', args: [], disabled: true }])(
    'refuses a conflicting WorkBuddy entry before copying any package: %j', async (entry) => {
      const root = await fixture()
      await buildPlugins(root)
      const destination = join(root, 'conflicted-install')
      const configPath = join(root, 'mcp.json')
      const original = JSON.stringify({ mcpServers: { vibegit: entry } })
      await writeFile(configPath, original)
      await expect(installAgent({ host: 'workbuddy', destination, configPath, root })).rejects.toThrow('left unchanged')
      expect(await readFile(configPath, 'utf8')).toBe(original)
      await expect(readFile(join(destination, 'server', 'server.mjs'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it('refuses to rebuild through a dist directory link pointing outside the project', async () => {
    const root = await fixture()
    const external = await mkdtemp(join(tmpdir(), 'vibegit-external-build-'))
    temporaryRoots.push(external)
    await mkdir(join(external, 'mcp'))
    await mkdir(join(external, 'plugins'))
    await writeFile(join(external, 'mcp', 'index.js'), 'bundle')
    await writeFile(join(external, 'mcp', 'THIRD_PARTY_NOTICES.txt'), 'notices')
    await writeFile(join(external, 'plugins', 'keep.txt'), 'unrelated')
    await rm(join(root, 'dist'), { recursive: true })
    await symlink(external, join(root, 'dist'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(buildPlugins(root)).rejects.toThrow('outside the project')
    expect(await readFile(join(external, 'plugins', 'keep.txt'), 'utf8')).toBe('unrelated')
  })
})
