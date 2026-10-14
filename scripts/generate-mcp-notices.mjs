import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'dist', 'mcp')
const metadata = JSON.parse(await readFile(join(output, 'metafile-esm.json'), 'utf8'))
const packages = new Map()

// Only redistribute notices for dependencies actually included in the bundle.
for (const input of Object.keys(metadata.inputs)) {
  if (!input.replaceAll('\\', '/').includes('node_modules/')) continue
  let directory = dirname(resolve(root, input))
  while (directory !== dirname(directory)) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      if (manifest.name && manifest.version) {
        packages.set(`${manifest.name}@${manifest.version}`, { directory, manifest })
        break
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    directory = dirname(directory)
  }
}
if (!packages.size) throw new Error('No bundled dependency metadata found.')

const sections = ['VibeGit MCP bundled third-party software notices\nGenerated from the build metafile.']
for (const [name, { directory, manifest }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const files = (await readdir(directory)).filter((file) => /^(license|licence|copying|notice)(\.|$)/i.test(file)).sort()
  if (!files.length) throw new Error(`Missing license text for bundled dependency ${name}`)
  const notices = await Promise.all(files.map(async (file) => `${file}\n${await readFile(join(directory, file), 'utf8')}`))
  sections.push(`${name}\nLicense: ${manifest.license ?? 'See included notice'}\n\n${notices.join('\n\n')}`)
}
await writeFile(join(output, 'THIRD_PARTY_NOTICES.txt'), `${sections.join('\n\n----------------------------------------\n\n')}\n`)
