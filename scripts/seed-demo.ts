/**
 * Rich DEMO data seed.
 *
 * Creates a self-contained "AppBoard Demo" workspace with a loginable demo user
 * and fully populated demo apps so the whole panel can be explored with example
 * data: listing description history, ASO / "where we stand in stores" analysis,
 * screenshots, reviews, app versions and monetization.
 *
 * SAFETY: purely ADDITIVE and idempotent. It only ever creates rows inside the
 * dedicated demo workspace and NEVER touches, resets or deletes any existing
 * data in other workspaces. Each section (Google Play store, App Store store,
 * app group) has its own guard, so re-running fills in missing sections
 * without duplicating anything.
 *
 * Both demo stores carry MOCK credentials ({ mock: true }), which routes
 * provider calls to the built-in mock provider — sync, versions and the
 * screenshots endpoint (DB-assets fallback) all work without real store keys.
 * Google Play holds three apps (Lumina, Aura, Pulse) and the App Store holds
 * their iOS variants. The Android + iOS Lumina apps are joined into a "Lumina"
 * app group and the Aura pair into an "Aura" group, each with a shared ASO
 * profile to showcase group management. Pulse stays ungrouped on purpose so
 * the panel also shows ungrouped apps.
 *
 * Login (dev): http://localhost:6600/login → email demo@appboard.dev → code 123456
 * Run: bun run scripts/seed-demo.ts   (or: bun run db:seed:demo)
 */
import { and, eq, isNull } from "drizzle-orm";
import config from "@/config";
import { auth } from "@/config/auth";
import { DEMO_ACCOUNT } from "@/modules/demo/demo.const";
import { SettingsService } from "@/modules/settings/settings.service";
import { encrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import {
	appAgeRatings,
	appAsoProfiles,
	appGroupMembers,
	appGroups,
	appPrivacyDeclarations,
	apps,
	appVersions,
	assets,
	groupAsoProfiles,
	inAppPurchases,
	listingHistory,
	listings,
	purchaseLocalizations,
	purchasePrices,
	reviews,
	stores,
	subscriptionGroupLocalizations,
	subscriptionGroups,
	user,
	versionLocalizations,
	workspaceMembers,
	workspaces,
} from "@/utils/db/schema";
import { createLogger } from "@/utils/logger";

const log = createLogger("seed-demo");

export interface SeedDemoOptions {
	auraGroupName?: string;
	email?: string;
	groupName?: string;
	iosStoreName?: string;
	name?: string;
	password?: string;
	storeName?: string;
	workspaceName?: string;
}

export interface SeedDemoResult {
	auraGroupId: string | null;
	auraId: string | null;
	auraIosId: string | null;
	created: boolean;
	groupId: string | null;
	iosStoreId: string | null;
	luminaId: string | null;
	luminaIosId: string | null;
	pulseId: string | null;
	pulseIosId: string | null;
	storeId: string | null;
	userId: string;
	workspaceId: string;
}

export const DEMO = {
	...DEMO_ACCOUNT,
	auraGroupName: "Aura",
	groupName: "Lumina",
	iosStoreName: "AppBoard Demo — App Store",
	storeName: "AppBoard Demo — Google Play",
};

// Mock credentials route every provider call to the built-in mock provider,
// so demo stores support sync/versions/screenshots without real store keys.
const mockCredentials = () => encrypt(JSON.stringify({ mock: true }));

// ── URL helpers (external placeholder images render via plain <img>) ─────
const icon = (bg: string, text: string) =>
	`https://placehold.co/512x512/${bg}/ffffff/png?text=${encodeURIComponent(text)}`;
const shot = (bg: string, text: string) =>
	`https://placehold.co/1284x2778/${bg}/ffffff/png?text=${encodeURIComponent(text)}`;
const feature = (bg: string, text: string) =>
	`https://placehold.co/1024x500/${bg}/ffffff/png?text=${encodeURIComponent(text)}`;

const d = (iso: string) => new Date(iso);
const now = new Date();

// ── User + workspace ────────────────────────────────────────────────────
async function ensureDemoUser(cfg: {
	email: string;
	name: string;
	password: string;
	workspaceName: string;
}): Promise<{ userId: string; workspaceId: string }> {
	let [u] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, cfg.email))
		.limit(1);

	if (!u) {
		await auth.api.signUpEmail({
			body: { email: cfg.email, name: cfg.name, password: cfg.password },
		});
		[u] = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, cfg.email))
			.limit(1);
		log.info({ email: cfg.email }, "Created demo user (+ auto workspace)");
	} else {
		log.info({ email: cfg.email }, "Demo user already exists");
	}
	if (!u) throw new Error("Demo user not found after sign-up");

	const [member] = await db
		.select({ workspaceId: workspaceMembers.workspaceId })
		.from(workspaceMembers)
		.where(eq(workspaceMembers.userId, u.id))
		.limit(1);
	if (!member) throw new Error("No workspace membership for demo user");

	await db
		.update(workspaces)
		.set({ name: cfg.workspaceName })
		.where(eq(workspaces.id, member.workspaceId));

	return { userId: u.id, workspaceId: member.workspaceId };
}

// ── Screenshot rows ─────────────────────────────────────────────────────
function screenshotRows(
	appId: string,
	appName: string,
	lang: string,
	captions: string[],
	colors: string[],
) {
	return captions.map((caption, i) => ({
		appId,
		assetType: "screenshot",
		deviceType: "phone",
		externalId: `seed-${appId.slice(0, 8)}-${lang}-phone-${i}`,
		fileSize: 240_000 + i * 1200,
		height: 2778,
		isDirty: false,
		language: lang,
		sortOrder: i,
		source: "remote",
		syncedAt: now,
		url: shot(colors[i % colors.length], `${appName}\n${caption}`),
		width: 1284,
	}));
}

