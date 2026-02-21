import Elysia from "elysia";
import { createLogger } from "@/utils/logger";

const log = createLogger("errorHandler");

export const errorHandler = new Elysia({ name: "errorHandler" }).onError(
	{ as: "global" },
	({ code, error, set }) => {
		switch (code) {
			case "VALIDATION":
				set.status = 422;
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
				return { code: "SOMETHING_WENT_WRONG" };

			case "UNKNOWN":
				log.error(error, "Unknown error");
				set.status = 500;
				return { code: "SOMETHING_WENT_WRONG" };

			case "PARSE":
				set.status = 400;
				return {
					code: "BAD_REQUEST",
					data: { info: "Invalid request body" },
				};

			default: {
				// Handle buildError() responses (status() throws with a specific shape)
				const statusCode =
					(error as Record<string, unknown>)?.status ??
					(error as Record<string, unknown>)?.statusCode;
				if (typeof statusCode === "number" && statusCode >= 400) {
					set.status = statusCode;
					const body = (error as Record<string, unknown>)?.response;
					if (body && typeof body === "object" && "code" in body) {
						return body;
					}
				}
				return;
			}
		}
	},
);
