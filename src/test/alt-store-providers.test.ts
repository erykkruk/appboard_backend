import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createProvider } from "@/providers";
import { validateAlternativeCredentials } from "@/providers/alternative/credentials.schema";
import { AmazonAppstoreProvider } from "@/providers/amazon-appstore";
import { clearAmazonTokenCache } from "@/providers/amazon-appstore/client";
import { HuaweiAppGalleryProvider } from "@/providers/huawei-appgallery";
import { clearHuaweiTokenCache } from "@/providers/huawei-appgallery/client";
import { MockStoreProvider } from "@/providers/mock";
import { OneStoreProvider } from "@/providers/onestore";
import { clearRuStoreTokenCache, RuStoreProvider } from "@/providers/rustore";
import { SamsungGalaxyProvider } from "@/providers/samsung-galaxy";
import { clearSamsungTokenCache } from "@/providers/samsung-galaxy/client";
import { XiaomiGetAppsProvider } from "@/providers/xiaomi-getapps";

const { privateKey: RSA_PRIVATE_KEY } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { format: "pem", type: "pkcs8" },
	publicKeyEncoding: { format: "pem", type: "spki" },
});

const realFetch = globalThis.fetch;

interface StubCall {
	body?: string;
	headers: Record<string, string>;
	method: string;
	url: string;
}

const calls: StubCall[] = [];

/** Token endpoints post URLSearchParams; everything else posts a JSON string. */
function readBody(body: unknown): string | undefined {
	if (typeof body === "string") return body;
	if (body instanceof URLSearchParams) return body.toString();
	return undefined;
}

/**
 * Route stubbed responses by URL fragment. Every provider talks to its store
 * exclusively through `fetch`, so this is the whole seam.
 */
function stubFetch(
	routes: Array<{
		match: string;
		status?: number;
		json?: unknown;
		text?: string;
		headers?: Record<string, string>;
	}>,
): void {
	globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
		const url = String(input);
		const headers: Record<string, string> = {};
		new Headers(init?.headers).forEach((value, key) => {
			headers[key] = value;
		});
		calls.push({
			body: readBody(init?.body),
			headers,
			method: init?.method ?? "GET",
			url,
		});

		const route = routes.find((candidate) => url.includes(candidate.match));
		if (!route) throw new Error(`Unstubbed request: ${url}`);

		const payload = route.text ?? JSON.stringify(route.json ?? {});
		return new Response(payload, {
			headers: { "Content-Type": "application/json", ...route.headers },
			status: route.status ?? 200,
		});
	}) as typeof globalThis.fetch;
}

/**
 * `buildError` throws an Elysia status object, not an `Error`, so assertions
 * inspect it directly instead of using `.rejects.toThrow()`.
 */
interface ThrownStatus {
	code: number;
	response?: { code?: string; data?: { info?: string } };
}

async function captureThrow(fn: () => Promise<unknown>): Promise<ThrownStatus> {
	try {
		await fn();
	} catch (err) {
		return err as ThrownStatus;
	}
	throw new Error("expected the call to throw");
}

