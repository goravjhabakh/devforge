import { createHash } from "node:crypto"
import type { AddressInfo } from "node:net"

import { afterEach, describe, expect, it } from "vitest"
import WebSocket from "ws"

import { daemons, projects } from "@devforge/db"

import type { AppDeps } from "../app.js"
import { buildApp } from "../app.js"
import { DaemonConnectionRegistry } from "./connection-registry.js"

const daemonId = "11111111-1111-4111-8111-111111111111"
const otherDaemonId = "66666666-6666-4666-8666-666666666666"

const projectId = "22222222-2222-4222-8222-222222222222"
const bindingId = "33333333-3333-4333-8333-333333333333"

const fakeProjectId = "44444444-4444-4444-8444-444444444444"
const fakeBindingId = "55555555-5555-4555-8555-555555555555"

const credential = "devforge-local-development-credential-0001"

const credentialHash = createHash("sha256").update(credential).digest("hex")

function createFakeDb(): AppDeps["db"] {
  const daemonRow = {
    id: daemonId,
    credentialHash,
  }

  const projectRow = {
    id: projectId,
    daemonId,
    daemonBindingId: bindingId,
  }

  const fakeDb = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === daemons) {
              return [daemonRow]
            }

            if (table === projects) {
              return [projectRow]
            }

            return []
          },
        }),
      }),
    }),

    update: () => ({
      set: () => ({
        where: async () => [],
      }),
    }),
  }

  return fakeDb as unknown as AppDeps["db"]
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve)
    socket.once("error", reject)
  })
}

function waitForMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()))
      } catch (error) {
        reject(error)
      }
    })

    socket.once("error", reject)
  })
}

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.once("close", (code) => {
      resolve(code)
    })
  })
}

function createClient(
  url: string,
  options?: {
    daemonId?: string
    credential?: string
  }
) {
  return new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${options?.credential ?? credential}`,
      "X-Devforge-Daemon-Id": options?.daemonId ?? daemonId,
    },
  })
}

describe("daemon WebSocket", () => {
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = []

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()))
    apps.length = 0
  })

  async function setup() {
    const registry = new DaemonConnectionRegistry()

    const app = await buildApp({
      db: createFakeDb(),
      daemonWsPath: "/api/daemon",
      registry,
    })

    apps.push(app)

    await app.listen({
      host: "127.0.0.1",
      port: 0,
    })

    const address = app.server.address() as AddressInfo

    return {
      registry,
      url: `ws://127.0.0.1:${address.port}/api/daemon`,
    }
  }

  it("accepts valid authentication and daemon.hello", async () => {
    const { registry, url } = await setup()

    const socket = createClient(url)

    await waitForOpen(socket)

    const messagePromise = waitForMessage(socket)

    socket.send(
      JSON.stringify({
        version: 1,
        type: "daemon.hello",
        messageId: "77777777-7777-4777-8777-777777777777",
        payload: {
          daemonId,
          supportedVersions: [1],
          capabilities: ["git.status"],
          bindings: [
            {
              projectId,
              bindingId,
            },
          ],
        },
      })
    )

    const response = (await messagePromise) as {
      type: string
      payload: {
        selectedVersion: number
        bindings: Array<{
          projectId: string
          bindingId: string
        }>
      }
    }

    expect(response.type).toBe("daemon.ready")
    expect(response.payload.selectedVersion).toBe(1)

    expect(response.payload.bindings).toEqual([
      {
        projectId,
        bindingId,
      },
    ])

    expect(registry.isConnected(daemonId)).toBe(true)

    expect(registry.hasAcceptedBinding(daemonId, projectId, bindingId)).toBe(true)

    socket.close()
  })

  it("rejects an invalid credential", async () => {
    const { registry, url } = await setup()

    const socket = createClient(url, {
      credential: "definitely-the-wrong-credential",
    })

    const closePromise = waitForClose(socket)

    const code = await closePromise

    expect(code).toBe(1008)
    expect(registry.isConnected(daemonId)).toBe(false)
  })

  it("rejects a hello with a different daemon ID", async () => {
    const { registry, url } = await setup()

    const socket = createClient(url)

    await waitForOpen(socket)

    const closePromise = waitForClose(socket)

    socket.send(
      JSON.stringify({
        version: 1,
        type: "daemon.hello",
        messageId: "77777777-7777-4777-8777-777777777777",
        payload: {
          daemonId: otherDaemonId,
          supportedVersions: [1],
          capabilities: ["git.status"],
          bindings: [],
        },
      })
    )

    expect(await closePromise).toBe(1008)
    expect(registry.isConnected(daemonId)).toBe(false)
  })

  it("rejects an unsupported protocol version", async () => {
    const { registry, url } = await setup()

    const socket = createClient(url)

    await waitForOpen(socket)

    const closePromise = waitForClose(socket)

    socket.send(
      JSON.stringify({
        version: 2,
        type: "daemon.hello",
        messageId: "77777777-7777-4777-8777-777777777777",
        payload: {
          daemonId,
          supportedVersions: [2],
          capabilities: ["git.status"],
          bindings: [],
        },
      })
    )

    expect(await closePromise).toBe(1008)
    expect(registry.isConnected(daemonId)).toBe(false)
  })

  it("accepts the daemon but excludes an invalid binding", async () => {
    const { registry, url } = await setup()

    const socket = createClient(url)

    await waitForOpen(socket)

    const messagePromise = waitForMessage(socket)

    socket.send(
      JSON.stringify({
        version: 1,
        type: "daemon.hello",
        messageId: "77777777-7777-4777-8777-777777777777",
        payload: {
          daemonId,
          supportedVersions: [1],
          capabilities: ["git.status"],
          bindings: [
            {
              projectId,
              bindingId,
            },
            {
              projectId: fakeProjectId,
              bindingId: fakeBindingId,
            },
          ],
        },
      })
    )

    const response = (await messagePromise) as {
      type: string
      payload: {
        bindings: Array<{
          projectId: string
          bindingId: string
        }>
      }
    }

    expect(response.type).toBe("daemon.ready")

    expect(response.payload.bindings).toEqual([
      {
        projectId,
        bindingId,
      },
    ])

    expect(registry.isConnected(daemonId)).toBe(true)

    expect(registry.hasAcceptedBinding(daemonId, fakeProjectId, fakeBindingId)).toBe(false)

    socket.close()
  })
})
