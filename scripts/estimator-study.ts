/**
 * Popularity-estimator calibration study.
 *
 * Fits the popularity regression weights against Apple's OFFICIAL
 * searchPopularity1to100 values from the locally synced weekly dataset
 * (requires a connected Apple Ads workspace and at least one synced week -
 * see POST /api/apple-ads/sync). For each sampled term it fetches the live
 * iTunes competitor list, extracts the shared signal components
 * (popularitySignalComponents - the same extractor production uses) and
 * solves ordinary least squares; quality is reported on a holdout split.
 *
 * PRINT-ONLY: the script never touches the shipped weights. Update
 * POPULARITY_WEIGHTS in keyword-scoring.ts manually - and only when the
 * holdout metrics beat the current weights.
 *
 * Usage:
 *   bun run scripts/estimator-study.ts --country us [--sample 200] [--holdout 0.3]
 */
import { parseArgs } from "node:util";
import { and, eq } from "drizzle-orm";
import { appstoreKeywordSearch } from "@/modules/research/appstore.client";
import {
	POPULARITY_WEIGHTS,
	type PopularitySignals,
	popularitySignalComponents,
} from "@/modules/research/keyword-scoring";
import { db } from "@/utils/db";
import { appleDatasetWeeks, appleTopTerms } from "@/utils/db/schema";

const FEATURES = [
	"fResult",
	"fLeader",
	"fTitle",
	"fDepth",
	"fSpec",
	"fExact",
	"xTop1Exact",
	"xLeaderMag",
] as const;

const FETCH_DELAY_MS = 1_500;
const SEARCH_LIMIT = 25;

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		country: { default: "us", type: "string" },
		holdout: { default: "0.3", type: "string" },
		sample: { default: "200", type: "string" },
	},
});

