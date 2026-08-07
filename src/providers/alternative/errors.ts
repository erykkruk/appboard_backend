/**
 * Pull a human-readable reason out of whatever a provider threw, so
 * `validateCredentials` can tell the user *why* a connection failed instead of
 * a generic "invalid credentials".
 *
 * `buildError()` throws an Elysia status object carrying the message in
 * `.response.data.info`; native errors use `.message`.
 */
export function describeStoreError(error: unknown): string {
	const err = error as Record<string, unknown> | null;
	const response = err?.response as
		| { code?: string; data?: { info?: string } }
		| undefined;
	if (response?.data?.info) return response.data.info;
	if (error instanceof Error && error.message) return error.message;
	if (response?.code) return response.code;
	return String(error);
}