beforeEach(() => {
	calls.length = 0;
	clearHuaweiTokenCache();
	clearSamsungTokenCache();
	clearAmazonTokenCache();
	clearRuStoreTokenCache();
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("createProvider factory", () => {
	it("routes each alternative store to its real provider", () => {
		expect(
			createProvider("huawei_appgallery", { clientId: "a", clientSecret: "b" }),
		).toBeInstanceOf(HuaweiAppGalleryProvider);
		expect(
			createProvider("samsung_galaxy", {
				privateKey: RSA_PRIVATE_KEY,
				serviceAccountId: "a",
			}),
		).toBeInstanceOf(SamsungGalaxyProvider);
		expect(
			createProvider("amazon_appstore", { clientId: "a", clientSecret: "b" }),
		).toBeInstanceOf(AmazonAppstoreProvider);
		expect(
			createProvider("rustore", { keyId: "1", privateKey: RSA_PRIVATE_KEY }),
		).toBeInstanceOf(RuStoreProvider);
		expect(
			createProvider("onestore", { clientId: "a", clientSecret: "b" }),
		).toBeInstanceOf(OneStoreProvider);
		expect(
			createProvider("xiaomi_getapps", {
				email: "dev@example.com",
				privateKey: RSA_PRIVATE_KEY,
			}),
		).toBeInstanceOf(XiaomiGetAppsProvider);
	});

	it("still serves seeded demo connections from the mock provider", () => {
		expect(createProvider("huawei_appgallery", { mock: true })).toBeInstanceOf(
			MockStoreProvider,
		);
	});
});

describe("Huawei AppGallery provider", () => {
	const credentials = {
		clientId: "client-1",
		clientSecret: "secret-1",
		packageNames: ["com.example.app"],
	};

	it("mints a token and sends it with the client_id header", async () => {
		stubFetch([
			{
				json: { access_token: "tok-1", expires_in: 172800 },
				match: "/oauth2/v1/token",
			},
			{
				json: {
					languages: [{ appName: "Demo", lang: "en-US" }],
					ret: { code: 0 },
				},
				match: "/app-info",
			},
		]);

		const provider = new HuaweiAppGalleryProvider(credentials);
		await provider.fetchListings("APP1");

		const appInfoCall = calls.find((call) => call.url.includes("/app-info"));
		expect(appInfoCall?.headers.authorization).toBe("Bearer tok-1");
		expect(appInfoCall?.headers.client_id).toBe("client-1");
	});

	it("reuses the cached token across calls", async () => {
		stubFetch([
			{
				json: { access_token: "tok-1", expires_in: 172800 },
				match: "/oauth2/v1/token",
			},
			{ json: { languages: [], ret: { code: 0 } }, match: "/app-info" },
		]);

		const provider = new HuaweiAppGalleryProvider(credentials);
		await provider.fetchListings("APP1");
		await provider.fetchListings("APP1");

		const tokenCalls = calls.filter((call) => call.url.includes("/token"));
		expect(tokenCalls.length).toBe(1);
	});

	it("maps AGC language info onto listings", async () => {
		stubFetch([
			{
				json: { access_token: "tok-1", expires_in: 172800 },
				match: "/oauth2/v1/token",
			},
			{
				json: {
					languages: [
						{
							appDesc: "Full description",
							appName: "Demo",
							briefInfo: "Short",
							lang: "en-US",
							newFeatures: "Bug fixes",
						},
					],
					ret: { code: 0 },
				},
				match: "/app-info",
			},
		]);

		const [listing] = await new HuaweiAppGalleryProvider(
			credentials,
		).fetchListings("APP1");

		expect(listing).toEqual({
			fullDesc: "Full description",
			language: "en-US",
			shortDesc: "Short",
			title: "Demo",
			whatsNew: "Bug fixes",
		});
	});

	it("writes listing text to the five fields AGC accepts", async () => {
		stubFetch([
			{
				json: { access_token: "tok-1", expires_in: 172800 },
				match: "/oauth2/v1/token",
			},
			{ json: { ret: { code: 0 } }, match: "/app-language-info" },
		]);

		await new HuaweiAppGalleryProvider(credentials).updateListing(
			"APP1",
			"en-US",
			{ shortDesc: "Short", title: "New title" },
		);

		const update = calls.find((call) =>
			call.url.includes("/app-language-info"),
		);
		expect(update?.method).toBe("PUT");
		expect(JSON.parse(update?.body ?? "{}")).toEqual({
			appName: "New title",
			briefInfo: "Short",
			lang: "en-US",
		});
	});

	it("surfaces the AGC error message from a 200 response", async () => {
		stubFetch([
			{
				json: { access_token: "tok-1", expires_in: 172800 },
				match: "/oauth2/v1/token",
			},
			{
				json: { ret: { code: 204144647, msg: "app not exist" } },
				match: "/app-info",
			},
		]);

		const thrown = await captureThrow(() =>
			new HuaweiAppGalleryProvider(credentials).fetchListings("APP1"),
		);
		expect(thrown.response?.code).toBe("STORE_API_ERROR");
		expect(thrown.response?.data?.info).toContain("app not exist");
	});

	it("reports a human-readable reason when the token is rejected", async () => {
		stubFetch([
			{
				json: { ret: { code: 101, msg: "client secret invalid" } },
				match: "/oauth2/v1/token",
			},
		]);

		const result = await new HuaweiAppGalleryProvider(
			credentials,
		).validateCredentials();

		expect(result.valid).toBe(false);
		expect(result.reason).toContain("client secret invalid");
	});

	it("raises a typed error for capabilities AGC has no API for", async () => {
		const provider = new HuaweiAppGalleryProvider(credentials);

		const reviews = await captureThrow(() => provider.fetchReviews("APP1"));
		expect(reviews.code).toBe(400);
		expect(reviews.response?.data?.info).toContain("Huawei AppGallery");

		const purchases = await captureThrow(() =>
			provider.fetchInAppPurchases("APP1"),
		);
		expect(purchases.code).toBe(400);
	});
});

describe("Samsung Galaxy Store provider", () => {
	const credentials = {
		privateKey: RSA_PRIVATE_KEY,
		serviceAccountId: "sa-1",
	};

	it("exchanges a signed JWT for an access token and sends both headers", async () => {
		stubFetch([
			{ json: { accessToken: "acc-1" }, match: "/auth/accessToken" },
			{
				json: [{ contentId: "000001234567", contentName: "Demo" }],
				match: "/seller/contentList",
			},
		]);

		const apps = await new SamsungGalaxyProvider(credentials).fetchApps();

		expect(apps).toEqual([
			{
				bundleId: "000001234567",
				externalId: "000001234567",
				name: "Demo",
				platform: "android",
			},
		]);

		const tokenCall = calls.find((call) =>
			call.url.includes("/auth/accessToken"),
		);
		// The JWT is signed locally and passed as a bearer token.
		expect(tokenCall?.headers.authorization).toMatch(/^Bearer eyJ/);

		const listCall = calls.find((call) => call.url.includes("/contentList"));
		expect(listCall?.headers.authorization).toBe("Bearer acc-1");
		expect(listCall?.headers["service-account-id"]).toBe("sa-1");
	});

	it("surfaces the gateway error message", async () => {
		stubFetch([
			{ json: { accessToken: "acc-1" }, match: "/auth/accessToken" },
			{
				json: { resultCode: "4008", resultMessage: "content is not yours" },
				match: "/seller/contentList",
			},
		]);

		const result = await new SamsungGalaxyProvider(
			credentials,
		).validateCredentials();

		expect(result.valid).toBe(false);
		expect(result.reason).toContain("content is not yours");
	});

	it("merges a language into addLanguage and keeps the mandatory fields", async () => {
		stubFetch([
			{ json: { accessToken: "acc-1" }, match: "/auth/accessToken" },
			{
				json: [
					{
						addLanguage: [{ appTitle: "Old", languagecode: "ENG" }],
						appTitle: "Demo",
						contentId: "000001234567",
						defaultLanguageCode: "ENG",
						paid: "N",
						publicationType: "PUBLIC",
					},
				],
				match: "/seller/contentInfo",
			},
			{
				json: { contentStatus: "REGISTERING" },
				match: "/seller/contentUpdate",
			},
		]);

		await new SamsungGalaxyProvider(credentials).updateListing(
			"000001234567",
			"ENG",
			{ title: "New title" },
		);

		const update = calls.find((call) => call.url.includes("/contentUpdate"));
		const body = JSON.parse(update?.body ?? "{}");
		expect(body.contentId).toBe("000001234567");
		expect(body.defaultLanguageCode).toBe("ENG");
		expect(body.publicationType).toBe("PUBLIC");
		expect(body.addLanguage).toEqual([
			{ appTitle: "New title", languagecode: "ENG" },
		]);
	});

	it("raises a typed error for reviews, which Galaxy Store has no API for", async () => {
		const thrown = await captureThrow(() =>
			new SamsungGalaxyProvider(credentials).fetchReviews("000001234567"),
		);
		expect(thrown.code).toBe(400);
		expect(thrown.response?.data?.info).toContain("Samsung Galaxy Store");
	});
});

describe("Amazon Appstore provider", () => {
	const credentials = {
		clientId: "amzn-client",
		clientSecret: "amzn-secret",
		packageNames: ["com.example.app"],
	};

	it("requests the App Submission scope and caches the token", async () => {
		stubFetch([
			{
				json: { access_token: "Atc|tok", expires_in: 3600 },
				match: "/auth/o2/token",
			},
			{ json: { id: "edit-1" }, match: "/edits" },
		]);

		await new AmazonAppstoreProvider(credentials).fetchListings(
			"com.example.app",
		);

		const tokenCall = calls.find((call) => call.url.includes("/auth/o2/token"));
		expect(tokenCall?.body).toContain("scope=appstore%3A%3Aapps%3Areadwrite");
		expect(tokenCall?.body).toContain("grant_type=client_credentials");
	});

	it("echoes the ETag back as If-Match when updating a listing", async () => {
		stubFetch([
			{
				json: { access_token: "Atc|tok", expires_in: 3600 },
				match: "/auth/o2/token",
			},
			{ json: { id: "edit-1" }, match: "/edits/edit-1/listings/en-US" },
			{ json: { id: "edit-1" }, match: "/edits" },
		]);

		// The listing GET carries the ETag the PUT must send back.
		globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
			const url = String(input);
			const headers: Record<string, string> = {};
			new Headers(init?.headers).forEach((value, key) => {
				headers[key] = value;
			});
			calls.push({
				body: typeof init?.body === "string" ? init.body : undefined,
				headers,
				method: init?.method ?? "GET",
				url,
			});

			if (url.includes("/auth/o2/token")) {
				return Response.json({ access_token: "Atc|tok", expires_in: 3600 });
			}
			if (url.includes("/listings/en-US")) {
				return new Response(
					JSON.stringify({ language: "en-US", title: "Old" }),
					{
						headers: { ETag: "etag-42" },
						status: 200,
					},
				);
			}
			return Response.json({ id: "edit-1" });
		}) as typeof globalThis.fetch;

		await new AmazonAppstoreProvider(credentials).updateListing(
			"com.example.app",
			"en-US",
			{ keywords: "aso, tools", title: "New" },
		);

		const put = calls.find((call) => call.method === "PUT");
		expect(put?.headers["if-match"]).toBe("etag-42");
		const body = JSON.parse(put?.body ?? "{}");
		expect(body.title).toBe("New");
		expect(body.keywords).toEqual(["aso", "tools"]);
	});

	it("explains a 412 as the app being in review", async () => {
		globalThis.fetch = (async (input: unknown) => {
			const url = String(input);
			if (url.includes("/auth/o2/token")) {
				return Response.json({ access_token: "Atc|tok", expires_in: 3600 });
			}
			if (url.includes("/edits/edit-1/commit")) {
				return new Response("{}", { status: 412 });
			}
			return Response.json({ id: "edit-1" });
		}) as typeof globalThis.fetch;

		const thrown = await captureThrow(() =>
			new AmazonAppstoreProvider(credentials).publishListings(
				"com.example.app",
			),
		);
		expect(thrown.response?.data?.info).toContain("pending or in review");
	});
});

