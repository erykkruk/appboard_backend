import type { ResearchRunReport } from "@/modules/research/research.types";
import type { MailMessage } from "@/utils/mailer";
import type { LatestPosition } from "./tracking.types";

const WRAP_START = `<div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #18181b;">`;
const WRAP_END = `<p style="color: #a1a1aa; font-size: 12px; margin-top: 32px;">Sent by AppBoard · you enabled this in the app's Research → Automation settings.</p></div>`;

const MAX_LIST_ITEMS = 5;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function bulletList(items: string[]): string {
	if (!items.length) return "";
	const lis = items
		.slice(0, MAX_LIST_ITEMS)
		.map((i) => `<li style="margin: 4px 0;">${escapeHtml(i)}</li>`)
		.join("");
	return `<ul style="padding-left: 20px; margin: 8px 0;">${lis}</ul>`;
}

function positionLabel(position: number | null): string {
	return position === null ? "—" : `#${position}`;
}

export class ReportService {
	static buildAutoResearchEmail(
		appTitle: string,
		report: ResearchRunReport,
	): MailMessage {
		const { analysis, heuristics, meta } = report;
		const rating =
			meta.rating !== undefined ? `${meta.rating.toFixed(2)}★` : "—";
		const negShare = `${Math.round(heuristics.negativeShare * 100)}%`;

		const sections: string[] = [
			`<h2 style="margin: 0 0 4px;">Research report — ${escapeHtml(appTitle)}</h2>`,
			`<p style="color: #71717a; margin: 0 0 16px;">${escapeHtml(meta.store)} · ${escapeHtml(meta.country.toUpperCase())} · ${rating} · ${report.reviewsCount} reviews analysed · ${negShare} negative</p>`,
		];

		if (analysis?.summary) {
			sections.push(
				`<p style="line-height: 1.5;">${escapeHtml(analysis.summary)}</p>`,
			);
		}
		if (analysis?.quickWins?.length) {
			sections.push(
				`<h3 style="margin: 16px 0 4px;">Quick wins</h3>${bulletList(analysis.quickWins)}`,
			);
		}
		if (analysis?.topIrritations?.length) {
			sections.push(
				`<h3 style="margin: 16px 0 4px;">Top complaints</h3>${bulletList(analysis.topIrritations)}`,
			);
		}
		if (heuristics.buckets.length) {
			const buckets = heuristics.buckets
				.slice(0, MAX_LIST_ITEMS)
				.map((b) => `${b.label} (${b.count})`);
			sections.push(
				`<h3 style="margin: 16px 0 4px;">Issue categories</h3>${bulletList(buckets)}`,
			);
		}
		if (report.keywords?.length) {
			const rows = report.keywords
				.map((k) => {
					const pos = k.appstore ?? k.playstore ?? null;
					return `<tr><td style="padding: 2px 12px 2px 0;">${escapeHtml(k.keyword)}</td><td style="padding: 2px 0; text-align: right;">${pos === null ? "—" : `#${pos}`}</td></tr>`;
				})
				.join("");
			sections.push(
				`<h3 style="margin: 16px 0 4px;">Keyword positions</h3><table style="border-collapse: collapse;">${rows}</table>`,
			);
		}

		const textParts = [
			`Research report — ${appTitle}`,
			`${meta.store} · ${meta.country.toUpperCase()} · ${rating} · ${report.reviewsCount} reviews · ${negShare} negative`,
		];
		if (analysis?.summary) textParts.push("", analysis.summary);
		if (analysis?.quickWins?.length) {
			textParts.push(
				"",
				"Quick wins:",
				...analysis.quickWins.slice(0, MAX_LIST_ITEMS).map((w) => `- ${w}`),
			);
		}

		return {
			html: `${WRAP_START}${sections.join("")}${WRAP_END}`,
			subject: `AppBoard — research report for ${appTitle}`,
			text: textParts.join("\n"),
			to: "",
		};
	}

	static buildRankDigest(
		appTitle: string,
		positions: LatestPosition[],
	): MailMessage {
		const rows = positions
			.map((p) => {
				const arrow =
					p.delta === null || p.delta === 0
						? ""
						: p.delta > 0
							? ` <span style="color: #16a34a;">▲${p.delta}</span>`
							: ` <span style="color: #dc2626;">▼${Math.abs(p.delta)}</span>`;
				return `<tr><td style="padding: 3px 12px 3px 0;">${escapeHtml(p.keyword)}</td><td style="padding: 3px 12px 3px 0; color: #71717a;">${escapeHtml(p.country.toUpperCase())}</td><td style="padding: 3px 0; text-align: right;">${positionLabel(p.position)}${arrow}</td></tr>`;
			})
			.join("");

		const html = `${WRAP_START}<h2 style="margin: 0 0 12px;">Daily rankings — ${escapeHtml(appTitle)}</h2><table style="border-collapse: collapse; width: 100%;"><thead><tr><th style="text-align: left; color: #a1a1aa; font-weight: 500; padding-bottom: 6px;">Keyword</th><th style="text-align: left; color: #a1a1aa; font-weight: 500;">Market</th><th style="text-align: right; color: #a1a1aa; font-weight: 500;">Position</th></tr></thead><tbody>${rows}</tbody></table>${WRAP_END}`;

		const text = [
			`Daily rankings — ${appTitle}`,
			...positions.map((p) => {
				const d =
					p.delta === null || p.delta === 0
						? ""
						: p.delta > 0
							? ` (up ${p.delta})`
							: ` (down ${Math.abs(p.delta)})`;
				return `${p.keyword} [${p.country.toUpperCase()}]: ${positionLabel(p.position)}${d}`;
			}),
		].join("\n");

		return {
			html,
			subject: `AppBoard — daily rankings for ${appTitle}`,
			text,
			to: "",
		};
	}
}
