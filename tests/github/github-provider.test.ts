import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitHubProvider, type GhExecutor, type SystemExecutor } from '@vibegit/github-provider'
import type { TestSandbox } from '../helpers'
import { cleanupSandbox, createSandbox, writeProjectFile } from '../helpers'

function privateRepositoryExecutor(visibility = 'PRIVATE'): GhExecutor {
  return vi.fn(async (_cwd, args) => {
    if (args[0] === 'api') return { exitCode: 0, stdout: 'test-user\n', stderr: '' }
    if (args[0] === 'repo' && args[1] === 'view') return { exitCode: 0, stdout: `${visibility}\n`, stderr: '' }
    return { exitCode: 0, stdout: '', stderr: '' }
  })
}

async function configureLocalGitHubRemote(sandbox: TestSandbox, bareRemote: string, repository: string): Promise<string> {
  const remoteUrl = `https://github.com/test-user/${repository}.git`
  const runner = sandbox.service.git.runner
  const originalRun = runner.run.bind(runner)
  vi.spyOn(runner, 'run').mockImplementation(async (cwd, args, options) => {
    const isNetworkOperation = args[0] === 'fetch' || args[0] === 'push' ||
      (args[0] === 'ls-remote' && !args.includes('--get-url'))
    const routedArgs = isNetworkOperation
      ? args.map((argument) => argument === remoteUrl ? pathToFileURL(bareRemote).href : argument)
      : [...args]
    return await originalRun(cwd, routedArgs, options)
  })
  await runner.run(sandbox.projectPath, ['remote', 'add', 'vibegit', remoteUrl])
  return remoteUrl
}

describe('GitHubProvider mock contract', () => {
  let sandbox: TestSandbox | undefined
  afterEach(async () => { if (sandbox) await cleanupSandbox(sandbox); sandbox = undefined })

  it('uses explicit Private creation and configures the resulting remote', async () => {
    sandbox = await createSandbox()
    await writeProjectFile(sandbox, 'README.md', '# Test\n')
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const calls: string[][] = []
    const executor: GhExecutor = vi.fn(async (_cwd, args) => {
      calls.push(args)
      if (args[0] === 'api') return { exitCode: 0, stdout: 'test-user\n', stderr: '' }
      if (args[0] === 'repo' && args[1] === 'view') return { exitCode: 0, stdout: 'PRIVATE\n', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const provider = new GitHubProvider(sandbox.service.database, sandbox.service.git, sandbox.service.checkpoints, { executor })
    const remote = await provider.createPrivateRepository(project.id, 'safe-project')
    expect(remote).toBe('https://github.com/test-user/safe-project.git')
    expect(calls).toContainEqual(['repo', 'create', 'test-user/safe-project', '--private'])
    expect(await sandbox.service.git.getRemoteUrl(sandbox.projectPath, 'vibegit')).toBe(remote)
  })

  it('opens browser authorization, creates an app-owned SSH key, and uses SSH 443 for a new Private repository', async () => {
    sandbox = await createSandbox()
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
      dataDirectory: sandbox.dataDirectory
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

  it('pins every gh call to github.com when the ambient environment names another host', async () => {
    sandbox = await createSandbox()
    const project = await sandbox.service.addProject({ path: sandbox.projectPath })
    await sandbox.service.initializeProtection(project.id)
    const originalHost = process.env.GH_HOST
    process.env.GH_HOST = 'attacker.invalid'
    const observedHosts: Array<string | undefined> = []
    const executor: GhExecutor = vi.fn(async (_cwd, args, _options, environment) => {
      observedHosts.push(environment.GH_HOST)
      if (args[0] === 'api') return { exitCode: 0, stdout: 'test-user\n', stderr: '' }
      if (args[0] === 'repo' && args[1] === 'view') return { exitCode: 0, stdout: 'PRIVATE\n', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    try {
      const provider = new GitHubProvider(sandbox.service.database, sandbox.service.git, sandbox.service.checkpoints, { executor })
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
      if (args[0] === 'api') return { exitCode: 0, stdout: 'test-user\n', stderr: '' }
      if (args[0] === 'repo' && args[1] === 'view') return { exitCode: 0, stdout: 'PRIVATE\n', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const provider = new GitHubProvider(sandbox.service.database, sandbox.service.git, sandbox.service.checkpoints, { executor })

    const remote = 'https://github.com/test-user/existing-private.git'
    const original = 'https://github.com/test-user/original-project.git'
    await sandbox.service.git.runner.run(sandbox.projectPath, ['remote', 'add', 'origin', original])
    await expect(provider.connect(project.id, remote)).resolves.toBe(remote)
    expect(calls).toContainEqual(['repo', 'view', 'test-user/existing-private', '--json', 'visibility', '--jq', '.visibility'])
    expect(await sandbox.service.git.getRemoteUrl(sandbox.projectPath, 'vibegit')).toBe(remote)
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
    const provider = new GitHubProvider(
      sandbox.service.database,
      sandbox.service.git,
      sandbox.service.checkpoints,
      { executor: privateRepositoryExecutor() }
    )

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
    const provider = new GitHubProvider(
      sandbox.service.database,
      sandbox.service.git,
      sandbox.service.checkpoints,
      { executor: privateRepositoryExecutor() }
    )

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
    const provider = new GitHubProvider(
      sandbox.service.database,
      sandbox.service.git,
      sandbox.service.checkpoints,
      { executor }
    )

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
    const verifiedUrl = 'https://github.com/test-user/verified-private.git'
    await sandbox.service.git.runner.run(sandbox.projectPath, ['remote', 'add', 'vibegit', verifiedUrl])
    await sandbox.service.git.runner.run(sandbox.projectPath, [
      'config',
      `url.${pathToFileURL(redirectedRemote).href}.insteadOf`,
      verifiedUrl
    ])
    const provider = new GitHubProvider(
      sandbox.service.database,
      sandbox.service.git,
      sandbox.service.checkpoints,
      { executor: privateRepositoryExecutor() }
    )

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
    const verifiedUrl = 'https://github.com/test-user/push-verified-private.git'
    await sandbox.service.git.runner.run(sandbox.projectPath, ['remote', 'add', 'vibegit', verifiedUrl])
    await sandbox.service.git.runner.run(sandbox.projectPath, [
      'config',
      `url.${pathToFileURL(redirectedRemote).href}.pushInsteadOf`,
      verifiedUrl
    ])
    const provider = new GitHubProvider(
      sandbox.service.database,
      sandbox.service.git,
      sandbox.service.checkpoints,
      { executor: privateRepositoryExecutor() }
    )

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
    const provider = new GitHubProvider(
      sandbox.service.database,
      sandbox.service.git,
      sandbox.service.checkpoints,
      { executor: privateRepositoryExecutor() }
    )

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
