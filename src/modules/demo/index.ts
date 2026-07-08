import Elysia from "elysia";
import { auth } from "@/config/auth";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import { checkRateLimit, rateLimitEnabled } from "@/utils/rate-limit";
import { DEMO_ACCOUNT } from "./demo.const";

const log = createLogger("demo");

const SESSION_MAX_ATTEMPTS = 10;
const SESSION_WINDOW_MS = 60_000;

/**
 * Public (pre-auth-guard) controller: signs the visitor into the shared demo
 * account and passes better-auth's Set-Cookie response through, so the
 * website's "Demo" button can open a ready-to-browse panel session.
 *
 * The demo workspace is reset from scratch by a daily cron (`demo:reset`),
 * so anything a visitor changes — including the account password — is
 * temporary. Sign-in happens server-side to keep the flow to one click.
 */
export const demoController = new Elysia({ prefix: "/api/demo" }).post(
	"/session",
	async ({ request }) => {
		const ip =
			request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
			"unknown";
		if (
			rateLimitEnabled() &&
			!checkRateLimit(
				`demo-session:${ip}`,
				SESSION_MAX_ATTEMPTS,
				SESSION_WINDOW_MS,
			)
		) {
			buildError("rateLimitExceeded", {
				info: "Too many demo sign-ins. Try again in a minute.",
			});
		}

		try {
			const response = await auth.api.signInEmail({
				asResponse: true,
				body: {
					email: DEMO_ACCOUNT.email,
					password: DEMO_ACCOUNT.password,
				},
			});
			if (!response.ok) {
				log.error({ status: response.status }, "Demo sign-in rejected by auth");
				buildError("storeUnavailable", {
					info: "Demo account is being reset. Try again in a minute.",
				});
			}
			return response;
		} catch (err) {
			log.error(err, "Demo sign-in failed");
			buildError("storeUnavailable", {
				info: "Demo account is being reset. Try again in a minute.",
			});
		}
	},
	{
		detail: {
			description: "Sign the visitor into the shared demo account",
			tags: ["Demo"],
		},
	},
);
