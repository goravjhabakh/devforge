import type WebSocket from "ws"

export type AcceptedBinding = {
  projectId: string
  bindingId: string
}

export type DaemonConnection = {
  socket: WebSocket
  acceptedBindings: AcceptedBinding[]
  connectedAt: Date
}

export class DaemonConnectionRegistry {
  private readonly connections = new Map<string, DaemonConnection>()

  setConnection(daemonId: string, connection: DaemonConnection): void {
    const existing = this.connections.get(daemonId)

    if (existing && existing.socket !== connection.socket) {
      existing.socket.close()
    }

    this.connections.set(daemonId, connection)
  }

  getConnection(daemonId: string): DaemonConnection | undefined {
    return this.connections.get(daemonId)
  }

  removeConnection(daemonId: string, socket: WebSocket): boolean {
    const current = this.connections.get(daemonId)

    if (!current || current.socket !== socket) {
      return false
    }

    return this.connections.delete(daemonId)
  }

  isConnected(daemonId: string): boolean {
    return this.connections.has(daemonId)
  }

  hasAcceptedBinding(daemonId: string, projectId: string, bindingId: string): boolean {
    const connection = this.connections.get(daemonId)

    if (!connection) {
      return false
    }

    return connection.acceptedBindings.some(
      (binding) => binding.projectId === projectId && binding.bindingId === bindingId
    )
  }
}
