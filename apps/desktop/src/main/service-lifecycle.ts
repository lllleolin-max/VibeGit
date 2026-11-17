// Keep each IPC operation on the instance it started with while newly installed
// dependencies are picked up by a replacement service.
export class ServiceLifecycle<T extends { close(): void }> {
  private current: T | undefined
  private readonly active = new Map<T, number>()
  private readonly retired = new Set<T>()
  private shutdown: Promise<void> | undefined
  private resolveShutdown: (() => void) | undefined

  replace(next: T): void {
    if (this.shutdown) {
      this.retired.add(next)
      this.closeRetired(next)
      return
    }
    const previous = this.current
    this.current = next
    if (previous && previous !== next) {
      this.retired.add(previous)
      this.closeRetired(previous)
    }
  }

  async run<R>(operation: (service: T) => R | Promise<R>): Promise<R> {
    const service = this.current
    if (!service) throw new Error('VibeGit service is not ready')
    this.active.set(service, (this.active.get(service) ?? 0) + 1)
    try { return await operation(service) }
    finally {
      const remaining = (this.active.get(service) ?? 1) - 1
      if (remaining > 0) this.active.set(service, remaining)
      else this.active.delete(service)
      this.closeRetired(service)
      if (this.active.size === 0) this.resolveShutdown?.()
    }
  }

  private closeRetired(service: T): void {
    if (!this.active.has(service) && this.retired.delete(service)) service.close()
  }

  close(): Promise<void> {
    if (this.shutdown) return this.shutdown
    this.shutdown = new Promise<void>((resolve) => { this.resolveShutdown = resolve })
    if (this.current) this.retired.add(this.current)
    this.current = undefined
    for (const service of this.retired) this.closeRetired(service)
    if (this.active.size === 0) this.resolveShutdown?.()
    return this.shutdown
  }
}
