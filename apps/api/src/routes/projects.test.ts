import { createHash } from "node:crypto"
import type { AddressInfo } from "node:net"

import { afterEach, describe, expect, it } from "vitest"
import WebSocket from "ws"

import { bootstrapApprovals, bootstrapPlans, daemons, events, projects } from "@devforge/db"
import { ApiToDaemonMessageSchema } from "@devforge/protocol"

import type { AppDeps } from "../app.js"
import { buildApp } from "../app.js"
import { DaemonConnectionRegistry } from "../daemon/connection-registry.js"
import { PendingRequestManager } from "../daemon/pending-requests.js"

const daemonId = "11111111-1111-4111-8111-111111111111"
const projectId = "22222222-2222-4222-8222-222222222222"
const bindingId = "33333333-3333-4333-8333-333333333333"

const credential = "devforge-local-development-credential-0001"

const credentialHash = createHash("sha256").update(credential).digest("hex")

const validStatus = {
  branch: {
    head: "main",
    detached: false,
    upstream: "origin/main",
    ahead: 1,
    behind: 0,
  },
  staged: 1,
  unstaged: 2,
  untracked: 3,
  conflicted: 0,
  clean: false,
}

type StoredEvent = {
  id: string
  projectId: string
  daemonId: string | null
  requestId: string
  type: string
  payload: unknown
  createdAt: Date
}

type BootstrapState =
  | "not_started"
  | "awaiting_approval"
  | "approved"
  | "executing"
  | "succeeded"
  | "failed"

type StoredBootstrapPlan = {
  id: string
  projectId: string
  revision: number
  schemaVersion: number
  planHash: string
  document: unknown
  status: string
  attemptCount: number
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}

type StoredBootstrapApproval = {
  id: string
  projectId: string
  planId: string
  planHash: string
  approvedAt: Date
}

function createFakeDb(options: { bootstrapState?: BootstrapState } = {}) {
  const storedEvents: StoredEvent[] = []
  const storedBootstrapPlans: StoredBootstrapPlan[] = []
  const storedBootstrapApprovals: StoredBootstrapApproval[] = []

  const daemonRow = {
    id: daemonId,
    name: "Test daemon",
    credentialHash,
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const projectRow = {
    id: projectId,
    name: "Test project",
    daemonId,
    daemonBindingId: bindingId,
    bootstrapState: options.bootstrapState ?? "succeeded",
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const fakeDb: any = {
    select: (selection?: unknown) => ({
      from: (table: unknown) => {
        if (table === events) {
          return {
            where: () => ({
              orderBy: () => ({
                limit: async () =>
                  [...storedEvents].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
              }),
            }),
          }
        }

        if (table === bootstrapPlans) {
          return {
            where: () => ({
              limit: async () => {
                const plan = [...storedBootstrapPlans].sort((a, b) => b.revision - a.revision)[0]
                return plan ? [plan] : []
              },
              orderBy: () => ({
                limit: async () => {
                  const latest = [...storedBootstrapPlans].sort(
                    (a, b) => b.revision - a.revision
                  )[0]

                  if (!latest) {
                    return []
                  }

                  return selection ? [{ revision: latest.revision }] : [latest]
                },
              }),
            }),
          }
        }

        if (table === bootstrapApprovals) {
          return {
            where: () => ({
              limit: async () => {
                const approval = storedBootstrapApprovals.at(-1)
                return approval ? [approval] : []
              },
            }),
          }
        }

        return {
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
        }
      },
    }),

    insert: (table: unknown) => ({
      values: (value: unknown) => {
        if (table === events) {
          const values = Array.isArray(value) ? value : [value]

          for (const event of values) {
            storedEvents.push(event as StoredEvent)
          }

          return Promise.resolve([])
        }

        if (table === bootstrapPlans) {
          const input = value as {
            projectId: string
            revision: number
            schemaVersion: number
            planHash: string
            document: unknown
            status: string
          }

          const now = new Date()

          const plan: StoredBootstrapPlan = {
            id: "44444444-4444-4444-8444-444444444444",
            projectId: input.projectId,
            revision: input.revision,
            schemaVersion: input.schemaVersion,
            planHash: input.planHash,
            document: input.document,
            status: input.status,
            attemptCount: 0,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          }

          storedBootstrapPlans.push(plan)

          return {
            returning: async () => [plan],
          }
        }

        if (table === bootstrapApprovals) {
          const input = value as {
            projectId: string
            planId: string
            planHash: string
          }

          const approval: StoredBootstrapApproval = {
            id: "55555555-5555-4555-8555-555555555555",
            projectId: input.projectId,
            planId: input.planId,
            planHash: input.planHash,
            approvedAt: new Date(),
          }

          storedBootstrapApprovals.push(approval)

          return {
            returning: async () => [approval],
          }
        }

        return Promise.resolve([])
      },
    }),

    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: async () => {
          if (table === bootstrapPlans) {
            for (const plan of storedBootstrapPlans) {
              Object.assign(plan, value)
            }
          }

          if (table === projects) {
            Object.assign(projectRow, value)
          }

          return []
        },
      }),
    }),
  }

  fakeDb.transaction = async <T>(callback: (tx: typeof fakeDb) => Promise<T>): Promise<T> =>
    callback(fakeDb)

  return {
    db: fakeDb as unknown as AppDeps["db"],
    storedEvents,
    storedBootstrapPlans,
    storedBootstrapApprovals,
    projectRow,
  }
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

