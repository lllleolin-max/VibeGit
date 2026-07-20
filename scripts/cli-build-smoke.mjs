import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

const cli = resolve('dist/cli/index.js')
const dataDirectory = mkdtempSync(join(tmpdir(), 'vibegit-cli-smoke-'))

try {
  const help = spawnSync(process.execPath, [cli, '--help'], {
    encoding: 'utf8',
    env: { ...process.env, VIBEGIT_DATA_DIR: dataDirectory }
  })
  if (help.status !== 0 || !help.stdout.includes('vibegit event --stdin')) {
    throw new Error(`CLI help smoke failed: ${help.stderr || help.stdout}`)
  }

  const hookPayload = JSON.stringify({
    hook_event_name: 'UserPromptSubmit',
    cwd: join(dataDirectory, 'not-registered'),
    session_id: 'smoke-session',
    turn_id: 'smoke-turn',
    prompt: 'CLI build smoke'
  })
  const hook = spawnSync(process.execPath, [cli, 'hook', 'codex', '--stdin'], {
    input: hookPayload,
    encoding: 'utf8',
    env: { ...process.env, VIBEGIT_DATA_DIR: dataDirectory }
  })
  if (hook.status !== 0 || hook.stdout.trim() !== '{}') {
    throw new Error(`CLI Hook smoke failed: ${hook.stderr || hook.stdout}`)
  }

  process.stdout.write(`${JSON.stringify({ help: 'passed', unregisteredHook: 'passed', output: '{}' })}\n`)
} finally {
  rmSync(dataDirectory, { recursive: true, force: true })
}
