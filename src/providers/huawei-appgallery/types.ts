/** Credentials pasted in the panel: AGC Console → Users and permissions → API client. */
export interface HuaweiCredentials {
	clientId: string;
	clientSecret: string;
	/**
	 * AGC has no "list all my apps" endpoint — apps are looked up by package
	 * name. Collected during connect (or added later) so `fetchApps` has
	 * something to resolve.
	 */
	packageNames?: string[];
}

/** Every AGC response carries this; `code: 0` means success. */
export interface AgcRet {
	code: number;
	msg?: string;
}

export interface AgcTokenResponse {
	access_token?: string;
	expires_in?: number;
	ret?: AgcRet;
}

export interface AgcAppIdListResponse {
	appids?: Array<{ key: string; value: string }>;
	ret?: AgcRet;
}

/** Subset of AGC `LanguageInfo` we map onto `ListingData`. */
export interface AgcLanguageInfo {
	appDesc?: string;
	appName?: string;
	briefInfo?: string;
	introPic?: string;
	lang: string;
	newFeatures?: string;
	showType?: number;
}

export interface AgcAppInfoResponse {
	appInfo?: {
		defaultLang?: string;
		releaseState?: number;
	};
	languages?: AgcLanguageInfo[];
	ret?: AgcRet;
}