async function waitForCommandRequest(socket: WebSocket) {
  const raw = await waitForMessage(socket)
  const message = ApiToDaemonMessageSchema.parse(raw)

  if (message.type !== "command.request") {
    throw new Error(`Expected command.request, received ${message.type}`)
  }

  return message
}

describe("POST /api/projects/:projectId/git-status", () => {
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = []
  const sockets: WebSocket[] = []

  afterEach(async () => {
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.terminate()
      }
    }

    sockets.length = 0

    await Promise.all(apps.map((app) => app.close()))
    apps.length = 0
  })

  async function setup(commandTimeoutMs = 1_000) {
    const fakeDb = createFakeDb()
    const registry = new DaemonConnectionRegistry()
    const pendingRequests = new PendingRequestManager()

    const app = await buildApp({
      db: fakeDb.db,
      daemonWsPath: "/api/daemon",
      registry,
      pendingRequests,
      commandTimeoutMs,
    })

    apps.push(app)

    await app.listen({
      host: "127.0.0.1",
      port: 0,
    })

    const address = app.server.address() as AddressInfo

    return {
      app,
      registry,
      storedEvents: fakeDb.storedEvents,
      wsUrl: `ws://127.0.0.1:${address.port}/api/daemon`,
    }
  }

  async function connectDaemon(wsUrl: string) {
    const socket = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${credential}`,
        "X-Devforge-Daemon-Id": daemonId,
      },
    })

    sockets.push(socket)

    await waitForOpen(socket)

    const readyPromise = waitForMessage(socket)

    socket.send(
      JSON.stringify({
        version: 1,
        type: "daemon.hello",
        messageId: "66666666-6666-4666-8666-666666666666",
        payload: {
          daemonId,
          supportedVersions: [1],
          capabilities: ["git.status", "bootstrap.apply"],
          bindings: [
            {
              projectId,
              bindingId,
            },
          ],
        },
      })
    )

    const ready = ApiToDaemonMessageSchema.parse(await readyPromise)

    expect(ready.type).toBe("daemon.ready")

    return socket
  }

  it("dispatches git.status and returns a correlated result", { timeout: 10_000 }, async () => {
    const { app, wsUrl, storedEvents } = await setup()
    const socket = await connectDaemon(wsUrl)

    const commandPromise = waitForCommandRequest(socket)

    const responsePromise = app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git-status`,
    })

    const command = await commandPromise

    expect(command.payload.command).toEqual({
      type: "git.status",
    })

    expect(command.payload).not.toHaveProperty("repositoryRoot")
    expect(command.payload.command).not.toHaveProperty("args")
    expect(command.payload.command).not.toHaveProperty("executable")

    const completedAt = new Date().toISOString()

    socket.send(
      JSON.stringify({
        version: 1,
        type: "command.result",
        messageId: "77777777-7777-4777-8777-777777777777",
        payload: {
          requestId: command.payload.requestId,
          projectId,
          bindingId,
          commandType: "git.status",
          result: validStatus,
          startedAt: new Date().toISOString(),
          completedAt,
        },
      })
    )

    const response = await responsePromise

    expect(response.statusCode).toBe(200)

    expect(response.json()).toEqual({
      requestId: command.payload.requestId,
      status: validStatus,
      completedAt,
    })

    expect(storedEvents).toHaveLength(2)

    expect(storedEvents[0]).toMatchObject({
      requestId: command.payload.requestId,
      type: "git.status.requested",
    })

    expect(storedEvents[1]).toMatchObject({
      requestId: command.payload.requestId,
      type: "git.status.succeeded",
      payload: {
        status: validStatus,
      },
    })
  })

  it("rejects a second request while one is already in flight", async () => {
    const { app, wsUrl } = await setup()
    const socket = await connectDaemon(wsUrl)

    const commandPromise = waitForCommandRequest(socket)

    const firstResponsePromise = app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git-status`,
    })

    const command = await commandPromise

    const secondResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git-status`,
    })

    expect(secondResponse.statusCode).toBe(409)

    expect(secondResponse.json()).toEqual({
      code: "REQUEST_ALREADY_IN_FLIGHT",
      message: "A Git status request is already in flight",
    })

    socket.send(
      JSON.stringify({
        version: 1,
        type: "command.result",
        messageId: "77777777-7777-4777-8777-777777777777",
        payload: {
          requestId: command.payload.requestId,
          projectId,
          bindingId,
          commandType: "git.status",
          result: validStatus,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      })
    )

    const firstResponse = await firstResponsePromise

    expect(firstResponse.statusCode).toBe(200)
  })

  it("persists a failure and returns 504 when the daemon times out", async () => {
    const { app, wsUrl, storedEvents } = await setup(50)
    const socket = await connectDaemon(wsUrl)

    const commandPromise = waitForCommandRequest(socket)

    const responsePromise = app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git-status`,
    })

    const command = await commandPromise

    // Intentionally do not respond.
    const response = await responsePromise

    expect(response.statusCode).toBe(504)

    expect(response.json()).toEqual({
      code: "COMMAND_TIMEOUT",
      message: "Git status command timed out",
    })

    expect(storedEvents).toHaveLength(2)

    expect(storedEvents[0]).toMatchObject({
      requestId: command.payload.requestId,
      type: "git.status.requested",
    })

    expect(storedEvents[1]).toMatchObject({
      requestId: command.payload.requestId,
      type: "git.status.failed",
      payload: {
        code: "COMMAND_TIMEOUT",
      },
    })

    const nextCommandPromise = waitForCommandRequest(socket)
    const nextResponsePromise = app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git-status`,
    })
    const nextCommand = await nextCommandPromise

    socket.send(
      JSON.stringify({
        version: 1,
        type: "command.result",
        messageId: "77777777-7777-4777-8777-777777777777",
        payload: {
          requestId: nextCommand.payload.requestId,
          projectId,
          bindingId,
          commandType: "git.status",
          result: validStatus,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      })
    )

    expect((await nextResponsePromise).statusCode).toBe(200)
  })

  it("fails promptly when the daemon disconnects", async () => {
    const { app, wsUrl, storedEvents } = await setup(5_000)
    const socket = await connectDaemon(wsUrl)

    const commandPromise = waitForCommandRequest(socket)

    const responsePromise = app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git-status`,
    })

    const command = await commandPromise

    socket.close()

    const response = await responsePromise

    expect(response.statusCode).toBe(409)

    expect(response.json()).toEqual({
      code: "DAEMON_DISCONNECTED",
      message: "Daemon disconnected while command was in flight",
    })

    expect(storedEvents).toHaveLength(2)

    expect(storedEvents[0]).toMatchObject({
      requestId: command.payload.requestId,
      type: "git.status.requested",
    })

    expect(storedEvents[1]).toMatchObject({
      requestId: command.payload.requestId,
      type: "git.status.failed",
      payload: {
        code: "DAEMON_DISCONNECTED",
      },
    })

    const reconnectedSocket = await connectDaemon(wsUrl)
    const nextCommandPromise = waitForCommandRequest(reconnectedSocket)
    const nextResponsePromise = app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git-status`,
    })
    const nextCommand = await nextCommandPromise

    reconnectedSocket.send(
      JSON.stringify({
        version: 1,
        type: "command.result",
        messageId: "77777777-7777-4777-8777-877777777777",
        payload: {
          requestId: nextCommand.payload.requestId,
          projectId,
          bindingId,
          commandType: "git.status",
          result: validStatus,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      })
    )

    expect((await nextResponsePromise).statusCode).toBe(200)
  })

  it("does not accept a mismatched command result", async () => {
    const { app, wsUrl, storedEvents } = await setup(100)
    const socket = await connectDaemon(wsUrl)

    const commandPromise = waitForCommandRequest(socket)

    const responsePromise = app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git-status`,
    })

    const command = await commandPromise

    socket.send(
      JSON.stringify({
        version: 1,
        type: "command.result",
        messageId: "77777777-7777-4777-8777-777777777777",
        payload: {
          requestId: command.payload.requestId,

          // Valid UUID, but deliberately wrong project.
          projectId: "88888888-8888-4888-8888-888888888888",

          bindingId,
          commandType: "git.status",
          result: validStatus,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      })
    )

    const response = await responsePromise

    expect(response.statusCode).not.toBe(200)

    expect(storedEvents.some((event) => event.type === "git.status.succeeded")).toBe(false)

    expect(storedEvents[0]).toMatchObject({
      requestId: command.payload.requestId,
      type: "git.status.requested",
    })

    expect(storedEvents[1]).toMatchObject({
      requestId: command.payload.requestId,
      type: "git.status.failed",
    })
  })

  it("rejects a request when the daemon is disconnected without creating activity", async () => {
    const { app, storedEvents } = await setup()

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/git-status`,
    })

    expect(response.statusCode).toBe(409)

    expect(response.json()).toEqual({
      code: "DAEMON_DISCONNECTED",
      message: "Daemon is disconnected",
    })

    expect(storedEvents).toHaveLength(0)
  })
})

