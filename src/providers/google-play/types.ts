export interface GooglePlayCredentials {
	client_email?: string;
	mock?: boolean;
	package_names?: string[];
	private_key?: string;
	private_key_id?: string;
	project_id?: string;
	type?: string;
}

export function isMockCredentials(creds: GooglePlayCredentials): boolean {
	return creds.type === "mock" || creds.mock === true;
}

/** Maps our generic asset types to Google Play image types */
export const GOOGLE_PLAY_IMAGE_TYPES = [
	"featureGraphic",
	"icon",
	"phoneScreenshots",
	"sevenInchScreenshots",
	"tenInchScreenshots",
	"tvBanner",
	"tvScreenshots",
	"wearScreenshots",
] as const;

export type GooglePlayImageType = (typeof GOOGLE_PLAY_IMAGE_TYPES)[number];

/** Maps our generic device types to Google Play screenshot image types */
export const DEVICE_TO_IMAGE_TYPE: Record<string, GooglePlayImageType> = {
	phone: "phoneScreenshots",
	sevenInch: "sevenInchScreenshots",
	tablet: "tenInchScreenshots",
	tv: "tvScreenshots",
	wear: "wearScreenshots",
};

/** Maps Google Play image types back to our generic device types */
export const IMAGE_TYPE_TO_DEVICE: Record<string, string> = {
	phoneScreenshots: "phone",
	sevenInchScreenshots: "sevenInch",
	tenInchScreenshots: "tablet",
	tvScreenshots: "tv",
	wearScreenshots: "wear",
};

/** Maps Google Play image types to our generic asset types */
export const IMAGE_TYPE_TO_ASSET: Record<string, string> = {
	featureGraphic: "featureGraphic",
	icon: "icon",
	phoneScreenshots: "screenshot",
	sevenInchScreenshots: "screenshot",
	tenInchScreenshots: "screenshot",
	tvBanner: "tvBanner",
	tvScreenshots: "screenshot",
	wearScreenshots: "screenshot",
};
