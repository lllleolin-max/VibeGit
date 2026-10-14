import { randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { pluginHosts, writeHostConfiguration, writeMarketplace } from './build-plugins.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const help = `Usage: node scripts/install-agent.mjs <${pluginHosts.join('|')}> --destination <directory> [--config <file>]

Copies a built plugin to a NEW durable directory. Requires Node.js 24+ and Git.
For Codex, destination is a marketplace root containing ./vibegit and .agents/.
For other hosts, destination is the VibeGit plugin package itself.
--config is optional and only supported for WorkBuddy: merge the MCP entry into
the exact JSON file provided, preserving unrelated entries and refusing conflicts.
Without --config, no host configuration or user skills are modified.
Run build:plugins first. Do not move the directory after installing.
`

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function mergeWorkBuddyConfig(existing, entry) {
  if (!object(existing) || (existing.mcpServers !== undefined && !object(existing.mcpServers))) {
    throw new Error('WorkBuddy configuration must be an object with an optional mcpServers object.')
  }
  const current = existing.mcpServers?.vibegit
  if (current !== undefined) {
    // Extra flags can change launch behavior. Treat them as a conflict too.
    if (!object(current) || JSON.stringify(Object.keys(current).sort()) !== JSON.stringify(['args', 'command'])
      || current.command !== entry.command || JSON.stringify(current.args) !== JSON.stringify(entry.args)) {
      throw new Error('A different WorkBuddy vibegit entry already exists; it was left unchanged.')
    }
  }
  return { ...existing, mcpServers: { ...existing.mcpServers, vibegit: entry } }
}

async function readConfiguration(path) {
  try {
    const metadata = await lstat(path)
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Host configuration must be a regular file, not a link.')
    return { existed: true, text: await readFile(path, 'utf8') }
  } catch (error) {
    if (error.code === 'ENOENT') return { existed: false, text: '{}' }
    throw error
  }
}

export async function installAgent({ host, destination, configPath, root = projectRoot }) {
  if (!pluginHosts.includes(host)) throw new Error(`Unknown host: ${host}`)
  if (!destination) throw new Error('--destination is required.')
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('VibeGit requires Node.js 24 or newer.')
  if (configPath && host !== 'workbuddy') throw new Error('--config is supported only for WorkBuddy.')
  const target = resolve(destination)
  const packageDirectory = host === 'codex' ? join(target, 'vibegit') : target
  const source = join(resolve(root), 'dist', 'plugins', host, 'vibegit')
  await lstat(join(source, 'server', 'server.mjs'))
  try {
    await lstat(target)
    throw new Error('Destination already exists; choose a new directory. Existing installations are never overwritten.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  let configuration
  let merged
  if (configPath) {
    configuration = await readConfiguration(resolve(configPath))
    merged = mergeWorkBuddyConfig(JSON.parse(configuration.text), {
      command: process.execPath, args: [join(packageDirectory, 'server', 'server.mjs')]
    })
  }
  await mkdir(dirname(target), { recursive: true })
  await cp(source, packageDirectory, { recursive: true, errorOnExist: true, force: false })
  await writeHostConfiguration(host, packageDirectory)
  if (host === 'codex') await writeMarketplace(target)
  if (configPath) {
    const path = resolve(configPath)
    // Detect changes made while the package was copied; never replace newer host settings.
    const latest = await readConfiguration(path)
    if (latest.existed !== configuration.existed || latest.text !== configuration.text) {
      throw new Error(`Host configuration changed during installation and was left unchanged. Package staged at ${target}.`)
    }
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.vibegit-${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
      const beforeReplace = await readConfiguration(path)
      if (beforeReplace.existed !== configuration.existed || beforeReplace.text !== configuration.text) {
        throw new Error(`Host configuration changed during installation and was left unchanged. Package staged at ${target}.`)
      }
      if (configuration.existed) {
        const backup = `${path}.vibegit-backup-${randomUUID()}`
        await writeFile(backup, configuration.text, { flag: 'wx', mode: 0o600 })
      }
      // The complete new file is renamed in one step; a partial write cannot
      // truncate settings for other MCP servers.
      await rename(temporary, path)
    } finally {
      await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error })
    }
  }
  return { host, directory: target, packageDirectory, ...(configPath ? { configPath: resolve(configPath) } : {}) }
}

function parseArguments(args) {
  const [host, ...options] = args
  if (!host || host === '--help' || host === '-h') return undefined
  const result = { host }
  for (let index = 0; index < options.length; index += 2) {
    const key = options[index]
    const value = options[index + 1]
    if (!['--destination', '--config'].includes(key) || !value || value.startsWith('--')) throw new Error(`Invalid option: ${key}`)
    const field = key === '--destination' ? 'destination' : 'configPath'
    if (result[field]) throw new Error(`Duplicate option: ${key}`)
    result[field] = value
  }
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (!options) process.stdout.write(help)
    else process.stdout.write(`${JSON.stringify(await installAgent(options), null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`Plugin installation failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