// ── Pulse (Google Play) app section ─────────────────────────────────────
// Third Android app — a fitness tracker that intentionally stays OUTSIDE any
// app group so the panel also demonstrates ungrouped apps. Own guard
// (storeId + bundleId), so re-running an older seed adds it without touching
// the existing Lumina/Aura rows.
async function ensurePulseGpApp(
	storeId: string,
): Promise<{ created: boolean; id: string }> {
	const [existing] = await db
		.select({ id: apps.id })
		.from(apps)
		.where(
			and(eq(apps.storeId, storeId), eq(apps.bundleId, "com.pulse.workout")),
		)
		.limit(1);
	if (existing) return { created: false, id: existing.id };

	const [pulse] = await db
		.insert(apps)
		.values({
			bundleId: "com.pulse.workout",
			externalId: "gp-com.pulse.workout",
			iconUrl: icon("ef4444", "Pulse"),
			lastSyncedAt: now,
			name: "Pulse – Workout Tracker",
			platform: "android",
			primaryCategory: "Health & Fitness",
			secondaryCategory: "Sports",
			status: "active",
			storeId,
		})
		.returning();

	const pulseListings = await db
		.insert(listings)
		.values([
			{
				appId: pulse.id,
				fullDesc:
					"Pulse is your gym companion — log sets and reps in seconds, follow ready-made plans and watch your strength grow.\n\n• Fast set & rep logging\n• 100+ exercises with animations\n• Ready-made training plans\n• Strength progress charts\n• Rest timer with alerts",
				isDirty: false,
				keywords: "workout,gym,fitness,training log,exercise,strength",
				language: "en-US",
				marketingUrl: "https://pulse.fit",
				privacyUrl: "https://pulse.fit/privacy",
				promoText: "New: training plans and rest timer.",
				shortDesc: "Log workouts, crush your goals",
				source: "remote",
				supportUrl: "https://pulse.fit/support",
				syncedAt: d("2026-06-23T07:30:00Z"),
				title: "Pulse – Workout Tracker",
				whatsNew: "Bug fixes and new exercises.",
			},
			{
				appId: pulse.id,
				fullDesc:
					"Pulse is your gym companion — log sets and reps in seconds, follow ready-made plans, track personal records and watch your strength grow week after week.\n\n• Fast set & rep logging\n• 100+ exercises with animations\n• Ready-made training plans\n• Personal record tracking\n• Strength progress charts\n• Rest timer with alerts",
				isDirty: true,
				keywords:
					"workout,gym log,fitness,training log,exercise,strength,personal records",
				language: "en-US",
				marketingUrl: "https://pulse.fit",
				privacyUrl: "https://pulse.fit/privacy",
				promoText: "New: training plans, rest timer & PR tracking.",
				shortDesc: "Your gym companion — log, plan, progress",
				source: "draft",
				supportUrl: "https://pulse.fit/support",
				title: "Pulse – Workout & Gym Log",
				whatsNew:
					"• Personal record tracking\n• New training plans\n• Rest timer alerts",
			},
			{
				appId: pulse.id,
				fullDesc:
					"Pulse to Twój partner na siłowni — zapisuj serie i powtórzenia w kilka sekund, korzystaj z gotowych planów i obserwuj wzrost siły.\n\n• Szybkie zapisywanie serii\n• Ponad 100 ćwiczeń z animacjami\n• Gotowe plany treningowe\n• Wykresy postępów siłowych\n• Minutnik odpoczynku",
				isDirty: false,
				keywords: "trening,siłownia,fitness,dziennik treningowy,ćwiczenia,siła",
				language: "pl-PL",
				promoText: "Nowość: plany treningowe i minutnik odpoczynku.",
				shortDesc: "Zapisuj treningi i bij rekordy",
				source: "remote",
				syncedAt: d("2026-06-23T07:30:00Z"),
				title: "Pulse – Dziennik treningowy",
				whatsNew: "Poprawki błędów i nowe ćwiczenia.",
			},
			{
				appId: pulse.id,
				fullDesc:
					"Pulse to Twój partner na siłowni — zapisuj serie i powtórzenia w kilka sekund, korzystaj z gotowych planów i obserwuj wzrost siły.\n\n• Szybkie zapisywanie serii\n• Ponad 100 ćwiczeń z animacjami\n• Gotowe plany treningowe\n• Wykresy postępów siłowych\n• Minutnik odpoczynku",
				isDirty: false,
				keywords: "trening,siłownia,fitness,dziennik treningowy,ćwiczenia,siła",
				language: "pl-PL",
				promoText: "Nowość: plany treningowe i minutnik odpoczynku.",
				shortDesc: "Zapisuj treningi i bij rekordy",
				source: "draft",
				title: "Pulse – Dziennik treningowy",
				whatsNew: "Poprawki błędów i nowe ćwiczenia.",
			},
		])
		.returning();

	const pulseEnDraft = pulseListings.find(
		(l) => l.language === "en-US" && l.source === "draft",
	);

	await db.insert(listingHistory).values([
		{
			appId: pulse.id,
			createdAt: d("2026-02-14T09:00:00Z"),
			field: "fullDesc",
			language: "en-US",
			listingId: pulseEnDraft?.id,
			newValue: "Log your workouts and track your progress at the gym.",
			oldValue: null,
			publishedAt: d("2026-02-14T09:00:00Z"),
		},
		{
			appId: pulse.id,
			createdAt: d("2026-04-22T13:45:00Z"),
			field: "shortDesc",
			language: "en-US",
			listingId: pulseEnDraft?.id,
			newValue: "Log workouts, crush your goals",
			oldValue: "Simple workout logging",
			publishedAt: d("2026-04-22T13:45:00Z"),
		},
		{
			appId: pulse.id,
			createdAt: d("2026-06-23T07:30:00Z"),
			field: "fullDesc",
			language: "en-US",
			listingId: pulseEnDraft?.id,
			newValue:
				"Pulse is your gym companion — log sets and reps in seconds, follow ready-made plans and watch your strength grow.",
			oldValue: "Log your workouts and track your progress at the gym.",
			publishedAt: d("2026-06-23T07:30:00Z"),
		},
	]);

	await db.insert(appAsoProfiles).values({
		appId: pulse.id,
		category: "Health & Fitness / Sports",
		competitiveAdvantage:
			"Fastest set logging on the market — one tap per set, no menus mid-workout.",
		competitors: ["Strong", "Hevy", "Jefit", "Gymshark Training"],
		differentiator:
			"Logging built for the gym floor: one-tap sets, plate calculator, rest timer.",
		downloadCount: "50,000+",
		freeFeatures: ["Workout logging", "30 exercises", "Rest timer"],
		keyFeatures: [
			"Fast set & rep logging",
			"100+ exercises with animations",
			"Ready-made training plans",
			"Personal record tracking",
			"Strength progress charts",
			"Rest timer with alerts",
		],
		longTailKeywords: [
			"gym workout log app",
			"strength training tracker",
			"workout planner with rest timer",
		],
		mainBenefit:
			"Spend your gym time lifting, not typing — log a set in one tap.",
		mustIncludeKeywords: ["workout tracker", "gym log", "training plan"],
		oneLiner: "The fastest way to log workouts and get stronger.",
		painPoints: [
			"Logging workouts interrupts training",
			"No idea if strength is improving",
			"Generic plans that ignore progress",
			"Forgets rest times between sets",
		],
		positioning: "The no-friction workout log for serious lifters.",
		premiumFeatures: [
			"Unlimited training plans",
			"Personal record insights",
			"Advanced progress charts",
			"Plate calculator",
			"Cloud backup",
		],
		price: "$7.99/mo or $49.99/yr",
		pricingModel: "Freemium with Premium subscription",
		problem:
			"Lifters lose momentum because tracking progress at the gym is slow and awkward.",
		targetAudience:
			"Gym-goers and strength athletes (20-40) who train 3+ times a week and want visible progress.",
		tone: "Energetic, direct, motivating",
		userLanguage: "Short, punchy, gym-native — sets, reps, PRs.",
		wordsToAvoid: ["diet", "weight loss", "shame"],
		wordsToInclude: ["strength", "progress", "PR", "training", "log"],
	});

	await db.insert(reviews).values([
		{
			appId: pulse.id,
			appVersion: "1.8.0",
			authorName: "ironmike",
			body: "Logging a set takes literally one tap. Been through Strong and Hevy — this is faster than both.",
			device: "Pixel 9",
			externalId: "gp-pulse-4001",
			language: "en-US",
			osVersion: "Android 15",
			rating: 5,
			reviewDate: d("2026-06-27T18:20:00Z"),
			storeType: "google_play",
			syncedAt: now,
			territory: "US",
			title: "Fastest gym logger",
		},
		{
			appId: pulse.id,
			appVersion: "1.8.0",
			authorName: "Bartek T.",
			body: "Świetny dziennik treningowy, ale brakuje ćwiczeń na maszynach. Poza tym super.",
			device: "Samsung Galaxy S24",
			externalId: "gp-pulse-4002",
			language: "pl-PL",
			osVersion: "Android 15",
			rating: 4,
			repliedAt: d("2026-06-22T09:10:00Z"),
			replyText:
				"Dzięki Bartek! Ćwiczenia na maszynach dodajemy w wersji 1.9 — jeszcze w tym miesiącu.",
			reviewDate: d("2026-06-21T16:45:00Z"),
			storeType: "google_play",
			syncedAt: now,
			territory: "PL",
			title: "Prawie komplet",
		},
		{
			appId: pulse.id,
			appVersion: "1.7.2",
			authorName: "cardio_carl",
			body: "The rest timer keeps resetting itself when the screen locks. Annoying mid-workout.",
			device: "OnePlus 12",
			externalId: "gp-pulse-4003",
			language: "en-US",
			osVersion: "Android 14",
			rating: 2,
			repliedAt: d("2026-06-13T08:30:00Z"),
			replyText:
				"Sorry about that Carl — the lock-screen timer bug is fixed in 1.8.0, please update.",
			reviewDate: d("2026-06-12T19:05:00Z"),
			storeType: "google_play",
			syncedAt: now,
			territory: "US",
			title: "Rest timer bug",
		},
		{
			appId: pulse.id,
			appVersion: "1.8.0",
			authorName: "Lena M.",
			body: "Endlich eine Trainings-App ohne Schnickschnack. Die Fortschritts-Charts motivieren total.",
			device: "Pixel 8a",
			externalId: "gp-pulse-4004",
			language: "de-DE",
			osVersion: "Android 15",
			rating: 5,
			reviewDate: d("2026-06-25T07:50:00Z"),
			storeType: "google_play",
			syncedAt: now,
			territory: "DE",
		},
		{
			appId: pulse.id,
			appVersion: "1.8.0",
			authorName: "gym_newbie",
			body: "Good app but the free tier only has 30 exercises. Premium feels a bit pricey for a log.",
			device: "Motorola Edge 50",
			externalId: "gp-pulse-4005",
			language: "en-GB",
			osVersion: "Android 14",
			rating: 3,
			reviewDate: d("2026-06-05T11:30:00Z"),
			storeType: "google_play",
			syncedAt: now,
			territory: "GB",
			title: "Decent but limited free tier",
		},
	]);

	const pulseColors = ["ef4444", "f97316", "f59e0b", "dc2626", "f43f5e"];
	await db.insert(assets).values([
		...screenshotRows(
			pulse.id,
			"Pulse",
			"en-US",
			[
				"Log Workouts Fast",
				"Track Your Progress",
				"Training Plans",
				"Rest Timer",
				"Personal Records",
			],
			pulseColors,
		),
		...screenshotRows(
			pulse.id,
			"Pulse",
			"pl-PL",
			[
				"Zapisuj Treningi",
				"Śledź Postępy",
				"Plany Treningowe",
				"Minutnik Odpoczynku",
				"Rekordy Życiowe",
			],
			pulseColors,
		),
		{
			appId: pulse.id,
			assetType: "icon",
			deviceType: "phone",
			externalId: "seed-pulse-icon",
			height: 512,
			language: "en-US",
			source: "remote",
			syncedAt: now,
			url: icon("ef4444", "Pulse"),
			width: 512,
		},
		{
			appId: pulse.id,
			assetType: "featureGraphic",
			deviceType: "phone",
			externalId: "seed-pulse-feature",
			height: 500,
			language: "en-US",
			source: "remote",
			syncedAt: now,
			url: feature("ef4444", "Pulse – Log workouts, crush your goals"),
			width: 1024,
		},
	]);

	const [pulseVersion] = await db
		.insert(appVersions)
		.values({
			appId: pulse.id,
			copyright: "© 2026 Pulse Fitness",
			externalId: "gp-ver-1.8.0",
			isEditable: true,
			state: "DRAFT",
			syncedAt: now,
			versionString: "1.8.0",
		})
		.returning();

	await db.insert(versionLocalizations).values([
		{
			appId: pulse.id,
			description:
				"Pulse is your gym companion — log sets and reps in seconds, follow ready-made plans and watch your strength grow.",
			isDirty: false,
			keywords: "workout,gym,fitness,training log,exercise,strength",
			language: "en-US",
			promotionalText: "New: training plans and rest timer.",
			source: "remote",
			subtitle: "Log workouts, crush your goals",
			syncedAt: now,
			title: "Pulse – Workout Tracker",
			versionId: pulseVersion.id,
			whatsNew: "Bug fixes and new exercises.",
		},
		{
			appId: pulse.id,
			description:
				"Pulse is your gym companion — log sets and reps in seconds, follow ready-made plans, track personal records and watch your strength grow.",
			isDirty: true,
			keywords: "workout,gym log,fitness,training log,personal records",
			language: "en-US",
			promotionalText: "New: training plans, rest timer & PR tracking.",
			source: "draft",
			subtitle: "Your gym companion — log, plan, progress",
			title: "Pulse – Workout & Gym Log",
			versionId: pulseVersion.id,
			whatsNew:
				"• Personal record tracking\n• New training plans\n• Rest timer alerts",
		},
	]);

	await db.insert(appAgeRatings).values({
		appId: pulse.id,
		googleQuestionnaire: {
			controlledSubstances: false,
			gambling: false,
			userGeneratedContent: false,
			violence: false,
		},
		googleRating: "Everyone",
		presetId: "everyone",
	});

	await db.insert(appPrivacyDeclarations).values({
		appId: pulse.id,
		dataCollections: [
			{
				category: "Health & Fitness",
				collected: true,
				dataType: "Fitness",
				linked: true,
				purposes: ["App Functionality"],
				required: false,
				tracking: false,
			},
			{
				category: "Usage Data",
				collected: true,
				dataType: "Product Interaction",
				linked: false,
				purposes: ["Analytics"],
				required: false,
				tracking: false,
			},
		],
		gpDeletionMechanism: true,
		gpEncryptedInTransit: true,
		privacyPolicyUrl: "https://pulse.fit/privacy",
		templateId: "gp_basic_app",
		trackingDomains: [],
		trackingEnabled: false,
	});

	// Monetization — subscription group + Premium subscription.
	const [pulseSubGroup] = await db
		.insert(subscriptionGroups)
		.values({
			appId: pulse.id,
			availableTerritories: ["US", "PL", "DE", "GB"],
			externalId: "gp-sub-pulse-premium",
			name: "Pulse Premium",
			syncedAt: now,
		})
		.returning();

	await db.insert(subscriptionGroupLocalizations).values({
		description: "Premium workout tracking features.",
		groupId: pulseSubGroup.id,
		language: "en-US",
		name: "Pulse Premium",
	});

	const [pulseIap] = await db
		.insert(inAppPurchases)
		.values({
			appId: pulse.id,
			availableTerritories: ["US", "PL", "DE", "GB"],
			duration: "P1M",
			externalId: "gp-iap-premium-monthly",
			familySharable: false,
			groupId: pulseSubGroup.id,
			name: "Pulse Premium (Monthly)",
			productId: "com.pulse.workout.premium.monthly",
			productType: "auto_renewable",
			status: "approved",
			syncedAt: now,
		})
		.returning();

	await db.insert(purchaseLocalizations).values({
		description:
			"Unlimited training plans, PR insights, advanced charts, plate calculator and cloud backup.",
		language: "en-US",
		name: "Pulse Premium",
		purchaseId: pulseIap.id,
		syncedAt: now,
	});

	await db.insert(purchasePrices).values([
		{
			currency: "USD",
			price: "7.99",
			purchaseId: pulseIap.id,
			syncedAt: now,
			territory: "US",
		},
		{
			currency: "EUR",
			price: "7.99",
			purchaseId: pulseIap.id,
			syncedAt: now,
			territory: "DE",
		},
	]);

	log.info({ appId: pulse.id }, "Seeded Pulse – Workout Tracker (full)");

	return { created: true, id: pulse.id };
}

// ── iOS demo section ────────────────────────────────────────────────────
// Seeds App Store variants of Lumina, Aura and Pulse under one shared
// mock-credential store. Each app has its own guard (storeId + bundleId), so
// re-running an older seed adds only the missing apps. Mock credentials keep
// every publishing flow working: versions fall back to the seeded DB rows and
// the screenshots endpoint serves DB assets.
const IOS_SHOT_W = 1290;
const IOS_SHOT_H = 2796;
const iosShot = (bg: string, text: string) =>
	`https://placehold.co/${IOS_SHOT_W}x${IOS_SHOT_H}/${bg}/ffffff/png?text=${encodeURIComponent(text)}`;

function iosScreenshotRows(
	appId: string,
	appName: string,
	lang: string,
	captions: string[],
	colors: string[],
) {
	return captions.map((caption, i) => ({
		appId,
		assetType: "screenshot",
		deviceType: "APP_IPHONE_67",
		externalId: `seed-${appId.slice(0, 8)}-${lang}-iphone67-${i}`,
		fileSize: 260_000 + i * 1300,
		height: IOS_SHOT_H,
		isDirty: false,
		language: lang,
		sortOrder: i,
		source: "remote",
		syncedAt: now,
		url: iosShot(colors[i % colors.length], `${appName}\n${caption}`),
		width: IOS_SHOT_W,
	}));
}

