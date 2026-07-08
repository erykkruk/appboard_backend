import Elysia from "elysia";
import config from "@/config";
import { ErrorLogService } from "@/modules/system/error-log.service";
import { createLogger } from "@/utils/logger";

const log = createLogger("errorHandler");

const isProd = config.NODE_ENV === "production";

// Client aborts and route-miss noise aren't worth persisting to the DB.
const NON_PERSISTED_CODES = new Set(["NOT_FOUND", "PARSE"]);

/**
 * Pull a human-readable message out of whatever was thrown. buildError() throws
 * an Elysia status object whose message lives in `.response.data.info`; native
 * errors use `.message`; everything else falls back to a JSON snapshot.
 */
function extractErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	const err = error as Record<string, unknown> | null;
	const response = err?.response as
		| { code?: string; data?: { info?: string } }
		| undefined;
	if (response?.data?.info) return response.data.info;
	if (response?.code) return response.code;
	if (typeof err?.message === "string") return err.message;
	try {
		return JSON.stringify(error).slice(0, 500);
	} catch {
		return String(error);
	}
}

export const errorHandler = new Elysia({ name: "errorHandler" }).onError(
	{ as: "global" },
	(ctx) => {
		const { code, error, set } = ctx;
		const request = ctx.request as Request | undefined;
		const method = request?.method;
		let path: string | undefined;
		try {
			path = request ? new URL(request.url).pathname : undefined;
		} catch {
			path = undefined;
		}

		// Persist any >= 400 (except NOT_FOUND/PARSE noise) to our DB so failures
		// are visible without SSH. Fire-and-forget + secret-scrubbed in the service.
		const persist = (statusCode: number, errCode: string) => {
			if (NON_PERSISTED_CODES.has(code) || statusCode < 400) return;
			ErrorLogService.record({
				code: errCode,
				context: { elysiaCode: code },
				level: statusCode >= 500 ? "error" : "warn",
				message: extractErrorMessage(error),
				method,
				path,
				statusCode,
			});
		};

		switch (code) {
			case "VALIDATION":
				set.status = 422;
				persist(422, "VALIDATION");
				return {
					code: "VALIDATION",
					data: { info: error.message },
				};

			case "NOT_FOUND":
				set.status = 404;
				return { code: "NOT_FOUND" };

			case "INTERNAL_SERVER_ERROR":
				log.error(error, "Internal server error");
				set.status = 500;
				persist(500, "SOMETHING_WENT_WRONG");
				return {
					code: "SOMETHING_WENT_WRONG",
					data: {
						info: isProd
							? "Internal server error"
							: error?.message || "Internal server error",
					},
				};

			case "UNKNOWN":
				log.error(error, "Unknown error");
				set.status = 500;
				persist(500, "SOMETHING_WENT_WRONG");
				return {
					code: "SOMETHING_WENT_WRONG",
					data: {
						info: isProd
							? "Internal server error"
							: error?.message || "Unknown error",
					},
				};

			case "PARSE":
				set.status = 400;
				return {
					code: "BAD_REQUEST",
					data: { info: "Invalid request body" },
				};

			default: {
				// Handle buildError() responses (status() throws with a specific shape)
				// Elysia status() puts HTTP code in .code (number), external APIs use .status/.statusCode
				const err = error as Record<string, unknown>;
				const rawCode = err?.status ?? err?.statusCode ?? err?.code;
				const statusCode = typeof rawCode === "number" ? rawCode : undefined;
				if (statusCode !== undefined && statusCode >= 400) {
					set.status = statusCode;
					const body = (error as Record<string, unknown>)?.response;
					if (body && typeof body === "object" && "code" in body) {
						persist(
							statusCode,
							String((body as Record<string, unknown>).code ?? "ERROR"),
						);
						return body;
					}
					// External/upstream API errors (e.g. googleapis). Don't leak raw
					// upstream messages to clients in production — they can carry
					// internal/request context. Full detail is still logged above.
					log.error(error, "Unhandled error with status code");
					persist(statusCode, "EXTERNAL_ERROR");
					return {
						code: "EXTERNAL_ERROR",
						data: {
							info: isProd
								? "Upstream service error"
								: error?.message || `Error (${statusCode})`,
						},
					};
				}
				log.error(error, "Unhandled error");
				set.status = 500;
				persist(500, "SOMETHING_WENT_WRONG");
				return {
					code: "SOMETHING_WENT_WRONG",
					data: {
						info: isProd
							? "Internal server error"
							: error?.message || "Unknown error",
					},
				};
			}
		}
	},
);
