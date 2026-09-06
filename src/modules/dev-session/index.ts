import { randomUUID } from "node:crypto";
import Elysia from "elysia";
import config from "@/config";
import { auth } from "@/config/auth";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("dev-session");

/**
 * Local-only entry point that creates a brand-new user (and, through the
 * better-auth signup hook, a brand-new empty workspace) and signs it in, so
 * the whole flow can be walked from zero without an inbox.
 *
 * It exists only when ENABLE_TEST_AUTH=true in a non-production environment
 * - the same switch that enables the x-test-user-id header - and is never
 * registered otherwise, so production cannot even route to it.
 */
export const devSessionEnabled =
	config.NODE_ENV !== "production" && config.ENABLE_TEST_AUTH === "true";

export const devSessionController = new Elysia({ prefix: "/api/dev" }).post(
	"/session",
	async () => {
		if (!devSessionEnabled) {
			buildError("notFound", { info: "Not available" });
		}
		const stamp = randomUUID().slice(0, 8);
		const email = `fresh-${stamp}@local.appboard`;
		try {
			const response = await auth.api.signUpEmail({
				asResponse: true,
				body: {
					email,
					name: `Fresh ${stamp}`,
					password: `fresh-${randomUUID()}`,
				},
			});
			if (!response.ok) {
				log.error(
					{ status: response.status },
					"Fresh sign-up rejected by auth",
				);
				buildError("storeUnavailable", {
					info: "Could not create a fresh workspace",
				});
			}
			log.info({ email }, "Fresh local workspace created");
			return response;
		} catch (err) {
			log.error(err, "Fresh sign-up failed");
			buildError("storeUnavailable", {
				info: "Could not create a fresh workspace",
			});
		}
	},
	{
		detail: {
			description:
				"Local development only: create and sign into a brand-new empty workspace.",
			tags: ["Demo"],
		},
	},
);
