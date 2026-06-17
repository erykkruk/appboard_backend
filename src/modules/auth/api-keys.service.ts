import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { sha256Hex } from "@/utils/crypto";
import { db } from "@/utils/db";
import { apiKeys } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";

/** Human-readable, non-secret token prefix (e.g. `ab_`). */
const TOKEN_PREFIX = "ab_";
/** Random bytes encoded into the token body (URL-safe base64). */
const TOKEN_BYTES = 32;
/** Length of the stored display prefix, e.g. `ab_1a2b3c4` (10 chars). */
const DISPLAY_PREFIX_LENGTH = 10;

/** `ab_` + URL-safe random. The plaintext is returned to the caller only once. */
function generateToken(): string {
	const random = randomBytes(TOKEN_BYTES).toString("base64url");
	return `${TOKEN_PREFIX}${random}`;
}

export const ApiKeysService = {
	/**
	 * Mint a new API key. Returns the plaintext token exactly once — only the
	 * sha-256 hash and a short display prefix are persisted.
	 */
	async create(workspaceId: string, name: string) {
		const token = generateToken();
		const keyHash = sha256Hex(token);
		const prefix = token.slice(0, DISPLAY_PREFIX_LENGTH);

		const [created] = await db
			.insert(apiKeys)
			.values({ keyHash, name, prefix, workspaceId })
			.returning({
				id: apiKeys.id,
				name: apiKeys.name,
				prefix: apiKeys.prefix,
			});

		return { ...created, token };
	},

	/** List the workspace's keys. Never exposes the token or its hash. */
	async list(workspaceId: string) {
		return db
			.select({
				createdAt: apiKeys.createdAt,
				id: apiKeys.id,
				lastUsedAt: apiKeys.lastUsedAt,
				name: apiKeys.name,
				prefix: apiKeys.prefix,
				revokedAt: apiKeys.revokedAt,
			})
			.from(apiKeys)
			.where(eq(apiKeys.workspaceId, workspaceId))
			.orderBy(desc(apiKeys.createdAt));
	},

	/**
	 * Resolve a plaintext bearer token to its workspace. Returns null when the
	 * token is unknown or revoked. Best-effort touches `lastUsedAt`.
	 */
	async resolveToken(
		token: string,
	): Promise<{ id: string; workspaceId: string } | null> {
		const keyHash = sha256Hex(token);
		const [row] = await db
			.select({ id: apiKeys.id, workspaceId: apiKeys.workspaceId })
			.from(apiKeys)
			.where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
			.limit(1);
		if (!row) return null;

		await db
			.update(apiKeys)
			.set({ lastUsedAt: new Date() })
			.where(eq(apiKeys.id, row.id));

		return row;
	},

	/** Revoke a key, scoped to the caller's workspace. */
	async revoke(workspaceId: string, id: string) {
		const [revoked] = await db
			.update(apiKeys)
			.set({ revokedAt: new Date() })
			.where(
				and(
					eq(apiKeys.id, id),
					eq(apiKeys.workspaceId, workspaceId),
					isNull(apiKeys.revokedAt),
				),
			)
			.returning({ id: apiKeys.id });
		if (!revoked) buildError("notFound", { info: "API key not found" });

		return { revoked: true };
	},
};
