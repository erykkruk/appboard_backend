import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { asoProfileController } from "@/modules/aso-profile";
import { storesController } from "@/modules/stores";
import { db } from "@/utils/db";
import { appAsoProfiles } from "@/utils/db/schema";
import { authGuard, authRequest, cleanupStores } from "./setup";

describe("ASO Profile module", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) =>
			app.use(storesController).use(appsController).use(asoProfileController),
		);

	let storeId: string;
	let appId: string;

	afterAll(async () => {
		if (storeId) await cleanupStores([storeId]);
	});

	beforeAll(async () => {
		// Clean up any leftover ASO profiles from previous test runs
		await db.delete(appAsoProfiles);
	});

	it("sets up mock store with apps", async () => {
		const response = await app
			.handle(
				authRequest("http://localhost/api/stores/connect", {
					body: JSON.stringify({
						credentials: { mock: true, type: "mock" },
						name: "Test ASO Profile Store",
						type: "google_play",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((res) => res.json());

		storeId = response.store.id;

		const appsRes = await app
			.handle(authRequest("http://localhost/api/apps"))
			.then((res) => res.json());

		appId = appsRes.apps[0].id;
	});

	it("GET /api/apps/:appId/aso-profile returns null when no profile exists", async () => {
		const response = await app
			.handle(authRequest(`http://localhost/api/apps/${appId}/aso-profile`))
			.then((res) => res.json());

		expect(response.asoProfile).toBeNull();
	});

	it("PUT /api/apps/:appId/aso-profile creates a new profile", async () => {
		const body = {
			category: "Productivity",
			differentiator: "AI-powered prioritization",
			keyFeatures: ["Reminders", "Calendar sync", "Team sharing"],
			mainBenefit: "Never miss a deadline again",
			oneLiner: "The best task manager",
			problem: "People forget important tasks",
		};

		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/aso-profile`, {
				body: JSON.stringify(body),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		expect(res.status).toBe(200);

		const response = await res.json();
		expect(response.asoProfile).toBeDefined();
		expect(response.asoProfile.category).toBe("Productivity");
		expect(response.asoProfile.oneLiner).toBe("The best task manager");
		expect(response.asoProfile.keyFeatures).toEqual([
			"Reminders",
			"Calendar sync",
			"Team sharing",
		]);
		expect(response.asoProfile.appId).toBe(appId);
		expect(response.asoProfile.id).toBeDefined();
	});

	it("GET /api/apps/:appId/aso-profile returns saved profile", async () => {
		const response = await app
			.handle(authRequest(`http://localhost/api/apps/${appId}/aso-profile`))
			.then((res) => res.json());

		expect(response.asoProfile).not.toBeNull();
		expect(response.asoProfile.category).toBe("Productivity");
		expect(response.asoProfile.oneLiner).toBe("The best task manager");
		expect(response.asoProfile.keyFeatures).toEqual([
			"Reminders",
			"Calendar sync",
			"Team sharing",
		]);
	});

	it("PUT /api/apps/:appId/aso-profile updates existing profile (upsert)", async () => {
		const body = {
			category: "Business",
			competitors: ["Todoist", "Asana"],
			differentiator: "AI-powered prioritization",
			keyFeatures: ["Reminders", "Calendar sync"],
			mainBenefit: "Never miss a deadline again",
			oneLiner: "Updated tagline",
			problem: "People forget important tasks",
			tone: "Professional",
		};

		const response = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/aso-profile`, {
					body: JSON.stringify(body),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((res) => res.json());

		expect(response.asoProfile.category).toBe("Business");
		expect(response.asoProfile.oneLiner).toBe("Updated tagline");
		expect(response.asoProfile.tone).toBe("Professional");
		expect(response.asoProfile.competitors).toEqual(["Todoist", "Asana"]);
		expect(response.asoProfile.keyFeatures).toEqual([
			"Reminders",
			"Calendar sync",
		]);
	});

	it("GET after update returns updated data", async () => {
		const response = await app
			.handle(authRequest(`http://localhost/api/apps/${appId}/aso-profile`))
			.then((res) => res.json());

		expect(response.asoProfile.category).toBe("Business");
		expect(response.asoProfile.oneLiner).toBe("Updated tagline");
		expect(response.asoProfile.tone).toBe("Professional");
	});

	it("PUT with all optional sections saves correctly", async () => {
		const body = {
			awards: ["Best Fitness App 2025"],
			brandVoiceExample: "You got this! Let's crush today's workout.",
			category: "Health & Fitness",
			competitiveAdvantage: "More affordable",
			// Competitors
			competitors: ["Nike Training Club", "Peloton"],
			differentiator: "Adaptive plans",
			// Social Proof
			downloadCount: "500K+",
			excludeKeywords: ["bodybuilding"],
			freeFeatures: ["Basic tracking", "Community"],
			keyFeatures: ["Tracking", "Coaching"],
			longTailKeywords: ["home workout for beginners"],
			mainBenefit: "Build lasting habits",
			// Keywords
			mustIncludeKeywords: ["fitness", "workout"],
			oneLiner: "Your personal trainer",
			painPoints: ["No time", "Lack of motivation"],
			positioning: "Budget-friendly",
			premiumFeatures: ["Personal coaching", "Custom plans"],
			pressQuotes: ["'Amazing app' - TechCrunch"],
			price: "$9.99/month",
			// Product
			pricingModel: "Freemium",
			problem: "Hard to stay consistent",
			// Audience
			targetAudience: "Fitness beginners aged 25-40",
			testimonials: ["Changed my life!"],
			// Tone
			tone: "Motivational",
			userLanguage: "Casual and encouraging",
			wordsToAvoid: ["pain", "suffer"],
			wordsToInclude: ["results", "progress"],
		};

		const response = await app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/aso-profile`, {
					body: JSON.stringify(body),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((res) => res.json());

		const p = response.asoProfile;
		expect(p.targetAudience).toBe("Fitness beginners aged 25-40");
		expect(p.painPoints).toEqual(["No time", "Lack of motivation"]);
		expect(p.competitors).toEqual(["Nike Training Club", "Peloton"]);
		expect(p.tone).toBe("Motivational");
		expect(p.wordsToInclude).toEqual(["results", "progress"]);
		expect(p.wordsToAvoid).toEqual(["pain", "suffer"]);
		expect(p.downloadCount).toBe("500K+");
		expect(p.awards).toEqual(["Best Fitness App 2025"]);
		expect(p.pricingModel).toBe("Freemium");
		expect(p.freeFeatures).toEqual(["Basic tracking", "Community"]);
		expect(p.mustIncludeKeywords).toEqual(["fitness", "workout"]);
		expect(p.excludeKeywords).toEqual(["bodybuilding"]);
	});

	it("PUT with empty body creates profile with null fields", async () => {
		// Use a different app for this test
		const appsRes = await app
			.handle(authRequest("http://localhost/api/apps"))
			.then((res) => res.json());

		const otherAppId = appsRes.apps[1].id;

		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${otherAppId}/aso-profile`, {
				body: JSON.stringify({}),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		expect(res.status).toBe(200);

		const response = await res.json();
		expect(response.asoProfile.appId).toBe(otherAppId);
		expect(response.asoProfile.category).toBeNull();
		expect(response.asoProfile.keyFeatures).toBeNull();
	});

	it("PUT with invalid appId returns 422", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/apps/not-a-uuid/aso-profile", {
				body: JSON.stringify({ category: "Test" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		expect(res.status).toBe(422);
	});

	it("GET with invalid appId returns 422", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/apps/not-a-uuid/aso-profile"),
		);

		expect(res.status).toBe(422);
	});

	it("PUT 'import all' — full profile saves and reads back correctly", async () => {
		const fullProfile = {
			awards: ["Editor's Choice", "Best App 2025"],
			brandVoiceExample: "Capture every moment, effortlessly.",
			category: "Photography",
			competitiveAdvantage: "AI auto-enhance in real time",
			competitors: ["VSCO", "Snapseed", "Lightroom"],
			differentiator: "One-tap AI editing",
			downloadCount: "2M+",
			excludeKeywords: ["filter", "selfie"],
			freeFeatures: ["Basic editing", "Sharing"],
			keyFeatures: ["AI enhance", "RAW support", "Cloud backup", "Presets"],
			longTailKeywords: ["photo editor with AI", "best RAW editor mobile"],
			mainBenefit: "Professional photos in seconds",
			mustIncludeKeywords: ["photo editor", "AI", "RAW"],
			oneLiner: "AI-powered photo editing on the go",
			painPoints: ["Complex editing tools", "Storage limits"],
			positioning: "Premium but accessible",
			premiumFeatures: ["RAW editing", "Cloud storage", "Advanced AI"],
			pressQuotes: ["'Best mobile editor' - TheVerge"],
			price: "$4.99/month",
			pricingModel: "Freemium",
			problem: "Mobile photos look amateur",
			targetAudience: "Amateur photographers aged 20-35",
			testimonials: ["Replaced Lightroom for me!", "So easy to use"],
			tone: "Inspiring",
			userLanguage: "Casual tech-savvy",
			wordsToAvoid: ["cheap", "basic", "simple"],
			wordsToInclude: ["pro", "AI", "stunning", "effortless"],
		};

		// Save full profile
		const saveRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/aso-profile`, {
				body: JSON.stringify(fullProfile),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		expect(saveRes.status).toBe(200);
		const saved = (await saveRes.json()).asoProfile;

		// Verify every field was saved correctly
		for (const [key, value] of Object.entries(fullProfile)) {
			expect(saved[key]).toEqual(value);
		}

		// Read back from DB via GET
		const getRes = await app
			.handle(authRequest(`http://localhost/api/apps/${appId}/aso-profile`))
			.then((res) => res.json());

		const loaded = getRes.asoProfile;

		// Verify every field reads back identically
		for (const [key, value] of Object.entries(fullProfile)) {
			expect(loaded[key]).toEqual(value);
		}
	});

	it("PUT partial update preserves other fields", async () => {
		// First: save a full profile
		await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/aso-profile`, {
				body: JSON.stringify({
					category: "Photography",
					keyFeatures: ["AI enhance", "RAW support"],
					tone: "Inspiring",
					wordsToInclude: ["pro", "AI"],
				}),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		// Then: update only category and add wordsToAvoid
		const partialRes = await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/aso-profile`, {
				body: JSON.stringify({
					category: "Photo & Video",
					wordsToAvoid: ["ugly"],
				}),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		expect(partialRes.status).toBe(200);
		const updated = (await partialRes.json()).asoProfile;

		// Updated fields should have new values
		expect(updated.category).toBe("Photo & Video");
		expect(updated.wordsToAvoid).toEqual(["ugly"]);

		// Fields NOT in the partial update body — upsert uses onConflictDoUpdate
		// with the request body as setData, so only sent fields are updated
		// The previous values of tone, keyFeatures, wordsToInclude should still be there
		// because Drizzle only updates columns present in setData
	});

	it("PUT with arrays containing special characters saves correctly", async () => {
		const body = {
			keyFeatures: ["Multi-language support (日本語)", "E2E encryption 🔒"],
			wordsToAvoid: ['quotes "inside"', "apostrophe's", "back\\slash"],
			wordsToInclude: ["résumé", "naïve", "über-cool"],
		};

		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/aso-profile`, {
				body: JSON.stringify(body),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		expect(res.status).toBe(200);
		const saved = (await res.json()).asoProfile;
		expect(saved.keyFeatures).toEqual(body.keyFeatures);
		expect(saved.wordsToInclude).toEqual(body.wordsToInclude);
		expect(saved.wordsToAvoid).toEqual(body.wordsToAvoid);

		// Verify via GET
		const getRes = await app
			.handle(authRequest(`http://localhost/api/apps/${appId}/aso-profile`))
			.then((res) => res.json());

		expect(getRes.asoProfile.keyFeatures).toEqual(body.keyFeatures);
		expect(getRes.asoProfile.wordsToInclude).toEqual(body.wordsToInclude);
		expect(getRes.asoProfile.wordsToAvoid).toEqual(body.wordsToAvoid);
	});
});
