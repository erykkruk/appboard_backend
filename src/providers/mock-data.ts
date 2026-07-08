import type {
	AppData,
	AssetData,
	InAppPurchaseData,
	ListingData,
	ReviewData,
	SubscriptionGroupData,
} from "./store-provider";

export const MOCK_ANDROID_APPS: AppData[] = [
	{
		bundleId: "com.example.taskmaster",
		externalId: "com.example.taskmaster",
		iconUrl: "https://placehold.co/512x512?text=TM",
		name: "TaskMaster Pro",
		platform: "android",
	},
	{
		bundleId: "com.example.weathernow",
		externalId: "com.example.weathernow",
		iconUrl: "https://placehold.co/512x512?text=WN",
		name: "WeatherNow",
		platform: "android",
	},
	{
		bundleId: "com.example.fittrack",
		externalId: "com.example.fittrack",
		iconUrl: "https://placehold.co/512x512?text=FT",
		name: "FitTrack",
		platform: "android",
	},
];

export const MOCK_IOS_APPS: AppData[] = [
	{
		bundleId: "com.example.taskmaster",
		externalId: "1234567890",
		iconUrl: "https://placehold.co/512x512?text=TM",
		name: "TaskMaster Pro",
		platform: "ios",
	},
	{
		bundleId: "com.example.weathernow",
		externalId: "1234567891",
		iconUrl: "https://placehold.co/512x512?text=WN",
		name: "WeatherNow",
		platform: "ios",
	},
];

const LANGUAGES = ["en-US", "pl-PL", "de-DE"] as const;

function buildListings(appName: string): ListingData[] {
	const descriptions: Record<string, { full: string; short: string }> = {
		"de-DE": {
			full: `${appName} ist Ihre ultimative Produktivitaets-App. Verwalten Sie Aufgaben, verfolgen Sie Fortschritte und erreichen Sie Ihre Ziele mit Leichtigkeit. Entworfen fuer Profis und Teams, die intelligenter arbeiten moechten.`,
			short: `${appName} - Intelligent arbeiten`,
		},
		"en-US": {
			full: `${appName} is your ultimate productivity companion. Manage tasks, track progress, and achieve your goals with ease. Designed for professionals and teams who want to work smarter, not harder.\n\nFeatures:\n- Smart task management\n- Progress tracking\n- Team collaboration\n- Cross-platform sync`,
			short: `${appName} - Work smarter`,
		},
		"pl-PL": {
			full: `${appName} is your best productivity companion. Manage tasks, track progress and reach your goals with ease. Designed for professionals and teams who want to work smarter.`,
			short: `${appName} - Work smarter`,
		},
	};

	return LANGUAGES.map((lang) => ({
		fullDesc: descriptions[lang].full,
		keywords: `productivity,tasks,${appName.toLowerCase().replace(/\s+/g, "")}`,
		language: lang,
		promoText: `Try ${appName} today!`,
		shortDesc: descriptions[lang].short,
		title: appName,
		whatsNew: "Bug fixes and performance improvements.",
	}));
}

export function getMockListings(appExternalId: string): ListingData[] {
	const allApps = [...MOCK_ANDROID_APPS, ...MOCK_IOS_APPS];
	const app = allApps.find((a) => a.externalId === appExternalId);
	return buildListings(app?.name ?? "Demo App");
}

const _ASSET_TYPES = ["screenshot", "featureGraphic", "icon"] as const;
const _DEVICE_TYPES = ["phone", "tablet"] as const;

export function getMockAssets(
	appExternalId: string,
	language: string,
): AssetData[] {
	const assets: AssetData[] = [];
	const shortId = appExternalId.split(".").pop() ?? appExternalId;
	for (let i = 0; i < 8; i++) {
		const isTablet = i >= 4 && i < 6;
		const isPhone = i < 4;
		const deviceType = isPhone ? "phone" : isTablet ? "tenInch" : undefined;
		const assetType =
			i < 6 ? "screenshot" : i === 6 ? "featureGraphic" : "icon";
		assets.push({
			assetType,
			deviceType: deviceType ?? "phone",
			externalId: `${appExternalId}-${language}-asset-${i}`,
			fileSize: 256000 + i * 50000,
			height: isPhone ? 1920 : 2048,
			url: `https://placehold.co/${isPhone ? "1080x1920" : "2732x2048"}/1a1a1a/666?text=${shortId}+${i}`,
			width: isPhone ? 1080 : 2732,
		});
	}
	return assets;
}

