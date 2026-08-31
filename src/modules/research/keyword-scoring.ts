/**
 * Keyword scoring for App Store keyword research: popularity estimation,
 * difficulty scoring, opportunity/classification and download estimates.
 *
 * Everything here is pure math over the competitor list that the iTunes
 * Search API returns for a keyword - no network calls, no persistence.
 *
 * Methodology (signals, corrections and calibration anchors) is a
 * TypeScript reimplementation of the approach used by RespectASO
 * (github.com/respectlytics/respectaso, AGPL-3.0). The popularity weights
 * were fitted there against Apple's official searchPopularity1to100
 * dataset, so treat them as calibrated constants - do not hand-tune.
 */
import type {
	DownloadEstimates,
	KeywordClassification,
	KeywordCompetitor,
	KeywordDifficulty,
	KeywordDifficultyBreakdown,
	KeywordRankingTier,
	KeywordRankingTiers,
} from "./scoring-types";

// --------------------------------------------------------------------------
// Shared helpers
// --------------------------------------------------------------------------

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

function tokenize(text: string): string[] {
	// Unicode-aware word tokens (accented characters preserved).
	return (text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function median(values: number[]): number {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? sorted[mid]
		: (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function ageYears(releaseDate: string | undefined, now: Date): number | null {
	if (!releaseDate) return null;
	const released = new Date(releaseDate);
	if (Number.isNaN(released.getTime())) return null;
	return (now.getTime() - released.getTime()) / MS_PER_YEAR;
}

type Band = readonly [threshold: number, score: number];

/**
 * Interpolate a value onto a score curve defined by calibration bands.
 * Below the first band: linear ramp from 0. At/above the last band
 * threshold: `maxScore`. Between bands: log or linear interpolation.
 */
function interpolateBands(
	value: number,
	bands: readonly Band[],
	maxScore: number,
	scale: "log" | "linear" = "log",
): number {
	if (value <= 0) return 0;
	const last = bands[bands.length - 1];
	if (value >= last[0]) return maxScore;
	for (let i = 0; i < bands.length; i++) {
		const [threshold, score] = bands[i];
		if (value < threshold) {
			if (i === 0) return (value / threshold) * score;
			const [prevThreshold, prevScore] = bands[i - 1];
			const ratio =
				scale === "log"
					? Math.log(value / prevThreshold) /
						Math.log(threshold / prevThreshold)
					: (value - prevThreshold) / (threshold - prevThreshold);
			return prevScore + ratio * (score - prevScore);
		}
	}
	return maxScore;
}

// --------------------------------------------------------------------------
// Keyword-in-title evidence
// --------------------------------------------------------------------------

// Ambiguity guard: finance-intent keywords ("options", "call", "signals")
// must not gain strong relevance from unrelated apps whose titles happen to
// contain the same everyday words.
const FINANCE_INTENT_TOKENS = new Set([
	"option",
	"options",
	"trading",
	"trade",
	"stock",
	"stocks",
	"call",
	"put",
	"signal",
	"signals",
	"invest",
	"investing",
]);

const FINANCE_CONTEXT_TOKENS = new Set([
	"finance",
	"financial",
	"stock",
	"trading",
	"trade",
	"portfolio",
	"broker",
	"invest",
	"investing",
	"market",
	"futures",
	"derivative",
	"derivatives",
	"forex",
	"etf",
]);

const TOKEN_NORMALIZATION: Record<string, string> = {
	markets: "market",
	options: "option",
	signals: "signal",
	stocks: "stock",
};

function normalizedTokens(text: string): string[] {
	return tokenize(text).map((t) => TOKEN_NORMALIZATION[t] ?? t);
}

interface TitleEvidence {
	exactPhrase: boolean;
	allWords: boolean;
	evidence: number;
}

/** Match hierarchy: exact phrase > all words (any order) > partial overlap. */
function titleEvidence(
	keyword: string,
	title: string,
	genre: string,
): TitleEvidence {
	const kw = keyword.toLowerCase().trim();
	const titleLower = (title ?? "").toLowerCase();
	const kwTokens = new Set(normalizedTokens(kw));
	const titleTokenList = normalizedTokens(titleLower);
	const titleTokens = new Set(titleTokenList);

	if (!kwTokens.size || !titleTokens.size) {
		return { allWords: false, evidence: 0, exactPhrase: false };
	}

	let exactPhrase = kw.length > 0 && titleLower.includes(kw);
	let allWords = [...kwTokens].every((t) => titleTokens.has(t));
	let overlap =
		[...kwTokens].filter((t) => titleTokens.has(t)).length / kwTokens.size;

	// Proximity rewards compact all-word matches (reverse order still counts).
	let proximity = 0;
	if (allWords && kwTokens.size > 1) {
		const positions: number[] = [];
		for (const token of kwTokens) {
			const idx = titleTokenList.indexOf(token);
			if (idx !== -1) positions.push(idx);
		}
		if (positions.length) {
			const span = Math.max(
				1,
				Math.max(...positions) - Math.min(...positions) + 1,
			);
			proximity = Math.min(1, kwTokens.size / span);
		}
	}

	const financeIntent = [...kwTokens].some((t) => FINANCE_INTENT_TOKENS.has(t));
	const financeContext =
		(genre ?? "").toLowerCase().includes("finance") ||
		[...titleTokens].some((t) => FINANCE_CONTEXT_TOKENS.has(t));
	// A finance-intent keyword with no finance context carries no evidence at
	// all: strong matches are demoted first, then the remaining overlap is
	// zeroed (matching the reference implementation's sequential guards).
	if (financeIntent && !financeContext) {
		exactPhrase = false;
		allWords = false;
		overlap = 0;
	}

	let strongScore = 0;
	if (exactPhrase) strongScore = 1;
	else if (allWords) strongScore = 0.85 + 0.15 * proximity;
	const partialScore =
		!exactPhrase && !allWords && overlap > 0 ? Math.min(0.5, overlap * 0.5) : 0;

	return {
		allWords,
		evidence: Math.max(strongScore, partialScore),
		exactPhrase,
	};
}

// --------------------------------------------------------------------------
// Brand keyword detection
// --------------------------------------------------------------------------

const BRAND_STRONG_LEADER_REVIEWS = 1_000;
const BRAND_RUNNER_UP_MEDIAN_REVIEWS = 10_000;
const BRAND_RUNNER_UP_SAMPLE = 4;

/**
 * Detect whether a keyword is a brand/company name using search-result
 * signals only. Signal A (required): every keyword token appears in the #1
 * app's developer name. Signal B (weak leaders only): independent runner-ups
 * must have a median of 10K+ reviews, confirming Apple rank-boosted the
 * brand app rather than the keyword being genuinely weak.
 */
function detectBrandKeyword(
	keyword: string,
	competitors: KeywordCompetitor[],
): { isBrand: boolean; brandName: string | null } {
	const leader = competitors[0];
	if (!leader) return { brandName: null, isBrand: false };
	const kwTokens = new Set(normalizedTokens(keyword));
	const sellerTokens = new Set(normalizedTokens(leader.developer ?? ""));
	if (!kwTokens.size || !sellerTokens.size) {
		return { brandName: null, isBrand: false };
	}
	if (![...kwTokens].every((t) => sellerTokens.has(t))) {
		return { brandName: null, isBrand: false };
	}
	if ((leader.ratingsCount ?? 0) >= BRAND_STRONG_LEADER_REVIEWS) {
		return { brandName: leader.developer, isBrand: true };
	}
	const leaderSeller = (leader.developer ?? "").trim().toLowerCase();
	const independent = competitors
		.slice(1)
		.filter((c) => (c.developer ?? "").trim().toLowerCase() !== leaderSeller)
		.slice(0, BRAND_RUNNER_UP_SAMPLE);
	if (!independent.length) return { brandName: null, isBrand: false };
	const runnerMedian = median(independent.map((c) => c.ratingsCount ?? 0));
	if (runnerMedian < BRAND_RUNNER_UP_MEDIAN_REVIEWS) {
		return { brandName: null, isBrand: false };
	}
	return { brandName: leader.developer, isBrand: true };
}

// --------------------------------------------------------------------------
// Popularity estimator
// --------------------------------------------------------------------------

// Regression weights fitted against Apple's official searchPopularity1to100
// values (US dataset + below-top-terms negatives). Calibrated constants -
// never hand-tune; refit against fresh official data instead.
export const POPULARITY_WEIGHTS = {
	fDepth: 2.9001,
	fExact: -0.338,
	fLeader: -1.9714,
	fResult: 1.0404,
	fSpec: 0.8644,
	fTitle: 0.6129,
	intercept: 3.6672,
	xLeaderMag: 8.1524,
	xTop1Exact: 2.1709,
} as const;

const LEADER_BANDS: readonly Band[] = [
	[10, 1],
	[100, 5],
	[1_000, 10],
	[10_000, 17],
	[100_000, 24],
	[1_000_000, 30],
];

const DEPTH_BANDS: readonly Band[] = [
	[10, 0.5],
	[100, 3],
	[1_000, 5],
	[10_000, 8],
	[50_000, 10],
];

// Long-tail penalty: [wordCount, penalty] points, linear in between.
const SPECIFICITY_POINTS: readonly Band[] = [
	[1, 0],
	[2, -3],
	[3, -8],
	[4, -15],
	[5, -22],
	[6, -28],
];

const RESULT_SCORE_PER_APP = 2.5;
const RESULT_SCORE_MAX = 25;
const TITLE_SCORE_MAX = 20;
const TITLE_SCORE_RATIO_MULT = 40;
const EXACT_BONUS_MAX = 15;
const EXACT_BONUS_RATIO_MULT = 50;
const FULL_SAMPLE_SIZE = 10;
const RELEVANCE_FLOOR = 0.3;
const RELEVANCE_RATIO_MULT = 2.6;
const EXACT_LEADER_TOP_N = 5;

/** Observable signal components feeding the popularity regression. */
export interface PopularitySignals {
	fDepth: number;
	fExact: number;
	fLeader: number;
	fResult: number;
	fSpec: number;
	fTitle: number;
	xLeaderMag: number;
	xTop1Exact: number;
}

/**
 * The ONLY feature extractor for popularity - shared by estimatePopularity
 * and the calibration study script (scripts/estimator-study.ts), so fitted
 * weights and shipped code can never drift apart.
 */
export function popularitySignalComponents(
	competitors: KeywordCompetitor[],
	keyword: string,
): PopularitySignals | null {
	if (!competitors.length) return null;
	const n = competitors.length;
	const kw = keyword.toLowerCase().trim();
	const wordCount = kw ? kw.split(/\s+/).length : 1;

	// Signal 1: result count - broader/more popular topics fill up.
	let resultScore = Math.min(RESULT_SCORE_MAX, n * RESULT_SCORE_PER_APP);

	// Signal 2: leader strength - strongest app in the top half (tail apps
	// are often backfill from broader terms).
	const topHalf = competitors.slice(0, Math.max(Math.floor(n / 2), 1));
	const maxReviews = Math.max(...topHalf.map((c) => c.ratingsCount ?? 0));
	let leaderScore = interpolateBands(maxReviews, LEADER_BANDS, 30);

	// Signal 3: title match density + strongest exact-match leader.
	let titleMatches = 0;
	let exactMatches = 0;
	let relevanceSum = 0;
	let bestExactReviews = 0;
	competitors.forEach((c, index) => {
		const ev = titleEvidence(kw, c.title, c.genre ?? "");
		relevanceSum += ev.evidence;
		if (ev.exactPhrase) {
			titleMatches++;
			exactMatches++;
			if (index < EXACT_LEADER_TOP_N) {
				bestExactReviews = Math.max(bestExactReviews, c.ratingsCount ?? 0);
			}
		} else if (ev.allWords) {
			titleMatches++;
		}
	});
	let titleScore = Math.min(
		TITLE_SCORE_MAX,
		(titleMatches / n) * TITLE_SCORE_RATIO_MULT,
	);

	// Signal 4: market depth - median review count.
	let depthScore = interpolateBands(
		median(competitors.map((c) => c.ratingsCount ?? 0)),
		DEPTH_BANDS,
		10,
	);

	// Signal 5: long-tail specificity penalty.
	let specificityPenalty = -28;
	if (wordCount <= 1) specificityPenalty = 0;
	else if (wordCount < 6) {
		for (let i = 0; i < SPECIFICITY_POINTS.length - 1; i++) {
			const [loW, loV] = SPECIFICITY_POINTS[i];
			const [hiW, hiV] = SPECIFICITY_POINTS[i + 1];
			if (wordCount >= loW && wordCount <= hiW) {
				specificityPenalty =
					loV + ((wordCount - loW) / (hiW - loW)) * (hiV - loV);
				break;
			}
		}
	}

	// Signal 6: exact-phrase ratio - the keyword itself is a known term.
	let exactBonus = Math.min(
		EXACT_BONUS_MAX,
		(exactMatches / n) * EXACT_BONUS_RATIO_MULT,
	);

	// Small-sample dampening for ratio signals.
	const sampleDampening = Math.min(1, n / FULL_SAMPLE_SIZE);
	titleScore *= sampleDampening;
	exactBonus *= sampleDampening;

	// Backfill-aware dampening: when few titles carry the keyword, Apple
	// padded the results - volume signals count at reduced weight.
	const relevance = clamp(
		(relevanceSum / n) * RELEVANCE_RATIO_MULT,
		RELEVANCE_FLOOR,
		1,
	);
	resultScore *= relevance;
	leaderScore *= relevance;
	depthScore *= relevance;

	return {
		fDepth: depthScore,
		fExact: exactBonus,
		fLeader: leaderScore,
		fResult: resultScore,
		fSpec: specificityPenalty,
		fTitle: titleScore,
		xLeaderMag: Math.log10(1 + maxReviews),
		xTop1Exact: Math.log10(1 + bestExactReviews),
	};
}

/**
 * Estimate keyword search popularity (1-100, Apple's scale) from the
 * competitor landscape. Core insight: keywords with real search volume
 * attract strong, keyword-optimized apps.
 */
export function estimatePopularity(
	competitors: KeywordCompetitor[],
	keyword: string,
): number | null {
	const signals = popularitySignalComponents(competitors, keyword);
	if (!signals) return null;
	const w = POPULARITY_WEIGHTS;
	const raw =
		w.intercept +
		w.fResult * signals.fResult +
		w.fLeader * signals.fLeader +
		w.fTitle * signals.fTitle +
		w.fDepth * signals.fDepth +
		w.fSpec * signals.fSpec +
		w.fExact * signals.fExact +
		w.xTop1Exact * signals.xTop1Exact +
		w.xLeaderMag * signals.xLeaderMag;

	return Math.round(clamp(raw, 1, 100));
}

// --------------------------------------------------------------------------
// Difficulty calculator
// --------------------------------------------------------------------------

const RATING_VOLUME_BANDS: readonly Band[] = [
	[50, 5],
	[200, 15],
	[500, 30],
	[2_000, 50],
	[5_000, 65],
	[10_000, 78],
	[25_000, 88],
	[100_000, 95],
];

const VELOCITY_BANDS: readonly Band[] = [
	[10, 5],
	[50, 15],
	[200, 30],
	[1_000, 50],
	[5_000, 70],
	[20_000, 85],
	[50_000, 95],
];

const QUALITY_BANDS: readonly Band[] = [
	[3.0, 20],
	[3.5, 35],
	[4.0, 50],
	[4.3, 70],
	[4.5, 85],
	[5.0, 100],
];

const MARKET_AGE_BANDS: readonly Band[] = [
	[0.5, 10],
	[1, 20],
	[2, 35],
	[3, 50],
	[5, 70],
	[8, 85],
	[10, 100],
];

const DIFFICULTY_WEIGHTS = {
	dominantPlayers: 0.2,
	marketAge: 0.1,
	publisherDiversity: 0.1,
	ratingQuality: 0.1,
	ratingVolume: 0.3,
	reviewVelocity: 0.1,
	titleRelevance: 0.1,
} as const;

const DOMINANCE_LOG_CEILING = Math.log10(10_000_000);
const TOP_HALF_WEIGHT = 2;
const MIN_APP_AGE_YEARS = 0.5;
const DEFAULT_MID_SCORE = 50;

// Post-processing constants (Apple "generic backfill" corrections).
const SMALL_RESULT_CAPS: Record<number, number> = {
	1: 10,
	2: 20,
	3: 31,
	4: 40,
};
const WEAK_LEADER_REVIEWS = 1_000;
const WEAK_LEADER_CAP_BASE = 15;
const WEAK_LEADER_CAP_RANGE = 35;
const WEAK_LEADER_LOG_DIVISOR = Math.log10(1_001);
const BACKFILL_MATCH_RATIO = 0.2;
const BACKFILL_DISCOUNT_FLOOR = 0.6;
const BACKFILL_RATIO_MULT = 2.0;

const DIFFICULTY_LABELS: ReadonlyArray<readonly [number, string]> = [
	[15, "very-easy"],
	[35, "easy"],
	[55, "moderate"],
	[75, "hard"],
	[90, "very-hard"],
];

export function difficultyLabel(score: number): string {
	for (const [max, label] of DIFFICULTY_LABELS) {
		if (score <= max) return label;
	}
	return "extreme";
}

interface RawDifficulty {
	raw: number;
	ratingVolume: number;
	reviewVelocity: number;
	dominantPlayers: number;
	ratingQuality: number;
	marketAge: number;
	publisherDiversity: number;
	titleRelevance: number;
	titleMatchCount: number;
	medianReviews: number;
	avgReviews: number;
	relevanceSum: number;
}

function computeRawDifficulty(
	competitors: KeywordCompetitor[],
	keyword: string,
	now: Date,
	fullResultCount?: number,
): RawDifficulty {
	const n = competitors.length;
	if (n === 0) {
		return {
			avgReviews: 0,
			dominantPlayers: 0,
			marketAge: 0,
			medianReviews: 0,
			publisherDiversity: 0,
			ratingQuality: 0,
			ratingVolume: 0,
			raw: 0,
			relevanceSum: 0,
			reviewVelocity: 0,
			titleMatchCount: 0,
			titleRelevance: 0,
		};
	}
	const kw = keyword.toLowerCase().trim();
	const ratingCounts = competitors.map((c) => c.ratingsCount ?? 0);
	const medianReviews = median(ratingCounts);
	const avgReviews = ratingCounts.reduce((a, b) => a + b, 0) / n;

	// Rating volume (30%): log-scale of the MEDIAN review count.
	const ratingVolume = interpolateBands(
		medianReviews,
		RATING_VOLUME_BANDS,
		100,
	);

	// Review velocity (10%): median reviews-per-year - active vs stagnant.
	const velocities: number[] = [];
	for (const c of competitors) {
		const age = ageYears(c.released, now);
		const reviews = c.ratingsCount ?? 0;
		if (age !== null && reviews > 0) {
			velocities.push(reviews / Math.max(MIN_APP_AGE_YEARS, age));
		}
	}
	const reviewVelocity = velocities.length
		? interpolateBands(median(velocities), VELOCITY_BANDS, 100)
		: DEFAULT_MID_SCORE;

	// Dominant players (20%): continuous log dominance, top half weighted 2x.
	const topHalfSize = Math.max(Math.floor(n / 2), 1);
	let dominanceTotal = 0;
	ratingCounts.forEach((r, i) => {
		if (r <= 0) return;
		const dominance = Math.min(
			1,
			Math.log10(Math.max(r, 1)) / DOMINANCE_LOG_CEILING,
		);
		dominanceTotal += dominance * (i < topHalfSize ? TOP_HALF_WEIGHT : 1);
	});
	const weightSum =
		TOP_HALF_WEIGHT * topHalfSize + Math.max(n - topHalfSize, 0);
	let dominantPlayers = Math.min(
		100,
		(dominanceTotal / Math.max(weightSum, 1)) * 100,
	);

	// Rating quality (10%): review-weighted average star rating.
	let weightedSum = 0;
	let weightTotal = 0;
	for (const c of competitors) {
		const rating = c.rating ?? 0;
		const reviews = c.ratingsCount ?? 0;
		if (rating > 0 && reviews > 0) {
			const w = Math.log1p(reviews);
			weightedSum += rating * w;
			weightTotal += w;
		}
	}
	const avgQuality = weightTotal > 0 ? weightedSum / weightTotal : 0;
	let ratingQuality = interpolateBands(
		avgQuality,
		QUALITY_BANDS,
		100,
		"linear",
	);

	// Market age (10%): older markets are more entrenched.
	const ages = competitors
		.map((c) => ageYears(c.released, now))
		.filter((a): a is number => a !== null);
	let marketAge = ages.length
		? interpolateBands(
				ages.reduce((a, b) => a + b, 0) / ages.length,
				MARKET_AGE_BANDS,
				100,
				"linear",
			)
		: DEFAULT_MID_SCORE;

	// Publisher diversity (10%).
	const publishers = new Set(
		competitors.map((c) => (c.developer ?? "").toLowerCase()).filter(Boolean),
	);
	let publisherDiversity = Math.min(100, (publishers.size / n) * 100);

	// Title relevance (10%): strong matches only.
	let titleMatchCount = 0;
	let relevanceSum = 0;
	for (const c of competitors) {
		const ev = titleEvidence(kw, c.title, c.genre ?? "");
		relevanceSum += ev.evidence;
		if (ev.exactPhrase || ev.allWords) titleMatchCount++;
	}
	let titleRelevance = Math.min(100, (titleMatchCount / n) * 100);

	// Small-sample dampening: ratio sub-scores are unreliable with few
	// results. Uses the FULL result count so tier slices inherit dampening
	// from keyword popularity, not the deliberate slice size.
	const dampeningN = fullResultCount ?? n;
	const sampleDampening = Math.min(1, dampeningN / FULL_SAMPLE_SIZE);
	publisherDiversity *= sampleDampening;
	titleRelevance *= sampleDampening;
	dominantPlayers *= sampleDampening;
	ratingQuality *= sampleDampening;

	// Backfill-aware dampening: sub-scores computed on padded results mislead.
	const relevance = clamp(
		(relevanceSum / n) * RELEVANCE_RATIO_MULT,
		RELEVANCE_FLOOR,
		1,
	);
	publisherDiversity *= relevance;
	ratingQuality *= relevance;
	marketAge *= relevance;

	const w = DIFFICULTY_WEIGHTS;
	const raw = clamp(
		Math.floor(
			ratingVolume * w.ratingVolume +
				reviewVelocity * w.reviewVelocity +
				dominantPlayers * w.dominantPlayers +
				ratingQuality * w.ratingQuality +
				marketAge * w.marketAge +
				publisherDiversity * w.publisherDiversity +
				titleRelevance * w.titleRelevance,
		),
		1,
		100,
	);

	return {
		avgReviews: Math.round(avgReviews),
		dominantPlayers,
		marketAge,
		medianReviews: Math.round(medianReviews),
		publisherDiversity,
		ratingQuality,
		ratingVolume,
		raw,
		relevanceSum,
		reviewVelocity,
		titleMatchCount,
		titleRelevance,
	};
}

function weakLeaderCap(leaderReviews: number): number {
	return Math.floor(
		WEAK_LEADER_CAP_BASE +
			(WEAK_LEADER_CAP_RANGE * Math.log10(leaderReviews + 1)) /
				WEAK_LEADER_LOG_DIVISOR,
	);
}

function applyBackfillCorrections(
	score: number,
	leaderReviews: number,
	matchRatio: number,
	isBrand: boolean,
): { score: number; overrideReason: "weakLeader" | "backfill" | null } {
	let total = score;
	let overrideReason: "weakLeader" | "backfill" | null = null;

	// Weak leader cap: the #1 app's strength is the ultimate reality check.
	// Blend with matchRatio - many title matches mean real competition with
	// no dominant player yet, so the cap bites less.
	if (leaderReviews < WEAK_LEADER_REVIEWS && !isBrand) {
		const cap = weakLeaderCap(leaderReviews);
		if (total > cap) {
			total =
				matchRatio > BACKFILL_MATCH_RATIO
					? Math.floor(cap + (total - cap) * matchRatio)
					: cap;
			overrideReason = "weakLeader";
		}
	}

	// Backfill discount: few title matches AND a weak leader means most
	// results are generic backfill from broader terms.
	if (
		matchRatio < BACKFILL_MATCH_RATIO &&
		leaderReviews < WEAK_LEADER_REVIEWS &&
		!isBrand
	) {
		const ratioFactor = Math.min(
			1,
			BACKFILL_DISCOUNT_FLOOR + BACKFILL_RATIO_MULT * matchRatio,
		);
		const leaderFactor =
			Math.log10(leaderReviews + 1) / WEAK_LEADER_LOG_DIVISOR;
		const discount = clamp(
			ratioFactor + (1 - ratioFactor) * leaderFactor,
			BACKFILL_DISCOUNT_FLOOR,
			1,
		);
		const discounted = Math.max(1, Math.floor(total * discount));
		if (discounted < total) {
			total = discounted;
			overrideReason = "backfill";
		}
	}

	return { overrideReason, score: total };
}

const FRESH_ENTRANT_MAX_AGE_YEARS = 1;
const WEAK_APP_REVIEWS = 1_000;
const TIER_SIZES: ReadonlyArray<readonly [keyof KeywordRankingTiers, number]> =
	[
		["top5", 5],
		["top10", 10],
		["top20", 20],
	];

function computeTiers(
	competitors: KeywordCompetitor[],
	keyword: string,
	now: Date,
	overallScore: number,
	overallMatchRatio: number,
	overallLeaderReviews: number,
	isBrand: boolean,
): KeywordRankingTiers {
	const fullN = competitors.length;
	const tiers = {} as Record<keyof KeywordRankingTiers, KeywordRankingTier>;

	for (const [name, size] of TIER_SIZES) {
		const tierApps = competitors.slice(0, size);
		const n = tierApps.length;
		if (n === 0) {
			tiers[name] = {
				freshCount: 0,
				label: "easy",
				medianReviews: 0,
				minReviews: 0,
				tierScore: 0,
				titleKeywordCount: 0,
				totalApps: 0,
				weakCount: 0,
				weakestApp: null,
			};
			continue;
		}

		// Same algorithm as the overall score, on the tier slice, then the
		// same keyword-level backfill corrections (using OVERALL context) so
		// tiers can never contradict the overall assessment.
		const sub = computeRawDifficulty(tierApps, keyword, now, fullN);
		let tierScore = sub.raw;
		if (keyword.trim() && fullN >= 2) {
			tierScore = applyBackfillCorrections(
				tierScore,
				overallLeaderReviews,
				overallMatchRatio,
				isBrand,
			).score;
		}
		tierScore = clamp(tierScore, 1, 100);

		const reviews = tierApps.map((c) => c.ratingsCount ?? 0);
		const minReviews = Math.min(...reviews);
		const freshCount = tierApps.filter((c) => {
			const age = ageYears(c.released, now);
			return age !== null && age < FRESH_ENTRANT_MAX_AGE_YEARS;
		}).length;

		tiers[name] = {
			freshCount,
			label: difficultyLabel(tierScore),
			medianReviews: Math.round(median(reviews)),
			minReviews,
			tierScore,
			titleKeywordCount: sub.titleMatchCount,
			totalApps: n,
			weakCount: reviews.filter((r) => r < WEAK_APP_REVIEWS).length,
			weakestApp: tierApps[reviews.indexOf(minReviews)]?.title ?? null,
		};
	}

	// Floor: breaking into any tier is at least as hard as competing at all.
	for (const [name] of TIER_SIZES) {
		if (tiers[name].totalApps > 0 && tiers[name].tierScore < overallScore) {
			tiers[name].tierScore = overallScore;
		}
	}
	// Monotonicity: larger tiers (more slots) can never be harder.
	if (tiers.top10.tierScore > tiers.top5.tierScore) {
		tiers.top10.tierScore = tiers.top5.tierScore;
	}
	if (tiers.top20.tierScore > tiers.top10.tierScore) {
		tiers.top20.tierScore = tiers.top10.tierScore;
	}
	for (const [name] of TIER_SIZES) {
		if (tiers[name].totalApps > 0) {
			tiers[name].label = difficultyLabel(tiers[name].tierScore);
		}
	}

	return tiers;
}

/**
 * Calculate keyword difficulty (1-100) with sub-score breakdown, backfill
 * corrections, brand detection and Top 5/10/20 ranking tiers.
 */
export function calculateDifficulty(
	competitors: KeywordCompetitor[],
	keyword: string,
	now: Date = new Date(),
): KeywordDifficulty {
	const emptyBreakdown: KeywordDifficultyBreakdown = {
		avgReviews: 0,
		brandName: null,
		dominantPlayers: 0,
		isBrandKeyword: false,
		marketAge: 0,
		medianReviews: 0,
		overrideReason: null,
		publisherDiversity: 0,
		ratingQuality: 0,
		ratingVolume: 0,
		rawTotal: 0,
		reviewVelocity: 0,
		titleMatchCount: 0,
		titleRelevance: 0,
	};
	if (!competitors.length) {
		return {
			breakdown: emptyBreakdown,
			label: "no-data",
			score: 0,
			tiers: computeTiers([], keyword, now, 0, 0, 0, false),
		};
	}

	const n = competitors.length;
	const kw = keyword.toLowerCase().trim();
	const sub = computeRawDifficulty(competitors, keyword, now);
	let total = sub.raw;
	let overrideReason: KeywordDifficultyBreakdown["overrideReason"] = null;

	const leaderReviews = competitors[0].ratingsCount ?? 0;
	const matchRatio = sub.titleMatchCount / n;
	const { brandName, isBrand } = kw
		? detectBrandKeyword(kw, competitors)
		: { brandName: null, isBrand: false };

	// Small result set cap: very few results = objectively little
	// competition, and ratio sub-scores are statistically meaningless.
	const smallCap = SMALL_RESULT_CAPS[n];
	if (smallCap !== undefined && total > smallCap) {
		total = smallCap;
		overrideReason = "smallResultSet";
	}

	if (kw && n >= 2) {
		const corrected = applyBackfillCorrections(
			total,
			leaderReviews,
			matchRatio,
			isBrand,
		);
		total = corrected.score;
		overrideReason = corrected.overrideReason ?? overrideReason;
	}
	total = clamp(total, 1, 100);

	const round1 = (v: number) => Math.round(v * 10) / 10;
	return {
		breakdown: {
			avgReviews: sub.avgReviews,
			brandName,
			dominantPlayers: round1(sub.dominantPlayers),
			isBrandKeyword: isBrand,
			marketAge: round1(sub.marketAge),
			medianReviews: sub.medianReviews,
			overrideReason,
			publisherDiversity: round1(sub.publisherDiversity),
			ratingQuality: round1(sub.ratingQuality),
			ratingVolume: round1(sub.ratingVolume),
			rawTotal: sub.raw,
			reviewVelocity: round1(sub.reviewVelocity),
			titleMatchCount: sub.titleMatchCount,
			titleRelevance: round1(sub.titleRelevance),
		},
		label: difficultyLabel(total),
		score: total,
		tiers: computeTiers(
			competitors,
			keyword,
			now,
			total,
			matchRatio,
			leaderReviews,
			isBrand,
		),
	};
}

// --------------------------------------------------------------------------
// Opportunity + classification
// --------------------------------------------------------------------------

// Popularity -> estimated daily searches (US baseline). Anchored to Apple's
// official top-terms dataset: reported terms start around 500 searches/week
// (~70/day) at the observed popularity floor of ~40; above the anchor the
// curve grows log-linearly (~15%/point).
const POP_TO_SEARCHES: readonly Band[] = [
	[1, 1],
	[20, 35],
	[39, 65],
	[40, 70],
	[45, 140],
	[50, 280],
	[55, 570],
	[60, 1_150],
	[65, 2_300],
	[70, 4_600],
	[75, 9_300],
	[80, 19_000],
	[85, 38_000],
	[90, 76_000],
	[95, 152_000],
	[100, 300_000],
];

// Normalizes volume so that the curve's maximum (pop 100 = 300K daily
// searches) maps to volume 1.0.
const OPPORTUNITY_VOLUME_NORM = Math.log10(1 + 300_000);

function popToSearches(popularity: number): number {
	if (popularity <= 0) return 0;
	const pts = POP_TO_SEARCHES;
	if (popularity <= pts[0][0]) return pts[0][1] * (popularity / pts[0][0]);
	const last = pts[pts.length - 1];
	if (popularity >= last[0]) return last[1];
	for (let i = 1; i < pts.length; i++) {
		const [p1, s1] = pts[i];
		if (popularity <= p1) {
			const [p0, s0] = pts[i - 1];
			return s0 + ((popularity - p0) / (p1 - p0)) * (s1 - s0);
		}
	}
	return last[1];
}

/**
 * Opportunity score (0-100): log-normalized search volume gated by a
 * quadratic difficulty penalty. Difficulty 100 always yields 0.
 */
export function calcOpportunity(
	popularity: number | null,
	difficulty: number,
): number {
	if (!popularity || popularity <= 0) return 0;
	const searches = popToSearches(popularity);
	if (searches <= 0) return 0;
	const volume = Math.log10(1 + searches) / OPPORTUNITY_VOLUME_NORM;
	const gate = 1 - (difficulty / 100) ** 2;
	return clamp(Math.floor(volume * gate * 100), 0, 100);
}

const SWEET_SPOT_MIN_POP = 40;
const SWEET_SPOT_MAX_DIFF = 40;
const HIDDEN_GEM_MIN_POP = 25;
const HIDDEN_GEM_MAX_DIFF = 30;
const HIDDEN_GEM_MIN_OPP = 30;
const LOW_VOLUME_MAX_POP = 15;
const HIGH_COMPETITION_MIN_DIFF = 65;
const GOOD_TARGET_MIN_OPP = 55;
const AVOID_MAX_OPP = 25;

/** Single source of truth for keyword targeting classification. */
export function classifyKeyword(
	popularity: number | null,
	difficulty: number,
): KeywordClassification {
	if (popularity === null) return "unknown";
	const opp = calcOpportunity(popularity, difficulty);
	if (popularity >= SWEET_SPOT_MIN_POP && difficulty <= SWEET_SPOT_MAX_DIFF) {
		return "sweet-spot";
	}
	if (
		popularity >= HIDDEN_GEM_MIN_POP &&
		popularity < SWEET_SPOT_MIN_POP &&
		difficulty <= HIDDEN_GEM_MAX_DIFF &&
		opp >= HIDDEN_GEM_MIN_OPP
	) {
		return "hidden-gem";
	}
	if (popularity < LOW_VOLUME_MAX_POP) return "low-volume";
	if (difficulty >= HIGH_COMPETITION_MIN_DIFF) return "high-competition";
	if (opp >= GOOD_TARGET_MIN_OPP) return "good-target";
	if (opp <= AVOID_MAX_OPP) return "avoid";
	return "moderate";
}

// --------------------------------------------------------------------------
// Download estimator
// --------------------------------------------------------------------------

// Position -> organic tap-through rate. Power-law decay: positions 1-5 sit
// on the first screen, the tail requires scrolling.
const TTR_BY_POSITION: readonly number[] = [
	0.3, 0.18, 0.12, 0.085, 0.06, 0.045, 0.033, 0.025, 0.019, 0.013, 0.009, 0.007,
	0.0055, 0.0042, 0.0033, 0.0025, 0.0019, 0.0014, 0.001, 0.0007,
];

// Tap -> install conversion range for free apps: unknown indie with a weak
// listing vs an established category leader.
const CVR_LOW = 0.05;
const CVR_HIGH = 0.2;

// Search volume scale relative to the US storefront (active iPhone base).
const MARKET_SIZE: Record<string, number> = {
	ae: 0.04,
	ar: 0.03,
	at: 0.04,
	au: 0.12,
	be: 0.04,
	br: 0.18,
	ca: 0.15,
	ch: 0.06,
	cl: 0.03,
	cn: 0.45,
	co: 0.03,
	de: 0.25,
	dk: 0.04,
	eg: 0.03,
	es: 0.1,
	fi: 0.03,
	fr: 0.22,
	gb: 0.3,
	gh: 0.02,
	id: 0.05,
	ie: 0.03,
	il: 0.04,
	in: 0.15,
	it: 0.12,
	jp: 0.35,
	ke: 0.02,
	kr: 0.2,
	mx: 0.1,
	my: 0.04,
	ng: 0.03,
	nl: 0.07,
	no: 0.04,
	nz: 0.03,
	ph: 0.04,
	pk: 0.02,
	pl: 0.05,
	pt: 0.03,
	ru: 0.12,
	sa: 0.04,
	se: 0.06,
	sg: 0.04,
	th: 0.05,
	tr: 0.05,
	tw: 0.08,
	tz: 0.02,
	ug: 0.02,
	us: 1.0,
	za: 0.03,
};
const MARKET_SIZE_DEFAULT = 0.03;

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Estimate daily downloads per ranking position (1-20) as low-high ranges:
 * downloads = searches x TTR(position) x CVR.
 */
export function estimateDownloads(
	popularity: number | null,
	country: string,
): DownloadEstimates {
	const marketMult =
		MARKET_SIZE[(country || "us").toLowerCase()] ?? MARKET_SIZE_DEFAULT;
	const searches = popToSearches(popularity ?? 0) * marketMult;

	const positions = TTR_BY_POSITION.map((ttr, i) => ({
		high: round2(searches * ttr * CVR_HIGH),
		low: round2(searches * ttr * CVR_LOW),
		position: i + 1,
		ttr: round2(ttr * 100),
	}));

	const tierAvg = (start: number, end: number) => {
		const subset = positions.slice(start - 1, end);
		return {
			high: round2(subset.reduce((a, p) => a + p.high, 0) / subset.length),
			low: round2(subset.reduce((a, p) => a + p.low, 0) / subset.length),
		};
	};

	return {
		dailySearches: round2(searches),
		positions,
		tiers: {
			top5: tierAvg(1, 5),
			top6to10: tierAvg(6, 10),
			top11to20: tierAvg(11, 20),
		},
	};
}
