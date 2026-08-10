/** Credentials pasted in the panel: Amazon Developer Console → Security Profile. */
export interface AmazonCredentials {
	clientId: string;
	clientSecret: string;
	/**
	 * The App Submission API has no "list my apps" endpoint — every path is
	 * rooted at an app id / package name, so the connection carries them.
	 */
	packageNames?: string[];
}

export interface AmazonTokenResponse {
	access_token?: string;
	expires_in?: number;
	token_type?: string;
}

export interface AmazonEdit {
	id: string;
	status?: string;
}

/** `ListingResource` from the App Submission API OpenAPI spec. */
export interface AmazonListing {
	featureBullets?: string[];
	fullDescription?: string;
	keywords?: string[];
	language: string;
	recentChanges?: string;
	shortDescription?: string;
	title?: string;
}

export interface AmazonListingsResponse {
	listings?: Record<string, AmazonListing> | AmazonListing[];
}

export interface AmazonImage {
	id: string;
}

export interface AmazonAssetResource {
	image?: AmazonImage;
	images?: AmazonImage[];
}
