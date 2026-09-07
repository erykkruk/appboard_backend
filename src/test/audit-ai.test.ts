import { afterAll, describe, expect, it } from "bun:test";
import { AIService } from "@/modules/ai/ai.service";
import type { AppAuditReport } from "@/modules/audit/audit.types";
import { AuditAiService } from "@/modules/audit/audit-ai.service";

const realComplete = AIService.complete;
const realResolveApiKey = AIService.resolveApiKey;

const REPORT: AppAuditReport = {
	ai: null,
	appId: "app-1",
	country: "pl",
	draft: null,
	keywords: [],
	keywordsSupported: true,
	language: "pl",
	measuredAt: new Date().toISOString(),
	recommendable: ["teleturniej"],
	store: { asoScore: 82, issues: [], strengths: [], themes: [] },
};

const LISTING = {
	country: "pl",
	description: "Gra imprezowa na telewizor.",
	genre: "Games",
	name: "Buzzin: TV Party Game Show",
	screenshots: 6,
};

describe("audit AI review", () => {
	afterAll(() => {
		AIService.complete = realComplete;
		AIService.resolveApiKey = realResolveApiKey;
	});

	it("returns null without a key and never calls the model", async () => {
		let called = false;
		AIService.resolveApiKey = async () => null;
		AIService.complete = async () => {
			called = true;
			return { content: "{}", model: "x" };
		};
		expect(await AuditAiService.analyze("ws", REPORT, LISTING)).toBeNull();
		expect(called).toBe(false);
	});

	it("parses fenced JSON, uses the research model and enforces store limits", async () => {
		let purpose: string | undefined;
		AIService.resolveApiKey = async () => "sk-or-test";
		AIService.complete = async (_ws, _system, _user, options) => {
			purpose = options?.purpose;
			return {
				content: [
					"```json",
					JSON.stringify({
						priorities: [
							{
								how: "Add it to the subtitle",
								title: "Use teleturniej",
								why: "popularity 36, difficulty 18",
							},
							{ how: "b", title: "2", why: "b" },
							{ how: "c", title: "3", why: "c" },
							{ how: "d", title: "4", why: "d" },
							{ how: "e", title: "5 - one too many", why: "e" },
						],
						rewrites: {
							keywords: "teleturniej,quiz,wieczor",
							opening: "Wlacz telewizor, kazdy bierze telefon.",
							subtitle: "This subtitle is far longer than thirty characters",
							title: "Buzzin: Teleturniej",
						},
						summary: "  Put teleturniej in the subtitle first.  ",
					}),
					"```",
				].join("\n"),
				model: "anthropic/claude-sonnet-5",
			};
		};
		const ai = await AuditAiService.analyze("ws", REPORT, LISTING);
		expect(purpose).toBe("research");
		expect(ai?.model).toBe("anthropic/claude-sonnet-5");
		expect(ai?.language).toBe("pl");
		expect(ai?.summary).toBe("Put teleturniej in the subtitle first.");
		expect(ai?.priorities).toHaveLength(4);
		expect(ai?.rewrites.title).toBe("Buzzin: Teleturniej");
		// Over the 30-character subtitle limit: dropped, not truncated mid-word.
		expect(ai?.rewrites.subtitle).toBeNull();
		expect(ai?.rewrites.keywords).toBe("teleturniej,quiz,wieczor");
	});

	it("returns null on content that is not the expected JSON", async () => {
		AIService.resolveApiKey = async () => "sk-or-test";
		AIService.complete = async () => ({
			content: "Sure! Here is my review...",
			model: "m",
		});
		expect(await AuditAiService.analyze("ws", REPORT, LISTING)).toBeNull();
		AIService.complete = async () => ({
			content: '{"summary": 1}',
			model: "m",
		});
		expect(await AuditAiService.analyze("ws", REPORT, LISTING)).toBeNull();
	});
});
