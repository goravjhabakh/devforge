import { randomUUID } from "node:crypto"

import { desc, eq } from "drizzle-orm"
import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import type WebSocket from "ws"

import {
  ActivityEventSchema,
  ApiErrorSchema,
  BootstrapPlanPreviewSchema,
  BootstrapPlanHashRequestSchema,
  CreateBootstrapPlanRequestSchema,
  GitStatusResponseSchema,
  ProjectBootstrapSchema,
  ProjectDetailSchema,
  validateBootstrapPlan,
} from "@devforge/contracts"
import { daemons, events, projects } from "@devforge/db"
import { ApiToDaemonMessageSchema, PROTOCOL_VERSION } from "@devforge/protocol"

import type { AppDeps } from "../app.js"
import { createBootstrapPlan } from "../bootstrap/plan.js"
import {
  approveBootstrapPlan,
  beginBootstrapExecution,
  completeBootstrapExecution,
  createBootstrapPlanRevision,
  failBootstrapExecution,
  getBootstrapApproval,
  getLatestBootstrapPlan,
} from "../bootstrap/repository.js"

const ProjectParamsSchema = z.strictObject({
  projectId: z.uuid(),
})

const BootstrapPlanParamsSchema = z.strictObject({
  projectId: z.uuid(),
  planId: z.uuid(),
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
  async function executeBootstrapPlan(
    projectId: string,
    planId: string,
    planHash: string,
    mode: "initial" | "resume",
    reply: FastifyReply
  ) {
    const [project] = await deps.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    if (!project) {
      return reply.status(404).send({
        code: "PROJECT_NOT_FOUND",
        message: "Project not found",
      })
    }

    const plan = await getLatestBootstrapPlan(deps.db, project.id)

    if (!plan || plan.id !== planId || plan.planHash !== planHash) {
      return reply.status(409).send({
        code: "BOOTSTRAP_STATE_CONFLICT",
        message: "Bootstrap plan cannot be executed",
      })
    }

    const approval = await getBootstrapApproval(deps.db, plan.id)

    if (!approval || approval.planHash !== plan.planHash) {
      return reply.status(409).send({
        code: "BOOTSTRAP_STATE_CONFLICT",
        message: "Bootstrap plan cannot be executed",
      })
    }

    if (mode === "initial" && plan.status !== "approved") {
      return reply.status(409).send({
        code: "BOOTSTRAP_STATE_CONFLICT",
        message: "Bootstrap plan cannot be executed",
      })
    }

    if (mode === "resume" && plan.status !== "failed") {
      return reply.status(409).send({
        code: "BOOTSTRAP_STATE_CONFLICT",
        message: "Bootstrap plan cannot be executed",
      })
    }

    const connection = deps.registry.getConnection(project.daemonId)

    if (!connection) {
      return reply.status(409).send({
        code: "DAEMON_DISCONNECTED",
        message: "Daemon is disconnected",
      })
    }

    const bindingAvailable = deps.registry.hasAcceptedBinding(
      project.daemonId,
      project.id,
      project.daemonBindingId
    )

    if (!bindingAvailable) {
      return reply.status(409).send({
        code: "BINDING_NOT_AVAILABLE",
        message: "Project binding is not available",
      })
    }

    if (deps.pendingRequests.hasProjectInFlight(project.id)) {
      return reply.status(409).send({
        code: "REQUEST_ALREADY_IN_FLIGHT",
        message: "A project command is already in flight",
      })
    }

    const executingPlan = await beginBootstrapExecution(deps.db, {
      projectId: project.id,
      planId: plan.id,
      retry: mode === "resume",
    })

    if (!executingPlan) {
      return reply.status(409).send({
        code: "BOOTSTRAP_STATE_CONFLICT",
        message: "Bootstrap plan cannot be executed",
      })
    }

    const attempt = executingPlan.attemptCount

    const requestId = randomUUID()

    const requestedEvent = ActivityEventSchema.parse({
      id: randomUUID(),
      projectId: project.id,
      daemonId: project.daemonId,
      requestId,
      type: "bootstrap.requested",
      payload: {
        planId: plan.id,
        planHash: plan.planHash,
        attempt,
        mode,
      },
      createdAt: new Date().toISOString(),
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
      commandType: "bootstrap.apply",
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
          type: "bootstrap.apply",
          planId: plan.id,
          planHash: plan.planHash,
          mode,
          plan: plan.document,
        },
      },
    })

    try {
      await sendSocketMessage(connection.socket, commandMessage)
    } catch {
      deps.pendingRequests.remove(requestId)

      const completedAt = new Date()

      await failBootstrapExecution(deps.db, {
        projectId: project.id,
        planId: plan.id,
        code: "BOOTSTRAP_FAILED",
        message: "Daemon disconnected before bootstrap dispatch",
        completedAt,
      })

      const failedEvent = ActivityEventSchema.parse({
        id: randomUUID(),
        projectId: project.id,
        daemonId: project.daemonId,
        requestId,
        type: "bootstrap.failed",
        payload: {
          planId: plan.id,
          planHash: plan.planHash,
          attempt,
          code: "BOOTSTRAP_FAILED",
          message: "Daemon disconnected before bootstrap dispatch",
        },
        createdAt: completedAt.toISOString(),
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

      return reply.status(409).send({
        code: "DAEMON_DISCONNECTED",
        message: "Daemon is disconnected",
      })
    }

    const outcome = await pending

    if (outcome.type === "result") {
      if (outcome.payload.commandType !== "bootstrap.apply") {
        throw new Error(`Expected bootstrap.apply result, received ${outcome.payload.commandType}`)
      }

      if (outcome.payload.planId !== plan.id || outcome.payload.planHash !== plan.planHash) {
        throw new Error("Received bootstrap result for a different plan")
      }

      await completeBootstrapExecution(deps.db, {
        projectId: project.id,
        planId: plan.id,
        completedAt: new Date(outcome.payload.completedAt),
      })

      const succeededEvent = ActivityEventSchema.parse({
        id: randomUUID(),
        projectId: project.id,
        daemonId: project.daemonId,
        requestId,
        type: "bootstrap.succeeded",
        payload: {
          planId: plan.id,
          planHash: plan.planHash,
          attempt,
          verifiedOperationCount: outcome.payload.verifiedOperationCount,
          reusedOperationCount: outcome.payload.reusedOperationCount,
          gitInitialized: outcome.payload.gitInitialized,
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

      return reply.status(200).send({
        requestId,
        planId: plan.id,
        planHash: plan.planHash,
        attempt,
        status: "succeeded",
        verifiedOperationCount: outcome.payload.verifiedOperationCount,
        reusedOperationCount: outcome.payload.reusedOperationCount,
        gitInitialized: outcome.payload.gitInitialized,
        completedAt: outcome.payload.completedAt,
      })
    }

    if (outcome.type === "error") {
      if (outcome.payload.commandType !== "bootstrap.apply") {
        throw new Error(`Expected bootstrap.apply error, received ${outcome.payload.commandType}`)
      }

      if (outcome.payload.planId !== plan.id || outcome.payload.planHash !== plan.planHash) {
        throw new Error("Received bootstrap error for a different plan")
      }

      await failBootstrapExecution(deps.db, {
        projectId: project.id,
        planId: plan.id,
        code: outcome.payload.code,
        message: outcome.payload.message,
        completedAt: new Date(outcome.payload.completedAt),
      })

      const failedEvent = ActivityEventSchema.parse({
        id: randomUUID(),
        projectId: project.id,
        daemonId: project.daemonId,
        requestId,
        type: "bootstrap.failed",
        payload: {
          planId: plan.id,
          planHash: plan.planHash,
          attempt,
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

      return reply.status(502).send({
        code: "DAEMON_COMMAND_FAILED",
        message: outcome.payload.message,
      })
    }

    if (outcome.type === "timeout") {
      const completedAt = new Date()

      await failBootstrapExecution(deps.db, {
        projectId: project.id,
        planId: plan.id,
        code: "BOOTSTRAP_FAILED",
        message: "Bootstrap command timed out",
        completedAt,
      })

      const failedEvent = ActivityEventSchema.parse({
        id: randomUUID(),
        projectId: project.id,
        daemonId: project.daemonId,
        requestId,
        type: "bootstrap.failed",
        payload: {
          planId: plan.id,
          planHash: plan.planHash,
          attempt,
          code: "BOOTSTRAP_FAILED",
          message: "Bootstrap command timed out",
        },
        createdAt: completedAt.toISOString(),
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

      return reply.status(504).send({
        code: "COMMAND_TIMEOUT",
        message: "Bootstrap command timed out",
      })
    }

    const completedAt = new Date()

    await failBootstrapExecution(deps.db, {
      projectId: project.id,
      planId: plan.id,
      code: "BOOTSTRAP_FAILED",
      message: "Daemon disconnected while bootstrap was in flight",
      completedAt,
    })

    const failedEvent = ActivityEventSchema.parse({
      id: randomUUID(),
      projectId: project.id,
      daemonId: project.daemonId,
      requestId,
      type: "bootstrap.failed",
      payload: {
        planId: plan.id,
        planHash: plan.planHash,
        attempt,
        code: "BOOTSTRAP_FAILED",
        message: "Daemon disconnected while bootstrap was in flight",
      },
      createdAt: completedAt.toISOString(),
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

    return reply.status(409).send({
      code: "DAEMON_DISCONNECTED",
      message: "Daemon disconnected while bootstrap was in flight",
    })
  }

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
        bootstrapState: project.bootstrapState,
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
      commandType: "git.status",
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
      if (outcome.payload.commandType !== "git.status") {
        throw new Error(`Expected git.status result, received ${outcome.payload.commandType}`)
      }

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

  app.post("/api/projects/:projectId/bootstrap/plan", async (request, reply) => {
    const params = ProjectParamsSchema.safeParse(request.params)

    if (!params.success) {
      return reply.status(400).send({
        code: "PROJECT_NOT_FOUND",
        message: "Invalid project ID",
      })
    }

    const body = CreateBootstrapPlanRequestSchema.safeParse(request.body)

    if (!body.success) {
      return reply.status(400).send({
        code: "INTERNAL_ERROR",
        message: "Invalid bootstrap plan request",
      })
    }

    const [project] = await deps.db
      .select()
      .from(projects)
      .where(eq(projects.id, params.data.projectId))
      .limit(1)

    if (!project) {
      return reply.status(404).send({
        code: "PROJECT_NOT_FOUND",
        message: "Project not found",
      })
    }

    if (project.bootstrapState === "executing" || project.bootstrapState === "succeeded") {
      return reply.status(409).send({
        code: "BOOTSTRAP_STATE_CONFLICT",
        message: "Project cannot create a bootstrap plan in its current state",
      })
    }

    const created = await createBootstrapPlan({
      projectId: project.id,
      bindingId: project.daemonBindingId,
      projectName: project.name,
      initializeGit: body.data.initializeGit,
    })

    const validation = await validateBootstrapPlan(created.document)

    if (!validation.success) {
      return reply.status(500).send({
        code: "INTERNAL_ERROR",
        message: "Generated bootstrap plan is invalid",
      })
    }

    const persisted = await createBootstrapPlanRevision(deps.db, {
      projectId: project.id,
      document: created.document,
      planHash: created.planHash,
    })

    const requestId = randomUUID()

    const createdEvent = ActivityEventSchema.parse({
      id: randomUUID(),
      projectId: project.id,
      daemonId: null,
      requestId,
      type: "bootstrap.plan_created",
      payload: {
        planId: persisted.id,
        revision: persisted.revision,
        planHash: persisted.planHash,
      },
      createdAt: new Date().toISOString(),
    })

    await deps.db.insert(events).values({
      id: createdEvent.id,
      projectId: createdEvent.projectId,
      daemonId: createdEvent.daemonId,
      requestId: createdEvent.requestId,
      type: createdEvent.type,
      payload: createdEvent.payload,
      createdAt: new Date(createdEvent.createdAt),
    })

    const response = BootstrapPlanPreviewSchema.parse({
      id: persisted.id,
      revision: persisted.revision,
      planHash: persisted.planHash,
      status: persisted.status,
      attemptCount: persisted.attemptCount,
      document: persisted.document,
      createdAt: persisted.createdAt.toISOString(),
      updatedAt: persisted.updatedAt.toISOString(),
      completedAt: persisted.completedAt?.toISOString() ?? null,
    })

    return reply.status(201).send(response)
  })

  app.get("/api/projects/:projectId/bootstrap", async (request, reply) => {
    const params = ProjectParamsSchema.safeParse(request.params)

    if (!params.success) {
      return reply.status(404).send({
        code: "PROJECT_NOT_FOUND",
        message: "Project not found",
      })
    }

    const [project] = await deps.db
      .select()
      .from(projects)
      .where(eq(projects.id, params.data.projectId))
      .limit(1)

    if (!project) {
      return reply.status(404).send({
        code: "PROJECT_NOT_FOUND",
        message: "Project not found",
      })
    }

    const plan = await getLatestBootstrapPlan(deps.db, project.id)

    const approval = plan ? await getBootstrapApproval(deps.db, plan.id) : null

    const response = ProjectBootstrapSchema.parse({
      state: project.bootstrapState,

      plan: plan
        ? {
            id: plan.id,
            revision: plan.revision,
            planHash: plan.planHash,
            status: plan.status,
            attemptCount: plan.attemptCount,
            document: plan.document,
            createdAt: plan.createdAt.toISOString(),
            updatedAt: plan.updatedAt.toISOString(),
            completedAt: plan.completedAt?.toISOString() ?? null,
          }
        : null,

      approval: approval
        ? {
            planId: approval.planId,
            planHash: approval.planHash,
            approvedAt: approval.approvedAt.toISOString(),
          }
        : null,
    })

    return reply.send(response)
  })

  app.post("/api/projects/:projectId/bootstrap/:planId/approve", async (request, reply) => {
    const params = BootstrapPlanParamsSchema.safeParse(request.params)

    if (!params.success) {
      return reply.status(400).send({
        code: "PROJECT_NOT_FOUND",
        message: "Invalid bootstrap request",
      })
    }

    const body = BootstrapPlanHashRequestSchema.safeParse(request.body)

    if (!body.success) {
      return reply.status(400).send({
        code: "INTERNAL_ERROR",
        message: "Invalid bootstrap approval request",
      })
    }

    const [project] = await deps.db
      .select()
      .from(projects)
      .where(eq(projects.id, params.data.projectId))
      .limit(1)

    if (!project) {
      return reply.status(404).send({
        code: "PROJECT_NOT_FOUND",
        message: "Project not found",
      })
    }

    const approval = await approveBootstrapPlan(deps.db, {
      projectId: project.id,
      planId: params.data.planId,
      planHash: body.data.planHash,
    })

    if (!approval) {
      return reply.status(409).send({
        code: "BOOTSTRAP_STATE_CONFLICT",
        message: "Bootstrap plan cannot be approved",
      })
    }

    const requestId = randomUUID()
    const plan = await getLatestBootstrapPlan(deps.db, project.id)

    const approvedEvent = ActivityEventSchema.parse({
      id: randomUUID(),
      projectId: project.id,
      daemonId: null,
      requestId,
      type: "bootstrap.approved",
      payload: {
        planId: approval.planId,
        planHash: approval.planHash,

        // Fetch this from the plan rather than guessing.
        revision: plan?.revision,
      },
      createdAt: approval.approvedAt.toISOString(),
    })

    await deps.db.insert(events).values({
      id: approvedEvent.id,
      projectId: approvedEvent.projectId,
      daemonId: approvedEvent.daemonId,
      requestId: approvedEvent.requestId,
      type: approvedEvent.type,
      payload: approvedEvent.payload,
      createdAt: new Date(approvedEvent.createdAt),
    })

    return reply.status(200).send({
      planId: approval.planId,
      planHash: approval.planHash,
      approvedAt: approval.approvedAt.toISOString(),
    })
  })

  app.post("/api/projects/:projectId/bootstrap/:planId/execute", async (request, reply) => {
    const params = BootstrapPlanParamsSchema.safeParse(request.params)

    if (!params.success) {
      return reply.status(400).send({
        code: "PROJECT_NOT_FOUND",
        message: "Invalid bootstrap request",
      })
    }

    const body = BootstrapPlanHashRequestSchema.safeParse(request.body)

    if (!body.success) {
      return reply.status(400).send({
        code: "INTERNAL_ERROR",
        message: "Invalid bootstrap execution request",
      })
    }

    return executeBootstrapPlan(
      params.data.projectId,
      params.data.planId,
      body.data.planHash,
      "initial",
      reply
    )
  })

  app.post("/api/projects/:projectId/bootstrap/:planId/retry", async (request, reply) => {
    const params = BootstrapPlanParamsSchema.safeParse(request.params)

    if (!params.success) {
      return reply.status(400).send({
        code: "PROJECT_NOT_FOUND",
        message: "Invalid bootstrap request",
      })
    }

    const body = BootstrapPlanHashRequestSchema.safeParse(request.body)

    if (!body.success) {
      return reply.status(400).send({
        code: "INTERNAL_ERROR",
        message: "Invalid bootstrap retry request",
      })
    }

    return executeBootstrapPlan(
      params.data.projectId,
      params.data.planId,
      body.data.planHash,
      "resume",
      reply
    )
  })
}
