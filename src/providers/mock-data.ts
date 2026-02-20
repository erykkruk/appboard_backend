import type {
	AppData,
	AssetData,
	ListingData,
	ReviewData,
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
			full: `${appName} to Twoj najlepszy towarzysz produktywnosci. Zarzadzaj zadaniami, sledz postepy i osiagaj cele z latwoscia. Zaprojektowany dla profesjonalistow i zespolow, ktorzy chca pracowac madrzej.`,
			short: `${appName} - Pracuj madrzej`,
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
	for (let i = 0; i < 8; i++) {
		assets.push({
			assetType: i < 6 ? "screenshot" : i === 6 ? "featureGraphic" : "icon",
			deviceType: i < 4 ? "phone" : "tablet",
			externalId: `${appExternalId}-${language}-asset-${i}`,
			fileSize: 256000 + i * 50000,
			height: i < 4 ? 1920 : 2048,
			url: `https://placehold.co/1080x1920?text=${appExternalId}-${language}-${i}`,
			width: i < 4 ? 1080 : 2732,
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
