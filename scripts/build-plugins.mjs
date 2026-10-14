import { cp, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const pluginHosts = ['codex', 'claude-code', 'deepseek-harness', 'workbuddy']
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function marketplaceManifest() {
  return {
    name: 'vibegit-local',
    interface: { displayName: 'VibeGit Local' },
    plugins: [{ name: 'vibegit', source: { source: 'local', path: './vibegit' } }]
  }
}

/** These hosts require concrete paths; regenerate after moving an installation. */
export async function writeHostConfiguration(host, packageDirectory, nodeExecutable = process.execPath) {
  const server = join(packageDirectory, 'server', 'server.mjs')
  const config = { command: nodeExecutable, args: [server] }
  if (host === 'deepseek-harness') {
    const overlay = [{ insert: [{
      id: 'mcp-vibegit', name: '@deepseek-ai/dsh-mcp-client',
      config: { serverName: 'vibegit', transport: 'stdio', ...config }
    }] }]
    // JSON is valid YAML, avoiding a YAML dependency and ambiguous Windows escaping.
    await writeFile(join(packageDirectory, 'vibegit.cordis.yml'), `${JSON.stringify(overlay, null, 2)}\n`)
  } else if (host === 'workbuddy') {
    await writeFile(join(packageDirectory, 'mcp.json'), `${JSON.stringify({ mcpServers: { vibegit: config } }, null, 2)}\n`)
  }
}

export async function writeMarketplace(directory) {
  const manifestDirectory = join(directory, '.agents', 'plugins')
  await mkdir(manifestDirectory, { recursive: true })
  await writeFile(join(manifestDirectory, 'marketplace.json'), `${JSON.stringify(marketplaceManifest(), null, 2)}\n`)
}

export async function buildPlugins(root = projectRoot) {
  const canonicalRoot = await realpath(root)
  const distDirectory = join(canonicalRoot, 'dist')
  const outputDirectory = join(distDirectory, 'plugins')
  const serverBundle = join(distDirectory, 'mcp', 'index.js')
  const bundle = await readFile(serverBundle)
  const notices = await readFile(join(distDirectory, 'mcp', 'THIRD_PARTY_NOTICES.txt'))
  if (!bundle.length) throw new Error('The MCP bundle is empty; run build:mcp first.')
  if (!notices.length) throw new Error('The bundled dependency notices are empty; run build:mcp first.')
  // Check all inputs before replacing generated output.
  for (const host of pluginHosts) await realpath(join(canonicalRoot, 'integrations', host, 'vibegit'))
  const canonicalDist = await realpath(distDirectory)
  const inside = relative(canonicalRoot, canonicalDist)
  if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error('Refusing to replace plugin output outside the project directory.')
  }
  try {
    if ((await lstat(outputDirectory)).isSymbolicLink()) throw new Error('Plugin output must not be a symbolic link.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await rm(outputDirectory, { recursive: true, force: true })
  for (const host of pluginHosts) {
    const destination = join(outputDirectory, host, 'vibegit')
    await cp(join(canonicalRoot, 'integrations', host, 'vibegit'), destination, { recursive: true, errorOnExist: true, force: false })
    await mkdir(join(destination, 'server'), { recursive: true })
    await writeFile(join(destination, 'server', 'server.mjs'), bundle)
    await writeFile(join(destination, 'THIRD_PARTY_NOTICES.txt'), notices)
    await writeHostConfiguration(host, destination)
  }
  await writeMarketplace(join(outputDirectory, 'codex'))
  return { directory: outputDirectory, hosts: pluginHosts, node: '>=24', bundleBytes: bundle.length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(await buildPlugins())}\n`)
  } catch (error) {
    process.stderr.write(`Plugin build failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
