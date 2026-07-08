/**
 * Optional workspace bootstrap seed.
 *
 * Creates an owner user + workspace from SEED_USER_EMAIL / SEED_USER_NAME
 * (set in your local .env). No-ops when SEED_USER_EMAIL is unset, so it ships
 * no personal data and is safe to run on any deployment. Idempotent: skips if a
 * user with that email already exists.
 *
 * Run with: bun run db:seed
 */
import { eq } from "drizzle-orm";
import config from "@/config";
import { db } from "@/utils/db";
import { user, workspaceMembers, workspaces } from "@/utils/db/schema";
import { createLogger } from "@/utils/logger";

const log = createLogger("seed");

async function seed() {
	const email = config.SEED_USER_EMAIL;
	const name = config.SEED_USER_NAME ?? "Owner";

	if (!email) {
		log.info("SEED_USER_EMAIL not set — nothing to seed.");
		return;
	}

	const existing = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email))
		.limit(1);

	if (existing.length > 0) {
		log.info({ email }, "Seed user already exists — skipping.");
		return;
	}

	const userId = `seed-${crypto.randomUUID()}`;
	await db
		.insert(user)
		.values({ email, emailVerified: true, id: userId, name });
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Workspace ${name}` })
		.returning();
	await db.insert(workspaceMembers).values({
		role: "owner",
		userId,
		workspaceId: workspace.id,
	});

	log.info(
		{ email, workspaceId: workspace.id },
		"Seeded owner user + workspace.",
	);
}

seed()
	.then(() => process.exit(0))
	.catch((err) => {
		log.error(err, "Seed failed");
		process.exit(1);
	});
