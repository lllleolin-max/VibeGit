import { describe, expect, it } from 'vitest'
import { parseRecordAgentSummary, redactSecrets } from '@vibegit/shared'

describe('Secret redaction', () => {
  it('redacts quoted assignments, fine-grained tokens, and encrypted PEM before they enter diagnostics', () => {
    const secret = ['abcdefghijklm', 'nopqrstuvwxyz123456'].join('')
    const input = [
      JSON.stringify({ api_key: secret, access_token: secret, password: secret }),
      `${['github', 'pat', ''].join('_')}${secret}`,
      `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${secret}\n-----END ENCRYPTED PRIVATE KEY-----`
    ].join('\n')
    const redacted = redactSecrets(input)
    expect(redacted).not.toContain(secret)
    expect(redacted).toContain('[REDACTED PRIVATE KEY]')
    expect(redacted).toContain('api_key')
  })

  it('redacts complete quoted values and authorization schemes', () => {
    const token = ['abcdefghijklm', 'nopqrstuvwxyz123456'].join('')
    for (const value of [
      `Authorization: Bearer ${token}`,
      `Authorization: Basic ${token}`,
      'password: "two words with spaces"',
      "password='two words with spaces'",
      JSON.stringify({ password: 'two "quoted" words' })
    ]) {
      const redacted = redactSecrets(value)
      expect(redacted).not.toContain(token)
      expect(redacted).not.toContain('words')
      expect(redacted).toContain('[REDACTED]')
    }
  })

  it('redacts secrets even when summary limits cut off closing quotes or PEM footers', () => {
    const secret = 'FAKE_PRIVATE_VALUE '
    for (const overview of [
      `-----BEGIN PRIVATE KEY-----\n${secret.repeat(40)}\n-----END PRIVATE KEY-----`,
      `password="${secret.repeat(40)}"`
    ]) {
      const parsed = parseRecordAgentSummary({
        projectPath: '/project', agent: 'codex',
        summary: { overview, added: [], improved: [], removed: [] }
      })
      expect(parsed.summary.overview).toHaveLength(500)
      expect(redactSecrets(parsed.summary.overview!)).not.toContain(secret.trim())
    }
  })
})