describe("RuStore provider", () => {
	const credentials = { keyId: "123", privateKey: RSA_PRIVATE_KEY };

	it("signs keyId+timestamp and lists apps with the Public-Token header", async () => {
		stubFetch([
			{
				json: { body: { jwe: "jwe-1", ttl: 900 }, code: "OK" },
				match: "/public/auth",
			},
			{
				json: {
					body: {
						content: [
							{ appId: 55, appName: "Demo", packageName: "com.example.app" },
						],
					},
					code: "OK",
				},
				match: "/public/v1/application",
			},
		]);

		const apps = await new RuStoreProvider(credentials).fetchApps();

		expect(apps).toEqual([
			{
				bundleId: "com.example.app",
				externalId: "55",
				name: "Demo",
				platform: "android",
			},
		]);

		const auth = JSON.parse(
			calls.find((call) => call.url.includes("/public/auth"))?.body ?? "{}",
		);
		expect(auth.keyId).toBe("123");
		expect(auth.timestamp).toMatch(/\+00:00$/);
		expect(auth.signature.length).toBeGreaterThan(0);

		const list = calls.find((call) => call.url.includes("/v1/application"));
		expect(list?.headers["public-token"]).toBe("jwe-1");
	});

	it("reports the RuStore error code when authorization fails", async () => {
		stubFetch([
			{
				json: { code: "404", message: "Company key not found" },
				match: "/public/auth",
			},
		]);

		const result = await new RuStoreProvider(credentials).validateCredentials();
		expect(result.valid).toBe(false);
		expect(result.reason).toContain("Company key not found");
	});

	it("raises a typed error for listing edits, which stay in RuStore Console", async () => {
		const thrown = await captureThrow(() =>
			new RuStoreProvider(credentials).fetchListings("55"),
		);
		expect(thrown.code).toBe(400);
		expect(thrown.response?.data?.info).toContain("RuStore");
	});
});

