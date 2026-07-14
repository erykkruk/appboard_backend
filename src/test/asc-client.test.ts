import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { ASC_URL_BASE, createAscFetch } from "@/providers/app-store/asc-fetch";
import {
	clearAscTokenCache,
	getAscToken,
	invalidateAscToken,
} from "@/providers/app-store/asc-token";
import type { AppStoreApiCredentials } from "@/providers/app-store/types";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

const CREDENTIALS: AppStoreApiCredentials = {
	issuerId: "issuer-1",
	keyId: "key-1",
	privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
};

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, headers: Record<string, string> = {}) {
	return new Response("{}", {
		headers: { "content-type": "application/json", ...headers },
		status,
	});
}

describe("App Store Connect token", () => {
	beforeEach(() => clearAscTokenCache());

	it("signs an ES256 token with the claims Apple requires", async () => {
		const token = await getAscToken(CREDENTIALS);

		const header = decodeProtectedHeader(token);
		expect(header.alg).toBe("ES256");
		expect(header.kid).toBe("key-1");

		const claims = decodeJwt(token);
		expect(claims.iss).toBe("issuer-1");
		expect(claims.aud).toBe("appstoreconnect-v1");

		const nowSeconds = Math.floor(Date.now() / 1_000);
		// Backdated to survive a local clock running ahead of Apple's.
		expect(claims.iat).toBeLessThan(nowSeconds);
		// Well inside Apple's 20-minute ceiling.
		expect(claims.exp as number).toBeLessThanOrEqual(nowSeconds + 1_200);
		expect(claims.exp as number).toBeGreaterThan(nowSeconds);
	});

	it("reuses a cached token instead of re-signing on every call", async () => {
		const first = await getAscToken(CREDENTIALS);
		const second = await getAscToken(CREDENTIALS);
		expect(second).toBe(first);
	});

	it("mints a fresh token after invalidation", async () => {
		const first = await getAscToken(CREDENTIALS);
		invalidateAscToken(CREDENTIALS);
		const second = await getAscToken(CREDENTIALS);
		expect(second).not.toBe(first);
	});

	it("does not share tokens between credentials", async () => {
		const first = await getAscToken(CREDENTIALS);
		const other = await getAscToken({ ...CREDENTIALS, keyId: "key-2" });
		expect(other).not.toBe(first);
	});
});

describe("App Store Connect fetch", () => {
	beforeEach(() => clearAscTokenCache());
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("authenticates App Store Connect requests", async () => {
		const seen: Array<Headers | undefined> = [];
		globalThis.fetch = (async (_url: string, options?: RequestInit) => {
			seen.push(options?.headers as Headers);
			return jsonResponse(200);
		}) as typeof fetch;

		const ascFetch = createAscFetch(CREDENTIALS);
		await ascFetch(`${ASC_URL_BASE}/v1/apps`);

		expect(seen[0]?.get("Authorization")).toStartWith("Bearer ");
	});

	it("never attaches the JWT to a pre-signed upload URL", async () => {
		const seen: Array<Headers | undefined> = [];
		globalThis.fetch = (async (_url: string, options?: RequestInit) => {
			seen.push(options?.headers as Headers);
			return jsonResponse(200);
		}) as typeof fetch;

		const ascFetch = createAscFetch(CREDENTIALS);
		await ascFetch("https://upload.itunes.apple.com/upload/abc", {
			headers: new Headers({ "Content-Type": "image/png" }),
			method: "PUT",
		});

		expect(seen[0]?.get("Authorization")).toBeNull();
	});

	it("re-mints the token once when Apple rejects it, then replays", async () => {
		const tokens: string[] = [];
		let call = 0;

		globalThis.fetch = (async (_url: string, options?: RequestInit) => {
			call++;
			const headers = options?.headers as Headers;
			tokens.push(headers.get("Authorization") ?? "");
			return jsonResponse(call === 1 ? 401 : 200);
		}) as typeof fetch;

		const ascFetch = createAscFetch(CREDENTIALS);
		const response = await ascFetch(`${ASC_URL_BASE}/v1/apps`);

		expect(response.status).toBe(200);
		expect(call).toBe(2);
		// The replay must not reuse the rejected token.
		expect(tokens[1]).not.toBe(tokens[0]);
	});

	it("gives up rather than looping forever on a persistent 401", async () => {
		let call = 0;
		globalThis.fetch = (async () => {
			call++;
			return jsonResponse(401);
		}) as typeof fetch;

		const ascFetch = createAscFetch(CREDENTIALS);
		const response = await ascFetch(`${ASC_URL_BASE}/v1/apps`);

		expect(response.status).toBe(401);
		expect(call).toBe(2);
	});

	it("honours Retry-After on a 429 and retries", async () => {
		let call = 0;
		globalThis.fetch = (async () => {
			call++;
			return call === 1
				? jsonResponse(429, { "retry-after": "0" })
				: jsonResponse(200);
		}) as typeof fetch;

		const ascFetch = createAscFetch(CREDENTIALS);
		const response = await ascFetch(`${ASC_URL_BASE}/v1/apps`);

		expect(response.status).toBe(200);
		expect(call).toBe(2);
	});

	it("does not retry a client error", async () => {
		let call = 0;
		globalThis.fetch = (async () => {
			call++;
			return jsonResponse(400);
		}) as typeof fetch;

		const ascFetch = createAscFetch(CREDENTIALS);
		const response = await ascFetch(`${ASC_URL_BASE}/v1/apps`);

		expect(response.status).toBe(400);
		expect(call).toBe(1);
	});
});
