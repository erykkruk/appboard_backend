import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import {
	privacyDeclarationController,
	privacyTemplatesController,
} from "@/modules/privacy-declaration";
import { storesController } from "@/modules/stores";
import { db } from "@/utils/db";
import { appPrivacyDeclarations } from "@/utils/db/schema";
import { cleanupStores } from "./setup";

describe("Privacy Declaration module", () => {
	const app = new Elysia().group("/api", (app) =>
		app
			.use(storesController)
			.use(appsController)
			.use(privacyTemplatesController)
			.use(privacyDeclarationController),
	);

	let storeId: string;
	let appId: string;

	afterAll(async () => {
		if (storeId) await cleanupStores([storeId]);
	});

	beforeAll(async () => {
		await db.delete(appPrivacyDeclarations);
	});

	it("sets up mock store with apps", async () => {
		const response = await app
			.handle(
				new Request("http://localhost/api/stores/connect", {
					body: JSON.stringify({
						credentials: { mock: true, type: "mock" },
						name: "Test Privacy Store",
						type: "google_play",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((res) => res.json());

		storeId = response.store.id;

		const appsRes = await app
			.handle(new Request("http://localhost/api/apps"))
			.then((res) => res.json());

		appId = appsRes.apps[0].id;
	});

	// --- Templates ---

	it("GET /api/privacy-templates returns all templates", async () => {
		const response = await app
			.handle(new Request("http://localhost/api/privacy-templates"))
			.then((res) => res.json());

		expect(response.templates).toBeDefined();
		expect(Array.isArray(response.templates)).toBe(true);
		expect(response.templates.length).toBeGreaterThanOrEqual(5);

		const minimal = response.templates.find(
			(t: { id: string }) => t.id === "minimal",
		);
		expect(minimal).toBeDefined();
		expect(minimal.name).toBe("Minimal (No Data Collection)");
		expect(minimal.dataCollections).toEqual([]);

		const custom = response.templates.find(
			(t: { id: string }) => t.id === "custom",
		);
		expect(custom).toBeDefined();
		expect(custom.dataCollections).toEqual([]);

		const basic = response.templates.find(
			(t: { id: string }) => t.id === "basic_app",
		);
		expect(basic).toBeDefined();
		expect(basic.dataCollections.length).toBeGreaterThan(0);
	});

	// --- GET empty ---

	it("GET /api/apps/:appId/privacy-declaration returns null when none exists", async () => {
		const response = await app
			.handle(
				new Request(`http://localhost/api/apps/${appId}/privacy-declaration`),
			)
			.then((res) => res.json());

		expect(response.privacyDeclaration).toBeNull();
	});

	// --- PUT create with template ---

	it("PUT /api/apps/:appId/privacy-declaration creates with basic_app template", async () => {
		const res = await app.handle(
			new Request(`http://localhost/api/apps/${appId}/privacy-declaration`, {
				body: JSON.stringify({ templateId: "basic_app" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		expect(res.status).toBe(200);

		const response = await res.json();
		const decl = response.privacyDeclaration;
		expect(decl).toBeDefined();
		expect(decl.appId).toBe(appId);
		expect(decl.templateId).toBe("basic_app");
		expect(decl.dataCollections.length).toBeGreaterThan(0);

		// Should have email, user ID, product interaction, crash data
		const categories = decl.dataCollections.map(
			(dc: { dataType: string }) => dc.dataType,
		);
		expect(categories).toContain("Email Address");
		expect(categories).toContain("User ID");
		expect(categories).toContain("Crash Data");
	});

	// --- GET after create ---

	it("GET /api/apps/:appId/privacy-declaration returns saved declaration", async () => {
		const response = await app
			.handle(
				new Request(`http://localhost/api/apps/${appId}/privacy-declaration`),
			)
			.then((res) => res.json());

		expect(response.privacyDeclaration).not.toBeNull();
		expect(response.privacyDeclaration.templateId).toBe("basic_app");
		expect(response.privacyDeclaration.dataCollections.length).toBeGreaterThan(
			0,
		);
	});

	// --- PUT update (upsert) with different template ---

	it("PUT /api/apps/:appId/privacy-declaration updates to ecommerce template", async () => {
		const response = await app
			.handle(
				new Request(`http://localhost/api/apps/${appId}/privacy-declaration`, {
					body: JSON.stringify({ templateId: "ecommerce" }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((res) => res.json());

		const decl = response.privacyDeclaration;
		expect(decl.templateId).toBe("ecommerce");

		const dataTypes = decl.dataCollections.map(
			(dc: { dataType: string }) => dc.dataType,
		);
		expect(dataTypes).toContain("Payment Info");
		expect(dataTypes).toContain("Purchase History");
	});

	// --- PUT with custom template + custom data ---

	it("PUT with custom template stores custom dataCollections", async () => {
		const customData = [
			{
				category: "contact_info",
				dataType: "Email Address",
				linked: true,
				purposes: ["app_functionality"],
				tracking: false,
			},
			{
				category: "diagnostics",
				dataType: "Performance Data",
				linked: false,
				purposes: ["analytics"],
				tracking: false,
			},
		];

		const response = await app
			.handle(
				new Request(`http://localhost/api/apps/${appId}/privacy-declaration`, {
					body: JSON.stringify({
						dataCollections: customData,
						templateId: "custom",
					}),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((res) => res.json());

		const decl = response.privacyDeclaration;
		expect(decl.templateId).toBe("custom");
		expect(decl.dataCollections).toHaveLength(2);
		expect(decl.dataCollections[0].dataType).toBe("Email Address");
		expect(decl.dataCollections[1].dataType).toBe("Performance Data");
	});

	// --- PUT with tracking data ---

	it("PUT with tracking data auto-detects trackingEnabled", async () => {
		const dataWithTracking = [
			{
				category: "identifiers",
				dataType: "Device ID",
				linked: false,
				purposes: ["third_party_advertising"],
				tracking: true,
			},
		];

		const response = await app
			.handle(
				new Request(`http://localhost/api/apps/${appId}/privacy-declaration`, {
					body: JSON.stringify({
						dataCollections: dataWithTracking,
						templateId: "custom",
					}),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((res) => res.json());

		const decl = response.privacyDeclaration;
		expect(decl.trackingEnabled).toBe(true);
	});

	// --- PUT with privacyPolicyUrl and trackingDomains ---

	it("PUT saves privacyPolicyUrl and trackingDomains", async () => {
		const response = await app
			.handle(
				new Request(`http://localhost/api/apps/${appId}/privacy-declaration`, {
					body: JSON.stringify({
						privacyPolicyUrl: "https://example.com/privacy",
						templateId: "minimal",
						trackingDomains: ["analytics.example.com"],
						trackingEnabled: false,
					}),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((res) => res.json());

		const decl = response.privacyDeclaration;
		expect(decl.templateId).toBe("minimal");
		expect(decl.privacyPolicyUrl).toBe("https://example.com/privacy");
		expect(decl.trackingDomains).toEqual(["analytics.example.com"]);
		expect(decl.trackingEnabled).toBe(false);
		expect(decl.dataCollections).toEqual([]);
	});

	// --- Validation ---

	it("PUT with invalid appId returns 422", async () => {
		const res = await app.handle(
			new Request("http://localhost/api/apps/not-a-uuid/privacy-declaration", {
				body: JSON.stringify({ templateId: "minimal" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		expect(res.status).toBe(422);
	});

	it("GET with invalid appId returns 422", async () => {
		const res = await app.handle(
			new Request("http://localhost/api/apps/not-a-uuid/privacy-declaration"),
		);

		expect(res.status).toBe(422);
	});

	it("PUT without templateId returns 422", async () => {
		const res = await app.handle(
			new Request(`http://localhost/api/apps/${appId}/privacy-declaration`, {
				body: JSON.stringify({}),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		expect(res.status).toBe(422);
	});
});
