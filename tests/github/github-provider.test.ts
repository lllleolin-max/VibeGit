import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitHubProvider, type GhExecutor, type GitHubProviderOptions, type SystemExecutor } from '@vibegit/github-provider'
import type { TestSandbox } from '../helpers'
import { cleanupSandbox, createSandbox, writeProjectFile } from '../helpers'

const TEST_PUBLIC_KEY = 'ssh-ed25519 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

function testKeyPath(dataDirectory: string): string {
  const identity = createHash('sha256').update('test-user').digest('hex').slice(0, 24)
  return join(dataDirectory, 'ssh', `id_ed25519_vibegit_${identity}`)
}

async function managedProvider(sandbox: TestSandbox, options: GitHubProviderOptions = {}): Promise<GitHubProvider> {
  const dataDirectory = options.dataDirectory ?? sandbox.dataDirectory
  const keyPath = testKeyPath(dataDirectory)
  await mkdir(join(dataDirectory, 'ssh'), { recursive: true })
  await writeFile(keyPath, 'test private key fixture\n')
  await writeFile(`${keyPath}.pub`, `${TEST_PUBLIC_KEY} test\n`)
  await writeFile(`${keyPath}.json`, JSON.stringify({
    version: 1, username: 'test-user', createdAt: new Date().toISOString(),
    publicKeySha256: createHash('sha256').update(TEST_PUBLIC_KEY).digest('hex')
  }))
  return new GitHubProvider(sandbox.service.database, sandbox.service.git, sandbox.service.checkpoints, {
    executor: privateRepositoryExecutor(),
    systemExecutor: vi.fn(async () => ({ exitCode: 0, stdout: `${TEST_PUBLIC_KEY}\n`, stderr: '' })),
    ...options,
    dataDirectory
  })
}

function privateRepositoryExecutor(visibility = 'PRIVATE'): GhExecutor {
  return vi.fn(async (_cwd, args) => {
    if (args.includes('user/keys')) return { exitCode: 0, stdout: `${TEST_PUBLIC_KEY}\n`, stderr: '' }
    if (args[0] === 'api') return { exitCode: 0, stdout: 'test-user\n', stderr: '' }
    if (args[0] === 'repo' && args[1] === 'view') return { exitCode: 0, stdout: `${visibility}\n`, stderr: '' }
    return { exitCode: 0, stdout: '', stderr: '' }
  })
}

async function configureLocalGitHubRemote(sandbox: TestSandbox, bareRemote: string, repository: string): Promise<string> {
  const remoteUrl = `https://github.com/test-user/${repository}.git`
  const managedUrl = `ssh://git@ssh.github.com:443/test-user/${repository}.git`
  const runner = sandbox.service.git.runner
  const originalRun = runner.run.bind(runner)
  vi.spyOn(runner, 'run').mockImplementation(async (cwd, args, options) => {
    const isNetworkOperation = args[0] === 'fetch' || args[0] === 'push' ||
      (args[0] === 'ls-remote' && !args.includes('--get-url'))
    const routedArgs = isNetworkOperation
      ? args.map((argument) => argument === remoteUrl || argument === managedUrl ? pathToFileURL(bareRemote).href : argument)
      : [...args]
    return await originalRun(cwd, routedArgs, options)
  })
  await runner.run(sandbox.projectPath, ['remote', 'add', 'vibegit', remoteUrl])
  return managedUrl
}