describe("ONE Store and Xiaomi providers", () => {
	it("validates ONE Store credentials through the documented OAuth handshake", async () => {
		stubFetch([
			{ json: { access_token: "one-tok" }, match: "/v7/oauth/token" },
		]);

		const result = await new OneStoreProvider({
			clientId: "c",
			clientSecret: "s",
		}).validateCredentials();

		expect(result.valid).toBe(true);
		const call = calls[0];
		expect(call.headers["x-market-code"]).toBe("MKT_ONE");
	});

	it("rejects a Xiaomi key that does not parse", async () => {
		const result = await new XiaomiGetAppsProvider({
			email: "dev@example.com",
			privateKey: "not-a-key",
		}).validateCredentials();

		expect(result.valid).toBe(false);
		expect(result.reason).toContain("private key");
	});

	it("accepts a well-formed Xiaomi key but exposes no listing API", async () => {
		const provider = new XiaomiGetAppsProvider({
			email: "dev@example.com",
			privateKey: RSA_PRIVATE_KEY,
		});

		expect((await provider.validateCredentials()).valid).toBe(true);
		expect(await provider.fetchApps()).toEqual([]);

		const thrown = await captureThrow(() => provider.fetchListings("x"));
		expect(thrown.code).toBe(400);
	});
});

describe("alternative store credential contract", () => {
	it("accepts the documented field names per store", () => {
		expect(() =>
			validateAlternativeCredentials("huawei_appgallery", {
				clientId: "a",
				clientSecret: "b",
			}),
		).not.toThrow();
		expect(() =>
			validateAlternativeCredentials("samsung_galaxy", {
				privateKey: RSA_PRIVATE_KEY,
				serviceAccountId: "sa",
			}),
		).not.toThrow();
		expect(() =>
			validateAlternativeCredentials("xiaomi_getapps", {
				email: "dev@example.com",
				privateKey: RSA_PRIVATE_KEY,
			}),
		).not.toThrow();
	});

	it("rejects a missing or malformed field with a 422 naming it", async () => {
		const missing = await captureThrow(async () =>
			validateAlternativeCredentials("huawei_appgallery", { clientId: "a" }),
		);
		expect(missing.code).toBe(422);
		expect(missing.response?.data?.info).toContain("clientSecret");

		const badKey = await captureThrow(async () =>
			validateAlternativeCredentials("rustore", {
				keyId: "1",
				privateKey: "nope",
			}),
		);
		expect(badKey.code).toBe(422);
	});

	it("ignores primary stores, which validate through their own providers", () => {
		expect(() =>
			validateAlternativeCredentials("google_play", {}),
		).not.toThrow();
	});
});