async function ensureLuminaIosApp(
	storeId: string,
): Promise<{ created: boolean; id: string }> {
	const [existing] = await db
		.select({ id: apps.id })
		.from(apps)
		.where(
			and(eq(apps.storeId, storeId), eq(apps.bundleId, "com.lumina.habits")),
		)
		.limit(1);
	if (existing) return { created: false, id: existing.id };

	const [luminaIos] = await db
		.insert(apps)
		.values({
			bundleId: "com.lumina.habits",
			externalId: "asc-1000000001",
			iconUrl: icon("6366f1", "Lumina"),
			lastSyncedAt: now,
			name: "Lumina – Habit Tracker",
			platform: "ios",
			primaryCategory: "Productivity",
			secondaryCategory: "Health & Fitness",
			status: "active",
			storeId,
		})
		.returning();

	const iosListings = await db
		.insert(listings)
		.values([
			{
				appId: luminaIos.id,
				fullDesc:
					"Lumina helps you build lasting habits with gentle reminders, streaks, and a calm daily view.\n\n• Simple daily check-ins\n• Streaks & progress charts\n• Smart reminders that adapt to you\n• Private by design — your data stays yours",
				isDirty: false,
				keywords: "habit,tracker,routine,streak,goals,reminder,productivity",
				language: "en-US",
				marketingUrl: "https://lumina.app",
				privacyUrl: "https://lumina.app/privacy",
				promoText: "New: weekly insights and streak recovery.",
				shortDesc: "Habits that finally stick",
				source: "remote",
				supportUrl: "https://lumina.app/support",
				syncedAt: d("2026-06-21T09:30:00Z"),
				title: "Lumina – Habit Tracker",
				whatsNew: "Bug fixes and performance improvements.",
			},
			{
				appId: luminaIos.id,
				fullDesc:
					"Lumina makes habits stick with adaptive reminders, streak recovery, and a calm daily view designed to keep you motivated without pressure.\n\n• One-tap daily check-ins\n• Streaks, charts & weekly insights\n• Adaptive smart reminders\n• 100% private — your data never leaves your device",
				isDirty: true,
				keywords: "habit,tracker,routine,streak,goals,self care,widgets",
				language: "en-US",
				marketingUrl: "https://lumina.app",
				privacyUrl: "https://lumina.app/privacy",
				promoText: "New: weekly insights, streak recovery & widgets.",
				shortDesc: "Build habits without pressure",
				source: "draft",
				supportUrl: "https://lumina.app/support",
				title: "Lumina – Habit Tracker & Goals",
				whatsNew:
					"• Weekly insights\n• Streak recovery\n• New home-screen widgets",
			},
			{
				appId: luminaIos.id,
				fullDesc:
					"Lumina pomaga budować trwałe nawyki dzięki delikatnym przypomnieniom, seriom i spokojnemu widokowi dnia.\n\n• Proste codzienne odznaczanie\n• Serie i wykresy postępów\n• Inteligentne przypomnienia\n• Prywatność przede wszystkim",
				isDirty: false,
				keywords: "nawyki,rutyna,seria,cele,przypomnienia,produktywność",
				language: "pl-PL",
				promoText: "Nowość: tygodniowe podsumowania.",
				shortDesc: "Nawyki, które zostają",
				source: "remote",
				syncedAt: d("2026-06-21T09:30:00Z"),
				title: "Lumina – Nawyki i cele",
				whatsNew: "Poprawki błędów i wydajności.",
			},
			{
				appId: luminaIos.id,
				fullDesc:
					"Lumina pomaga budować trwałe nawyki dzięki delikatnym przypomnieniom, seriom i spokojnemu widokowi dnia.\n\n• Proste codzienne odznaczanie\n• Serie i wykresy postępów\n• Inteligentne przypomnienia\n• Prywatność przede wszystkim",
				isDirty: false,
				keywords: "nawyki,rutyna,seria,cele,przypomnienia,produktywność",
				language: "pl-PL",
				promoText: "Nowość: tygodniowe podsumowania.",
				shortDesc: "Nawyki, które zostają",
				source: "draft",
				title: "Lumina – Nawyki i cele",
				whatsNew: "Poprawki błędów i wydajności.",
			},
		])
		.returning();

	const iosEnDraft = iosListings.find(
		(l) => l.language === "en-US" && l.source === "draft",
	);

	await db.insert(listingHistory).values([
		{
			appId: luminaIos.id,
			createdAt: d("2026-03-12T10:00:00Z"),
			field: "fullDesc",
			language: "en-US",
			listingId: iosEnDraft?.id,
			newValue: "Track your daily habits and build streaks on iPhone.",
			oldValue: null,
			publishedAt: d("2026-03-12T10:00:00Z"),
		},
		{
			appId: luminaIos.id,
			createdAt: d("2026-04-02T12:20:00Z"),
			field: "shortDesc",
			language: "en-US",
			listingId: iosEnDraft?.id,
			newValue: "Habits that finally stick",
			oldValue: "Daily habit tracking",
			publishedAt: d("2026-04-02T12:20:00Z"),
		},
		{
			appId: luminaIos.id,
			createdAt: d("2026-05-06T09:10:00Z"),
			field: "fullDesc",
			language: "en-US",
			listingId: iosEnDraft?.id,
			newValue:
				"Lumina helps you build lasting habits with gentle reminders, streaks, and a calm daily view.\n\n• Simple daily check-ins\n• Streaks & progress charts\n• Smart reminders\n• Private by design",
			oldValue: "Track your daily habits and build streaks on iPhone.",
			publishedAt: d("2026-05-06T09:10:00Z"),
		},
		{
			appId: luminaIos.id,
			createdAt: d("2026-06-21T09:30:00Z"),
			field: "keywords",
			language: "en-US",
			listingId: iosEnDraft?.id,
			newValue: "habit,tracker,routine,streak,goals,reminder,productivity",
			oldValue: "habit,tracker,routine,streak,goals",
			publishedAt: d("2026-06-21T09:30:00Z"),
		},
		{
			appId: luminaIos.id,
			createdAt: d("2026-06-21T09:31:00Z"),
			field: "fullDesc",
			language: "pl-PL",
			listingId: iosEnDraft?.id,
			newValue:
				"Lumina pomaga budować trwałe nawyki dzięki delikatnym przypomnieniom, seriom i spokojnemu widokowi dnia.",
			oldValue: "Śledź swoje codzienne nawyki.",
			publishedAt: d("2026-06-21T09:31:00Z"),
		},
	]);

	await db.insert(reviews).values([
		{
			appId: luminaIos.id,
			appVersion: "2.4.0",
			authorName: "morning_person",
			body: "The widgets and streak recovery make this the only habit app that stuck with me. Worth every penny.",
			device: "iPhone 15 Pro",
			externalId: "as-lum-3001",
			language: "en-US",
			osVersion: "iOS 18.2",
			rating: 5,
			reviewDate: d("2026-06-27T09:40:00Z"),
			storeType: "app_store",
			syncedAt: now,
			territory: "US",
			title: "Best habit tracker on iOS",
		},
		{
			appId: luminaIos.id,
			appVersion: "2.4.0",
			authorName: "Marta_K",
			body: "Bardzo przyjemna aplikacja, ale przydałaby się synchronizacja z Apple Watch.",
			device: "iPhone 14",
			externalId: "as-lum-3002",
			language: "pl-PL",
			osVersion: "iOS 18.1",
			rating: 4,
			repliedAt: d("2026-06-20T08:00:00Z"),
			replyText:
				"Dzięki Marta! Wersja na Apple Watch jest w planach na ten kwartał.",
			reviewDate: d("2026-06-19T17:25:00Z"),
			storeType: "app_store",
			syncedAt: now,
			territory: "PL",
			title: "Prawie idealna",
		},
		{
			appId: luminaIos.id,
			appVersion: "2.3.1",
			authorName: "quantified_self",
			body: "Sync between my iPhone and iPad stopped working after the last update.",
			device: "iPhone 13 mini",
			externalId: "as-lum-3003",
			language: "en-US",
			osVersion: "iOS 17.6",
			rating: 2,
			reviewDate: d("2026-06-08T20:15:00Z"),
			storeType: "app_store",
			syncedAt: now,
			territory: "GB",
			title: "Sync issues",
		},
		{
			appId: luminaIos.id,
			appVersion: "2.4.0",
			authorName: "zen.daily",
			body: "Calm, beautiful and actually motivating. The weekly insights are a great touch.",
			device: "iPhone 15",
			externalId: "as-lum-3004",
			language: "en-US",
			osVersion: "iOS 18.2",
			rating: 5,
			reviewDate: d("2026-06-24T11:05:00Z"),
			storeType: "app_store",
			syncedAt: now,
			territory: "US",
			title: "Calm and motivating",
		},
	]);

	const iosColors = ["6366f1", "8b5cf6", "ec4899", "f59e0b", "10b981"];
	await db.insert(assets).values([
		...iosScreenshotRows(
			luminaIos.id,
			"Lumina",
			"en-US",
			[
				"Track Your Habits",
				"Build Streaks",
				"Weekly Insights",
				"Smart Reminders",
				"Home Screen Widgets",
			],
			iosColors,
		),
		...iosScreenshotRows(
			luminaIos.id,
			"Lumina",
			"pl-PL",
			["Śledź Nawyki", "Buduj Serie", "Tygodniowe Wnioski"],
			iosColors,
		),
		{
			appId: luminaIos.id,
			assetType: "icon",
			deviceType: "phone",
			externalId: "seed-lumina-ios-icon",
			height: 512,
			language: "en-US",
			source: "remote",
			syncedAt: now,
			url: icon("6366f1", "Lumina"),
			width: 512,
		},
	]);

	const [iosVersion] = await db
		.insert(appVersions)
		.values({
			appId: luminaIos.id,
			copyright: "© 2026 Lumina Labs",
			externalId: "asc-ver-2.4.0",
			isEditable: true,
			state: "PREPARE_FOR_SUBMISSION",
			syncedAt: now,
			versionString: "2.4.0",
		})
		.returning();

	await db.insert(versionLocalizations).values([
		{
			appId: luminaIos.id,
			description:
				"Lumina helps you build lasting habits with gentle reminders, streaks, and a calm daily view.",
			isDirty: false,
			keywords: "habit,tracker,routine,streak,goals,reminder,productivity",
			language: "en-US",
			promotionalText: "New: weekly insights and streak recovery.",
			source: "remote",
			subtitle: "Habits that finally stick",
			syncedAt: now,
			title: "Lumina – Habit Tracker",
			versionId: iosVersion.id,
			whatsNew: "Bug fixes and performance improvements.",
		},
		{
			appId: luminaIos.id,
			description:
				"Lumina makes habits stick with adaptive reminders, streak recovery, and a calm daily view.",
			isDirty: true,
			keywords: "habit,tracker,routine,streak,goals,self care,widgets",
			language: "en-US",
			promotionalText: "New: weekly insights, streak recovery & widgets.",
			source: "draft",
			subtitle: "Build habits without pressure",
			title: "Lumina – Habit Tracker & Goals",
			versionId: iosVersion.id,
			whatsNew:
				"• Weekly insights\n• Streak recovery\n• New home-screen widgets",
		},
	]);

	await db.insert(appAgeRatings).values({
		appId: luminaIos.id,
		appleQuestionnaire: {
			alcoholTobaccoOrDrugUseOrReferences: "NONE",
			gamblingSimulated: "NONE",
			medicalOrTreatmentInformation: "NONE",
			violenceCartoonOrFantasy: "NONE",
		},
		appleRating: "4+",
		presetId: "everyone",
	});

	log.info(
		{ appId: luminaIos.id },
		"Seeded Lumina – Habit Tracker (iOS, full)",
	);

	return { created: true, id: luminaIos.id };
}