const REVIEWER_NAMES = [
	"Alex Johnson",
	"Maria Garcia",
	"James Smith",
	"Yuki Tanaka",
	"Sarah Williams",
	"Mohammed Al-Rashid",
	"Emma Mueller",
	"Carlos Silva",
	"Anna Kowalska",
	"David Chen",
	"Sophie Martin",
	"Raj Patel",
	"Lisa Anderson",
	"Tom Brown",
	"Mika Virtanen",
	"Olga Petrova",
	"Hans Weber",
	"Fatima Hassan",
	"Lucas Dubois",
	"Nina Johansson",
];

const REVIEW_BODIES = [
	{
		body: "Amazing app! Really helps me stay organized.",
		rating: 5,
		title: "Great app!",
	},
	{
		body: "Good overall but crashes sometimes on older devices.",
		rating: 4,
		title: "Mostly good",
	},
	{
		body: "Interface is clean and easy to use. Love the dark mode.",
		rating: 5,
		title: "Beautiful design",
	},
	{
		body: "Needs more customization options.",
		rating: 3,
		title: "Could be better",
	},
	{
		body: "Not worth the price. Too many bugs.",
		rating: 2,
		title: "Disappointing",
	},
	{
		body: "Perfect for my daily workflow. Highly recommend!",
		rating: 5,
		title: "Must have",
	},
	{
		body: "Decent app but missing some features I need.",
		rating: 3,
		title: "Missing features",
	},
	{
		body: "Worst app ever. Deleted immediately.",
		rating: 1,
		title: "Terrible",
	},
	{
		body: "Regular updates show the devs care. Keep it up!",
		rating: 4,
		title: "Good support",
	},
	{
		body: "Works great on my phone. Tablet version needs work.",
		rating: 3,
		title: "Phone only",
	},
	{
		body: "Sync between devices is flawless.",
		rating: 5,
		title: "Seamless sync",
	},
	{
		body: "I use this every day. Cannot imagine life without it.",
		rating: 5,
		title: "Essential",
	},
	{
		body: "Had issues at first but latest update fixed everything.",
		rating: 4,
		title: "Getting better",
	},
	{
		body: "Simple and effective. Does exactly what it promises.",
		rating: 4,
		title: "Does the job",
	},
	{
		body: "Too complex for casual users.",
		rating: 2,
		title: "Overcomplicated",
	},
	{
		body: "Battery drain is noticeable when running in background.",
		rating: 3,
		title: "Battery hog",
	},
	{ body: "Love the widget support!", rating: 5, title: "Widgets!" },
	{
		body: "Ads are too intrusive in the free version.",
		rating: 2,
		title: "Too many ads",
	},
	{
		body: "Fast, reliable, and well-designed.",
		rating: 5,
		title: "Top quality",
	},
	{
		body: "Needs offline mode to be truly useful.",
		rating: 3,
		title: "Needs offline",
	},
];

export function getMockReviews(
	appExternalId: string,
	storeType: string,
): ReviewData[] {
	return REVIEW_BODIES.map((review, i) => {
		const daysAgo = i * 3 + Math.floor(i / 3);
		const reviewDate = new Date(Date.now() - daysAgo * 86400000);
		const hasReply = i % 4 === 0;
		return {
			appVersion: `${1 + Math.floor(i / 5)}.${i % 5}.0`,
			authorName: REVIEWER_NAMES[i],
			body: review.body,
			device: storeType === "google_play" ? "Pixel 8" : "iPhone 15",
			externalId: `${appExternalId}-review-${i}`,
			language: LANGUAGES[i % LANGUAGES.length],
			osVersion: storeType === "google_play" ? "Android 14" : "iOS 17.2",
			rating: review.rating,
			repliedAt: hasReply
				? new Date(reviewDate.getTime() + 86400000)
				: undefined,
			replyText: hasReply
				? "Thank you for your feedback! We appreciate your support."
				: undefined,
			reviewDate,
			territory: ["US", "PL", "DE"][i % 3],
			title: review.title,
		};
	});
}

