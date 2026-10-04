import { describe, expect, it, vi } from 'vitest'
import { ServiceLifecycle } from '../../apps/desktop/src/main/service-lifecycle'

function signal() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

function resource(name: string) {
  let closed = false
  return {
    close: vi.fn(() => { closed = true }),
    read: () => { if (closed) throw new Error('Resource is closed'); return name }
  }
}

describe('desktop service lifetime during dependency reload', () => {
  it('lets an old operation finish on its original instance without waiting for new operations', async () => {
    const previous = resource('old database')
    const next = resource('new database')
    const lifecycle = new ServiceLifecycle<typeof previous>()
    lifecycle.replace(previous)
    const oldSignal = signal()
    const newSignal = signal()
    const oldOperation = lifecycle.run(async (current) => {
      expect(current.read()).toBe('old database')
      await oldSignal.promise
      return current.read()
    })
    lifecycle.replace(next)
    const newOperation = lifecycle.run(async (current) => {
      expect(current.read()).toBe('new database')
      await newSignal.promise
      return current.read()
    })
    expect(previous.close).not.toHaveBeenCalled()
    oldSignal.release()
    await expect(oldOperation).resolves.toBe('old database')
    expect(previous.close).toHaveBeenCalledTimes(1)
    expect(next.close).not.toHaveBeenCalled()
    newSignal.release()
    await expect(newOperation).resolves.toBe('new database')
    lifecycle.close()
    expect(next.close).toHaveBeenCalledTimes(1)
    expect(previous.close).toHaveBeenCalledTimes(1)
  })

  it('releases a retired instance when an in-flight operation fails', async () => {
    const previous = resource('old')
    const next = resource('new')
    const lifecycle = new ServiceLifecycle<typeof previous>()
    lifecycle.replace(previous)
    const gate = signal()
    const operation = lifecycle.run(async () => { await gate.promise; throw new Error('operation failed') })
    lifecycle.replace(next)
    gate.release()
    await expect(operation).rejects.toThrow('operation failed')
    expect(previous.close).toHaveBeenCalledTimes(1)
    expect(await lifecycle.run((current) => current.read())).toBe('new')
    lifecycle.close()
  })

  it('closes all instances exactly once at shutdown and rejects later requests', async () => {
    const previous = resource('old')
    const next = resource('new')
    const lifecycle = new ServiceLifecycle<typeof previous>()
    lifecycle.replace(previous)
    const gate = signal()
    const operation = lifecycle.run(async () => { await gate.promise })
    lifecycle.replace(next)
    lifecycle.close()
    lifecycle.close()
    gate.release()
    await operation
    expect(previous.close).toHaveBeenCalledTimes(1)
    expect(next.close).toHaveBeenCalledTimes(1)
    await expect(lifecycle.run((current) => current.read())).rejects.toThrow('not ready')
  })
})