async function ensureAuraIosApp(
	storeId: string,
): Promise<{ created: boolean; id: string }> {
	const [existing] = await db
		.select({ id: apps.id })
		.from(apps)
		.where(and(eq(apps.storeId, storeId), eq(apps.bundleId, "com.aura.sleep")))
		.limit(1);
	if (existing) return { created: false, id: existing.id };

	const [auraIos] = await db
		.insert(apps)
		.values({
			bundleId: "com.aura.sleep",
			externalId: "asc-1000000002",
			iconUrl: icon("0ea5e9", "Aura"),
			lastSyncedAt: now,
			name: "Aura – Sleep & Focus",
			platform: "ios",
			primaryCategory: "Health & Fitness",
			secondaryCategory: "Lifestyle",
			status: "active",
			storeId,
		})
		.returning();

	const auraIosListings = await db
		.insert(listings)
		.values([
			{
				appId: auraIos.id,
				fullDesc:
					"Aura blends soothing soundscapes, sleep stories and a focus timer to help you rest deeply and concentrate better.\n\n• 200+ soundscapes\n• Sleep stories & meditations\n• Focus timer with ambient noise\n• Sleep insights",
				isDirty: false,
				keywords: "sleep,white noise,focus,meditation,relax,sounds",
				language: "en-US",
				marketingUrl: "https://aura.app",
				privacyUrl: "https://aura.app/privacy",
				promoText: "New sleep stories added weekly.",
				shortDesc: "Sleep deeply, focus calmly",
				source: "remote",
				supportUrl: "https://aura.app/support",
				syncedAt: d("2026-06-22T10:15:00Z"),
				title: "Aura – Sleep & Focus",
				whatsNew: "New soundscapes and stability improvements.",
			},
			{
				appId: auraIos.id,
				fullDesc:
					"Aura blends soothing soundscapes, sleep stories, breathing exercises and a focus timer to help you rest deeply and concentrate better.\n\n• 250+ soundscapes\n• Sleep stories & guided meditations\n• Focus timer with ambient noise\n• Breathing exercises\n• Sleep insights & trends",
				isDirty: true,
				keywords: "sleep,white noise,focus,meditation,relax,breathing,sounds",
				language: "en-US",
				marketingUrl: "https://aura.app",
				privacyUrl: "https://aura.app/privacy",
				promoText: "New: breathing exercises and sleep trends.",
				shortDesc: "Sleep deeply, focus calmly, breathe easy",
				source: "draft",
				supportUrl: "https://aura.app/support",
				title: "Aura – Sleep, Focus & Calm",
				whatsNew:
					"• Breathing exercises\n• Sleep trends dashboard\n• 50 new soundscapes",
			},
			{
				appId: auraIos.id,
				fullDesc:
					"Aura łączy kojące dźwięki, opowieści na dobranoc i minutnik skupienia, aby pomóc Ci głęboko odpocząć i lepiej się koncentrować.\n\n• 200+ pejzaży dźwiękowych\n• Opowieści i medytacje\n• Minutnik skupienia\n• Analiza snu",
				isDirty: false,
				keywords: "sen,biały szum,skupienie,medytacja,relaks,dźwięki",
				language: "pl-PL",
				promoText: "Nowe opowieści na dobranoc co tydzień.",
				shortDesc: "Śpij głęboko, skup się spokojnie",
				source: "remote",
				syncedAt: d("2026-06-22T10:15:00Z"),
				title: "Aura – Sen i Skupienie",
				whatsNew: "Nowe dźwięki i poprawki stabilności.",
			},
			{
				appId: auraIos.id,
				fullDesc:
					"Aura łączy kojące dźwięki, opowieści na dobranoc i minutnik skupienia, aby pomóc Ci głęboko odpocząć i lepiej się koncentrować.\n\n• 200+ pejzaży dźwiękowych\n• Opowieści i medytacje\n• Minutnik skupienia\n• Analiza snu",
				isDirty: false,
				keywords: "sen,biały szum,skupienie,medytacja,relaks,dźwięki",
				language: "pl-PL",
				promoText: "Nowe opowieści na dobranoc co tydzień.",
				shortDesc: "Śpij głęboko, skup się spokojnie",
				source: "draft",
				title: "Aura – Sen i Skupienie",
				whatsNew: "Nowe dźwięki i poprawki stabilności.",
			},
		])
		.returning();

	const auraIosEnDraft = auraIosListings.find(
		(l) => l.language === "en-US" && l.source === "draft",
	);

	await db.insert(listingHistory).values([
		{
			appId: auraIos.id,
			createdAt: d("2026-02-02T11:00:00Z"),
			field: "fullDesc",
			language: "en-US",
			listingId: auraIosEnDraft?.id,
			newValue: "Relaxing sounds to help you sleep on iPhone.",
			oldValue: null,
			publishedAt: d("2026-02-02T11:00:00Z"),
		},
		{
			appId: auraIos.id,
			createdAt: d("2026-04-15T09:40:00Z"),
			field: "shortDesc",
			language: "en-US",
			listingId: auraIosEnDraft?.id,
			newValue: "Sleep deeply, focus calmly",
			oldValue: "Relaxing sleep sounds",
			publishedAt: d("2026-04-15T09:40:00Z"),
		},
		{
			appId: auraIos.id,
			createdAt: d("2026-06-22T10:15:00Z"),
			field: "fullDesc",
			language: "en-US",
			listingId: auraIosEnDraft?.id,
			newValue:
				"Aura blends soothing soundscapes, sleep stories and a focus timer to help you rest deeply and concentrate better.",
			oldValue: "Relaxing sounds to help you sleep on iPhone.",
			publishedAt: d("2026-06-22T10:15:00Z"),
		},
	]);

	await db.insert(reviews).values([
		{
			appId: auraIos.id,
			appVersion: "3.1.0",
			authorName: "deep.sleeper",
			body: "The sleep stories combined with the ocean soundscape are pure magic. Asleep in minutes.",
			device: "iPhone 15 Pro Max",
			externalId: "as-aura-5001",
			language: "en-US",
			osVersion: "iOS 18.2",
			rating: 5,
			reviewDate: d("2026-06-26T23:05:00Z"),
			storeType: "app_store",
			syncedAt: now,
			territory: "US",
			title: "Asleep in minutes",
		},
		{
			appId: auraIos.id,
			appVersion: "3.1.0",
			authorName: "Piotr Z.",
			body: "Bardzo dobre dźwięki, ale chciałbym integrację ze Skrótami (Shortcuts).",
			device: "iPhone 14 Pro",
			externalId: "as-aura-5002",
			language: "pl-PL",
			osVersion: "iOS 18.1",
			rating: 4,
			repliedAt: d("2026-06-18T08:20:00Z"),
			replyText:
				"Dzięki Piotr! Integracja ze Skrótami pojawi się w wersji 3.2.",
			reviewDate: d("2026-06-17T21:50:00Z"),
			storeType: "app_store",
			syncedAt: now,
			territory: "PL",
			title: "Świetna do zasypiania",
		},
		{
			appId: auraIos.id,
			appVersion: "3.0.2",
			authorName: "light_sleeper22",
			body: "Audio stops when the phone locks with low power mode on. Please fix background playback.",
			device: "iPhone 13",
			externalId: "as-aura-5003",
			language: "en-US",
			osVersion: "iOS 17.6",
			rating: 2,
			reviewDate: d("2026-06-09T22:40:00Z"),
			storeType: "app_store",
			syncedAt: now,
			territory: "GB",
			title: "Background audio bug",
		},
		{
			appId: auraIos.id,
			appVersion: "3.1.0",
			authorName: "focus.flow",
			body: "I use the focus timer with brown noise every workday. Simple and beautiful.",
			device: "iPhone 15",
			externalId: "as-aura-5004",
			language: "en-US",
			osVersion: "iOS 18.2",
			rating: 5,
			reviewDate: d("2026-06-23T14:35:00Z"),
			storeType: "app_store",
			syncedAt: now,
			territory: "US",
			title: "Perfect for deep work",
		},
	]);

	const auraIosColors = ["0ea5e9", "6366f1", "1e293b", "334155", "0891b2"];
	await db.insert(assets).values([
		...iosScreenshotRows(
			auraIos.id,
			"Aura",
			"en-US",
			[
				"Fall Asleep Faster",
				"Soothing Soundscapes",
				"Focus Timer",
				"Sleep Insights",
				"Wake Up Refreshed",
			],
			auraIosColors,
		),
		...iosScreenshotRows(
			auraIos.id,
			"Aura",
			"pl-PL",
			["Zaśnij Szybciej", "Kojące Dźwięki", "Minutnik Skupienia"],
			auraIosColors,
		),
		{
			appId: auraIos.id,
			assetType: "icon",
			deviceType: "phone",
			externalId: "seed-aura-ios-icon",
			height: 512,
			language: "en-US",
			source: "remote",
			syncedAt: now,
			url: icon("0ea5e9", "Aura"),
			width: 512,
		},
	]);

	const [auraIosVersion] = await db
		.insert(appVersions)
		.values({
			appId: auraIos.id,
			copyright: "© 2026 Aura Studio",
			externalId: "asc-ver-3.1.0",
			isEditable: true,
			state: "PREPARE_FOR_SUBMISSION",
			syncedAt: now,
			versionString: "3.1.0",
		})
		.returning();

	await db.insert(versionLocalizations).values([
		{
			appId: auraIos.id,
			description:
				"Aura blends soothing soundscapes, sleep stories and a focus timer to help you rest deeply and concentrate better.",
			isDirty: false,
			keywords: "sleep,white noise,focus,meditation,relax,sounds",
			language: "en-US",
			promotionalText: "New sleep stories added weekly.",
			source: "remote",
			subtitle: "Sleep deeply, focus calmly",
			syncedAt: now,
			title: "Aura – Sleep & Focus",
			versionId: auraIosVersion.id,
			whatsNew: "New soundscapes and stability improvements.",
		},
		{
			appId: auraIos.id,
			description:
				"Aura blends soothing soundscapes, sleep stories, breathing exercises and a focus timer to help you rest deeply and concentrate better.",
			isDirty: true,
			keywords: "sleep,white noise,focus,meditation,breathing,sounds",
			language: "en-US",
			promotionalText: "New: breathing exercises and sleep trends.",
			source: "draft",
			subtitle: "Sleep deeply, focus calmly, breathe easy",
			title: "Aura – Sleep, Focus & Calm",
			versionId: auraIosVersion.id,
			whatsNew:
				"• Breathing exercises\n• Sleep trends dashboard\n• 50 new soundscapes",
		},
	]);

	await db.insert(appAgeRatings).values({
		appId: auraIos.id,
		appleQuestionnaire: {
			alcoholTobaccoOrDrugUseOrReferences: "NONE",
			gamblingSimulated: "NONE",
			medicalOrTreatmentInformation: "NONE",
			violenceCartoonOrFantasy: "NONE",
		},
		appleRating: "4+",
		presetId: "everyone",
	});

	log.info({ appId: auraIos.id }, "Seeded Aura – Sleep & Focus (iOS, full)");

	return { created: true, id: auraIos.id };
}

