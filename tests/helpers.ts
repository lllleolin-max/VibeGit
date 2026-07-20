import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VibeGitService } from '@vibegit/core'

export interface TestSandbox {
  root: string
  projectPath: string
  dataDirectory: string
  service: VibeGitService
}

export async function createSandbox(name = '项目 with spaces'): Promise<TestSandbox> {
  const root = await mkdtemp(join(tmpdir(), 'vibegit-test-'))
  const projectPath = join(root, name)
  const dataDirectory = join(root, 'vibegit-data')
  await mkdir(projectPath, { recursive: true })
  return {
    root,
    projectPath,
    dataDirectory,
    service: new VibeGitService({ dataDirectory, commandTimeoutMs: 10_000 })
  }
}

export async function cleanupSandbox(sandbox: TestSandbox): Promise<void> {
  sandbox.service.close()
  await rm(sandbox.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
}

export async function writeProjectFile(sandbox: TestSandbox, relativePath: string, content: string | Buffer): Promise<void> {
  const path = join(sandbox.projectPath, relativePath)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

