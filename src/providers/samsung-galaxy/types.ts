/** Credentials pasted in the panel: Seller Portal → Assistance → API Service. */
export interface SamsungCredentials {
	/** PEM-encoded PKCS#8 private key issued with the service account. */
	privateKey: string;
	serviceAccountId: string;
}

export interface SamsungAccessTokenResponse {
	accessToken?: string;
	errorCode?: string | null;
	errorMsg?: string | null;
}

export interface SamsungContentListItem {
	contentId: string;
	contentName?: string;
	contentStatus?: string;
}

/** Per-language listing data; note Samsung's lowercase `languagecode`. */
export interface SamsungLanguageEntry {
	appTitle?: string;
	description?: string;
	languagecode: string;
	newFeature?: string;
	screenshots?: unknown;
}

export interface SamsungContentInfo {
	addLanguage?: SamsungLanguageEntry[];
	appTitle?: string;
	contentId: string;
	contentStatus?: string;
	defaultLanguageCode?: string;
	longDescription?: string;
	newFeature?: string;
	paid?: string;
	publicationType?: string;
	screenshots?: unknown;
	shortDescription?: string;
	supportedLanguages?: unknown;
	youTubeURL?: string;
}

export interface SamsungUploadSession {
	sessionId?: string;
	url?: string;
}

export interface SamsungFileUploadResponse {
	errorCode?: string | null;
	errorMsg?: string | null;
	fileKey?: string;
	fileName?: string;
	fileSize?: string;
}

/** Screenshot reference as `contentUpdate` expects it. */
export interface SamsungScreenshotRef {
	reuseYn: "N" | "Y";
	screenshotKey: string;
}