async function ensurePulseIosApp(
	storeId: string,
): Promise<{ created: boolean; id: string }> {
	const [existing] = await db
		.select({ id: apps.id })
		.from(apps)
		.where(
			and(eq(apps.storeId, storeId), eq(apps.bundleId, "com.pulse.workout")),
		)
		.limit(1);
	if (existing) return { created: false, id: existing.id };

	const [pulseIos] = await db
		.insert(apps)
		.values({
			bundleId: "com.pulse.workout",
			externalId: "asc-1000000003",
			iconUrl: icon("ef4444", "Pulse"),
			lastSyncedAt: now,
			name: "Pulse – Workout Tracker",
			platform: "ios",
			primaryCategory: "Health & Fitness",
			secondaryCategory: "Sports",
			status: "active",
			storeId,
		})
		.returning();

	const pulseIosListings = await db
		.insert(listings)
		.values([
			{
				appId: pulseIos.id,
				fullDesc:
					"Pulse is your gym companion — log sets and reps in seconds, follow ready-made plans and watch your strength grow.\n\n• Fast set & rep logging\n• 100+ exercises with animations\n• Ready-made training plans\n• Strength progress charts\n• Rest timer with alerts",
				isDirty: false,
				keywords: "workout,gym,fitness,training,exercise,strength,log",
				language: "en-US",
				marketingUrl: "https://pulse.fit",
				privacyUrl: "https://pulse.fit/privacy",
				promoText: "New: training plans and rest timer.",
				shortDesc: "Log workouts, crush your goals",
				source: "remote",
				supportUrl: "https://pulse.fit/support",
				syncedAt: d("2026-06-23T08:00:00Z"),
				title: "Pulse – Workout Tracker",
				whatsNew: "Bug fixes and new exercises.",
			},
			{
				appId: pulseIos.id,
				fullDesc:
					"Pulse is your gym companion — log sets and reps in seconds, follow ready-made plans, track personal records and watch your strength grow week after week.\n\n• Fast set & rep logging\n• 100+ exercises with animations\n• Ready-made training plans\n• Personal record tracking\n• Strength progress charts\n• Rest timer with alerts",
				isDirty: true,
				keywords: "workout,gym log,fitness,training,strength,records,plans",
				language: "en-US",
				marketingUrl: "https://pulse.fit",
				privacyUrl: "https://pulse.fit/privacy",
				promoText: "New: training plans, rest timer & PR tracking.",
				shortDesc: "Your gym companion — log, plan, progress",
				source: "draft",
				supportUrl: "https://pulse.fit/support",
				title: "Pulse – Workout & Gym Log",
				whatsNew:
					"• Personal record tracking\n• New training plans\n• Rest timer alerts",
			},
			{
				appId: pulseIos.id,
				fullDesc:
					"Pulse to Twój partner na siłowni — zapisuj serie i powtórzenia w kilka sekund, korzystaj z gotowych planów i obserwuj wzrost siły.\n\n• Szybkie zapisywanie serii\n• Ponad 100 ćwiczeń z animacjami\n• Gotowe plany treningowe\n• Wykresy postępów siłowych\n• Minutnik odpoczynku",
				isDirty: false,
				keywords: "trening,siłownia,fitness,dziennik,ćwiczenia,siła",
				language: "pl-PL",
				promoText: "Nowość: plany treningowe i minutnik odpoczynku.",
				shortDesc: "Zapisuj treningi i bij rekordy",
				source: "remote",
				syncedAt: d("2026-06-23T08:00:00Z"),
				title: "Pulse – Dziennik treningowy",
				whatsNew: "Poprawki błędów i nowe ćwiczenia.",
			},
			{
				appId: pulseIos.id,
				fullDesc:
					"Pulse to Twój partner na siłowni — zapisuj serie i powtórzenia w kilka sekund, korzystaj z gotowych planów i obserwuj wzrost siły.\n\n• Szybkie zapisywanie serii\n• Ponad 100 ćwiczeń z animacjami\n• Gotowe plany treningowe\n• Wykresy postępów siłowych\n• Minutnik odpoczynku",
				isDirty: false,
				keywords: "trening,siłownia,fitness,dziennik,ćwiczenia,siła",
				language: "pl-PL",
				promoText: "Nowość: plany treningowe i minutnik odpoczynku.",
				shortDesc: "Zapisuj treningi i bij rekordy",
				source: "draft",
				title: "Pulse – Dziennik treningowy",
				whatsNew: "Poprawki błędów i nowe ćwiczenia.",
			},
		])
		.returning();

	const pulseIosEnDraft = pulseIosListings.find(
		(l) => l.language === "en-US" && l.source === "draft",
	);

	await db.insert(listingHistory).values([
		{
			appId: pulseIos.id,
			createdAt: d("2026-03-01T10:30:00Z"),
			field: "fullDesc",
			language: "en-US",
			listingId: pulseIosEnDraft?.id,
			newValue: "Log your workouts and track your progress on iPhone.",
			oldValue: null,
			publishedAt: d("2026-03-01T10:30:00Z"),
		},
		{
			appId: pulseIos.id,
			createdAt: d("2026-05-10T15:20:00Z"),
			field: "shortDesc",
			language: "en-US",
			listingId: pulseIosEnDraft?.id,
			newValue: "Log workouts, crush your goals",
			oldValue: "Simple workout logging",
			publishedAt: d("2026-05-10T15:20:00Z"),
		},
		{
			appId: pulseIos.id,
			createdAt: d("2026-06-23T08:00:00Z"),
			field: "fullDesc",
			language: "en-US",
			listingId: pulseIosEnDraft?.id,
			newValue:
				"Pulse is your gym companion — log sets and reps in seconds, follow ready-made plans and watch your strength grow.",
			oldValue: "Log your workouts and track your progress on iPhone.",
			publishedAt: d("2026-06-23T08:00:00Z"),
		},
	]);

	await db.insert(reviews).values([
		{
			appId: pulseIos.id,
			appVersion: "1.8.0",
			authorName: "lift.heavy",
			body: "Logged every session for 6 weeks — the progress charts alone are worth the subscription.",
			device: "iPhone 15 Pro",
			externalId: "as-pulse-6001",
			language: "en-US",
			osVersion: "iOS 18.2",
			rating: 5,
			reviewDate: d("2026-06-27T17:10:00Z"),
			storeType: "app_store",
			syncedAt: now,
			territory: "US",
			title: "Charts keep me going",
		},
		{
			appId: pulseIos.id,
			appVersion: "1.8.0",
			authorName: "Magda R.",
			body: "Super szybkie zapisywanie serii. Przydałaby się aplikacja na Apple Watch.",
			device: "iPhone 14",
			externalId: "as-pulse-6002",
			language: "pl-PL",
			osVersion: "iOS 18.1",
			rating: 4,
			repliedAt: d("2026-06-21T07:45:00Z"),
			replyText: "Dzięki Magda! Aplikacja na Apple Watch jest w przygotowaniu.",
			reviewDate: d("2026-06-20T18:30:00Z"),
			storeType: "app_store",
			syncedAt: now,
			territory: "PL",
			title: "Szybkie logowanie serii",
		},
		{
			appId: pulseIos.id,
			appVersion: "1.7.2",
			authorName: "sore_tomorrow",
			body: "HealthKit sync duplicates my workouts. Had to turn it off.",
			device: "iPhone 13 Pro",
			externalId: "as-pulse-6003",
			language: "en-US",
			osVersion: "iOS 17.6",
			rating: 2,
			reviewDate: d("2026-06-10T12:25:00Z"),
			storeType: "app_store",
			syncedAt: now,
			territory: "US",
			title: "HealthKit duplicates",
		},
		{
			appId: pulseIos.id,
			appVersion: "1.8.0",
			authorName: "pr_chaser",
			body: "Clean, fast and no fluff. The PR tracking update is exactly what I wanted.",
			device: "iPhone 15",
			externalId: "as-pulse-6004",
			language: "en-GB",
			osVersion: "iOS 18.2",
			rating: 5,
			reviewDate: d("2026-06-24T08:55:00Z"),
			storeType: "app_store",
			syncedAt: now,
			territory: "GB",
			title: "No fluff, just gains",
		},
	]);

	const pulseIosColors = ["ef4444", "f97316", "f59e0b", "dc2626", "f43f5e"];
	await db.insert(assets).values([
		...iosScreenshotRows(
			pulseIos.id,
			"Pulse",
			"en-US",
			[
				"Log Workouts Fast",
				"Track Your Progress",
				"Training Plans",
				"Rest Timer",
				"Personal Records",
			],
			pulseIosColors,
		),
		...iosScreenshotRows(
			pulseIos.id,
			"Pulse",
			"pl-PL",
			["Zapisuj Treningi", "Śledź Postępy", "Plany Treningowe"],
			pulseIosColors,
		),
		{
			appId: pulseIos.id,
			assetType: "icon",
			deviceType: "phone",
			externalId: "seed-pulse-ios-icon",
			height: 512,
			language: "en-US",
			source: "remote",
			syncedAt: now,
			url: icon("ef4444", "Pulse"),
			width: 512,
		},
	]);

	const [pulseIosVersion] = await db
		.insert(appVersions)
		.values({
			appId: pulseIos.id,
			copyright: "© 2026 Pulse Fitness",
			externalId: "asc-ver-1.8.0",
			isEditable: true,
			state: "PREPARE_FOR_SUBMISSION",
			syncedAt: now,
			versionString: "1.8.0",
		})
		.returning();

	await db.insert(versionLocalizations).values([
		{
			appId: pulseIos.id,
			description:
				"Pulse is your gym companion — log sets and reps in seconds, follow ready-made plans and watch your strength grow.",
			isDirty: false,
			keywords: "workout,gym,fitness,training,exercise,strength,log",
			language: "en-US",
			promotionalText: "New: training plans and rest timer.",
			source: "remote",
			subtitle: "Log workouts, crush your goals",
			syncedAt: now,
			title: "Pulse – Workout Tracker",
			versionId: pulseIosVersion.id,
			whatsNew: "Bug fixes and new exercises.",
		},
		{
			appId: pulseIos.id,
			description:
				"Pulse is your gym companion — log sets and reps in seconds, follow ready-made plans, track personal records and watch your strength grow.",
			isDirty: true,
			keywords: "workout,gym log,fitness,training,strength,records",
			language: "en-US",
			promotionalText: "New: training plans, rest timer & PR tracking.",
			source: "draft",
			subtitle: "Your gym companion — log, plan, progress",
			title: "Pulse – Workout & Gym Log",
			versionId: pulseIosVersion.id,
			whatsNew:
				"• Personal record tracking\n• New training plans\n• Rest timer alerts",
		},
	]);

	await db.insert(appAgeRatings).values({
		appId: pulseIos.id,
		appleQuestionnaire: {
			alcoholTobaccoOrDrugUseOrReferences: "NONE",
			gamblingSimulated: "NONE",
			medicalOrTreatmentInformation: "NONE",
			violenceCartoonOrFantasy: "NONE",
		},
		appleRating: "4+",
		presetId: "everyone",
	});

	log.info(
		{ appId: pulseIos.id },
		"Seeded Pulse – Workout Tracker (iOS, full)",
	);

	return { created: true, id: pulseIos.id };
}

async function ensureIosSection(
	workspaceId: string,
	cfg: { iosStoreName: string },
): Promise<{
	auraIosId: string | null;
	created: boolean;
	luminaIosId: string | null;
	pulseIosId: string | null;
	storeId: string;
}> {
	let storeId: string;
	let created = false;

	const [existing] = await db
		.select({ id: stores.id })
		.from(stores)
		.where(
			and(
				eq(stores.workspaceId, workspaceId),
				eq(stores.name, cfg.iosStoreName),
			),
		)
		.limit(1);
	if (existing) {
		// Upgrade older seeds: attach mock credentials so store actions work.
		await db
			.update(stores)
			.set({ credentials: mockCredentials() })
			.where(and(eq(stores.id, existing.id), isNull(stores.credentials)));
		storeId = existing.id;
	} else {
		const [iosStore] = await db
			.insert(stores)
			.values({
				credentials: mockCredentials(),
				lastSyncedAt: now,
				name: cfg.iosStoreName,
				status: "connected",
				type: "app_store",
				workspaceId,
			})
			.returning();
		log.info({ storeId: iosStore.id }, "Created demo App Store store");
		storeId = iosStore.id;
		created = true;
	}

	const lumina = await ensureLuminaIosApp(storeId);
	const aura = await ensureAuraIosApp(storeId);
	const pulse = await ensurePulseIosApp(storeId);

	return {
		auraIosId: aura.id,
		created: created || lumina.created || aura.created || pulse.created,
		luminaIosId: lumina.id,
		pulseIosId: pulse.id,
		storeId,
	};
}

// ── App group section ───────────────────────────────────────────────────
// Groups an Android + iOS app pair into one named group with a shared ASO
// profile (copied from the Android app's profile).
async function ensureGroup(
	workspaceId: string,
	groupCfg: {
		iconBg: string;
		iconLabel: string;
		memberAppIds: string[];
		name: string;
		sortOrder: number;
	},
): Promise<{ created: boolean; groupId: string | null }> {
	const [existing] = await db
		.select({ id: appGroups.id })
		.from(appGroups)
		.where(
			and(
				eq(appGroups.workspaceId, workspaceId),
				eq(appGroups.name, groupCfg.name),
			),
		)
		.limit(1);
	if (existing) {
		return { created: false, groupId: existing.id };
	}

	const [group] = await db
		.insert(appGroups)
		.values({
			iconUrl: icon(groupCfg.iconBg, groupCfg.iconLabel),
			name: groupCfg.name,
			sortOrder: groupCfg.sortOrder,
			useSharedProfile: true,
			workspaceId,
		})
		.returning();

	await db.insert(appGroupMembers).values(
		groupCfg.memberAppIds.map((appId, i) => ({
			appId,
			groupId: group.id,
			sortOrder: i,
		})),
	);

	// Shared group profile = copy of the Android app's ASO profile.
	const [profile] = await db
		.select()
		.from(appAsoProfiles)
		.where(eq(appAsoProfiles.appId, groupCfg.memberAppIds[0]))
		.limit(1);
	if (profile) {
		const {
			appId: _appId,
			createdAt: _createdAt,
			id: _id,
			updatedAt: _updatedAt,
			...profileFields
		} = profile;
		await db
			.insert(groupAsoProfiles)
			.values({ ...profileFields, groupId: group.id });
	}

	log.info(
		{ groupId: group.id, name: groupCfg.name },
		"Created demo app group (android + ios)",
	);

	return { created: true, groupId: group.id };
}

