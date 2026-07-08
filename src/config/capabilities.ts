export interface PlatformCapabilities {
	listings: {
		fields: string[];
		maxLengths: Record<string, number>;
	};
	publishing: {
		hasVersions: boolean;
		hasTracks: boolean;
		hasReviewSubmission: boolean;
	};
	ageRating: { supported: boolean };
	categories: { supported: boolean };
	privacy: { supported: boolean };
	reviews: { supported: boolean; canReply: boolean };
	assets: {
		types: string[];
		screenshotDevices: string[];
	};
}

const IOS_CAPABILITIES: PlatformCapabilities = {
	ageRating: { supported: true },
	assets: {
		screenshotDevices: ['iPhone 6.7"', 'iPhone 6.5"', 'iPad Pro 12.9"'],
		types: ["screenshot", "preview"],
	},
	categories: { supported: true },
	listings: {
		fields: [
			"title",
			"subtitle",
			"description",
			"keywords",
			"promotionalText",
			"whatsNew",
			"marketingUrl",
			"supportUrl",
		],
		maxLengths: {
			description: 4000,
			keywords: 100,
			marketingUrl: 1024,
			promotionalText: 170,
			subtitle: 30,
			supportUrl: 1024,
			title: 30,
			whatsNew: 4000,
		},
	},
	privacy: { supported: true },
	publishing: {
		hasReviewSubmission: true,
		hasTracks: false,
		hasVersions: true,
	},
	reviews: { canReply: true, supported: true },
};

const ANDROID_CAPABILITIES: PlatformCapabilities = {
	ageRating: { supported: false },
	assets: {
		screenshotDevices: ["phone", "sevenInch", "tenInch", "tv", "wear"],
		types: ["icon", "featureGraphic", "screenshot"],
	},
	categories: { supported: false },
	listings: {
		fields: ["title", "shortDescription", "fullDescription"],
		maxLengths: {
			fullDescription: 4000,
			shortDescription: 80,
			title: 30,
		},
	},
	privacy: { supported: false },
	publishing: {
		hasReviewSubmission: false,
		hasTracks: true,
		hasVersions: false,
	},
	reviews: { canReply: true, supported: true },
};

export function getCapabilities(platform: string): PlatformCapabilities {
	return platform === "ios" ? IOS_CAPABILITIES : ANDROID_CAPABILITIES;
}
