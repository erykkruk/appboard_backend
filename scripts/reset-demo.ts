/**
 * DEMO reset — meant for the daily cron (`bun run demo:reset`).
 *
 * Deletes ONLY the demo user and their workspaces (FK cascades wipe every
 * workspace-scoped row: stores, apps, listings, reviews, settings, groups,
 * purchases, sessions, …), then re-seeds fresh demo data via seedDemo().
 * This also undoes visitor changes such as a modified account password.
 *
 * Scoped strictly to DEMO_ACCOUNT.email — never touches any other data.
 */
import { eq } from "drizzle-orm";
import { DEMO_ACCOUNT } from "@/modules/demo/demo.const";
import { db } from "@/utils/db";
import { user, workspaceMembers, workspaces } from "@/utils/db/schema";
import { createLogger } from "@/utils/logger";
import { seedDemo } from "./seed-demo";

const log = createLogger("reset-demo");

export async function resetDemo(): Promise<void> {
	const [demoUser] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, DEMO_ACCOUNT.email))
		.limit(1);

	if (demoUser) {
		const memberships = await db
			.select({ workspaceId: workspaceMembers.workspaceId })
			.from(workspaceMembers)
			.where(eq(workspaceMembers.userId, demoUser.id));

		for (const { workspaceId } of memberships) {
			await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
		}
		await db.delete(user).where(eq(user.id, demoUser.id));
		log.info(
			{ userId: demoUser.id, workspaces: memberships.length },
			"Demo user + workspaces deleted",
		);
	} else {
		log.info("No demo user found — seeding from scratch");
	}

	await seedDemo();
	log.info("✓ Demo reset complete");
}

if (import.meta.main) {
	resetDemo()
		.then(() => process.exit(0))
		.catch((err) => {
			log.error(err, "Demo reset failed");
			process.exit(1);
		});
}