// AI features read the OpenRouter key from workspace SETTINGS (not env).
// When the local .env has a key, copy it into the demo workspace once so AI
// generation works out of the box. SettingsService encrypts sensitive keys.
async function ensureAiKey(workspaceId: string): Promise<void> {
	if (!config.OPENROUTER_API_KEY) return;
	const existing = await SettingsService.getRaw(
		workspaceId,
		"OPENROUTER_API_KEY",
	);
	if (existing) return;
	await SettingsService.set(
		workspaceId,
		"OPENROUTER_API_KEY",
		config.OPENROUTER_API_KEY,
	);
	log.info("Copied OpenRouter API key from env into demo workspace settings");
}

export async function seedDemo(
	opts: SeedDemoOptions = {},
): Promise<SeedDemoResult> {
	const cfg = { ...DEMO, ...opts };
	const { userId, workspaceId } = await ensureDemoUser(cfg);

	// Idempotency guard — additive only. Each section (Google Play, App Store,
	// group) has its own guard, so re-running fills in whatever is missing
	// without ever duplicating or touching existing rows.
	const [existingStore] = await db
		.select({ id: stores.id })
		.from(stores)
		.where(
			and(eq(stores.workspaceId, workspaceId), eq(stores.name, cfg.storeName)),
		)
		.limit(1);
	if (existingStore) {
		log.info("GP demo store already present — skipping Google Play section.");
		// Upgrade older seeds: attach mock credentials so store actions work.
		await db
			.update(stores)
			.set({ credentials: mockCredentials() })
			.where(and(eq(stores.id, existingStore.id), isNull(stores.credentials)));
		const gpApps = await db
			.select({ bundleId: apps.bundleId, id: apps.id })
			.from(apps)
			.where(eq(apps.storeId, existingStore.id));
		const luminaGpId =
			gpApps.find((a) => a.bundleId === "com.lumina.habits")?.id ?? null;
		const auraId =
			gpApps.find((a) => a.bundleId === "com.aura.sleep")?.id ?? null;

		const pulse = await ensurePulseGpApp(existingStore.id);
		const ios = await ensureIosSection(workspaceId, cfg);
		const group =
			luminaGpId && ios.luminaIosId
				? await ensureGroup(workspaceId, {
						iconBg: "6366f1",
						iconLabel: "Lumina",
						memberAppIds: [luminaGpId, ios.luminaIosId],
						name: cfg.groupName,
						sortOrder: 0,
					})
				: { created: false, groupId: null };
		const auraGroup =
			auraId && ios.auraIosId
				? await ensureGroup(workspaceId, {
						iconBg: "0ea5e9",
						iconLabel: "Aura",
						memberAppIds: [auraId, ios.auraIosId],
						name: cfg.auraGroupName,
						sortOrder: 1,
					})
				: { created: false, groupId: null };
		await ensureAiKey(workspaceId);

		return {
			auraGroupId: auraGroup.groupId,
			auraId,
			auraIosId: ios.auraIosId,
			created:
				pulse.created || ios.created || group.created || auraGroup.created,
			groupId: group.groupId,
			iosStoreId: ios.storeId,
			luminaId: luminaGpId,
			luminaIosId: ios.luminaIosId,
			pulseId: pulse.id,
			pulseIosId: ios.pulseIosId,
			storeId: existingStore.id,
			userId,
			workspaceId,
		};
	}

	const [store] = await db
		.insert(stores)
		.values({
			credentials: mockCredentials(),
			lastSyncedAt: now,
			name: cfg.storeName,
			status: "connected",
			type: "google_play",
			workspaceId,
		})
		.returning();
	log.info({ storeId: store.id }, "Created demo Google Play store");

	// ─────────────────────────────────────────────────────────────────────
	// APP 1 — Lumina – Habit Tracker (fully populated showcase)
	// ─────────────────────────────────────────────────────────────────────
	const [lumina] = await db
		.insert(apps)
		.values({
			bundleId: "com.lumina.habits",
			externalId: "gp-com.lumina.habits",
			iconUrl: icon("6366f1", "Lumina"),
			lastSyncedAt: now,
			name: "Lumina – Habit Tracker",
			platform: "android",
			primaryCategory: "Productivity",
			secondaryCategory: "Health & Fitness",
			status: "active",
			storeId: store.id,
		})
		.returning();

	// Listings: EN (remote != draft, dirty), PL (published), DE (partial diff)
	const luminaListings = await db
		.insert(listings)
		.values([
			{
				appId: lumina.id,
				fullDesc:
					"Lumina helps you build lasting habits with gentle reminders, streaks, and a calm daily view.\n\n• Simple daily check-ins\n• Streaks & progress charts\n• Smart reminders that adapt to you\n• Private by design — your data stays yours",
				isDirty: false,
				keywords:
					"habit tracker,routine,streak,daily goals,reminder,productivity",
				language: "en-US",
				marketingUrl: "https://lumina.app",
				privacyUrl: "https://lumina.app/privacy",
				promoText: "New: weekly insights and streak recovery.",
				shortDesc: "Build better habits, one day at a time",
				source: "remote",
				supportUrl: "https://lumina.app/support",
				syncedAt: d("2026-06-20T08:45:00Z"),
				title: "Lumina – Habit Tracker",
				whatsNew: "Bug fixes and performance improvements.",
			},
			{
				appId: lumina.id,
				fullDesc:
					"Lumina makes habits stick with adaptive reminders, streak recovery, and a calm daily view designed to keep you motivated without pressure.\n\n• One-tap daily check-ins\n• Streaks, charts & weekly insights\n• Adaptive smart reminders\n• 100% private — your data never leaves your device",
				isDirty: true,
				keywords:
					"habit tracker,routine builder,streak,daily goals,reminder,self care",
				language: "en-US",
				marketingUrl: "https://lumina.app",
				privacyUrl: "https://lumina.app/privacy",
				promoText: "New: weekly insights, streak recovery & widgets.",
				shortDesc: "Build better habits that actually stick",
				source: "draft",
				supportUrl: "https://lumina.app/support",
				title: "Lumina – Habit Tracker & Goals",
				whatsNew:
					"• Weekly insights\n• Streak recovery\n• New home-screen widgets",
			},
			{
				appId: lumina.id,
				fullDesc:
					"Lumina pomaga budować trwałe nawyki dzięki delikatnym przypomnieniom, seriom i spokojnemu widokowi dnia.\n\n• Proste codzienne odznaczanie\n• Serie i wykresy postępów\n• Inteligentne przypomnienia\n• Prywatność przede wszystkim",
				isDirty: false,
				keywords:
					"nawyki,rutyna,seria,cele dzienne,przypomnienia,produktywność",
				language: "pl-PL",
				promoText: "Nowość: tygodniowe podsumowania.",
				shortDesc: "Buduj lepsze nawyki dzień po dniu",
				source: "remote",
				syncedAt: d("2026-06-20T08:45:00Z"),
				title: "Lumina – Nawyki i cele",
				whatsNew: "Poprawki błędów i wydajności.",
			},
			{
				appId: lumina.id,
				fullDesc:
					"Lumina pomaga budować trwałe nawyki dzięki delikatnym przypomnieniom, seriom i spokojnemu widokowi dnia.\n\n• Proste codzienne odznaczanie\n• Serie i wykresy postępów\n• Inteligentne przypomnienia\n• Prywatność przede wszystkim",
				isDirty: false,
				keywords:
					"nawyki,rutyna,seria,cele dzienne,przypomnienia,produktywność",
				language: "pl-PL",
				promoText: "Nowość: tygodniowe podsumowania.",
				shortDesc: "Buduj lepsze nawyki dzień po dniu",
				source: "draft",
				title: "Lumina – Nawyki i cele",
				whatsNew: "Poprawki błędów i wydajności.",
			},
			{
				appId: lumina.id,
				fullDesc:
					"Lumina hilft dir, dauerhafte Gewohnheiten aufzubauen – mit sanften Erinnerungen, Serien und einer ruhigen Tagesansicht.",
				isDirty: false,
				keywords:
					"gewohnheiten,routine,serie,tagesziele,erinnerung,produktivität",
				language: "de-DE",
				promoText: "Neu: wöchentliche Einblicke.",
				shortDesc: "Bessere Gewohnheiten, Tag für Tag",
				source: "remote",
				syncedAt: d("2026-06-20T08:45:00Z"),
				title: "Lumina – Gewohnheiten Tracker",
				whatsNew: "Fehlerbehebungen.",
			},
			{
				appId: lumina.id,
				fullDesc:
					"Lumina lässt Gewohnheiten haften – mit adaptiven Erinnerungen, Serien-Wiederherstellung und einer ruhigen, motivierenden Tagesansicht.\n\n• Tägliches Ein-Tipp-Einchecken\n• Serien, Diagramme & wöchentliche Einblicke\n• 100 % privat",
				isDirty: true,
				keywords:
					"gewohnheiten,routine,serie,tagesziele,erinnerung,produktivität",
				language: "de-DE",
				promoText: "Neu: wöchentliche Einblicke.",
				shortDesc: "Bessere Gewohnheiten, Tag für Tag",
				source: "draft",
				title: "Lumina – Gewohnheiten Tracker",
				whatsNew:
					"• Wöchentliche Einblicke\n• Serien-Wiederherstellung\n• Neue Widgets",
			},
		])
		.returning();

	const enDraft = luminaListings.find(
		(l) => l.language === "en-US" && l.source === "draft",
	);
	const deDraft = luminaListings.find(
		(l) => l.language === "de-DE" && l.source === "draft",
	);

	// Listing history ("historia opisów") — description evolving over time.
	// createdAt MUST be set explicitly (history is ordered by createdAt).
	await db.insert(listingHistory).values([
		{
			appId: lumina.id,
			createdAt: d("2026-02-10T09:00:00Z"),
			field: "fullDesc",
			language: "en-US",
			listingId: enDraft?.id,
			newValue: "Track your daily habits and build streaks.",
			oldValue: null,
			publishedAt: d("2026-02-10T09:00:00Z"),
		},
		{
			appId: lumina.id,
			createdAt: d("2026-03-05T11:30:00Z"),
			field: "title",
			language: "en-US",
			listingId: enDraft?.id,
			newValue: "Lumina – Habits",
			oldValue: "Lumina",
			publishedAt: d("2026-03-05T11:30:00Z"),
		},
		{
			appId: lumina.id,
			createdAt: d("2026-03-05T11:31:00Z"),
			field: "fullDesc",
			language: "en-US",
			listingId: enDraft?.id,
			newValue:
				"Lumina helps you track daily habits, build streaks and stay consistent with reminders.",
			oldValue: "Track your daily habits and build streaks.",
			publishedAt: d("2026-03-05T11:31:00Z"),
		},
		{
			appId: lumina.id,
			createdAt: d("2026-04-18T14:15:00Z"),
			field: "fullDesc",
			language: "en-US",
			listingId: enDraft?.id,
			newValue:
				"Lumina helps you build lasting habits with gentle reminders, streaks, and a calm daily view.\n\n• Simple daily check-ins\n• Streaks & progress charts\n• Smart reminders\n• Private by design",
			oldValue:
				"Lumina helps you track daily habits, build streaks and stay consistent with reminders.",
			publishedAt: d("2026-04-18T14:15:00Z"),
		},
		{
			appId: lumina.id,
			createdAt: d("2026-06-20T08:45:00Z"),
			field: "title",
			language: "en-US",
			listingId: enDraft?.id,
			newValue: "Lumina – Habit Tracker",
			oldValue: "Lumina – Habits",
			publishedAt: d("2026-06-20T08:45:00Z"),
		},
		{
			appId: lumina.id,
			createdAt: d("2026-06-20T08:46:00Z"),
			field: "whatsNew",
			language: "en-US",
			listingId: enDraft?.id,
			newValue: "Bug fixes and performance improvements.",
			oldValue: "Initial release.",
			publishedAt: d("2026-06-20T08:46:00Z"),
		},
		{
			appId: lumina.id,
			createdAt: d("2026-04-18T15:00:00Z"),
			field: "fullDesc",
			language: "de-DE",
			listingId: deDraft?.id,
			newValue:
				"Lumina hilft dir, dauerhafte Gewohnheiten aufzubauen – mit sanften Erinnerungen, Serien und einer ruhigen Tagesansicht.",
			oldValue: "Verfolge deine täglichen Gewohnheiten.",
			publishedAt: d("2026-04-18T15:00:00Z"),
		},
	]);

	// ASO profile — the "where we stand in stores" analysis.
	await db.insert(appAsoProfiles).values({
		appId: lumina.id,
		awards: ["Featured on the App Store — App of the Day (2025)"],
		brandVoiceExample:
			"Missed a day? No problem. Pick up right where you left off.",
		category: "Productivity / Health & Fitness",
		competitiveAdvantage:
			"Streak recovery and a shame-free UX competitors lack.",
		competitors: ["Streaks", "Habitica", "Productive", "Way of Life"],
		differentiator:
			"Streak recovery + a calm, pressure-free daily view (no red guilt badges).",
		downloadCount: "120,000+",
		excludeKeywords: ["gambling", "crypto", "betting"],
		freeFeatures: ["Up to 3 habits", "Daily reminders", "Basic streaks"],
		keyFeatures: [
			"Daily check-ins",
			"Streaks & progress charts",
			"Adaptive smart reminders",
			"Weekly insights",
			"Home-screen widgets",
			"Streak recovery",
		],
		longTailKeywords: [
			"habit tracker with reminders",
			"build a morning routine",
			"daily habit streak app",
		],
		mainBenefit:
			"Build habits that actually stick with adaptive, guilt-free reminders.",
		mustIncludeKeywords: ["habit tracker", "streak", "daily routine"],
		oneLiner:
			"The calm habit tracker that helps you stay consistent without pressure.",
		painPoints: [
			"Loses motivation after a missed day",
			"Overwhelmed by complex trackers",
			"Feels guilty about broken streaks",
			"Forgets to log habits",
		],
		positioning:
			"The anti-pressure habit tracker for people who quit strict apps.",
		premiumFeatures: [
			"Unlimited habits",
			"Weekly insights",
			"Streak recovery",
			"Widgets",
			"Cloud sync",
		],
		pressQuotes: ['"The gentlest habit app I have tried" — The Verge'],
		price: "$4.99/mo or $29.99/yr",
		pricingModel: "Freemium with Pro subscription",
		problem:
			"People start new habits but lose motivation and quit within two weeks.",
		targetAudience:
			"Busy professionals and students (25-40) who want to build routines but feel overwhelmed by strict trackers.",
		testimonials: [
			'"Finally an app that does not make me feel bad." — Sarah K.',
			'"The streak recovery feature is genius." — Marco',
		],
		tone: "Calm, supportive, minimal",
		userLanguage: "Warm, encouraging, plain-spoken — no jargon, no shame.",
		wordsToAvoid: ["grind", "hustle", "discipline", "punishment"],
		wordsToInclude: ["calm", "consistent", "streak", "routine", "gentle"],
	});

	// Reviews (mix of ratings/territories, some replied).
	await db.insert(reviews).values([
		{
			appId: lumina.id,
			appVersion: "2.4.0",
			authorName: "jenna_w",
			body: "Been using Lumina for 3 months and my morning routine is rock solid. The streak recovery is a lifesaver.",
			device: "Pixel 8 Pro",
			externalId: "gp-lum-1001",
			language: "en-US",
			osVersion: "Android 15",
			rating: 5,
			reviewDate: d("2026-06-28T10:12:00Z"),
			storeType: "google_play",
			syncedAt: now,
			territory: "US",
			title: "Finally a habit app that sticks",
		},
		{
			appId: lumina.id,
			appVersion: "2.3.1",
			authorName: "mike.d",
			body: "Love the design but reminders sometimes do not fire. Please fix.",
			device: "Samsung Galaxy A54",
			externalId: "gp-lum-1002",
			language: "en-US",
			osVersion: "Android 14",
			rating: 2,
			repliedAt: d("2026-06-16T09:00:00Z"),
			replyText:
				"Thanks for the report Mike — reminder reliability is fixed in 2.4.0, please update and let us know!",
			reviewDate: d("2026-06-15T18:40:00Z"),
			storeType: "google_play",
			syncedAt: now,
			territory: "US",
			title: "Reminders unreliable",
		},
		{
			appId: lumina.id,
			appVersion: "2.4.0",
			authorName: "Kasia Nowak",
			body: "Świetna aplikacja do budowania nawyków, brakuje mi tylko wersji na tablet.",
			device: "Pixel 8",
			externalId: "gp-lum-1003",
			language: "pl-PL",
			osVersion: "Android 15",
			rating: 4,
			reviewDate: d("2026-06-25T08:05:00Z"),
			storeType: "google_play",
			syncedAt: now,
			territory: "PL",
		},
		{
			appId: lumina.id,
			appVersion: "2.4.0",
			authorName: "Thomas B.",
			body: "Endlich eine ruhige Habit-App ohne Druck. Die wöchentlichen Einblicke sind top!",
			device: "Samsung Galaxy S24",
			externalId: "gp-lum-1004",
			language: "de-DE",
			osVersion: "Android 14",
			rating: 5,
			repliedAt: d("2026-06-23T07:15:00Z"),
			replyText: "Danke Thomas! Freut uns sehr.",
			reviewDate: d("2026-06-22T14:30:00Z"),
			storeType: "google_play",
			syncedAt: now,
			territory: "DE",
		},
		{
			appId: lumina.id,
			appVersion: "2.4.0",
			authorName: "Dev User",
			body: "App crashes on launch after the latest update.",
			device: "OnePlus 12",
			externalId: "gp-lum-1005",
			language: "en-GB",
			osVersion: "Android 15",
			rating: 1,
			reviewDate: d("2026-06-10T21:00:00Z"),
			storeType: "google_play",
			syncedAt: now,
			territory: "GB",
			title: "Crashes on launch",
		},
		{
			appId: lumina.id,
			appVersion: "2.4.0",
			authorName: "budget_user",
			body: "The free tier is too limited — 3 habits is not enough. Pro is a bit expensive.",
			device: "Motorola Edge",
			externalId: "gp-lum-1006",
			language: "en-US",
			osVersion: "Android 14",
			rating: 3,
			reviewDate: d("2026-05-30T12:00:00Z"),
			storeType: "google_play",
			syncedAt: now,
			territory: "US",
			title: "Good but pricey",
		},
	]);

	// Screenshots (per language) + icon + feature graphic.
	const luminaColors = ["6366f1", "8b5cf6", "ec4899", "f59e0b", "10b981"];
	await db.insert(assets).values([
		...screenshotRows(
			lumina.id,
			"Lumina",
			"en-US",
			[
				"Track Your Habits",
				"Build Streaks",
				"Weekly Insights",
				"Smart Reminders",
				"Stay Consistent",
			],
			luminaColors,
		),
		...screenshotRows(
			lumina.id,
			"Lumina",
			"pl-PL",
			[
				"Śledź Nawyki",
				"Buduj Serie",
				"Tygodniowe Wnioski",
				"Przypomnienia",
				"Bądź Konsekwentny",
			],
			luminaColors,
		),
		...screenshotRows(
			lumina.id,
			"Lumina",
			"de-DE",
			[
				"Gewohnheiten",
				"Serien Aufbauen",
				"Einblicke",
				"Erinnerungen",
				"Bleib Dran",
			],
			luminaColors,
		),
		{
			appId: lumina.id,
			assetType: "icon",
			deviceType: "phone",
			externalId: "seed-lumina-icon",
			height: 512,
			language: "en-US",
			source: "remote",
			syncedAt: now,
			url: icon("6366f1", "Lumina"),
			width: 512,
		},
		{
			appId: lumina.id,
			assetType: "featureGraphic",
			deviceType: "phone",
			externalId: "seed-lumina-feature",
			height: 500,
			language: "en-US",
			source: "remote",
			syncedAt: now,
			url: feature("6366f1", "Lumina – Build better habits"),
			width: 1024,
		},
	]);

	// App version + localizations (Current Version card / publishing screen).
	const [luminaVersion] = await db
		.insert(appVersions)
		.values({
			appId: lumina.id,
			copyright: "© 2026 Lumina Labs",
			externalId: "gp-ver-2.4.0",
			isEditable: true,
			state: "DRAFT",
			syncedAt: now,
			versionString: "2.4.0",
		})
		.returning();

	await db.insert(versionLocalizations).values([
		{
			appId: lumina.id,
			description:
				"Lumina helps you build lasting habits with gentle reminders, streaks, and a calm daily view.",
			isDirty: false,
			keywords: "habit tracker,routine,streak,daily goals,reminder",
			language: "en-US",
			promotionalText: "New: weekly insights and streak recovery.",
			source: "remote",
			subtitle: "Build better habits, one day at a time",
			syncedAt: now,
			title: "Lumina – Habit Tracker",
			versionId: luminaVersion.id,
			whatsNew: "Bug fixes and performance improvements.",
		},
		{
			appId: lumina.id,
			description:
				"Lumina makes habits stick with adaptive reminders, streak recovery, and a calm daily view.",
			isDirty: true,
			keywords: "habit tracker,routine builder,streak,self care",
			language: "en-US",
			promotionalText: "New: weekly insights, streak recovery & widgets.",
			source: "draft",
			subtitle: "Build better habits that actually stick",
			title: "Lumina – Habit Tracker & Goals",
			versionId: luminaVersion.id,
			whatsNew:
				"• Weekly insights\n• Streak recovery\n• New home-screen widgets",
		},
	]);

	// Age rating + privacy declaration.
	await db.insert(appAgeRatings).values({
		appId: lumina.id,
		googleQuestionnaire: {
			controlledSubstances: false,
			gambling: false,
			userGeneratedContent: false,
			violence: false,
		},
		googleRating: "Everyone",
		presetId: "everyone",
	});

	await db.insert(appPrivacyDeclarations).values({
		appId: lumina.id,
		dataCollections: [
			{
				category: "Contact Info",
				collected: true,
				dataType: "Email Address",
				linked: true,
				purposes: ["App Functionality", "Account Management"],
				required: false,
				tracking: false,
			},
			{
				category: "Usage Data",
				collected: true,
				dataType: "Product Interaction",
				linked: false,
				purposes: ["Analytics"],
				required: false,
				tracking: false,
			},
		],
		gpDeletionMechanism: true,
		gpEncryptedInTransit: true,
		privacyPolicyUrl: "https://lumina.app/privacy",
		templateId: "gp_basic_app",
		trackingDomains: [],
		trackingEnabled: false,
	});

	// Monetization — subscription group + Pro subscription.
	const [luminaSubGroup] = await db
		.insert(subscriptionGroups)
		.values({
			appId: lumina.id,
			availableTerritories: ["US", "PL", "DE", "GB"],
			externalId: "gp-sub-lumina-pro",
			name: "Lumina Pro",
			syncedAt: now,
		})
		.returning();

	await db.insert(subscriptionGroupLocalizations).values({
		description: "Premium habit tracking features.",
		groupId: luminaSubGroup.id,
		language: "en-US",
		name: "Lumina Pro",
	});

	const [luminaIap] = await db
		.insert(inAppPurchases)
		.values({
			appId: lumina.id,
			availableTerritories: ["US", "PL", "DE", "GB"],
			duration: "P1Y",
			externalId: "gp-iap-pro-yearly",
			familySharable: true,
			groupId: luminaSubGroup.id,
			name: "Lumina Pro (Yearly)",
			productId: "com.lumina.habits.pro.yearly",
			productType: "auto_renewable",
			status: "approved",
			syncedAt: now,
		})
		.returning();

	await db.insert(purchaseLocalizations).values({
		description:
			"Unlimited habits, weekly insights, streak recovery, widgets and cloud sync.",
		language: "en-US",
		name: "Lumina Pro",
		purchaseId: luminaIap.id,
		syncedAt: now,
	});

	await db.insert(purchasePrices).values([
		{
			currency: "USD",
			price: "29.99",
			purchaseId: luminaIap.id,
			syncedAt: now,
			territory: "US",
		},
		{
			currency: "EUR",
			price: "29.99",
			purchaseId: luminaIap.id,
			syncedAt: now,
			territory: "DE",
		},
	]);

	log.info({ appId: lumina.id }, "Seeded Lumina – Habit Tracker (full)");

	// ─────────────────────────────────────────────────────────────────────
	// APP 2 — Aura – Sleep & Focus (lighter, still populated)
	// ─────────────────────────────────────────────────────────────────────
	const [aura] = await db
		.insert(apps)
		.values({
			bundleId: "com.aura.sleep",
			externalId: "gp-com.aura.sleep",
			iconUrl: icon("0ea5e9", "Aura"),
			lastSyncedAt: now,
			name: "Aura – Sleep & Focus",
			platform: "android",
			primaryCategory: "Health & Fitness",
			secondaryCategory: "Lifestyle",
			status: "active",
			storeId: store.id,
		})
		.returning();

	const auraListings = await db
		.insert(listings)
		.values([
			{
				appId: aura.id,
				fullDesc:
					"Aura blends soothing soundscapes, sleep stories and a focus timer to help you rest deeply and concentrate better.\n\n• 200+ soundscapes\n• Sleep stories & meditations\n• Focus timer with ambient noise\n• Sleep insights",
				isDirty: false,
				keywords: "sleep,white noise,focus,meditation,relax,sounds",
				language: "en-US",
				marketingUrl: "https://aura.app",
				privacyUrl: "https://aura.app/privacy",
				promoText: "New sleep stories added weekly.",
				shortDesc: "Sleep deeply, focus calmly",
				source: "remote",
				supportUrl: "https://aura.app/support",
				syncedAt: d("2026-06-18T09:00:00Z"),
				title: "Aura – Sleep & Focus",
				whatsNew: "New soundscapes and stability improvements.",
			},
			{
				appId: aura.id,
				fullDesc:
					"Aura blends soothing soundscapes, sleep stories, breathing exercises and a focus timer to help you rest deeply and concentrate better.\n\n• 250+ soundscapes\n• Sleep stories & guided meditations\n• Focus timer with ambient noise\n• Breathing exercises\n• Sleep insights & trends",
				isDirty: true,
				keywords: "sleep,white noise,focus,meditation,relax,breathing,sounds",
				language: "en-US",
				marketingUrl: "https://aura.app",
				privacyUrl: "https://aura.app/privacy",
				promoText: "New: breathing exercises and sleep trends.",
				shortDesc: "Sleep deeply, focus calmly, breathe easy",
				source: "draft",
				supportUrl: "https://aura.app/support",
				title: "Aura – Sleep, Focus & Calm",
				whatsNew:
					"• Breathing exercises\n• Sleep trends dashboard\n• 50 new soundscapes",
			},
			{
				appId: aura.id,
				fullDesc:
					"Aura łączy kojące dźwięki, opowieści na dobranoc i minutnik skupienia, aby pomóc Ci głęboko odpocząć i lepiej się koncentrować.\n\n• 200+ pejzaży dźwiękowych\n• Opowieści i medytacje\n• Minutnik skupienia\n• Analiza snu",
				isDirty: false,
				keywords: "sen,biały szum,skupienie,medytacja,relaks,dźwięki",
				language: "pl-PL",
				promoText: "Nowe opowieści na dobranoc co tydzień.",
				shortDesc: "Śpij głęboko, skup się spokojnie",
				source: "remote",
				syncedAt: d("2026-06-18T09:00:00Z"),
				title: "Aura – Sen i Skupienie",
				whatsNew: "Nowe dźwięki i poprawki stabilności.",
			},
			{
				appId: aura.id,
				fullDesc:
					"Aura łączy kojące dźwięki, opowieści na dobranoc i minutnik skupienia, aby pomóc Ci głęboko odpocząć i lepiej się koncentrować.\n\n• 200+ pejzaży dźwiękowych\n• Opowieści i medytacje\n• Minutnik skupienia\n• Analiza snu",
				isDirty: false,
				keywords: "sen,biały szum,skupienie,medytacja,relaks,dźwięki",
				language: "pl-PL",
				promoText: "Nowe opowieści na dobranoc co tydzień.",
				shortDesc: "Śpij głęboko, skup się spokojnie",
				source: "draft",
				title: "Aura – Sen i Skupienie",
				whatsNew: "Nowe dźwięki i poprawki stabilności.",
			},
		])
		.returning();

	const auraEnDraft = auraListings.find(
		(l) => l.language === "en-US" && l.source === "draft",
	);

	await db.insert(listingHistory).values([
		{
			appId: aura.id,
			createdAt: d("2026-01-20T10:00:00Z"),
			field: "fullDesc",
			language: "en-US",
			listingId: auraEnDraft?.id,
			newValue: "Relaxing sounds to help you sleep.",
			oldValue: null,
			publishedAt: d("2026-01-20T10:00:00Z"),
		},
		{
			appId: aura.id,
			createdAt: d("2026-06-18T09:00:00Z"),
			field: "fullDesc",
			language: "en-US",
			listingId: auraEnDraft?.id,
			newValue:
				"Aura blends soothing soundscapes, sleep stories and a focus timer to help you rest deeply and concentrate better.",
			oldValue: "Relaxing sounds to help you sleep.",
			publishedAt: d("2026-06-18T09:00:00Z"),
		},
	]);

	await db.insert(appAsoProfiles).values({
		appId: aura.id,
		category: "Health & Fitness / Lifestyle",
		competitiveAdvantage:
			"The largest offline soundscape library plus a built-in focus timer.",
		competitors: ["Calm", "Headspace", "BetterSleep", "Endel"],
		differentiator: "Sleep + focus in one app, fully offline.",
		downloadCount: "500,000+",
		keyFeatures: [
			"200+ soundscapes",
			"Sleep stories",
			"Focus timer",
			"Sleep insights",
			"Offline playback",
		],
		longTailKeywords: [
			"white noise for sleep",
			"focus timer with sounds",
			"sleep sounds offline",
		],
		mainBenefit: "Fall asleep faster and focus longer with calming audio.",
		mustIncludeKeywords: ["sleep sounds", "white noise", "focus"],
		oneLiner: "Soothing sounds and stories for better sleep and deep focus.",
		painPoints: [
			"Can't fall asleep at night",
			"Distracted while working",
			"Noisy environment",
		],
		positioning: "The all-in-one sleep and focus companion.",
		targetAudience:
			"Adults (25-45) struggling with sleep and looking to focus during work.",
		tone: "Calm, warm, reassuring",
		wordsToInclude: ["calm", "soothing", "restful", "focus"],
	});

	await db.insert(reviews).values([
		{
			appId: aura.id,
			appVersion: "3.1.0",
			authorName: "sleepyhead",
			body: "The rain sounds knock me out every night. Best sleep app I have tried.",
			device: "Pixel 7",
			externalId: "gp-aura-2001",
			language: "en-US",
			osVersion: "Android 14",
			rating: 5,
			reviewDate: d("2026-06-26T22:10:00Z"),
			storeType: "google_play",
			syncedAt: now,
			territory: "US",
			title: "Best sleep app",
		},
		{
			appId: aura.id,
			appVersion: "3.1.0",
			authorName: "Ola W.",
			body: "Dobre dźwięki, ale minutnik skupienia mógłby mieć więcej opcji.",
			device: "Samsung Galaxy S23",
			externalId: "gp-aura-2002",
			language: "pl-PL",
			osVersion: "Android 15",
			rating: 4,
			reviewDate: d("2026-06-19T20:00:00Z"),
			storeType: "google_play",
			syncedAt: now,
			territory: "PL",
		},
		{
			appId: aura.id,
			appVersion: "3.0.2",
			authorName: "night_owl",
			body: "Too many features are locked behind the paywall now.",
			device: "Nothing Phone 2",
			externalId: "gp-aura-2003",
			language: "en-US",
			osVersion: "Android 14",
			rating: 2,
			repliedAt: d("2026-06-12T08:00:00Z"),
			replyText:
				"Thanks for the feedback — the free tier still includes 50+ soundscapes and we're reviewing our pricing.",
			reviewDate: d("2026-06-11T19:30:00Z"),
			storeType: "google_play",
			syncedAt: now,
			territory: "US",
			title: "Too much locked",
		},
	]);

	const auraColors = ["0ea5e9", "6366f1", "1e293b", "334155", "0891b2"];
	await db.insert(assets).values([
		...screenshotRows(
			aura.id,
			"Aura",
			"en-US",
			[
				"Fall Asleep Faster",
				"Soothing Soundscapes",
				"Focus Timer",
				"Sleep Insights",
				"Wake Up Refreshed",
			],
			auraColors,
		),
		...screenshotRows(
			aura.id,
			"Aura",
			"pl-PL",
			[
				"Zaśnij Szybciej",
				"Kojące Dźwięki",
				"Minutnik Skupienia",
				"Analiza Snu",
				"Obudź Się Wypoczęty",
			],
			auraColors,
		),
		{
			appId: aura.id,
			assetType: "icon",
			deviceType: "phone",
			externalId: "seed-aura-icon",
			height: 512,
			language: "en-US",
			source: "remote",
			syncedAt: now,
			url: icon("0ea5e9", "Aura"),
			width: 512,
		},
	]);

	const [auraVersion] = await db
		.insert(appVersions)
		.values({
			appId: aura.id,
			copyright: "© 2026 Aura Studio",
			externalId: "gp-ver-3.1.0",
			isEditable: true,
			state: "DRAFT",
			syncedAt: now,
			versionString: "3.1.0",
		})
		.returning();

	await db.insert(versionLocalizations).values({
		appId: aura.id,
		description:
			"Aura blends soothing soundscapes, sleep stories and a focus timer to help you rest deeply and concentrate better.",
		isDirty: false,
		keywords: "sleep,white noise,focus,meditation,relax",
		language: "en-US",
		promotionalText: "New sleep stories added weekly.",
		source: "remote",
		subtitle: "Sleep deeply, focus calmly",
		syncedAt: now,
		title: "Aura – Sleep & Focus",
		versionId: auraVersion.id,
		whatsNew: "New soundscapes and stability improvements.",
	});

	log.info({ appId: aura.id }, "Seeded Aura – Sleep & Focus (light)");

	// ─────────────────────────────────────────────────────────────────────
	// APP 3 — Pulse – Workout Tracker (fully populated, stays ungrouped)
	// ─────────────────────────────────────────────────────────────────────
	const pulse = await ensurePulseGpApp(store.id);

	const ios = await ensureIosSection(workspaceId, cfg);
	const group = ios.luminaIosId
		? await ensureGroup(workspaceId, {
				iconBg: "6366f1",
				iconLabel: "Lumina",
				memberAppIds: [lumina.id, ios.luminaIosId],
				name: cfg.groupName,
				sortOrder: 0,
			})
		: { created: false, groupId: null };
	const auraGroup = ios.auraIosId
		? await ensureGroup(workspaceId, {
				iconBg: "0ea5e9",
				iconLabel: "Aura",
				memberAppIds: [aura.id, ios.auraIosId],
				name: cfg.auraGroupName,
				sortOrder: 1,
			})
		: { created: false, groupId: null };

	await ensureAiKey(workspaceId);

	log.info(
		{
			apps: "3× Google Play (Lumina, Aura, Pulse) + 3× App Store (iOS)",
			email: cfg.email,
			groups: `${cfg.groupName} + ${cfg.auraGroupName} (Pulse ungrouped)`,
			login: "http://localhost:6600/login (OTP: 123456)",
			workspaceId,
		},
		"✓ Demo data seeded",
	);

	return {
		auraGroupId: auraGroup.groupId,
		auraId: aura.id,
		auraIosId: ios.auraIosId,
		created: true,
		groupId: group.groupId,
		iosStoreId: ios.storeId,
		luminaId: lumina.id,
		luminaIosId: ios.luminaIosId,
		pulseId: pulse.id,
		pulseIosId: ios.pulseIosId,
		storeId: store.id,
		userId,
		workspaceId,
	};
}

// Auto-run only when executed directly (so tests can import seedDemo).
if (import.meta.main) {
	seedDemo()
		.then(() => process.exit(0))
		.catch((err) => {
			log.error(err, "Demo seed failed");
			process.exit(1);
		});
}