describe('GitHubProvider mock contract', () => {
  let sandbox: TestSandbox | undefined
  afterEach(async () => { if (sandbox) await cleanupSandbox(sandbox); sandbox = undefined })

  it('normalizes supported GitHub URLs to the application SSH transport without changing origin', async () => {
    sandbox = await createSandbox()
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const provider = await managedProvider(sandbox)
    const original = 'https://github.com/test-user/original.git'
    await sandbox.service.git.runner.run(sandbox.projectPath, ['remote', 'add', 'origin', original])
    const canonical = 'ssh://git@ssh.github.com:443/test-user/existing.git'
    for (const input of [
      ' https://github.com/test-user/existing.git/ ',
      'https://github.com/test-user/existing',
      'git@github.com:test-user/existing.git',
      'ssh://git@github.com/test-user/existing.git',
      'ssh://git@github.com:22/test-user/existing',
      canonical
    ]) {
      await expect(provider.connect(project.id, input)).resolves.toBe(canonical)
      expect(sandbox.service.database.getProject(project.id)?.githubRemoteUrl).toBe(canonical)
    }
    expect(await sandbox.service.git.getRemoteUrl(sandbox.projectPath, 'origin')).toBe(original)
  })

  it('rejects credentials, lookalike hosts, extra paths, query strings, and unsafe URL slugs', async () => {
    sandbox = await createSandbox()
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const executor = privateRepositoryExecutor()
    const provider = await managedProvider(sandbox, { executor })
    for (const input of [
      'https://github.com.attacker.invalid/user/repo',
      'https://token@github.com/user/repo',
      'https://github.com/user/repo/tree/main',
      'https://github.com/user/repo?token=secret',
      'https://github.com/user/repo#fragment',
      'ssh://git@github.com:2222/user/repo',
      'https://github.com/user/..',
      'https://github.com/-option/repo',
      'https://github.com/user/%2e%2e'
    ]) await expect(provider.connect(project.id, input)).rejects.toMatchObject({ code: 'NOT_A_GITHUB_REMOTE' })
    expect(executor).not.toHaveBeenCalled()
    expect(await sandbox.service.git.getRemoteUrl(sandbox.projectPath, 'vibegit')).toBeUndefined()
  })

  it('detects a revoked GitHub key and registers the existing pair again without replacing it', async () => {
    sandbox = await createSandbox()
    let registered = true
    const normal = privateRepositoryExecutor()
    const executor: GhExecutor = vi.fn(async (cwd, args, options, environment) => {
      if (args.includes('user/keys')) return { exitCode: 0, stdout: registered ? TEST_PUBLIC_KEY : '', stderr: '' }
      if (args[0] === 'ssh-key' && args[1] === 'add') registered = true
      return await normal(cwd, args, options, environment)
    })
    const provider = await managedProvider(sandbox, { executor })
    const before = await readFile(testKeyPath(sandbox.dataDirectory), 'utf8')
    await expect(provider.status(sandbox.projectPath)).resolves.toMatchObject({ sshKeyReady: true })
    registered = false
    await expect(provider.status(sandbox.projectPath)).resolves.toMatchObject({ authenticated: true, sshKeyReady: false })
    await expect(provider.authorizeAndProvisionSshKey(sandbox.projectPath)).resolves.toMatchObject({ sshKeyCreated: false })
    await expect(provider.status(sandbox.projectPath)).resolves.toMatchObject({ sshKeyReady: true })
    expect(await readFile(testKeyPath(sandbox.dataDirectory), 'utf8')).toBe(before)
    expect(vi.mocked(executor).mock.calls.filter(([, args]) => args[0] === 'ssh-key' && args[1] === 'add')).toHaveLength(1)
    expect(provider.githubAuthorizationStatus()).toMatchObject({ phase: 'complete' })
  })

  it('refuses mismatched key pairs before uploading a public key or creating a repository', async () => {
    sandbox = await createSandbox()
    const executor = privateRepositoryExecutor()
    const provider = await managedProvider(sandbox, {
      executor,
      systemExecutor: async () => ({ exitCode: 0, stdout: 'ssh-ed25519 BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=\n', stderr: '' })
    })
    await expect(provider.status(sandbox.projectPath)).resolves.toMatchObject({ sshKeyReady: false })
    await expect(provider.authorizeAndProvisionSshKey(sandbox.projectPath)).rejects.toMatchObject({ code: 'SSH_KEY_MISMATCH' })
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await expect(provider.createPrivateRepository(project.id, 'should-not-exist')).rejects.toMatchObject({ code: 'VIBEGIT_SSH_KEY_UNAVAILABLE' })
    expect(vi.mocked(executor).mock.calls.some(([, args]) => args[0] === 'ssh-key' || (args[0] === 'repo' && args[1] === 'create'))).toBe(false)
    expect(provider.githubAuthorizationStatus()).toMatchObject({ phase: 'failed' })
  })

  it('does not mark a key ready when its private file is missing, and preserves its public file', async () => {
    sandbox = await createSandbox()
    const provider = await managedProvider(sandbox)
    const path = testKeyPath(sandbox.dataDirectory)
    const publicBefore = await readFile(`${path}.pub`, 'utf8')
    await rm(path)
    await expect(provider.status(sandbox.projectPath)).resolves.toMatchObject({ sshKeyReady: false })
    await expect(provider.authorizeAndProvisionSshKey(sandbox.projectPath)).rejects.toMatchObject({ code: 'SSH_KEY_INCOMPLETE' })
    expect(await readFile(`${path}.pub`, 'utf8')).toBe(publicBefore)
  })

  it('rebuilds a missing public file from the retained private key', async () => {
    sandbox = await createSandbox()
    const provider = await managedProvider(sandbox)
    const path = testKeyPath(sandbox.dataDirectory)
    const privateBefore = await readFile(path, 'utf8')
    await rm(`${path}.pub`)
    await expect(provider.status(sandbox.projectPath)).resolves.toMatchObject({ sshKeyReady: false })
    await expect(provider.authorizeAndProvisionSshKey(sandbox.projectPath)).resolves.toMatchObject({ sshKeyCreated: false })
    expect(await readFile(path, 'utf8')).toBe(privateBefore)
    expect(await readFile(`${path}.pub`, 'utf8')).toContain(TEST_PUBLIC_KEY)
    await expect(provider.status(sandbox.projectPath)).resolves.toMatchObject({ sshKeyReady: true })
  })

  it('refuses linked key files before changing permissions or provisioning them', async () => {
    sandbox = await createSandbox()
    const systemExecutor: SystemExecutor = vi.fn(async () => ({ exitCode: 0, stdout: `${TEST_PUBLIC_KEY}\n`, stderr: '' }))
    const provider = await managedProvider(sandbox, { systemExecutor })
    const path = testKeyPath(sandbox.dataDirectory)
    const externalKey = join(sandbox.root, 'retained-user-key')
    await link(path, externalKey)
    await expect(provider.status(sandbox.projectPath)).resolves.toMatchObject({ sshKeyReady: false })
    await expect(provider.authorizeAndProvisionSshKey(sandbox.projectPath)).rejects.toMatchObject({ code: 'SSH_KEY_INVALID' })
    expect(systemExecutor).not.toHaveBeenCalled()
    expect(await readFile(externalKey, 'utf8')).toBe('test private key fixture\n')
  })

  it('exposes only the device code during pending authorization, deduplicates requests, and clears the code on completion', async () => {
    sandbox = await createSandbox()
    let authenticated = false
    let finishLogin: (() => void) | undefined
    const normal = privateRepositoryExecutor()
    const executor: GhExecutor = vi.fn(async (cwd, args, options, environment) => {
      if (args[0] === 'auth' && args[1] === 'status') return { exitCode: authenticated ? 0 : 1, stdout: '', stderr: '' }
      if (args[0] === 'auth' && args[1] === 'login') {
        options.onOutput?.('! First copy your one-time co')
        options.onOutput?.('de: \u001b[1mABCD-')
        options.onOutput?.('1234\u001b[0m\nOpen https://attacker.invalid\naccess_token=ghp_DoNotExposeThisCredentialInTheUI\n')
        await new Promise<void>((resolveLogin) => { finishLogin = resolveLogin })
        authenticated = true
      }
      return await normal(cwd, args, options, environment)
    })
    const provider = await managedProvider(sandbox, { executor })
    expect(provider.githubAuthorizationStatus().phase).toBe('idle')
    const first = provider.authorizeAndProvisionSshKey(sandbox.projectPath)
    const second = provider.authorizeAndProvisionSshKey(sandbox.projectPath)
    expect(second).toBe(first)
    await vi.waitFor(() => expect(provider.githubAuthorizationStatus().userCode).toBe('ABCD-1234'))
    expect(provider.githubAuthorizationStatus()).toEqual({
      phase: 'authorizing', message: '请打开 GitHub 授权页面，输入一次性代码并确认授权',
      verificationUri: 'https://github.com/login/device', userCode: 'ABCD-1234'
    })
    finishLogin!()
    await first
    expect(provider.githubAuthorizationStatus().phase).toBe('complete')
    expect(provider.githubAuthorizationStatus().userCode).toBeUndefined()
    expect(provider.githubAuthorizationStatus().verificationUri).toBeUndefined()
    expect(vi.mocked(executor).mock.calls.filter(([, args]) => args[0] === 'auth' && args[1] === 'login')).toHaveLength(1)
  })

  it('refuses a linked metadata record before provisioning and preserves the external file', async () => {
    sandbox = await createSandbox()
    const systemExecutor: SystemExecutor = vi.fn(async () => ({ exitCode: 0, stdout: `${TEST_PUBLIC_KEY}\n`, stderr: '' }))
    const provider = await managedProvider(sandbox, { systemExecutor })
    const metadata = `${testKeyPath(sandbox.dataDirectory)}.json`
    const outside = join(sandbox.root, 'unrelated-settings.json')
    await rm(metadata)
    await writeFile(outside, '{"preserve":"these settings"}\n')
    await link(outside, metadata)

    await expect(provider.authorizeAndProvisionSshKey(sandbox.projectPath)).rejects.toMatchObject({ code: 'SSH_KEY_INVALID' })
    expect(systemExecutor).not.toHaveBeenCalled()
    expect(await readFile(outside, 'utf8')).toBe('{"preserve":"these settings"}\n')
  })

  it('clears failed authorization codes and allows a fresh retry without returning raw CLI output', async () => {
    sandbox = await createSandbox()
    let attempts = 0
    const normal = privateRepositoryExecutor()
    const executor: GhExecutor = vi.fn(async (cwd, args, options, environment) => {
      if (args[0] === 'auth' && args[1] === 'status') return { exitCode: 1, stdout: '', stderr: '' }
      if (args[0] === 'auth' && args[1] === 'login') {
        attempts += 1
        options.onOutput?.('First copy your one-time code: ABCD-1234\n')
        return { exitCode: 1, stdout: 'token=untrusted-secret-output', stderr: 'ABCD-1234' }
      }
      return await normal(cwd, args, options, environment)
    })
    const provider = await managedProvider(sandbox, { executor })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(provider.authorizeAndProvisionSshKey(sandbox.projectPath)).rejects.toMatchObject({ code: 'GH_AUTHORIZATION_FAILED', detail: undefined })
      expect(provider.githubAuthorizationStatus()).toEqual({ phase: 'failed', message: 'GitHub 连接未完成，请检查网络或重试授权' })
    }
    expect(attempts).toBe(2)
  })

  it('streams a real child process device prompt before exit and clears it after failure', async () => {
    sandbox = await createSandbox()
    // Node stands in for gh: the local auth script handles status/login only.
    // This exercises the actual stderr pipe without authenticating any account.
    await writeProjectFile(sandbox, 'auth', `
if (process.argv[2] === 'status') process.exit(1)
process.stderr.write('! First copy your one-time co')
setTimeout(() => process.stderr.write('de: ABCD-EFGH\\n'), 50)
setTimeout(() => process.exit(1), 750)
`)
    const provider = new GitHubProvider(sandbox.service.database, sandbox.service.git, sandbox.service.checkpoints, {
      ghExecutable: process.execPath, timeoutMs: 5_000, dataDirectory: sandbox.dataDirectory
    })
    const pending = provider.authorizeAndProvisionSshKey(sandbox.projectPath).catch((error: unknown) => error)
    await vi.waitFor(() => expect(provider.githubAuthorizationStatus()).toMatchObject({
      phase: 'authorizing', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device'
    }), { timeout: 5_000 })
    await expect(pending).resolves.toMatchObject({ code: 'GH_AUTHORIZATION_FAILED' })
    expect(provider.githubAuthorizationStatus().phase).toBe('failed')
    expect(provider.githubAuthorizationStatus().userCode).toBeUndefined()
  })

  it('marks early authentication and scan failures as failed instead of retaining a previous synced status', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'README.md', '# Failure reporting\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initialized = await sandbox.service.initializeProtection(project.id)
    const provider = await managedProvider(sandbox)
    await provider.connect(project.id, 'https://github.com/test-user/failure-reporting.git')
    const checkpoint = sandbox.service.listCheckpoints(initialized.project.id)[0]!
    sandbox.service.database.markCheckpointSynced(checkpoint.id, new Date().toISOString())
    const push = vi.spyOn(sandbox.service.git, 'pushCheckpoint').mockResolvedValue(undefined)
    const keyPath = testKeyPath(sandbox.dataDirectory)
    const publicBefore = await readFile(`${keyPath}.pub`, 'utf8')
    await rm(`${keyPath}.pub`)
    await expect(provider.push(project.id)).rejects.toMatchObject({ code: 'VIBEGIT_SSH_KEY_UNAVAILABLE' })
    expect(sandbox.service.database.getProject(project.id)?.githubSyncStatus).toBe('failed')
    expect(push).not.toHaveBeenCalled()

    await writeFile(`${keyPath}.pub`, publicBefore)
    sandbox.service.database.markCheckpointSynced(checkpoint.id, new Date().toISOString())
    vi.spyOn(provider.scanner, 'scan').mockRejectedValue(new Error('scan interrupted'))
    await expect(provider.push(project.id)).rejects.toThrow('scan interrupted')
    expect(sandbox.service.database.getProject(project.id)?.githubSyncStatus).toBe('failed')
    expect(push).not.toHaveBeenCalled()
  })

  it('uses explicit Private creation and configures the resulting remote', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'README.md', '# Test\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const calls: string[][] = []
    const executor: GhExecutor = vi.fn(async (_cwd, args) => {
      calls.push(args)
      if (args.includes('user/keys')) return { exitCode: 0, stdout: `${TEST_PUBLIC_KEY}\n`, stderr: '' }
      if (args[0] === 'api') return { exitCode: 0, stdout: 'test-user\n', stderr: '' }
      if (args[0] === 'repo' && args[1] === 'view') return { exitCode: 0, stdout: 'PRIVATE\n', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const provider = await managedProvider(sandbox, { executor })
    const remote = await provider.createPrivateRepository(project.id, 'safe-project')
    expect(remote).toBe('ssh://git@ssh.github.com:443/test-user/safe-project.git')
    expect(calls).toContainEqual(['repo', 'create', 'test-user/safe-project', '--private'])
    expect(await sandbox.service.git.getRemoteUrl(sandbox.projectPath, 'vibegit')).toBe(remote)
  })

  it('opens browser authorization, creates an app-owned SSH key, and uses SSH 443 for a new Private repository', async () => {
    sandbox = await createSandbox()
    const dataDirectory = join(sandbox.dataDirectory, "literal $(printf expanded) `printf expanded` user's data")
    const publicKey = 'ssh-ed25519 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    const calls: string[][] = []
    const environments: NodeJS.ProcessEnv[] = []
    let authenticated = false
    let registered = false
    const executor: GhExecutor = vi.fn(async (_cwd, args, _options, environment) => {
      calls.push(args)
      environments.push(environment)
      if (args[0] === '--version') return { exitCode: 0, stdout: 'gh version 2.0.0\n', stderr: '' }
      if (args[0] === 'auth' && args[1] === 'status') return { exitCode: authenticated ? 0 : 1, stdout: '', stderr: '' }
      if (args[0] === 'auth' && args[1] === 'login') { authenticated = true; return { exitCode: 0, stdout: '', stderr: '' } }
      if (args[0] === 'api' && args.includes('user/keys')) return { exitCode: 0, stdout: registered ? `${publicKey}\n` : '', stderr: '' }
      if (args[0] === 'api') return { exitCode: 0, stdout: 'test-user\n', stderr: '' }
      if (args[0] === 'ssh-key' && args[1] === 'add') { registered = true; return { exitCode: 0, stdout: '', stderr: '' } }
      if (args[0] === 'repo' && args[1] === 'view') return { exitCode: 0, stdout: 'PRIVATE\n', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const systemExecutor: SystemExecutor = vi.fn(async (executable, _cwd, args) => {
      if (args.includes('-y')) return { exitCode: 0, stdout: `${publicKey}\n`, stderr: '' }
      if (executable === 'ssh-keygen' && args.includes('-f')) {
        const keyPath = args[args.indexOf('-f') + 1]!
        await writeFile(keyPath, 'private key material stays local\n', 'utf8')
        await writeFile(`${keyPath}.pub`, `${publicKey} vibegit-backup\n`, 'utf8')
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const provider = new GitHubProvider(sandbox.service.database, sandbox.service.git, sandbox.service.checkpoints, {
      executor,
      systemExecutor,
      dataDirectory
    })

    const onboarding = await provider.authorizeAndProvisionSshKey(sandbox.projectPath)
    expect(onboarding).toMatchObject({ username: 'test-user', sshKeyCreated: true })
    expect(JSON.stringify(onboarding)).not.toContain('private key material')
    expect(calls).toContainEqual([
      'auth', 'login', '--hostname', 'github.com', '--web', '--git-protocol', 'ssh', '--skip-ssh-key',
      '--scopes', 'repo,read:org,admin:public_key'
    ])
    const loginIndex = calls.findIndex((args) => args[0] === 'auth' && args[1] === 'login')
    expect(environments[loginIndex]?.GH_PROMPT_DISABLED).toBeUndefined()
    expect(calls).toContainEqual(['ssh-key', 'add', expect.any(String), '--title', 'VibeGit backup key', '--type', 'authentication'])

    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const remote = await provider.createPrivateRepository(project.id, 'ssh-backed-project')
    expect(remote).toBe('ssh://git@ssh.github.com:443/test-user/ssh-backed-project.git')
    expect(await sandbox.service.git.getRemoteUrl(sandbox.projectPath, 'vibegit')).toBe(remote)

    const push = vi.spyOn(sandbox.service.git, 'pushCheckpoint').mockResolvedValue(undefined)
    await provider.push(project.id)
    const command = push.mock.calls[0]![4]!.sshCommand
    const gitExecPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true }).trim()
    const sh = process.platform === 'win32' ? resolve(gitExecPath, '../../../bin/sh.exe') : 'sh'
    // Run only printf in Git's shell: validate actual argument expansion without
    // invoking SSH or connecting to any remote.
    const args = execFileSync(sh, ['-c', command.replace(/^ssh /, "printf '%s\\n' ")], {
      encoding: 'utf8', windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: '1' }
    }).trim().split(/\r?\n/)
    const keyPath = vi.mocked(systemExecutor).mock.calls.find(([executable]) => executable === 'ssh-keygen')![2]
    const expectedKey = keyPath[keyPath.indexOf('-f') + 1]!.replaceAll('\\', '/')
    expect(args[args.indexOf('-i') + 1]).toBe(expectedKey)
    expect(args).toContain(`UserKnownHostsFile="${join(dataDirectory, 'ssh', 'known_hosts').replaceAll('\\', '/')}"`)
    expect(args[args.indexOf('-F') + 1]).toBe('none')
    // OpenSSH's configuration-only mode makes no network connection. Verify
    // Windows/OpenSSH accepts the isolated configuration and selected identity.
    const sshConfiguration = execFileSync('ssh', [...args, '-G', '-p', '443', 'git@ssh.github.com'], {
      encoding: 'utf8', windowsHide: true
    }).split(/\r?\n/)
    expect(sshConfiguration).toContain('hostname ssh.github.com')
    expect(sshConfiguration).toContain('identityagent none')
    expect(sshConfiguration).toContain('identitiesonly yes')
    expect(sshConfiguration).toContain('stricthostkeychecking accept-new')
    expect(sshConfiguration.filter((line) => line.startsWith('identityfile '))).toEqual([`identityfile ${expectedKey}`])
  })

  it('reports an installed but unauthenticated GitHub CLI and refuses repository creation', async () => {
    sandbox = await createSandbox()
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const calls: string[][] = []
    const executor: GhExecutor = vi.fn(async (_cwd, args) => {
      calls.push(args)
      if (args[0] === '--version') return { exitCode: 0, stdout: 'gh version 2.0.0\n', stderr: '' }
      if (args[0] === 'auth') return { exitCode: 1, stdout: '', stderr: 'not logged in' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const provider = new GitHubProvider(sandbox.service.database, sandbox.service.git, sandbox.service.checkpoints, { executor })

    await expect(provider.status(sandbox.projectPath)).resolves.toMatchObject({
      installed: true,
      authenticated: false
    })
    await expect(provider.createPrivateRepository(project.id, 'must-not-exist')).rejects.toMatchObject({
      code: 'GH_NOT_AUTHENTICATED'
    })
    expect(calls.some((args) => args[0] === 'repo')).toBe(false)
  })

  it('stops a CLI that emits excessive output instead of buffering indefinitely', async () => {
    sandbox = await createSandbox()
    // Node accepts --version and then runs this local "auth" script for the
    // next status command. No real GitHub process or network request is used.
    await writeProjectFile(sandbox, 'auth', 'process.stdout.write("x".repeat(5 * 1024 * 1024));\n')
    const provider = new GitHubProvider(sandbox.service.database, sandbox.service.git, sandbox.service.checkpoints, {
      ghExecutable: process.execPath, timeoutMs: 5_000
    })
    await expect(provider.status(sandbox.projectPath)).rejects.toMatchObject({ code: 'GH_OUTPUT_LIMIT' })
  })

  it('pins every gh call to github.com when the ambient environment names another host', async () => {
    sandbox = await createSandbox()
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const originalHost = process.env.GH_HOST
    process.env.GH_HOST = 'attacker.invalid'
    const observedHosts: Array<string | undefined> = []
    const executor: GhExecutor = vi.fn(async (_cwd, args, _options, environment) => {
      observedHosts.push(environment.GH_HOST)
      if (args.includes('user/keys')) return { exitCode: 0, stdout: `${TEST_PUBLIC_KEY}\n`, stderr: '' }
      if (args[0] === 'api') return { exitCode: 0, stdout: 'test-user\n', stderr: '' }
      if (args[0] === 'repo' && args[1] === 'view') return { exitCode: 0, stdout: 'PRIVATE\n', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    try {
      const provider = await managedProvider(sandbox, { executor })
      await expect(provider.createPrivateRepository(project.id, 'host-bound')).resolves.toContain('github.com')
      expect(observedHosts.length).toBeGreaterThan(0)
      expect(observedHosts.every((host) => host === 'github.com')).toBe(true)
    } finally {
      if (originalHost === undefined) delete process.env.GH_HOST
      else process.env.GH_HOST = originalHost
    }
  })

  it('connects only after gh confirms that an existing repository is Private', async () => {
    sandbox = await createSandbox()
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const calls: string[][] = []
    const executor: GhExecutor = vi.fn(async (_cwd, args) => {
      calls.push(args)
      if (args.includes('user/keys')) return { exitCode: 0, stdout: `${TEST_PUBLIC_KEY}\n`, stderr: '' }
      if (args[0] === 'api') return { exitCode: 0, stdout: 'test-user\n', stderr: '' }
      if (args[0] === 'repo' && args[1] === 'view') return { exitCode: 0, stdout: 'PRIVATE\n', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const provider = await managedProvider(sandbox, { executor })

    const remote = 'https://github.com/test-user/existing-private.git'
    const original = 'https://github.com/test-user/original-project.git'
    await sandbox.service.git.runner.run(sandbox.projectPath, ['remote', 'add', 'origin', original])
    const managedUrl = 'ssh://git@ssh.github.com:443/test-user/existing-private.git'
    await expect(provider.connect(project.id, remote)).resolves.toBe(managedUrl)
    expect(calls).toContainEqual(['repo', 'view', 'test-user/existing-private', '--json', 'visibility', '--jq', '.visibility'])
    expect(await sandbox.service.git.getRemoteUrl(sandbox.projectPath, 'vibegit')).toBe(managedUrl)
    expect(await sandbox.service.git.getRemoteUrl(sandbox.projectPath, 'origin')).toBe(original)
  })

  it('refuses to connect a Public repository and leaves Git remote unchanged', async () => {
    sandbox = await createSandbox()
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const executor: GhExecutor = vi.fn(async (_cwd, args) => {
      if (args[0] === 'api') return { exitCode: 0, stdout: 'test-user\n', stderr: '' }
      if (args[0] === 'repo' && args[1] === 'view') return { exitCode: 0, stdout: 'PUBLIC\n', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const provider = new GitHubProvider(sandbox.service.database, sandbox.service.git, sandbox.service.checkpoints, { executor })

    await expect(provider.connect(project.id, 'https://github.com/test-user/public-repo.git')).rejects.toMatchObject({
      code: 'GITHUB_REPOSITORY_NOT_PRIVATE'
    })
    expect(await sandbox.service.git.getRemoteUrl(sandbox.projectPath, 'vibegit')).toBeUndefined()
  })

  it('does not auto-trust or overwrite an existing origin', async () => {
    sandbox = await createSandbox()
    await sandbox.service.git.initialize(sandbox.projectPath)
    const publicRemote = 'https://github.com/test-user/public-existing.git'
    await sandbox.service.git.runner.run(sandbox.projectPath, ['remote', 'add', 'origin', publicRemote])
    await writeProjectFile(sandbox, 'README.md', '# Existing repository\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    const initialized = await sandbox.service.initializeProtection(project.id)
    expect(initialized.project.githubRemoteUrl).toBeUndefined()
    expect(initialized.project.githubSyncStatus).toBe('not_configured')

    const provider = new GitHubProvider(sandbox.service.database, sandbox.service.git, sandbox.service.checkpoints, { executor: privateRepositoryExecutor('PUBLIC') })
    await expect(provider.push(project.id)).rejects.toMatchObject({ code: 'GITHUB_REMOTE_NOT_CONFIGURED' })
    expect(sandbox.service.listCheckpoints(project.id).some((checkpoint) => checkpoint.type === 'pre_sync')).toBe(false)
    expect(await sandbox.service.git.getRemoteUrl(sandbox.projectPath, 'origin')).toBe(publicRemote)
  })

  it('pushes a scanned checkpoint to the non-force backup branch', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'README.md', '# Safe backup\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const bareRemote = join(sandbox.root, 'remote.git')
    await mkdir(bareRemote, { recursive: true })
    await sandbox.service.git.runner.run(bareRemote, ['init', '--bare'])
    await configureLocalGitHubRemote(sandbox, bareRemote, 'safe-backup')
    const provider = await managedProvider(sandbox)

    const result = await provider.push(project.id)
    expect(result.branch).toBe('vibegit-backup')
    expect(vi.mocked(sandbox.service.git.runner.run).mock.calls.some(([, args]) =>
      args[0] === 'push' && args.includes('--no-verify')
    )).toBe(true)
    const sourceCheckpoint = sandbox.service.database.getCheckpoint(result.checkpointId)
    expect(sourceCheckpoint).toBeDefined()
    const remoteObject = await sandbox.service.git.runner.run(sandbox.projectPath, [
      `--git-dir=${bareRemote}`,
      'rev-parse',
      'refs/heads/vibegit-backup'
    ])
    expect(remoteObject.stdout.trim()).toMatch(/^[0-9a-f]{40,64}$/)
    expect(remoteObject.stdout.trim()).not.toBe(sourceCheckpoint!.gitObjectId)
    const parents = await sandbox.service.git.runner.run(sandbox.projectPath, [
      `--git-dir=${bareRemote}`,
      'show',
      '-s',
      '--format=%P',
      remoteObject.stdout.trim()
    ])
    expect(parents.stdout.trim()).toBe('')

    await writeProjectFile(sandbox, 'README.md', '# Safe backup\n\nSecond snapshot.\n')
    await provider.push(project.id)
    const secondRemoteObject = await sandbox.service.git.runner.run(sandbox.projectPath, [
      `--git-dir=${bareRemote}`,
      'rev-parse',
      'refs/heads/vibegit-backup'
    ])
    expect(secondRemoteObject.stdout.trim()).not.toBe(remoteObject.stdout.trim())
    const secondParents = await sandbox.service.git.runner.run(sandbox.projectPath, [
      `--git-dir=${bareRemote}`,
      'show',
      '-s',
      '--format=%P',
      secondRemoteObject.stdout.trim()
    ])
    expect(secondParents.stdout.trim()).toBe(remoteObject.stdout.trim())
  })

  it('never uploads a sensitive file that exists only in a local checkpoint parent', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, '.env', `${['API', 'KEY'].join('_')}=${['abcdefghijklm', 'nopqrstuvwxyz123456'].join('')}\n`)
    await writeProjectFile(sandbox, 'app.txt', 'safe\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    await writeProjectFile(sandbox, '.gitignore', '.env\n')
    const bareRemote = join(sandbox.root, 'sanitized-remote.git')
    await mkdir(bareRemote, { recursive: true })
    await sandbox.service.git.runner.run(bareRemote, ['init', '--bare'])
    await configureLocalGitHubRemote(sandbox, bareRemote, 'sanitized-backup')
    const provider = await managedProvider(sandbox)

    await expect(provider.push(project.id)).resolves.toMatchObject({ branch: 'vibegit-backup' })
    const reachable = await sandbox.service.git.runner.run(sandbox.projectPath, [
      `--git-dir=${bareRemote}`,
      'rev-list',
      '--objects',
      'refs/heads/vibegit-backup'
    ])
    expect(reachable.stdout).not.toContain('.env')
    expect(reachable.stdout).toContain('.gitignore')
    expect(reachable.stdout).toContain('app.txt')
  })

  it('pushes to the exact verified URL even if origin changes after the visibility check', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'README.md', '# Bound remote target\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const verifiedRemote = join(sandbox.root, 'verified-private.git')
    const swappedRemote = join(sandbox.root, 'swapped-target.git')
    await mkdir(verifiedRemote, { recursive: true })
    await mkdir(swappedRemote, { recursive: true })
    await sandbox.service.git.runner.run(verifiedRemote, ['init', '--bare'])
    await sandbox.service.git.runner.run(swappedRemote, ['init', '--bare'])
    const verifiedUrl = await configureLocalGitHubRemote(sandbox, verifiedRemote, 'bound-private')
    let visibilityChecks = 0
    const executor: GhExecutor = vi.fn(async (_cwd, args) => {
      if (args.includes('user/keys')) return { exitCode: 0, stdout: `${TEST_PUBLIC_KEY}\n`, stderr: '' }
      if (args[0] === 'api') return { exitCode: 0, stdout: 'test-user\n', stderr: '' }
      if (args[0] === 'repo' && args[1] === 'view') {
        visibilityChecks += 1
        if (visibilityChecks === 2) {
          await sandbox!.service.git.runner.run(sandbox!.projectPath, [
            'remote',
            'set-url',
            'vibegit',
            pathToFileURL(swappedRemote).href
          ])
        }
        return { exitCode: 0, stdout: 'PRIVATE\n', stderr: '' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const provider = await managedProvider(sandbox, { executor })

    await expect(provider.push(project.id)).resolves.toMatchObject({ remoteUrl: verifiedUrl })
    expect(visibilityChecks).toBe(2)
    const verifiedRef = await sandbox.service.git.runner.run(verifiedRemote, [
      'show-ref', '--verify', '--quiet', 'refs/heads/vibegit-backup'
    ], { allowExitCodes: [0, 1] })
    const swappedRef = await sandbox.service.git.runner.run(swappedRemote, [
      'show-ref', '--verify', '--quiet', 'refs/heads/vibegit-backup'
    ], { allowExitCodes: [0, 1] })
    expect(verifiedRef.exitCode).toBe(0)
    expect(swappedRef.exitCode).toBe(1)
  })

  it('fails closed when Git configuration rewrites the verified GitHub URL', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'README.md', '# Rewrite must be blocked\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const redirectedRemote = join(sandbox.root, 'redirected.git')
    await mkdir(redirectedRemote, { recursive: true })
    await sandbox.service.git.runner.run(redirectedRemote, ['init', '--bare'])
    const verifiedUrl = 'ssh://git@ssh.github.com:443/test-user/verified-private.git'
    await sandbox.service.git.runner.run(sandbox.projectPath, ['remote', 'add', 'vibegit', verifiedUrl])
    await sandbox.service.git.runner.run(sandbox.projectPath, [
      'config',
      `url.${pathToFileURL(redirectedRemote).href}.insteadOf`,
      verifiedUrl
    ])
    const provider = await managedProvider(sandbox)

    await expect(provider.push(project.id)).rejects.toMatchObject({ code: 'UNSAFE_GIT_URL_REWRITE' })
    const redirectedRef = await sandbox.service.git.runner.run(redirectedRemote, [
      'show-ref', '--verify', '--quiet', 'refs/heads/vibegit-backup'
    ], { allowExitCodes: [0, 1] })
    expect(redirectedRef.exitCode).toBe(1)
  })

  it('also blocks a pushInsteadOf rewrite before it can change the backup target', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'README.md', '# Push rewrite must be blocked\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const redirectedRemote = join(sandbox.root, 'push-redirected.git')
    await mkdir(redirectedRemote, { recursive: true })
    await sandbox.service.git.runner.run(redirectedRemote, ['init', '--bare'])
    const verifiedUrl = 'ssh://git@ssh.github.com:443/test-user/push-verified-private.git'
    await sandbox.service.git.runner.run(sandbox.projectPath, ['remote', 'add', 'vibegit', verifiedUrl])
    await sandbox.service.git.runner.run(sandbox.projectPath, [
      'config',
      `url.${pathToFileURL(redirectedRemote).href}.pushInsteadOf`,
      verifiedUrl
    ])
    const provider = await managedProvider(sandbox)

    await expect(provider.push(project.id)).rejects.toMatchObject({ code: 'UNSAFE_GIT_URL_REWRITE' })
    const redirectedRef = await sandbox.service.git.runner.run(redirectedRemote, [
      'show-ref', '--verify', '--quiet', 'refs/heads/vibegit-backup'
    ], { allowExitCodes: [0, 1] })
    expect(redirectedRef.exitCode).toBe(1)
  })

  it('blocks a backup before any ref is pushed when a sensitive file is present', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, '.env', `${['API', 'KEY'].join('_')}=${['abcdefghijklm', 'nopqrstuvwxyz123456'].join('')}\n`)
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const bareRemote = join(sandbox.root, 'blocked-remote.git')
    await mkdir(bareRemote, { recursive: true })
    await sandbox.service.git.runner.run(bareRemote, ['init', '--bare'])
    await configureLocalGitHubRemote(sandbox, bareRemote, 'blocked-backup')
    const provider = await managedProvider(sandbox)

    await expect(provider.push(project.id)).rejects.toMatchObject({ code: 'SENSITIVE_FILES_BLOCKED' })
    const missingRef = await sandbox.service.git.runner.run(sandbox.projectPath, [
      `--git-dir=${bareRemote}`,
      'show-ref',
      '--verify',
      '--quiet',
      'refs/heads/vibegit-backup'
    ], { allowExitCodes: [0, 1] })
    expect(missingRef.exitCode).toBe(1)
  })
})
