CREATE TABLE "bootstrap_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_hash" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bootstrap_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"plan_hash" text NOT NULL,
	"document" jsonb NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "bootstrap_state" text DEFAULT 'succeeded' NOT NULL;--> statement-breakpoint
ALTER TABLE "bootstrap_approvals" ADD CONSTRAINT "bootstrap_approvals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bootstrap_approvals" ADD CONSTRAINT "bootstrap_approvals_plan_id_bootstrap_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."bootstrap_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bootstrap_plans" ADD CONSTRAINT "bootstrap_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bootstrap_approvals_plan_unique" ON "bootstrap_approvals" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bootstrap_plans_project_revision_unique" ON "bootstrap_plans" USING btree ("project_id","revision");--> statement-breakpoint
CREATE INDEX "bootstrap_plans_project_status_idx" ON "bootstrap_plans" USING btree ("project_id","status");