import { describe, expect, it, vi } from "vitest"
import type WebSocket from "ws"

import { DaemonConnectionRegistry } from "./connection-registry.js"

const daemonId = "11111111-1111-4111-8111-111111111111"
const projectId = "22222222-2222-4222-8222-222222222222"
const bindingId = "33333333-3333-4333-8333-333333333333"

function createFakeSocket() {
  return {
    close: vi.fn(),
  } as unknown as WebSocket
}

describe("DaemonConnectionRegistry", () => {
  it("registers a connection", () => {
    const registry = new DaemonConnectionRegistry()
    const socket = createFakeSocket()

    registry.setConnection(daemonId, {
      socket,
      acceptedBindings: [],
      connectedAt: new Date(),
    })

    expect(registry.isConnected(daemonId)).toBe(true)
  })

  it("retrieves a registered connection", () => {
    const registry = new DaemonConnectionRegistry()
    const socket = createFakeSocket()

    registry.setConnection(daemonId, {
      socket,
      acceptedBindings: [],
      connectedAt: new Date(),
    })

    const connection = registry.getConnection(daemonId)

    expect(connection).toBeDefined()
    expect(connection?.socket).toBe(socket)
  })

  it("closes the old socket when a connection is replaced", () => {
    const registry = new DaemonConnectionRegistry()

    const oldSocket = createFakeSocket()
    const newSocket = createFakeSocket()

    registry.setConnection(daemonId, {
      socket: oldSocket,
      acceptedBindings: [],
      connectedAt: new Date(),
    })

    registry.setConnection(daemonId, {
      socket: newSocket,
      acceptedBindings: [],
      connectedAt: new Date(),
    })

    expect(oldSocket.close).toHaveBeenCalledOnce()
    expect(registry.getConnection(daemonId)?.socket).toBe(newSocket)
  })

  it("does not let an old socket remove its replacement", () => {
    const registry = new DaemonConnectionRegistry()

    const oldSocket = createFakeSocket()
    const newSocket = createFakeSocket()

    registry.setConnection(daemonId, {
      socket: oldSocket,
      acceptedBindings: [],
      connectedAt: new Date(),
    })

    registry.setConnection(daemonId, {
      socket: newSocket,
      acceptedBindings: [],
      connectedAt: new Date(),
    })

    const removed = registry.removeConnection(daemonId, oldSocket)

    expect(removed).toBe(false)
    expect(registry.isConnected(daemonId)).toBe(true)
    expect(registry.getConnection(daemonId)?.socket).toBe(newSocket)
  })

  it("finds accepted bindings", () => {
    const registry = new DaemonConnectionRegistry()
    const socket = createFakeSocket()

    registry.setConnection(daemonId, {
      socket,
      acceptedBindings: [
        {
          projectId,
          bindingId,
        },
      ],
      connectedAt: new Date(),
    })

    expect(registry.hasAcceptedBinding(daemonId, projectId, bindingId)).toBe(true)

    expect(
      registry.hasAcceptedBinding(daemonId, projectId, "44444444-4444-4444-8444-444444444444")
    ).toBe(false)
  })
})
