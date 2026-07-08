CREATE TABLE "workspace_vault" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"wrapped_dek" text NOT NULL,
	"wrap_nonce" text NOT NULL,
	"kdf_salt" text NOT NULL,
	"kdf_params" jsonb NOT NULL,
	"verifier" text NOT NULL,
	CONSTRAINT "workspace_vault_workspaceId_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_vault" ADD CONSTRAINT "workspace_vault_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;