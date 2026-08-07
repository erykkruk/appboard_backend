import { createSign } from "node:crypto";
import { AlternativeStoreProvider } from "@/providers/alternative/base";
import { describeStoreError } from "@/providers/alternative/errors";
import type { AppData } from "@/providers/store-provider";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("rustore-provider");

const RUSTORE_API_BASE = "https://public-api.rustore.ru";
const AUTH_PATH = "/public/auth";
const APPLICATION_PATH = "/public/v1/application";

/** RuStore rejects a timestamp more than 60s from its own clock. */
const TOKEN_TTL_MARGIN_MS = 30 * 1_000;

/** Credentials pasted in the panel: RuStore Console → API keys. */
export interface RuStoreCredentials {
	keyId: string;
	/** PEM-encoded RSA private key paired with the console key. */
	privateKey: string;
}

interface RuStoreEnvelope<T> {
	body?: T;
	code?: string;
	message?: string | null;
}

interface RuStoreAuthBody {
	jwe?: string;
	ttl?: number;
}

interface RuStoreApplication {
	appId?: number | string;
	appName?: string;
	appStatus?: string;
	packageName?: string;
}

interface CachedToken {
	expiresAtMs: number;
	token: string;
}

const tokenCache = new Map<string, CachedToken>();

/** Test seam — the cache is process-wide. */
export function clearRuStoreTokenCache(): void {
	tokenCache.clear();
}

/**
 * RuStore provider.
 *
 * Only the parts RuStore documents publicly are wired: the RSA-signed auth
 * handshake and the application list. RuStore's publishing model is
 * create-a-new-draft rather than edit-in-place, and its draft endpoints are not
 * documented in enough detail to implement honestly, so listing reads/writes
 * stay console-only and raise a typed error.
 */
export class RuStoreProvider extends AlternativeStoreProvider {
	private readonly credentials: RuStoreCredentials;

	constructor(credentials: Record<string, unknown>) {
		super("rustore");
		this.credentials = credentials as unknown as RuStoreCredentials;
	}

	async validateCredentials(): Promise<{ reason?: string; valid: boolean }> {
		try {
			await this.getToken();
			log.info(
				{ keyId: this.credentials.keyId },
				"RuStore credentials validated",
			);
			return { valid: true };
		} catch (err) {
			log.error({ err }, "RuStore credentials validation failed");
			return { reason: describeStoreError(err), valid: false };
		}
	}

	async fetchApps(): Promise<AppData[]> {
		const token = await this.getToken();
		const response = await fetch(
			`${RUSTORE_API_BASE}${APPLICATION_PATH}?pageSize=1000`,
			{ headers: { "Public-Token": token } },
		);

		if (!response.ok) {
			buildError("storeApiError", {
				info: `RuStore app list failed (HTTP ${response.status}).`,
			});
		}

		const envelope = (await response.json()) as RuStoreEnvelope<{
			content?: RuStoreApplication[];
		}>;
		assertRuStoreOk(envelope, "app list");

		return (envelope.body?.content ?? [])
			.filter((app) => app.packageName)
			.map((app) => ({
				bundleId: String(app.packageName),
				externalId: String(app.appId ?? app.packageName),
				name: app.appName || String(app.packageName),
				platform: "android" as const,
			}));
	}

	/**
	 * The token is a JWE valid for ~15 minutes, obtained by signing
	 * `keyId + timestamp` (plain concatenation, no delimiter) with SHA512withRSA
	 * and sending the base64 signature.
	 */
	private async getToken(): Promise<string> {
		const cached = tokenCache.get(this.credentials.keyId);
		if (cached && cached.expiresAtMs > Date.now()) return cached.token;

		// RuStore wants an ISO-8601 timestamp with an explicit UTC offset.
		const timestamp = new Date().toISOString().replace("Z", "+00:00");
		const signature = this.sign(`${this.credentials.keyId}${timestamp}`);

		const response = await fetch(`${RUSTORE_API_BASE}${AUTH_PATH}`, {
			body: JSON.stringify({
				keyId: this.credentials.keyId,
				signature,
				timestamp,
			}),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		});

		if (!response.ok) {
			buildError("storeConnectionFailed", {
				info: `RuStore rejected the authorization request (HTTP ${response.status}). Check the key ID and private key.`,
			});
		}

		const envelope =
			(await response.json()) as RuStoreEnvelope<RuStoreAuthBody>;
		assertRuStoreOk(envelope, "authorization");

		const jwe = envelope.body?.jwe;
		if (!jwe) {
			buildError("storeConnectionFailed", {
				info: "RuStore returned no access token.",
			});
		}

		const ttlMs = (envelope.body?.ttl ?? 900) * 1_000;
		tokenCache.set(this.credentials.keyId, {
			expiresAtMs: Date.now() + ttlMs - TOKEN_TTL_MARGIN_MS,
			token: jwe,
		});
		log.info({ keyId: this.credentials.keyId }, "RuStore token obtained");
		return jwe;
	}

	private sign(payload: string): string {
		try {
			const signer = createSign("RSA-SHA512");
			signer.update(payload);
			signer.end();
			return signer.sign(this.credentials.privateKey, "base64");
		} catch (err) {
			log.error({ err }, "RuStore signature could not be created");
			buildError("storeConnectionFailed", {
				info: "The RuStore private key could not be used to sign the request. Paste the PEM key exactly as downloaded from RuStore Console.",
			});
		}
	}
}

function assertRuStoreOk(
	envelope: RuStoreEnvelope<unknown>,
	context: string,
): void {
	if (!envelope.code || envelope.code === "OK") return;
	buildError("storeApiError", {
		info: `RuStore ${context} failed (${envelope.code}): ${envelope.message ?? "unknown error"}`,
	});
}
