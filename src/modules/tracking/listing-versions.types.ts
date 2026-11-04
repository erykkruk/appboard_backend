/** The listing text a store indexes for search. NULL = not known. */
export interface ListingText {
	keywords: string | null;
	subtitle: string | null;
	title: string | null;
}

/** What was live in the store for one listing language at one moment. */
export interface ListingState extends ListingText {
	language: string | null;
	versionReleasedAt: Date | null;
	versionString: string | null;
}

export type ListingTextField = keyof ListingText;

/** Group key of measurements whose store version is not known. */
export const UNKNOWN_VERSION_KEY = "unknown";

/** One distinct listing text seen while a store version was live. */
export interface ByVersionListing extends ListingText {
	firstSeenAt: string;
	id: string;
	inferred: boolean;
	language: string | null;
	lastSeenAt: string;
}

export interface ByVersionColumn {
	/** Text fields that differ from the previous (older) version's listing. */
	changedFields: ListingTextField[];
	/** True when every measurement here was attributed afterwards (backfill). */
	inferred: boolean;
	/** `versionString`, or UNKNOWN_VERSION_KEY. */
	key: string;
	/** Newest listing text seen under this version (NULL fields = unknown). */
	listing: ListingText | null;
	/** Every distinct listing text seen under this version, oldest first. */
	listings: ByVersionListing[];
	/** First and last measurement taken while this version was live. */
	measuredFrom: string;
	measuredTo: string;
	measurements: number;
	releasedAt: string | null;
	versionString: string | null;
}

export interface ByVersionCell {
	/** Best (lowest) position measured while the version was live. */
	best: number | null;
	/**
	 * Positions gained vs the previous version's last measurement (positive =
	 * moved up). NULL when either side was not ranked or not measured.
	 */
	delta: number | null;
	/** Position of the last measurement under this version; NULL = not ranked. */
	last: number | null;
	measurements: number;
	/** Measurements that found the app in the scanned results. */
	ranked: number;
}

export interface ByVersionKeyword {
	/** Cells keyed by ByVersionColumn.key; a missing key = never measured then. */
	cells: Record<string, ByVersionCell>;
	keyword: string;
	starred: boolean;
	tracked: boolean;
}

export interface RankByVersion {
	country: string;
	keywords: ByVersionKeyword[];
	/** Newest version first. */
	versions: ByVersionColumn[];
}
