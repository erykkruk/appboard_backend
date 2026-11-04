import type {
	DailySummary,
	DailySummaryApp,
} from "@/modules/daily-summary/daily-summary.types";

const NOW = new Date("2026-11-04T06:30:00Z"); // 07:30 in Warsaw (CET)
const CHECKED = new Date("2026-11-03T23:41:00Z");

const ios: DailySummaryApp = {
	appId: "6d02da86-0000-4000-8000-000000000001",
	dashboardUrl:
		"https://app.appboard.dev/apps/6d02da86-0000-4000-8000-000000000001/dashboard",
	declined: 9,
	devices: ["phone"],
	dropped: 2,
	drops: [
		{
			country: "de",
			delta: -11,
			keyword: "quiz spiel",
			position: 31,
			previousPosition: 20,
		},
		{
			country: "pl",
			delta: -3,
			keyword: "kalambury",
			position: 14,
			previousPosition: 11,
		},
	],
	entered: 3,
	gains: [
		{
			country: "pl",
			delta: 8,
			keyword: "gry na impreze",
			position: 6,
			previousPosition: 14,
		},
		{
			country: "us",
			delta: 4,
			keyword: "party trivia",
			position: 18,
			previousPosition: 22,
		},
	],
	improved: 14,
	lastCheckedAt: CHECKED,
	name: "Buzzin - TV Show",
	platform: "ios",
	ranked: 96,
	rankTrackingSupported: true,
	research: {
		at: new Date("2026-11-04T05:12:00Z"),
		country: "pl",
		ideaMarkets: 9,
		ideasScored: 23,
		negativeShare: 0.08,
		rating: 4.62,
		reviewsCount: 120,
		summary:
			"Players love the quiz rounds \u2014 the main complaint is \u201Cpairing\u201D the phone with the TV\u2026",
		topIdeas: [
			{ country: "pl", keyword: "quiz na impreze", opportunity: 71.6 },
			{ country: "de", keyword: "partyspiel tv", opportunity: 64 },
		],
	},
	starred: {
		moved: [
			{
				country: "pl",
				delta: 2,
				keyword: "quiz",
				position: 4,
				previousPosition: 6,
			},
		],
		top10: 3,
		total: 5,
	},
	strongestMarkets: [
		{ country: "pl", medianPosition: 9, ranked: 38, top10: 12 },
		{ country: "cz", medianPosition: 12.5, ranked: 20, top10: 5 },
		{ country: "us", medianPosition: 27, ranked: 15, top10: 1 },
	],
	top10: 21,
	tracked: 320,
};

const androidTv: DailySummaryApp = {
	appId: "3aae8de7-0000-4000-8000-000000000003",
	dashboardUrl:
		"https://app.appboard.dev/apps/3aae8de7-0000-4000-8000-000000000003/dashboard",
	declined: 1,
	devices: ["tv"],
	dropped: 0,
	drops: [],
	entered: 0,
	gains: [],
	improved: 2,
	lastCheckedAt: CHECKED,
	name: "Buzzin <TV>",
	platform: "android",
	ranked: 4,
	rankTrackingSupported: true,
	research: null,
	starred: null,
	strongestMarkets: [{ country: "pl", medianPosition: 7, ranked: 4, top10: 2 }],
	top10: 2,
	tracked: 40,
};

export const SUMMARY_FIXTURE: DailySummary = {
	apps: [ios, androidTv],
	generatedAt: NOW,
	timezone: "Europe/Warsaw",
	totals: {
		apps: 2,
		declined: 10,
		improved: 16,
		ranked: 100,
		top10: 23,
		tracked: 360,
	},
};