export function getMockSubscriptionGroups(
	appExternalId: string,
): SubscriptionGroupData[] {
	const shortId = appExternalId.split(".").pop() ?? appExternalId;
	return [
		{
			externalId: `${appExternalId}-group-premium`,
			name: "Premium",
			subscriptions: [
				{
					duration: "P1M",
					externalId: `${appExternalId}-sub-monthly`,
					groupExternalId: `${appExternalId}-group-premium`,
					localizations: [
						{
							description: "Unlock all premium features with monthly access",
							language: "en-US",
							name: "Monthly Premium",
						},
						{
							description: "Unlock all premium features with monthly access",
							language: "pl-PL",
							name: "Monthly Premium",
						},
					],
					name: "Monthly Premium",
					prices: [
						{ currency: "USD", price: "4.99", territory: "US" },
						{ currency: "PLN", price: "19.99", territory: "PL" },
						{ currency: "EUR", price: "4.99", territory: "DE" },
					],
					productId: `${shortId}.premium.monthly`,
					productType: "auto_renewable",
					status: "approved",
				},
				{
					duration: "P1Y",
					externalId: `${appExternalId}-sub-yearly`,
					groupExternalId: `${appExternalId}-group-premium`,
					localizations: [
						{
							description:
								"Save 50% with yearly access to all premium features",
							language: "en-US",
							name: "Yearly Premium",
						},
						{
							description:
								"Save 50% with yearly access to all premium features",
							language: "pl-PL",
							name: "Yearly Premium",
						},
					],
					name: "Yearly Premium",
					prices: [
						{ currency: "USD", price: "29.99", territory: "US" },
						{ currency: "PLN", price: "119.99", territory: "PL" },
						{ currency: "EUR", price: "29.99", territory: "DE" },
					],
					productId: `${shortId}.premium.yearly`,
					productType: "auto_renewable",
					status: "approved",
				},
			],
		},
	];
}

export function getMockInAppPurchases(
	appExternalId: string,
): InAppPurchaseData[] {
	const shortId = appExternalId.split(".").pop() ?? appExternalId;
	return [
		{
			externalId: `${appExternalId}-iap-coins100`,
			localizations: [
				{
					description: "Get 100 coins to use in the app",
					language: "en-US",
					name: "100 Coins",
				},
				{
					description: "Get 100 coins to use in the app",
					language: "pl-PL",
					name: "100 Coins",
				},
			],
			name: "100 Coins",
			prices: [
				{ currency: "USD", price: "0.99", territory: "US" },
				{ currency: "PLN", price: "4.99", territory: "PL" },
				{ currency: "EUR", price: "0.99", territory: "DE" },
			],
			productId: `${shortId}.coins.100`,
			productType: "consumable",
			status: "approved",
		},
		{
			externalId: `${appExternalId}-iap-coins500`,
			localizations: [
				{
					description: "Get 500 coins to use in the app — best value!",
					language: "en-US",
					name: "500 Coins",
				},
				{
					description: "Get 500 coins to use in the app — best value!",
					language: "pl-PL",
					name: "500 Coins",
				},
			],
			name: "500 Coins",
			prices: [
				{ currency: "USD", price: "3.99", territory: "US" },
				{ currency: "PLN", price: "17.99", territory: "PL" },
				{ currency: "EUR", price: "3.99", territory: "DE" },
			],
			productId: `${shortId}.coins.500`,
			productType: "consumable",
			status: "approved",
		},
		{
			externalId: `${appExternalId}-iap-removeads`,
			localizations: [
				{
					description: "Remove all ads permanently",
					language: "en-US",
					name: "Remove Ads",
				},
				{
					description: "Remove all ads permanently",
					language: "pl-PL",
					name: "Remove Ads",
				},
			],
			name: "Remove Ads",
			prices: [
				{ currency: "USD", price: "2.99", territory: "US" },
				{ currency: "PLN", price: "12.99", territory: "PL" },
				{ currency: "EUR", price: "2.99", territory: "DE" },
			],
			productId: `${shortId}.removeads`,
			productType: "non_consumable",
			status: "approved",
		},
	];
}