/** Deterministic PRNG so runs are reproducible. */
function mulberry32(seed: number) {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Solve A x = b via Gaussian elimination with partial pivoting. */
function solve(matrix: number[][], vector: number[]): number[] {
	const n = vector.length;
	const a = matrix.map((row, i) => [...row, vector[i]]);
	for (let col = 0; col < n; col++) {
		let pivot = col;
		for (let row = col + 1; row < n; row++) {
			if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
		}
		[a[col], a[pivot]] = [a[pivot], a[col]];
		if (Math.abs(a[col][col]) < 1e-12) {
			throw new Error("Singular system - not enough signal variance");
		}
		for (let row = 0; row < n; row++) {
			if (row === col) continue;
			const factor = a[row][col] / a[col][col];
			for (let k = col; k <= n; k++) a[row][k] -= factor * a[col][k];
		}
	}
	return a.map((row, i) => row[n] / a[i][i]);
}

function spearman(a: number[], b: number[]): number {
	const rank = (xs: number[]) => {
		const sorted = xs
			.map((value, index) => ({ index, value }))
			.sort((p, q) => p.value - q.value);
		const ranks = new Array<number>(xs.length);
		sorted.forEach((entry, position) => {
			ranks[entry.index] = position;
		});
		return ranks;
	};
	return pearson(rank(a), rank(b));
}

function pearson(a: number[], b: number[]): number {
	const n = a.length;
	const meanA = a.reduce((s, v) => s + v, 0) / n;
	const meanB = b.reduce((s, v) => s + v, 0) / n;
	let cov = 0;
	let varA = 0;
	let varB = 0;
	for (let i = 0; i < n; i++) {
		cov += (a[i] - meanA) * (b[i] - meanB);
		varA += (a[i] - meanA) ** 2;
		varB += (b[i] - meanB) ** 2;
	}
	return cov / Math.sqrt(varA * varB);
}

function predict(
	weights: Record<string, number>,
	signals: PopularitySignals,
): number {
	let raw = weights.intercept;
	for (const f of FEATURES) raw += weights[f] * signals[f];
	return Math.max(1, Math.min(100, raw));
}

async function main() {
	const country = (values.country ?? "us").toLowerCase();
	const sampleSize = Number(values.sample);
	const holdoutShare = Number(values.holdout);

	const [weekRow] = await db
		.select({ week: appleDatasetWeeks.week })
		.from(appleDatasetWeeks)
		.where(
			and(
				eq(appleDatasetWeeks.country, country),
				eq(appleDatasetWeeks.status, "active"),
			),
		)
		.orderBy(appleDatasetWeeks.week)
		.limit(1);
	if (!weekRow) {
		console.error(
			`No active Apple dataset for '${country}'. Sync one first: POST /api/apple-ads/sync`,
		);
		process.exit(1);
	}

	const terms = await db
		.select({ popularity: appleTopTerms.popularity, term: appleTopTerms.term })
		.from(appleTopTerms)
		.where(
			and(
				eq(appleTopTerms.country, country),
				eq(appleTopTerms.week, weekRow.week),
			),
		);
	const random = mulberry32(42);
	const sampled = [...terms].sort(() => random() - 0.5).slice(0, sampleSize);
	console.log(
		`Study: ${sampled.length} terms from ${country.toUpperCase()} week ${weekRow.week}`,
	);

	const rows: Array<{ signals: PopularitySignals; y: number }> = [];
	for (const [index, { popularity, term }] of sampled.entries()) {
		if (index > 0) await Bun.sleep(FETCH_DELAY_MS);
		try {
			const competitors = await appstoreKeywordSearch(
				term,
				country,
				SEARCH_LIMIT,
			);
			const signals = popularitySignalComponents(competitors, term);
			if (signals) rows.push({ signals, y: popularity });
			process.stdout.write(
				`\r${index + 1}/${sampled.length} fetched (${rows.length} usable)`,
			);
		} catch {
			// Skip failed terms; the fit tolerates gaps.
		}
	}
	console.log();
	if (rows.length < 50) {
		console.error(`Only ${rows.length} usable rows - need at least 50.`);
		process.exit(1);
	}

	const splitAt = Math.floor(rows.length * (1 - holdoutShare));
	const train = rows.slice(0, splitAt);
	const holdout = rows.slice(splitAt);

	// Ordinary least squares via normal equations: X^T X w = X^T y.
	const dims = FEATURES.length + 1; // + intercept
	const xtx = Array.from({ length: dims }, () => new Array(dims).fill(0));
	const xty = new Array(dims).fill(0);
	for (const { signals, y } of train) {
		const x = [1, ...FEATURES.map((f) => signals[f])];
		for (let i = 0; i < dims; i++) {
			xty[i] += x[i] * y;
			for (let j = 0; j < dims; j++) xtx[i][j] += x[i] * x[j];
		}
	}
	const solved = solve(xtx, xty);
	const fitted: Record<string, number> = { intercept: solved[0] };
	FEATURES.forEach((f, i) => {
		fitted[f] = solved[i + 1];
	});

	const evaluate = (weights: Record<string, number>) => {
		const predictions = holdout.map(({ signals }) => predict(weights, signals));
		const actual = holdout.map(({ y }) => y);
		const mae =
			predictions.reduce((s, p, i) => s + Math.abs(p - actual[i]), 0) /
			predictions.length;
		return {
			mae,
			pearson: pearson(predictions, actual),
			spearman: spearman(predictions, actual),
		};
	};

	const current = evaluate(POPULARITY_WEIGHTS as Record<string, number>);
	const proposed = evaluate(fitted);

	console.log(`\nHoldout (${holdout.length} terms):`);
	console.log(
		`  current  weights: spearman ${current.spearman.toFixed(3)}, pearson ${current.pearson.toFixed(3)}, MAE ${current.mae.toFixed(1)}`,
	);
	console.log(
		`  proposed weights: spearman ${proposed.spearman.toFixed(3)}, pearson ${proposed.pearson.toFixed(3)}, MAE ${proposed.mae.toFixed(1)}`,
	);
	console.log("\nProposed POPULARITY_WEIGHTS (apply manually if better):");
	console.log(
		JSON.stringify(
			Object.fromEntries(
				Object.entries(fitted).map(([k, v]) => [k, Number(v.toFixed(4))]),
			),
			null,
			2,
		),
	);
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
