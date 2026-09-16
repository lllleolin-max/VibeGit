import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('browser compatibility API boundary', () => {
  let child: ChildProcess | undefined
  let root: string | undefined
  let origin = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'vibegit-browser-test-'))
    child = spawn(process.execPath, ['--import', 'tsx', resolve('scripts/browser-server.ts'), '--no-open'], {
      cwd: resolve('.'),
      env: { ...process.env, VIBEGIT_DATA_DIR: root },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const processHandle = child
    origin = await new Promise<string>((resolveReady, reject) => {
      let output = ''
      const timeout = setTimeout(() => reject(new Error(`Browser server did not start: ${output}`)), 20_000)
      const settle = (error?: Error, url?: string): void => {
        clearTimeout(timeout)
        if (error) reject(error)
        else resolveReady(url!)
      }
      processHandle.once('error', (error) => settle(error))
      processHandle.once('exit', (code) => settle(new Error(`Browser server exited (${code}): ${output}`)))
      processHandle.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
      processHandle.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString()
        const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]
        if (url) settle(undefined, url)
      })
    })
  })

  afterAll(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  async function invoke(body: string, requestOrigin = origin): Promise<Response> {
    return await fetch(`${origin}/api/invoke`, {
      method: 'POST',
      headers: { origin: requestOrigin, 'content-type': 'application/json' },
      body
    })
  }

  it('allows the local UI and rejects requests from another origin', async () => {
    expect(await (await invoke('{"method":"listProjects","args":[]}')).json()).toEqual({ ok: true, data: [] })
    expect((await invoke('{"method":"listProjects","args":[]}', 'https://untrusted.example')).status).toBe(403)
  })

  it('exposes safe authorization progress without starting a login', async () => {
    expect(await (await invoke('{"method":"githubAuthorizationStatus","args":[]}')).json()).toMatchObject({
      ok: true, data: { phase: 'idle' }
    })
  })

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'unknownMethod'])('rejects non-API method %s', async (method) => {
    expect(await (await invoke(JSON.stringify({ method, args: [] }))).json()).toMatchObject({
      ok: false, error: { code: 'INVALID_BROWSER_REQUEST' }
    })
  })

  it.each(['null', '[]', 'false', '{', '{"method":"listProjects","args":null}'])('rejects malformed payload %s', async (body) => {
    expect(await (await invoke(body)).json()).toMatchObject({
      ok: false, error: { code: 'INVALID_BROWSER_REQUEST' }
    })
  })

  it.each(['selectDataDirectory', 'setDataDirectory', 'minimizeWindow', 'toggleMaximizeWindow', 'closeWindow'])('reports unsupported desktop action %s', async (method) => {
    expect(await (await invoke(JSON.stringify({ method, args: [] }))).json()).toMatchObject({
      ok: false, error: { code: 'BROWSER_DESKTOP_REQUIRED' }
    })
  })
})
