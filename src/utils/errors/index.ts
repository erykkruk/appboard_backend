import { status } from "elysia";

type ErrorData = { [key: string]: unknown; info?: string };

export const errors = {
	badRequest: { code: "BAD_REQUEST", status: 400 },
	encryptionFailed: { code: "ENCRYPTION_FAILED", status: 500 },
	forbidden: { code: "FORBIDDEN", status: 403 },
	invalidScreenshotDimensions: {
		code: "INVALID_SCREENSHOT_DIMENSIONS",
		status: 422,
	},
	notFound: { code: "NOT_FOUND", status: 404 },
	rateLimitExceeded: { code: "RATE_LIMIT_EXCEEDED", status: 429 },
	somethingWentWrong: { code: "SOMETHING_WENT_WRONG", status: 500 },
	storeApiError: { code: "STORE_API_ERROR", status: 502 },
	storeConnectionFailed: { code: "STORE_CONNECTION_FAILED", status: 502 },
	storeUnavailable: { code: "STORE_UNAVAILABLE", status: 503 },
	unauthorized: { code: "UNAUTHORIZED", status: 401 },
	validationFailed: { code: "VALIDATION", status: 422 },
	vaultLocked: { code: "VAULT_LOCKED", status: 423 },
	vaultRequired: { code: "VAULT_REQUIRED", status: 428 },
} as const satisfies Record<
	string,
	{ code: string; data?: ErrorData; status: number }
>;

export function buildError(type: keyof typeof errors, data?: ErrorData): never {
	const error = errors[type];
	if (!error) {
		throw status(500, { code: errors.somethingWentWrong.code });
	}
	throw status(error.status, { code: error.code, data });
}
