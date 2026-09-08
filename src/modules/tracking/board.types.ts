import type { KeywordClassification } from "@/modules/research/scoring-types";

/**
 * How many points a sparkline carries. Older measurements stay in the
 * database (and in the per-keyword chart endpoint); the board only needs
 * enough to show a direction without shipping a year of history per row.
 */
export const BOARD_TREND_POINTS = 30;

/** A keyword is worth chasing: winnable difficulty and real intent behind it. */
export const MAX_PICK_DIFFICULTY = 70;
export const PICK_CLASSIFICATIONS: ReadonlySet<KeywordClassification> = new Set(
	["sweet-spot", "good-target", "hidden-gem", "moderate"],
);

/** Listing fields whose text is indexed by the store and so can carry a term. */
export const METADATA_FIELDS = ["title", "subtitle", "keywords"] as const;
export type MetadataField = (typeof METADATA_FIELDS)[number];

/** The app sitting at the top of the keyword's search results. */
export interface BoardLeader {
	title: string;
	developer: string;
	ratingsCount: number | null;
	rating: number | null;
}

export interface BoardRankPoint {
	day: string;
	/** NULL means measured but outside the scanned depth, not position zero. */
	position: number | null;
}

export interface BoardScorePoint {
	day: string;
	difficulty: number;
	popularity: number | null;
}

export interface BoardKeyword {
	keyword: string;
	country: string;
	platform: string;
	// ── Where we stand ───────────────────────────────────────────────
	position: number | null;
	previousPosition: number | null;
	/** Positive = moved up. NULL when either measurement is missing. */
	delta: number | null;
	bestPosition: number | null;
	measuredAt: string | null;
	// ── What the term is worth ───────────────────────────────────────
	difficulty: number | null;
	difficultyLabel: string | null;
	/** Negative = the term got easier since the previous scored day. */
	difficultyDelta: number | null;
	popularity: number | null;
	opportunity: number | null;
	classification: KeywordClassification | null;
	scoredAt: string | null;
	// ── Context ──────────────────────────────────────────────────────
	rankTrend: BoardRankPoint[];
	scoreTrend: BoardScorePoint[];
	leader: BoardLeader | null;
	/** Listing fields this term already sits in, so metadata and ranking can be read together. */
	metadataFields: MetadataField[];
	pick: boolean;
}

/**
 * Entering and leaving the scanned depth are separate events on purpose:
 * "was outside the top 50, now #38" is not a numeric improvement of 12, and
 * printing it as one would invent a position we never measured.
 */
export type BoardMoveKind = "entered" | "dropped" | "moved" | "new";

export interface BoardMove {
	keyword: string;
	country: string;
	kind: BoardMoveKind;
	from: number | null;
	to: number | null;
	difficultyDelta: number | null;
}

/** One measurement run, as the scheduler (or a manual check) recorded it. */
export interface BoardRun {
	day: string;
	measured: number;
	ranked: number;
	top10: number;
	avgDifficulty: number | null;
}

export interface BoardChange {
	date: string;
	field: string;
	language: string;
	label: string;
	newValue: string | null;
	oldValue: string | null;
	type: string;
}

/** A term our own metadata targets while the store does not rank us for it. */
export interface BoardGap {
	keyword: string;
	fields: MetadataField[];
	difficulty: number | null;
	popularity: number | null;
}

export interface BoardStats {
	tracked: number;
	ranked: number;
	top10: number;
	picks: number;
	avgPosition: number | null;
	bestPosition: number | null;
	improved: number;
	declined: number;
	lastCheckedAt: string | null;
	lastScoredAt: string | null;
	runs: number;
}

export interface TrackingBoard {
	country: string;
	/** Every market this app has tracked keywords in, for the market switcher. */
	countries: string[];
	/** Listing language the metadata columns were read from. */
	language: string;
	stats: BoardStats;
	keywords: BoardKeyword[];
	movement: BoardMove[];
	runs: BoardRun[];
	changes: BoardChange[];
	metadataGap: BoardGap[];
	/** Metadata terms with no tracking at all - candidates for the tracked set. */
	metadataUntracked: string[];
}
