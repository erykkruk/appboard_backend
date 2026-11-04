import type { TrackingMarket } from "@/modules/tracking/tracking.types";
import type { MailMessage } from "@/utils/mailer";
import {
	type DailySummary,
	type DailySummaryApp,
	type DailySummaryTotals,
	SUMMARY_IDEAS_LIMIT,
	SUMMARY_MARKETS_LIMIT,
	SUMMARY_MOVERS_LIMIT,
	SUMMARY_RESEARCH_TEXT_LIMIT,
	SUMMARY_STARRED_LIMIT,
	type SummaryMarket,
	type SummaryMover,
	type SummaryStarred,
} from "./daily-summary.types";

const WRAP_START = `<div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #18181b;">`;
const WRAP_END = `<p style="color: #a1a1aa; font-size: 12px; margin-top: 32px;">Sent by AppBoard. You turned on the daily summary in Automations, it replaces the per-app rank digests and research reports.</p></div>`;
const MUTED = "color: #71717a;";
const UP = "color: #16a34a;";
const DOWN = "color: #dc2626;";

/**
 * Text from stores and models can carry typographic characters; the mail
 * itself stays plain ASCII punctuation.
 */
export function asciiText(value: string): string {
	return value
		.replace(/[\u2013\u2014\u2015]/g, "-")
		.replace(/[\u2018\u2019\u201A]/g, "'")
		.replace(/[\u201C\u201D\u201E]/g, '"')
		.replace(/\u2026/g, "...")
		.replace(/[\u00A0\u202F]/g, " ")
		.replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "");
}

