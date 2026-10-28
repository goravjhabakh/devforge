import { desc, eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { ActivityEventSchema, ApiErrorSchema, ProjectDetailSchema } from "@devforge/contracts"
import { daemons, events, projects } from "@devforge/db"

import type { AppDeps } from "../app.js"

const ProjectParamsSchema = z.strictObject({
  projectId: z.uuid(),
})

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

    const response = ProjectDetailSchema.parse({
      project: {
        id: project.id,
        name: project.name,
      },

      daemon: {
        id: daemon.id,
        connected: false,
        lastSeenAt: daemon.lastSeenAt?.toISOString() ?? null,
      },

      binding: {
        available: false,
      },

      latestStatus,

      activity,
    })

    return reply.send(response)
  })
}
