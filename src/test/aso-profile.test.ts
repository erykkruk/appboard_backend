import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { asoProfileController } from "@/modules/aso-profile";
import { appsController } from "@/modules/apps";
import { storesController } from "@/modules/stores";
import { db } from "@/utils/db";
import { appAsoProfiles } from "@/utils/db/schema";
import { cleanupStores } from "./setup";

describe("ASO Profile module", () => {
	const app = new Elysia().group("/api", (app) =>
		app
			.use(storesController)
			.use(appsController)
			.use(asoProfileController),
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
			.handle(
				new Request(`http://localhost/api/apps/${appId}/aso-profile`),
			)
			.then((res) => res.json());

		expect(response.asoProfile).toBeNull();
	});

	it("PUT /api/apps/:appId/aso-profile creates a new profile", async () => {
		const body = {
			category: "Productivity",
			oneLiner: "The best task manager",
			problem: "People forget important tasks",
			mainBenefit: "Never miss a deadline again",
			keyFeatures: ["Reminders", "Calendar sync", "Team sharing"],
			differentiator: "AI-powered prioritization",
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
			.handle(
				new Request(`http://localhost/api/apps/${appId}/aso-profile`),
			)
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
			oneLiner: "Updated tagline",
			problem: "People forget important tasks",
			mainBenefit: "Never miss a deadline again",
			keyFeatures: ["Reminders", "Calendar sync"],
			differentiator: "AI-powered prioritization",
			tone: "Professional",
			competitors: ["Todoist", "Asana"],
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
			.handle(
				new Request(`http://localhost/api/apps/${appId}/aso-profile`),
			)
			.then((res) => res.json());

		expect(response.asoProfile.category).toBe("Business");
		expect(response.asoProfile.oneLiner).toBe("Updated tagline");
		expect(response.asoProfile.tone).toBe("Professional");
	});

	it("PUT with all optional sections saves correctly", async () => {
		const body = {
			category: "Health & Fitness",
			oneLiner: "Your personal trainer",
			problem: "Hard to stay consistent",
			mainBenefit: "Build lasting habits",
			keyFeatures: ["Tracking", "Coaching"],
			differentiator: "Adaptive plans",
			// Audience
			targetAudience: "Fitness beginners aged 25-40",
			painPoints: ["No time", "Lack of motivation"],
			userLanguage: "Casual and encouraging",
			// Competitors
			competitors: ["Nike Training Club", "Peloton"],
			competitiveAdvantage: "More affordable",
			positioning: "Budget-friendly",
			// Tone
			tone: "Motivational",
			brandVoiceExample: "You got this! Let's crush today's workout.",
			wordsToInclude: ["results", "progress"],
			wordsToAvoid: ["pain", "suffer"],
			// Social Proof
			downloadCount: "500K+",
			awards: ["Best Fitness App 2025"],
			pressQuotes: ["'Amazing app' - TechCrunch"],
			testimonials: ["Changed my life!"],
			// Product
			pricingModel: "Freemium",
			price: "$9.99/month",
			freeFeatures: ["Basic tracking", "Community"],
			premiumFeatures: ["Personal coaching", "Custom plans"],
			// Keywords
			mustIncludeKeywords: ["fitness", "workout"],
			longTailKeywords: ["home workout for beginners"],
			excludeKeywords: ["bodybuilding"],
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
			new Request(
				`http://localhost/api/apps/${otherAppId}/aso-profile`,
				{
					body: JSON.stringify({}),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				},
			),
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