function escapeHtml(value: string): string {
	return asciiText(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function truncate(value: string, limit: number): string {
	const clean = asciiText(value).replace(/\s+/g, " ").trim();
	if (clean.length <= limit) return clean;
	const cut = clean.slice(0, limit);
	const lastSpace = cut.lastIndexOf(" ");
	return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trim()}...`;
}

/** Biggest moves since each keyword's previous check, brand terms excluded. */
export function pickMovers(
	positions: SummaryMover[],
	isBrand: (keyword: string) => boolean,
	limit = SUMMARY_MOVERS_LIMIT,
): { drops: SummaryMover[]; gains: SummaryMover[] } {
	const moved = positions.filter(
		(p) => p.delta !== null && p.delta !== 0 && !isBrand(p.keyword),
	);
	const byPosition = (a: SummaryMover, b: SummaryMover) =>
		(a.position ?? Number.MAX_SAFE_INTEGER) -
		(b.position ?? Number.MAX_SAFE_INTEGER);
	const gains = moved
		.filter((p) => (p.delta ?? 0) > 0)
		.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0) || byPosition(a, b))
		.slice(0, limit);
	const drops = moved
		.filter((p) => (p.delta ?? 0) < 0)
		.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0) || byPosition(a, b))
		.slice(0, limit);
	return { drops, gains };
}

/**
 * Starred keywords: how many, how many on the first page, and the ones worth a
 * look (moved first, biggest move first, then best position).
 */
export function starredSummary(
	positions: SummaryMover[],
	starredKeys: Set<string>,
	limit = SUMMARY_STARRED_LIMIT,
): SummaryStarred | null {
	if (!starredKeys.size) return null;
	const starred = positions.filter((p) =>
		starredKeys.has(`${p.country}|${p.keyword}`),
	);
	const moved = starred
		.filter((p) => p.delta !== null && p.delta !== 0)
		.sort(
			(a, b) =>
				Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) ||
				(a.position ?? Number.MAX_SAFE_INTEGER) -
					(b.position ?? Number.MAX_SAFE_INTEGER),
		)
		.slice(0, limit);
	return {
		moved,
		top10: starred.filter((p) => p.position !== null && p.position <= 10)
			.length,
		total: starredKeys.size,
	};
}

/** Top markets by first-page keywords, then ranked keywords, then median. */
export function strongestMarkets(
	markets: Array<
		Pick<
			TrackingMarket,
			"country" | "earnedMedianPosition" | "earnedRanked" | "earnedTop10"
		>
	>,
	limit = SUMMARY_MARKETS_LIMIT,
): SummaryMarket[] {
	return markets
		.filter((m) => m.earnedRanked > 0)
		.sort(
			(a, b) =>
				b.earnedTop10 - a.earnedTop10 ||
				b.earnedRanked - a.earnedRanked ||
				(a.earnedMedianPosition ?? Number.MAX_SAFE_INTEGER) -
					(b.earnedMedianPosition ?? Number.MAX_SAFE_INTEGER) ||
				a.country.localeCompare(b.country),
		)
		.slice(0, limit)
		.map((m) => ({
			country: m.country,
			medianPosition: m.earnedMedianPosition,
			ranked: m.earnedRanked,
			top10: m.earnedTop10,
		}));
}

export function summarizeTotals(apps: DailySummaryApp[]): DailySummaryTotals {
	return apps.reduce<DailySummaryTotals>(
		(sum, app) => ({
			apps: sum.apps + 1,
			declined: sum.declined + app.declined,
			improved: sum.improved + app.improved,
			ranked: sum.ranked + app.ranked,
			top10: sum.top10 + app.top10,
			tracked: sum.tracked + app.tracked,
		}),
		{ apps: 0, declined: 0, improved: 0, ranked: 0, top10: 0, tracked: 0 },
	);
}

function formatDay(date: Date, timezone: string): string {
	return new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "short",
		timeZone: timezone,
		weekday: "short",
	}).format(date);
}

function formatShortDay(date: Date, timezone: string): string {
	return new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "short",
		timeZone: timezone,
	}).format(date);
}

function storeLabel(app: DailySummaryApp): string {
	const store = app.platform === "ios" ? "App Store" : "Google Play";
	return app.devices.includes("tv") ? `${store}, TV` : store;
}

function plural(count: number, one: string, many = `${one}s`): string {
	return `${count} ${count === 1 ? one : many}`;
}

function positionLabel(position: number | null): string {
	return position === null ? "out" : `#${position}`;
}

function signed(delta: number): string {
	return delta > 0 ? `+${delta}` : `${delta}`;
}

function moverText(m: SummaryMover): string {
	const delta = m.delta === null ? "" : ` (${signed(m.delta)})`;
	return `${asciiText(m.keyword)} [${m.country.toUpperCase()}] ${positionLabel(m.previousPosition)} -> ${positionLabel(m.position)}${delta}`;
}

function moverHtml(m: SummaryMover): string {
	const delta =
		m.delta === null
			? ""
			: m.delta > 0
				? ` <span style="${UP}">&#9650;${m.delta}</span>`
				: ` <span style="${DOWN}">&#9660;${Math.abs(m.delta)}</span>`;
	return `${escapeHtml(m.keyword)} <span style="${MUTED}">${escapeHtml(m.country.toUpperCase())}</span> ${positionLabel(m.position)}${delta}`;
}

function marketText(m: SummaryMarket): string {
	const median =
		m.medianPosition === null ? "" : `, median #${m.medianPosition}`;
	return `${m.country.toUpperCase()} ${m.top10} in top 10 / ${m.ranked} ranked${median}`;
}

function movementText(app: DailySummaryApp): string {
	const parts = [`${app.improved} up`, `${app.declined} down`];
	if (app.entered) parts.push(`${app.entered} new in results`);
	if (app.dropped) parts.push(`${app.dropped} out of results`);
	return parts.join(", ");
}

/** The 2-3 research lines, shared by the HTML and plain-text bodies. */
function researchLines(app: DailySummaryApp, timezone: string): string[] {
	const r = app.research;
	if (!r) return [];
	const stats = [`${plural(r.reviewsCount, "review")} analysed`];
	if (r.rating !== null) stats.unshift(`rating ${r.rating.toFixed(2)}`);
	if (r.negativeShare !== null) {
		stats.push(`${Math.round(r.negativeShare * 100)}% negative`);
	}
	const lines = [
		`Auto-research ${formatShortDay(r.at, timezone)}, ${r.country.toUpperCase()}: ${stats.join(", ")}.`,
	];
	if (r.ideasScored !== null) {
		const where =
			r.ideaMarkets === null ? "" : ` in ${plural(r.ideaMarkets, "market")}`;
		const best = r.topIdeas
			.slice(0, SUMMARY_IDEAS_LIMIT)
			.map(
				(i) =>
					`${asciiText(i.keyword)} [${i.country.toUpperCase()}] ${Math.round(i.opportunity)}`,
			);
		lines.push(
			`${plural(r.ideasScored, "new keyword idea")} scored${where}.${best.length ? ` Best by opportunity: ${best.join(", ")}.` : ""}`,
		);
	}
	if (r.summary) lines.push(truncate(r.summary, SUMMARY_RESEARCH_TEXT_LIMIT));
	return lines;
}

function appText(app: DailySummaryApp, timezone: string): string[] {
	const lines = [`${asciiText(app.name)} (${storeLabel(app)})`];
	if (!app.rankTrackingSupported) {
		lines.push("Rankings cannot be measured for this store record.");
	} else {
		lines.push(
			`Tracked ${app.tracked}, ranked ${app.ranked}, top 10: ${app.top10} (without the app name).`,
		);
		if (app.lastCheckedAt) {
			lines.push(
				`Since the previous check: ${movementText(app)}. Last check ${formatShortDay(app.lastCheckedAt, timezone)}.`,
			);
		}
		if (app.gains.length) {
			lines.push("Gains:", ...app.gains.map((m) => `  ${moverText(m)}`));
		}
		if (app.drops.length) {
			lines.push("Drops:", ...app.drops.map((m) => `  ${moverText(m)}`));
		}
		if (app.starred) {
			lines.push(
				`Starred: ${app.starred.top10} of ${app.starred.total} in top 10${app.starred.moved.length ? "" : ", no movement"}.`,
				...app.starred.moved.map((m) => `  ${moverText(m)}`),
			);
		}
		if (app.strongestMarkets.length) {
			lines.push(
				`Strongest markets: ${app.strongestMarkets.map(marketText).join("; ")}.`,
			);
		}
	}
	lines.push(...researchLines(app, timezone));
	lines.push(`Dashboard: ${app.dashboardUrl}`);
	return lines;
}

function listHtml(title: string, items: string[]): string {
	if (!items.length) return "";
	const lis = items.map((i) => `<li style="margin: 2px 0;">${i}</li>`).join("");
	return `<p style="margin: 10px 0 2px; font-weight: 600;">${title}</p><ul style="padding-left: 18px; margin: 0;">${lis}</ul>`;
}

function appHtml(app: DailySummaryApp, timezone: string): string {
	const parts = [
		`<h3 style="margin: 0 0 2px;">${escapeHtml(app.name)}</h3>`,
		`<p style="${MUTED} margin: 0 0 8px; font-size: 13px;">${escapeHtml(storeLabel(app))}</p>`,
	];
	if (!app.rankTrackingSupported) {
		parts.push(
			`<p style="margin: 4px 0;">Rankings cannot be measured for this store record.</p>`,
		);
	} else {
		parts.push(
			`<p style="margin: 4px 0;"><strong>${app.tracked}</strong> tracked &middot; <strong>${app.ranked}</strong> ranked &middot; <strong>${app.top10}</strong> in top 10 <span style="${MUTED} font-size: 13px;">(without the app name)</span></p>`,
		);
		if (app.lastCheckedAt) {
			parts.push(
				`<p style="${MUTED} margin: 4px 0; font-size: 13px;">Since the previous check: ${escapeHtml(movementText(app))}. Last check ${escapeHtml(formatShortDay(app.lastCheckedAt, timezone))}.</p>`,
			);
		}
		parts.push(listHtml("Gains", app.gains.map(moverHtml)));
		parts.push(listHtml("Drops", app.drops.map(moverHtml)));
		if (app.starred) {
			const title = `Starred: ${app.starred.top10} of ${app.starred.total} in top 10${app.starred.moved.length ? "" : ", no movement"}`;
			parts.push(
				app.starred.moved.length
					? listHtml(escapeHtml(title), app.starred.moved.map(moverHtml))
					: `<p style="margin: 10px 0 2px; font-weight: 600;">${escapeHtml(title)}</p>`,
			);
		}
		if (app.strongestMarkets.length) {
			parts.push(
				`<p style="margin: 10px 0 2px;"><strong>Strongest markets:</strong> ${escapeHtml(app.strongestMarkets.map(marketText).join("; "))}</p>`,
			);
		}
	}
	const research = researchLines(app, timezone);
	if (research.length) {
		parts.push(
			`<p style="margin: 10px 0 2px; line-height: 1.45;">${research.map(escapeHtml).join("<br>")}</p>`,
		);
	}
	parts.push(
		`<p style="margin: 10px 0 0;"><a href="${escapeHtml(app.dashboardUrl)}" style="color: #2563eb;">Open the dashboard</a></p>`,
	);
	return `<div style="border-top: 1px solid #e4e4e7; padding: 16px 0;">${parts.join("")}</div>`;
}

function headerText(summary: DailySummary): string {
	const t = summary.totals;
	return `${plural(t.apps, "app")}: ${t.tracked} keywords tracked, ${t.ranked} ranked, ${t.top10} in top 10. Since the previous check: ${t.improved} up, ${t.declined} down.`;
}

/**
 * One morning email for the whole workspace: totals first, then each app's
 * rankings, movers, starred keywords, strongest markets and latest
 * auto-research. Pure: the data is collected by DailySummaryService.
 */
export function buildDailySummaryEmail(
	summary: DailySummary,
): Omit<MailMessage, "to"> {
	const day = formatDay(summary.generatedAt, summary.timezone);
	const title = `Daily summary, ${day}`;
	const html = [
		WRAP_START,
		`<h2 style="margin: 0 0 6px;">${escapeHtml(title)}</h2>`,
		`<p style="${MUTED} margin: 0 0 12px;">${escapeHtml(headerText(summary))}</p>`,
		...summary.apps.map((app) => appHtml(app, summary.timezone)),
		WRAP_END,
	].join("");
	const text = [
		`AppBoard daily summary, ${day}`,
		headerText(summary),
		...summary.apps.flatMap((app) => ["", ...appText(app, summary.timezone)]),
		"",
		"You get this because the daily summary is on in Automations. It replaces the per-app rank digests and research reports.",
	].join("\n");
	return {
		html,
		subject: `AppBoard daily summary, ${day}: ${summary.totals.top10} in top 10 across ${plural(summary.totals.apps, "app")}`,
		text,
	};
}