describe("POST /api/projects/:projectId/bootstrap/plan", () => {
  async function setupBootstrap(bootstrapState: BootstrapState = "not_started") {
    const fakeDb = createFakeDb({
      bootstrapState,
    })

    const app = await buildApp({
      db: fakeDb.db,
      daemonWsPath: "/api/daemon",
      registry: new DaemonConnectionRegistry(),
      pendingRequests: new PendingRequestManager(),
      commandTimeoutMs: 1_000,
    })

    return {
      app,
      storedEvents: fakeDb.storedEvents,
      storedBootstrapPlans: fakeDb.storedBootstrapPlans,
    }
  }

  it("creates a bootstrap plan and returns 201", async () => {
    const { app, storedEvents } = await setupBootstrap("not_started")

    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/plan`,
        payload: {
          initializeGit: true,
        },
      })

      expect(response.statusCode).toBe(201)

      const body = response.json()

      expect(body.revision).toBe(1)
      expect(body.status).toBe("awaiting_approval")
      expect(body.planHash).toMatch(/^[0-9a-f]{64}$/)

      expect(body.document.projectId).toBe(projectId)
      expect(body.document.bindingId).toBe(bindingId)

      expect(body.document.operations.at(-1)).toEqual({
        type: "git.init",
        initialBranch: "main",
      })

      expect(JSON.stringify(body)).not.toContain("C:\\")

      expect(storedEvents.some((event) => event.type === "bootstrap.plan_created")).toBe(true)
    } finally {
      await app.close()
    }
  })

  it("rejects malformed bootstrap plan request", async () => {
    const { app } = await setupBootstrap("not_started")

    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/plan`,
        payload: {
          initializeGit: "yes",
        },
      })

      expect(response.statusCode).toBe(400)

      expect(response.json()).toEqual({
        code: "INTERNAL_ERROR",
        message: "Invalid bootstrap plan request",
      })
    } finally {
      await app.close()
    }
  })

  it("rejects plan creation for succeeded project", async () => {
    const { app, storedEvents } = await setupBootstrap("succeeded")

    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/plan`,
        payload: {
          initializeGit: true,
        },
      })

      expect(response.statusCode).toBe(409)

      expect(response.json()).toEqual({
        code: "BOOTSTRAP_STATE_CONFLICT",
        message: "Project cannot create a bootstrap plan in its current state",
      })

      expect(storedEvents).toHaveLength(0)
    } finally {
      await app.close()
    }
  })
})

describe("bootstrap preview and approval routes", () => {
  async function setupBootstrap(bootstrapState: BootstrapState = "not_started") {
    const fakeDb = createFakeDb({ bootstrapState })

    const app = await buildApp({
      db: fakeDb.db,
      daemonWsPath: "/api/daemon",
      registry: new DaemonConnectionRegistry(),
      pendingRequests: new PendingRequestManager(),
      commandTimeoutMs: 1_000,
    })

    return {
      app,
      ...fakeDb,
    }
  }

  async function createPlan(app: Awaited<ReturnType<typeof buildApp>>) {
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/bootstrap/plan`,
      payload: {
        initializeGit: true,
      },
    })

    expect(response.statusCode).toBe(201)
    return response.json()
  }

  it("GET bootstrap returns current plan + approval", async () => {
    const { app } = await setupBootstrap("not_started")

    try {
      const plan = await createPlan(app)
      const planId = plan.id
      const planHash = plan.planHash

      const approveResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${planId}/approve`,
        payload: { planHash },
      })

      expect(approveResponse.statusCode).toBe(200)

      const response = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/bootstrap`,
      })

      expect(response.statusCode).toBe(200)

      const body = response.json()

      expect(body.state).toBe("approved")
      expect(body.plan).toMatchObject({
        id: planId,
        planHash,
        status: "approved",
      })
      expect(body.approval).toMatchObject({
        planId,
        planHash,
      })
    } finally {
      await app.close()
    }
  })

  it("GET bootstrap returns null plan before bootstrap starts", async () => {
    const { app } = await setupBootstrap("not_started")

    try {
      const response = await app.inject({
        method: "GET",
        url: `/api/projects/${projectId}/bootstrap`,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        state: "not_started",
        plan: null,
        approval: null,
      })
    } finally {
      await app.close()
    }
  })

  it("approve succeeds for exact plan hash", async () => {
    const { app, storedEvents } = await setupBootstrap("not_started")

    try {
      const plan = await createPlan(app)
      const planId = plan.id
      const planHash = plan.planHash

      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${planId}/approve`,
        payload: { planHash },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        planId,
        planHash,
      })

      expect(storedEvents.some((event) => event.type === "bootstrap.approved")).toBe(true)
    } finally {
      await app.close()
    }
  })

  it("approve rejects wrong hash", async () => {
    const { app } = await setupBootstrap("not_started")

    try {
      const plan = await createPlan(app)

      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/approve`,
        payload: {
          planHash: "0".repeat(64),
        },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({
        code: "BOOTSTRAP_STATE_CONFLICT",
        message: "Bootstrap plan cannot be approved",
      })
    } finally {
      await app.close()
    }
  })

  it("approve rejects superseded/non-awaiting plan", async () => {
    const { app, storedBootstrapPlans } = await setupBootstrap("not_started")

    try {
      const plan = await createPlan(app)

      storedBootstrapPlans[0]!.status = "superseded"

      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/approve`,
        payload: {
          planHash: plan.planHash,
        },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({
        code: "BOOTSTRAP_STATE_CONFLICT",
        message: "Bootstrap plan cannot be approved",
      })
    } finally {
      await app.close()
    }
  })

  it("execute dispatches the approved bootstrap plan", async () => {
    const fakeDb = createFakeDb({
      bootstrapState: "not_started",
    })

    const registry = new DaemonConnectionRegistry()
    const pendingRequests = new PendingRequestManager()

    const app = await buildApp({
      db: fakeDb.db,
      daemonWsPath: "/api/daemon",
      registry,
      pendingRequests,
      commandTimeoutMs: 1_000,
    })

    await app.listen({
      host: "127.0.0.1",
      port: 0,
    })

    const address = app.server.address() as AddressInfo
    const wsUrl = `ws://127.0.0.1:${address.port}/api/daemon`

    const socket = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${credential}`,
        "X-Devforge-Daemon-Id": daemonId,
      },
    })

    try {
      await waitForOpen(socket)

      const readyPromise = waitForMessage(socket)

      socket.send(
        JSON.stringify({
          version: 1,
          type: "daemon.hello",
          messageId: "66666666-6666-4666-8666-666666666666",
          payload: {
            daemonId,
            supportedVersions: [1],
            capabilities: ["git.status", "bootstrap.apply"],
            bindings: [
              {
                projectId,
                bindingId,
              },
            ],
          },
        })
      )

      const ready = ApiToDaemonMessageSchema.parse(await readyPromise)

      expect(ready.type).toBe("daemon.ready")

      const createResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/plan`,
        payload: {
          initializeGit: true,
        },
      })

      expect(createResponse.statusCode).toBe(201)

      const plan = createResponse.json()

      const approveResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/approve`,
        payload: {
          planHash: plan.planHash,
        },
      })

      expect(approveResponse.statusCode).toBe(200)

      const commandPromise = waitForCommandRequest(socket)

      const executeResponsePromise = app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/execute`,
        payload: {
          planHash: plan.planHash,
        },
      })

      const command = await commandPromise

      expect(command.payload.command).toEqual({
        type: "bootstrap.apply",
        planId: plan.id,
        planHash: plan.planHash,
        mode: "initial",
        plan: plan.document,
      })

      expect(command.payload).not.toHaveProperty("repositoryRoot")
      expect(command.payload.command).not.toHaveProperty("cwd")
      expect(command.payload.command).not.toHaveProperty("executable")
      expect(command.payload.command).not.toHaveProperty("args")

      const completedAt = new Date().toISOString()

      socket.send(
        JSON.stringify({
          version: 1,
          type: "command.result",
          messageId: "77777777-7777-4777-8777-777777777777",
          payload: {
            requestId: command.payload.requestId,
            projectId,
            bindingId,
            commandType: "bootstrap.apply",
            planId: plan.id,
            planHash: plan.planHash,
            verifiedOperationCount: plan.document.operations.length,
            reusedOperationCount: 0,
            gitInitialized: true,
            startedAt: new Date().toISOString(),
            completedAt,
          },
        })
      )

      const executeResponse = await executeResponsePromise

      expect(executeResponse.statusCode).toBe(200)

      expect(fakeDb.storedEvents.some((event) => event.type === "bootstrap.requested")).toBe(true)

      expect(fakeDb.storedEvents.some((event) => event.type === "bootstrap.succeeded")).toBe(true)
    } finally {
      socket.terminate()
      await app.close()
    }
  })

  it("retry reuses the same bootstrap plan with resume mode", async () => {
    const fakeDb = createFakeDb({
      bootstrapState: "not_started",
    })

    const registry = new DaemonConnectionRegistry()
    const pendingRequests = new PendingRequestManager()

    const app = await buildApp({
      db: fakeDb.db,
      daemonWsPath: "/api/daemon",
      registry,
      pendingRequests,
      commandTimeoutMs: 1_000,
    })

    await app.listen({
      host: "127.0.0.1",
      port: 0,
    })

    const address = app.server.address() as AddressInfo
    const wsUrl = `ws://127.0.0.1:${address.port}/api/daemon`

    const socket = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${credential}`,
        "X-Devforge-Daemon-Id": daemonId,
      },
    })

    try {
      await waitForOpen(socket)

      const readyPromise = waitForMessage(socket)

      socket.send(
        JSON.stringify({
          version: 1,
          type: "daemon.hello",
          messageId: "66666666-6666-4666-8666-666666666666",
          payload: {
            daemonId,
            supportedVersions: [1],
            capabilities: ["git.status", "bootstrap.apply"],
            bindings: [
              {
                projectId,
                bindingId,
              },
            ],
          },
        })
      )

      await readyPromise

      const createResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/plan`,
        payload: {
          initializeGit: true,
        },
      })

      expect(createResponse.statusCode).toBe(201)

      const plan = createResponse.json()

      const approveResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/approve`,
        payload: {
          planHash: plan.planHash,
        },
      })

      expect(approveResponse.statusCode).toBe(200)

      const initialCommandPromise = waitForCommandRequest(socket)

      const initialExecutePromise = app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/execute`,
        payload: {
          planHash: plan.planHash,
        },
      })

      const initialCommand = await initialCommandPromise

      const initialCompletedAt = new Date().toISOString()

      socket.send(
        JSON.stringify({
          version: 1,
          type: "command.error",
          messageId: "77777777-7777-4777-8777-777777777777",
          payload: {
            requestId: initialCommand.payload.requestId,
            projectId,
            bindingId,
            commandType: "bootstrap.apply",
            planId: plan.id,
            planHash: plan.planHash,
            code: "BOOTSTRAP_FAILED",
            message: "Simulated bootstrap failure",
            completedOperationCount: 1,
            reusedOperationCount: 0,
            startedAt: new Date().toISOString(),
            completedAt: initialCompletedAt,
          },
        })
      )

      const initialResponse = await initialExecutePromise

      expect(initialResponse.statusCode).toBe(502)

      const retryCommandPromise = waitForCommandRequest(socket)

      const retryResponsePromise = app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/retry`,
        payload: {
          planHash: plan.planHash,
        },
      })

      const retryCommand = await retryCommandPromise

      expect(retryCommand.payload.command).toEqual({
        type: "bootstrap.apply",
        planId: plan.id,
        planHash: plan.planHash,
        mode: "resume",
        plan: plan.document,
      })

      expect(initialCommand.payload.command.type).toBe("bootstrap.apply")
      expect(retryCommand.payload.command.type).toBe("bootstrap.apply")

      if (
        initialCommand.payload.command.type !== "bootstrap.apply" ||
        retryCommand.payload.command.type !== "bootstrap.apply"
      ) {
        throw new Error("Expected bootstrap.apply commands")
      }

      expect(retryCommand.payload.command.planId).toBe(initialCommand.payload.command.planId)

      expect(retryCommand.payload.command.planHash).toBe(initialCommand.payload.command.planHash)

      expect(retryCommand.payload.command.plan).toEqual(initialCommand.payload.command.plan)

      expect(retryCommand.payload.command.mode).toBe("resume")

      const retryCompletedAt = new Date().toISOString()

      socket.send(
        JSON.stringify({
          version: 1,
          type: "command.result",
          messageId: "88888888-8888-4888-8888-888888888888",
          payload: {
            requestId: retryCommand.payload.requestId,
            projectId,
            bindingId,
            commandType: "bootstrap.apply",
            planId: plan.id,
            planHash: plan.planHash,
            verifiedOperationCount: plan.document.operations.length,
            reusedOperationCount: 1,
            gitInitialized: true,
            startedAt: new Date().toISOString(),
            completedAt: retryCompletedAt,
          },
        })
      )

      const retryResponse = await retryResponsePromise

      expect(retryResponse.statusCode).toBe(200)
    } finally {
      socket.terminate()
      await app.close()
    }
  })

  it("execute rejects a non-approved plan", async () => {
    const fakeDb = createFakeDb({
      bootstrapState: "not_started",
    })

    const registry = new DaemonConnectionRegistry()

    const app = await buildApp({
      db: fakeDb.db,
      daemonWsPath: "/api/daemon",
      registry,
      pendingRequests: new PendingRequestManager(),
      commandTimeoutMs: 1_000,
    })

    await app.listen({
      host: "127.0.0.1",
      port: 0,
    })

    const address = app.server.address() as AddressInfo

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/daemon`, {
      headers: {
        Authorization: `Bearer ${credential}`,
        "X-Devforge-Daemon-Id": daemonId,
      },
    })

    try {
      await waitForOpen(socket)

      const readyPromise = waitForMessage(socket)

      socket.send(
        JSON.stringify({
          version: 1,
          type: "daemon.hello",
          messageId: "66666666-6666-4666-8666-666666666666",
          payload: {
            daemonId,
            supportedVersions: [1],
            capabilities: ["git.status", "bootstrap.apply"],
            bindings: [
              {
                projectId,
                bindingId,
              },
            ],
          },
        })
      )

      await readyPromise

      const createResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/plan`,
        payload: {
          initializeGit: true,
        },
      })

      const plan = createResponse.json()

      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/execute`,
        payload: {
          planHash: plan.planHash,
        },
      })

      expect(response.statusCode).toBe(409)

      expect(response.json()).toEqual({
        code: "BOOTSTRAP_STATE_CONFLICT",
        message: "Bootstrap plan cannot be executed",
      })
    } finally {
      socket.terminate()
      await app.close()
    }
  })

  it("execute daemon failure marks the bootstrap plan failed", async () => {
    const fakeDb = createFakeDb({
      bootstrapState: "not_started",
    })

    const registry = new DaemonConnectionRegistry()

    const app = await buildApp({
      db: fakeDb.db,
      daemonWsPath: "/api/daemon",
      registry,
      pendingRequests: new PendingRequestManager(),
      commandTimeoutMs: 1_000,
    })

    await app.listen({
      host: "127.0.0.1",
      port: 0,
    })

    const address = app.server.address() as AddressInfo

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/daemon`, {
      headers: {
        Authorization: `Bearer ${credential}`,
        "X-Devforge-Daemon-Id": daemonId,
      },
    })

    try {
      await waitForOpen(socket)

      const readyPromise = waitForMessage(socket)

      socket.send(
        JSON.stringify({
          version: 1,
          type: "daemon.hello",
          messageId: "66666666-6666-4666-8666-666666666666",
          payload: {
            daemonId,
            supportedVersions: [1],
            capabilities: ["git.status", "bootstrap.apply"],
            bindings: [
              {
                projectId,
                bindingId,
              },
            ],
          },
        })
      )

      await readyPromise

      const createResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/plan`,
        payload: {
          initializeGit: true,
        },
      })

      const plan = createResponse.json()

      const approveResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/approve`,
        payload: {
          planHash: plan.planHash,
        },
      })

      expect(approveResponse.statusCode).toBe(200)

      const commandPromise = waitForCommandRequest(socket)

      const responsePromise = app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/execute`,
        payload: {
          planHash: plan.planHash,
        },
      })

      const command = await commandPromise

      socket.send(
        JSON.stringify({
          version: 1,
          type: "command.error",
          messageId: "77777777-7777-4777-8777-777777777777",
          payload: {
            requestId: command.payload.requestId,
            projectId,
            bindingId,
            commandType: "bootstrap.apply",
            planId: plan.id,
            planHash: plan.planHash,
            code: "BOOTSTRAP_FAILED",
            message: "Simulated failure",
            completedOperationCount: 1,
            reusedOperationCount: 0,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        })
      )

      const response = await responsePromise

      expect(response.statusCode).toBe(502)

      expect(fakeDb.projectRow.bootstrapState).toBe("failed")

      expect(fakeDb.storedBootstrapPlans[0]?.status).toBe("failed")

      expect(fakeDb.storedEvents.some((event) => event.type === "bootstrap.failed")).toBe(true)
    } finally {
      socket.terminate()
      await app.close()
    }
  })

  it("retry rejects a non-failed plan", async () => {
    const fakeDb = createFakeDb({
      bootstrapState: "not_started",
    })

    const registry = new DaemonConnectionRegistry()

    const app = await buildApp({
      db: fakeDb.db,
      daemonWsPath: "/api/daemon",
      registry,
      pendingRequests: new PendingRequestManager(),
      commandTimeoutMs: 1_000,
    })

    await app.listen({
      host: "127.0.0.1",
      port: 0,
    })

    const address = app.server.address() as AddressInfo

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/daemon`, {
      headers: {
        Authorization: `Bearer ${credential}`,
        "X-Devforge-Daemon-Id": daemonId,
      },
    })

    try {
      await waitForOpen(socket)

      const readyPromise = waitForMessage(socket)

      socket.send(
        JSON.stringify({
          version: 1,
          type: "daemon.hello",
          messageId: "66666666-6666-4666-8666-666666666666",
          payload: {
            daemonId,
            supportedVersions: [1],
            capabilities: ["git.status", "bootstrap.apply"],
            bindings: [
              {
                projectId,
                bindingId,
              },
            ],
          },
        })
      )

      await readyPromise

      const createResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/plan`,
        payload: {
          initializeGit: true,
        },
      })

      const plan = createResponse.json()

      const approveResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/approve`,
        payload: {
          planHash: plan.planHash,
        },
      })

      expect(approveResponse.statusCode).toBe(200)

      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/retry`,
        payload: {
          planHash: plan.planHash,
        },
      })

      expect(response.statusCode).toBe(409)

      expect(response.json()).toEqual({
        code: "BOOTSTRAP_STATE_CONFLICT",
        message: "Bootstrap plan cannot be executed",
      })
    } finally {
      socket.terminate()
      await app.close()
    }
  })

  it("marks bootstrap failed when execution times out", async () => {
    const fakeDb = createFakeDb({
      bootstrapState: "not_started",
    })

    const registry = new DaemonConnectionRegistry()

    const app = await buildApp({
      db: fakeDb.db,
      daemonWsPath: "/api/daemon",
      registry,
      pendingRequests: new PendingRequestManager(),
      commandTimeoutMs: 50,
    })

    await app.listen({
      host: "127.0.0.1",
      port: 0,
    })

    const address = app.server.address() as AddressInfo

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/daemon`, {
      headers: {
        Authorization: `Bearer ${credential}`,
        "X-Devforge-Daemon-Id": daemonId,
      },
    })

    try {
      await waitForOpen(socket)

      const readyPromise = waitForMessage(socket)

      socket.send(
        JSON.stringify({
          version: 1,
          type: "daemon.hello",
          messageId: "66666666-6666-4666-8666-666666666666",
          payload: {
            daemonId,
            supportedVersions: [1],
            capabilities: ["git.status", "bootstrap.apply"],
            bindings: [
              {
                projectId,
                bindingId,
              },
            ],
          },
        })
      )

      await readyPromise

      const createResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/plan`,
        payload: {
          initializeGit: true,
        },
      })

      const plan = createResponse.json()

      await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/approve`,
        payload: {
          planHash: plan.planHash,
        },
      })

      const commandPromise = waitForCommandRequest(socket)

      const responsePromise = app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/execute`,
        payload: {
          planHash: plan.planHash,
        },
      })

      await commandPromise

      // Intentionally do not send a daemon response.
      const response = await responsePromise

      expect(response.statusCode).toBe(504)

      expect(response.json()).toEqual({
        code: "COMMAND_TIMEOUT",
        message: "Bootstrap command timed out",
      })

      expect(fakeDb.storedBootstrapPlans[0]?.status).toBe("failed")
      expect(fakeDb.projectRow.bootstrapState).toBe("failed")

      expect(fakeDb.storedEvents.some((event) => event.type === "bootstrap.failed")).toBe(true)
    } finally {
      socket.terminate()
      await app.close()
    }
  })

  it("execute rejects wrong plan hash", async () => {
    const fakeDb = createFakeDb({
      bootstrapState: "not_started",
    })

    const registry = new DaemonConnectionRegistry()

    const app = await buildApp({
      db: fakeDb.db,
      daemonWsPath: "/api/daemon",
      registry,
      pendingRequests: new PendingRequestManager(),
      commandTimeoutMs: 1_000,
    })

    await app.listen({
      host: "127.0.0.1",
      port: 0,
    })

    const address = app.server.address() as AddressInfo

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/daemon`, {
      headers: {
        Authorization: `Bearer ${credential}`,
        "X-Devforge-Daemon-Id": daemonId,
      },
    })

    try {
      await waitForOpen(socket)

      const readyPromise = waitForMessage(socket)

      socket.send(
        JSON.stringify({
          version: 1,
          type: "daemon.hello",
          messageId: "99999999-9999-4999-8999-999999999999",
          payload: {
            daemonId,
            supportedVersions: [1],
            capabilities: ["git.status", "bootstrap.apply"],
            bindings: [
              {
                projectId,
                bindingId,
              },
            ],
          },
        })
      )

      await readyPromise

      const createResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/plan`,
        payload: {
          initializeGit: true,
        },
      })

      const plan = createResponse.json()

      const approveResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/approve`,
        payload: {
          planHash: plan.planHash,
        },
      })

      expect(approveResponse.statusCode).toBe(200)

      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/execute`,
        payload: {
          planHash: "a".repeat(64),
        },
      })

      expect(response.statusCode).toBe(409)

      expect(response.json()).toEqual({
        code: "BOOTSTRAP_STATE_CONFLICT",
        message: "Bootstrap plan cannot be executed",
      })
    } finally {
      socket.terminate()
      await app.close()
    }
  })

  it("retry rejects a different plan hash", async () => {
    const fakeDb = createFakeDb({
      bootstrapState: "not_started",
    })

    const registry = new DaemonConnectionRegistry()

    const app = await buildApp({
      db: fakeDb.db,
      daemonWsPath: "/api/daemon",
      registry,
      pendingRequests: new PendingRequestManager(),
      commandTimeoutMs: 1_000,
    })

    await app.listen({
      host: "127.0.0.1",
      port: 0,
    })

    const address = app.server.address() as AddressInfo

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/daemon`, {
      headers: {
        Authorization: `Bearer ${credential}`,
        "X-Devforge-Daemon-Id": daemonId,
      },
    })

    try {
      await waitForOpen(socket)

      const readyPromise = waitForMessage(socket)

      socket.send(
        JSON.stringify({
          version: 1,
          type: "daemon.hello",
          messageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          payload: {
            daemonId,
            supportedVersions: [1],
            capabilities: ["git.status", "bootstrap.apply"],
            bindings: [
              {
                projectId,
                bindingId,
              },
            ],
          },
        })
      )

      await readyPromise

      const createResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/plan`,
        payload: {
          initializeGit: true,
        },
      })

      const plan = createResponse.json()

      const approveResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/approve`,
        payload: {
          planHash: plan.planHash,
        },
      })

      expect(approveResponse.statusCode).toBe(200)

      const commandPromise = waitForCommandRequest(socket)

      const executePromise = app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/execute`,
        payload: {
          planHash: plan.planHash,
        },
      })

      const command = await commandPromise

      socket.send(
        JSON.stringify({
          version: 1,
          type: "command.error",
          messageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          payload: {
            requestId: command.payload.requestId,
            projectId,
            bindingId,
            commandType: "bootstrap.apply",
            planId: plan.id,
            planHash: plan.planHash,
            code: "BOOTSTRAP_FAILED",
            message: "Simulated failure",
            completedOperationCount: 0,
            reusedOperationCount: 0,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        })
      )

      await executePromise

      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/bootstrap/${plan.id}/retry`,
        payload: {
          planHash: "b".repeat(64),
        },
      })

      expect(response.statusCode).toBe(409)

      expect(response.json()).toEqual({
        code: "BOOTSTRAP_STATE_CONFLICT",
        message: "Bootstrap plan cannot be executed",
      })
    } finally {
      socket.terminate()
      await app.close()
    }
  })
})
