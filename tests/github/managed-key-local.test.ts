import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { GitHubProvider, type GhExecutor } from '@vibegit/github-provider'
import { cleanupSandbox, createSandbox } from '../helpers'

it('generates and re-registers a real local SSH key without contacting GitHub', async () => {
  const sandbox = await createSandbox('local managed SSH key')
  let registeredPublicKey = ''
  let registrations = 0
  const executor: GhExecutor = async (_cwd, args) => {
    if (args[0] === '--version' || args[0] === 'auth') return { exitCode: 0, stdout: '', stderr: '' }
    if (args[0] === 'api' && args.includes('user/keys')) return { exitCode: 0, stdout: registeredPublicKey, stderr: '' }
    if (args[0] === 'api' && args.includes('user')) return { exitCode: 0, stdout: 'vibegit-local-test\n', stderr: '' }
    if (args[0] === 'ssh-key' && args[1] === 'add') {
      registeredPublicKey = await readFile(args[2]!, 'utf8')
      registrations += 1
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    throw new Error(`Unexpected synthetic GitHub command: ${args[0]}`)
  }
  const provider = new GitHubProvider(sandbox.service.database, sandbox.service.git, sandbox.service.checkpoints, {
    executor, dataDirectory: sandbox.dataDirectory
  })
  try {
    // Only GitHub is simulated. ssh-keygen, the private/public pair comparison
    // and local permission protection use the real platform tools.
    expect(await provider.status(sandbox.projectPath)).toMatchObject({ authenticated: true, sshKeyReady: false })
    expect(await provider.authorizeAndProvisionSshKey(sandbox.projectPath)).toMatchObject({ sshKeyCreated: true })
    expect(await provider.status(sandbox.projectPath)).toMatchObject({ authenticated: true, sshKeyReady: true })
    const keyDirectory = join(sandbox.dataDirectory, 'ssh')
    const keyName = (await readdir(keyDirectory)).find((name) => name.startsWith('id_ed25519_') && !name.includes('.'))
    expect(keyName).toBeDefined()
    const digest = (value: Buffer): string => createHash('sha256').update(value).digest('hex')
    const before = digest(await readFile(join(keyDirectory, keyName!)))
    registeredPublicKey = ''
    expect(await provider.status(sandbox.projectPath)).toMatchObject({ sshKeyReady: false })
    expect(await provider.authorizeAndProvisionSshKey(sandbox.projectPath)).toMatchObject({ sshKeyCreated: false })
    expect(registrations).toBe(2)
    expect(digest(await readFile(join(keyDirectory, keyName!)))).toBe(before)
    expect(await provider.status(sandbox.projectPath)).toMatchObject({ sshKeyReady: true })
    expect(provider.githubAuthorizationStatus()).toMatchObject({ phase: 'complete' })
    expect(provider.githubAuthorizationStatus()).not.toHaveProperty('userCode')
  } finally {
    await cleanupSandbox(sandbox)
  }
})
