import type { VibeGitApi } from '@vibegit/shared'

declare global {
  interface Window {
    vibegit: VibeGitApi
  }
}

export {}
