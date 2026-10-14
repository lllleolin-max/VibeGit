#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { toPublicError } from '@vibegit/shared'
import { createVibeGitMcpServer } from './server.js'

const runtime = createVibeGitMcpServer()
const shutdown = (): void => {
  void runtime.close().catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify(toPublicError(error))}\n`)
    process.exitCode = 1
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
process.stdin.once('end', shutdown)
runtime.server.server.onclose = shutdown

try {
  await runtime.server.connect(new StdioServerTransport())
} catch (error) {
  process.stderr.write(`${JSON.stringify(toPublicError(error))}\n`)
  process.exitCode = 1
  await runtime.close()
}
