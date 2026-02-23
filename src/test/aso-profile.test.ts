import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { asoProfileController } from "@/modules/aso-profile";
import { storesController } from "@/modules/stores";
import { db } from "@/utils/db";
import { appAsoProfiles } from "@/utils/db/schema";
import { cleanupStores } from "./setup";

describe("ASO Profile module", () => {
	const app = new Elysia().group("/api", (app) =>
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
				new Request("http://localhost/api/stores/connect", {
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
			.handle(new Request("http://localhost/api/apps"))
			.then((res) => res.json());

		appId = appsRes.apps[0].id;
	});

	it("GET /api/apps/:appId/aso-profile returns null when no profile exists", async () => {
		const response = await app
			.handle(new Request(`http://localhost/api/apps/${appId}/aso-profile`))
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
			new Request(`http://localhost/api/apps/${appId}/aso-profile`, {
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
			.handle(new Request(`http://localhost/api/apps/${appId}/aso-profile`))
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
				new Request(`http://localhost/api/apps/${appId}/aso-profile`, {
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
			.handle(new Request(`http://localhost/api/apps/${appId}/aso-profile`))
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
				new Request(`http://localhost/api/apps/${appId}/aso-profile`, {
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
			.handle(new Request("http://localhost/api/apps"))
			.then((res) => res.json());

		const otherAppId = appsRes.apps[1].id;

		const res = await app.handle(
			new Request(`http://localhost/api/apps/${otherAppId}/aso-profile`, {
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
			new Request("http://localhost/api/apps/not-a-uuid/aso-profile", {
				body: JSON.stringify({ category: "Test" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		expect(res.status).toBe(422);
	});

	it("GET with invalid appId returns 422", async () => {
		const res = await app.handle(
			new Request("http://localhost/api/apps/not-a-uuid/aso-profile"),
		);

		expect(res.status).toBe(422);
	});
});
