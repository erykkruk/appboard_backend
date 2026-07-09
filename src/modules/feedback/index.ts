import Elysia from "elysia";
import { buildError } from "@/utils/errors";
import { checkRateLimit, rateLimitEnabled } from "@/utils/rate-limit";
import { feedbackBody } from "./feedback.schema";
import { FeedbackService } from "./feedback.service";

const MAX_SUBMISSIONS = 5;
const WINDOW_MS = 60_000;

// Public (pre-auth-guard) controller: the marketing site's feedback widget
// posts here. Rate-limited per IP to deter spam.
export const feedbackController = new Elysia({ prefix: "/api/feedback" }).post(
	"/",
	async ({ body, request }) => {
		const ip =
			request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
			"unknown";
		if (
			rateLimitEnabled() &&
			!checkRateLimit(`feedback:${ip}`, MAX_SUBMISSIONS, WINDOW_MS)
		) {
			buildError("rateLimitExceeded", {
				info: "Too many submissions. Please try again in a minute.",
			});
		}
		return FeedbackService.submit(body);
	},
	{
		body: feedbackBody,
		detail: {
			description: "Public product-feedback form — emails the maintainer",
			tags: ["Feedback"],
		},
	},
);
