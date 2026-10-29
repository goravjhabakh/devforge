import { randomUUID } from "node:crypto"

import { desc, eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type WebSocket from "ws"

import {
  ActivityEventSchema,
  ApiErrorSchema,
  GitStatusResponseSchema,
  ProjectDetailSchema,
} from "@devforge/contracts"
import { daemons, events, projects } from "@devforge/db"
import { ApiToDaemonMessageSchema, PROTOCOL_VERSION } from "@devforge/protocol"

import type { AppDeps } from "../app.js"

const ProjectParamsSchema = z.strictObject({
  projectId: z.uuid(),
})

const GitStatusBodySchema = z.strictObject({})

function sendSocketMessage(socket: WebSocket, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(JSON.stringify(value), (error: Error | undefined) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

export function registerProjectRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get("/api/projects/:projectId", async (request, reply) => {
    const params = ProjectParamsSchema.safeParse(request.params)

    if (!params.success) {
      const error = ApiErrorSchema.parse({
        code: "PROJECT_NOT_FOUND",
        message: "Project not found",
      })

      return reply.status(404).send(error)
    }

    const [project] = await deps.db
      .select()
      .from(projects)
      .where(eq(projects.id, params.data.projectId))
      .limit(1)

    if (!project) {
      const error = ApiErrorSchema.parse({
        code: "PROJECT_NOT_FOUND",
        message: "Project not found",
      })

      return reply.status(404).send(error)
    }

    const [daemon] = await deps.db
      .select()
      .from(daemons)
      .where(eq(daemons.id, project.daemonId))
      .limit(1)

    if (!daemon) {
      const error = ApiErrorSchema.parse({
        code: "INTERNAL_ERROR",
        message: "Assigned daemon not found",
      })

      return reply.status(500).send(error)
    }

    const eventRows = await deps.db
      .select()
      .from(events)
      .where(eq(events.projectId, project.id))
      .orderBy(desc(events.createdAt))
      .limit(20)

    const activity = eventRows.map((event) =>
      ActivityEventSchema.parse({
        id: event.id,
        projectId: event.projectId,
        daemonId: event.daemonId,
        requestId: event.requestId,
        type: event.type,
        payload: event.payload,
        createdAt: event.createdAt.toISOString(),
      })
    )

    const latestSuccessfulEvent = activity.find((event) => event.type === "git.status.succeeded")

    const latestStatus =
      latestSuccessfulEvent?.type === "git.status.succeeded"
        ? {
            status: latestSuccessfulEvent.payload.status,
            completedAt: latestSuccessfulEvent.createdAt,
          }
        : null

    const connection = deps.registry.getConnection(project.daemonId)

    const connected = connection !== undefined

    const available = deps.registry.hasAcceptedBinding(
      project.daemonId,
      project.id,
      project.daemonBindingId
    )

    const response = ProjectDetailSchema.parse({
      project: {
        id: project.id,
        name: project.name,
      },

      daemon: {
        id: daemon.id,
        connected,
        lastSeenAt: daemon.lastSeenAt?.toISOString() ?? null,
      },

      binding: {
        available,
      },

      latestStatus,

      activity,
    })

    return reply.send(response)
  })

  app.post("/api/projects/:projectId/git-status", async (request, reply) => {
    const params = ProjectParamsSchema.safeParse(request.params)

    if (!params.success) {
      return reply.status(400).send({
        code: "PROJECT_NOT_FOUND",
        message: "Invalid project ID",
      })
    }

    const body = GitStatusBodySchema.safeParse(request.body ?? {})

    if (!body.success) {
      return reply.status(400).send({
        code: "INTERNAL_ERROR",
        message: "Request body must be empty",
      })
    }

    const [project] = await deps.db
      .select()
      .from(projects)
      .where(eq(projects.id, params.data.projectId))
      .limit(1)

    if (!project) {
      const error = ApiErrorSchema.parse({
        code: "PROJECT_NOT_FOUND",
        message: "Project not found",
      })

      return reply.status(404).send(error)
    }

    const connection = deps.registry.getConnection(project.daemonId)

    if (!connection) {
      const error = ApiErrorSchema.parse({
        code: "DAEMON_DISCONNECTED",
        message: "Daemon is disconnected",
      })

      return reply.status(409).send(error)
    }

    const bindingAvailable = deps.registry.hasAcceptedBinding(
      project.daemonId,
      project.id,
      project.daemonBindingId
    )

    if (!bindingAvailable) {
      const error = ApiErrorSchema.parse({
        code: "BINDING_NOT_AVAILABLE",
        message: "Project binding is not available",
      })

      return reply.status(409).send(error)
    }

    if (deps.pendingRequests.hasProjectInFlight(project.id)) {
      const error = ApiErrorSchema.parse({
        code: "REQUEST_ALREADY_IN_FLIGHT",
        message: "A Git status request is already in flight",
      })

      return reply.status(409).send(error)
    }

    const requestId = randomUUID()
    const requestedAt = new Date()

    const requestedEvent = ActivityEventSchema.parse({
      id: randomUUID(),
      projectId: project.id,
      daemonId: project.daemonId,
      requestId,
      type: "git.status.requested",
      payload: {},
      createdAt: requestedAt.toISOString(),
    })

    await deps.db.insert(events).values({
      id: requestedEvent.id,
      projectId: requestedEvent.projectId,
      daemonId: requestedEvent.daemonId,
      requestId: requestedEvent.requestId,
      type: requestedEvent.type,
      payload: requestedEvent.payload,
      createdAt: new Date(requestedEvent.createdAt),
    })

    const pending = deps.pendingRequests.create({
      requestId,
      projectId: project.id,
      daemonId: project.daemonId,
      bindingId: project.daemonBindingId,
      timeoutMs: deps.commandTimeoutMs,
    })

    const commandMessage = ApiToDaemonMessageSchema.parse({
      version: PROTOCOL_VERSION,
      type: "command.request",
      messageId: randomUUID(),
      payload: {
        requestId,
        projectId: project.id,
        bindingId: project.daemonBindingId,
        command: {
          type: "git.status",
        },
      },
    })

    try {
      await sendSocketMessage(connection.socket, commandMessage)
    } catch {
      deps.pendingRequests.remove(requestId)

      const failedEvent = ActivityEventSchema.parse({
        id: randomUUID(),
        projectId: project.id,
        daemonId: project.daemonId,
        requestId,
        type: "git.status.failed",
        payload: {
          code: "DAEMON_DISCONNECTED",
          message: "Daemon disconnected before command dispatch",
        },
        createdAt: new Date().toISOString(),
      })

      await deps.db.insert(events).values({
        id: failedEvent.id,
        projectId: failedEvent.projectId,
        daemonId: failedEvent.daemonId,
        requestId: failedEvent.requestId,
        type: failedEvent.type,
        payload: failedEvent.payload,
        createdAt: new Date(failedEvent.createdAt),
      })

      const error = ApiErrorSchema.parse({
        code: "DAEMON_DISCONNECTED",
        message: "Daemon is disconnected",
      })

      return reply.status(409).send(error)
    }

    const outcome = await pending

    if (outcome.type === "result") {
      const succeededEvent = ActivityEventSchema.parse({
        id: randomUUID(),
        projectId: project.id,
        daemonId: project.daemonId,
        requestId,
        type: "git.status.succeeded",
        payload: {
          status: outcome.payload.result,
        },
        createdAt: outcome.payload.completedAt,
      })

      await deps.db.insert(events).values({
        id: succeededEvent.id,
        projectId: succeededEvent.projectId,
        daemonId: succeededEvent.daemonId,
        requestId: succeededEvent.requestId,
        type: succeededEvent.type,
        payload: succeededEvent.payload,
        createdAt: new Date(succeededEvent.createdAt),
      })

      const response = GitStatusResponseSchema.parse({
        requestId,
        status: outcome.payload.result,
        completedAt: outcome.payload.completedAt,
      })

      return reply.status(200).send(response)
    }

    if (outcome.type === "error") {
      const failedEvent = ActivityEventSchema.parse({
        id: randomUUID(),
        projectId: project.id,
        daemonId: project.daemonId,
        requestId,
        type: "git.status.failed",
        payload: {
          code: outcome.payload.code,
          message: outcome.payload.message,
        },
        createdAt: outcome.payload.completedAt,
      })

      await deps.db.insert(events).values({
        id: failedEvent.id,
        projectId: failedEvent.projectId,
        daemonId: failedEvent.daemonId,
        requestId: failedEvent.requestId,
        type: failedEvent.type,
        payload: failedEvent.payload,
        createdAt: new Date(failedEvent.createdAt),
      })

      if (outcome.payload.code === "COMMAND_TIMEOUT") {
        const error = ApiErrorSchema.parse({
          code: "COMMAND_TIMEOUT",
          message: "Git status command timed out",
        })

        return reply.status(504).send(error)
      }

      const error = ApiErrorSchema.parse({
        code: "DAEMON_COMMAND_FAILED",
        message: outcome.payload.message,
      })

      return reply.status(502).send(error)
    }

    if (outcome.type === "timeout") {
      const completedAt = new Date().toISOString()

      const failedEvent = ActivityEventSchema.parse({
        id: randomUUID(),
        projectId: project.id,
        daemonId: project.daemonId,
        requestId,
        type: "git.status.failed",
        payload: {
          code: "COMMAND_TIMEOUT",
          message: "Git status command timed out",
        },
        createdAt: completedAt,
      })

      await deps.db.insert(events).values({
        id: failedEvent.id,
        projectId: failedEvent.projectId,
        daemonId: failedEvent.daemonId,
        requestId: failedEvent.requestId,
        type: failedEvent.type,
        payload: failedEvent.payload,
        createdAt: new Date(failedEvent.createdAt),
      })

      const error = ApiErrorSchema.parse({
        code: "COMMAND_TIMEOUT",
        message: "Git status command timed out",
      })

      return reply.status(504).send(error)
    }

    const completedAt = new Date().toISOString()

    const failedEvent = ActivityEventSchema.parse({
      id: randomUUID(),
      projectId: project.id,
      daemonId: project.daemonId,
      requestId,
      type: "git.status.failed",
      payload: {
        code: "DAEMON_DISCONNECTED",
        message: "Daemon disconnected while command was in flight",
      },
      createdAt: completedAt,
    })

    await deps.db.insert(events).values({
      id: failedEvent.id,
      projectId: failedEvent.projectId,
      daemonId: failedEvent.daemonId,
      requestId: failedEvent.requestId,
      type: failedEvent.type,
      payload: failedEvent.payload,
      createdAt: new Date(failedEvent.createdAt),
    })

    const error = ApiErrorSchema.parse({
      code: "DAEMON_DISCONNECTED",
      message: "Daemon disconnected while command was in flight",
    })

    return reply.status(409).send(error)
  })
}
