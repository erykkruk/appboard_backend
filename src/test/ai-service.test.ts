import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { AIService } from "@/modules/ai/ai.service";
import { getTestWorkspaceId } from "./setup";

type Completion = { content: string; model: string };
type ModelCall = { system: string; user: string; purpose: string };

/**
 * The service reaches OpenRouter through one private static; tests replace
 * it, capture the prompts and answer with a canned completion.
 */
const seam = AIService as unknown as {
	callOpenRouter: (
		workspaceId: string,
		system: string,
		user: string,
		purpose: string,
	) => Promise<Completion>;
};
const realCall = seam.callOpenRouter;
/** A well-formed id with no ASO profile behind it. */
const APP_ID = crypto.randomUUID();
let calls: ModelCall[] = [];
let answer = "";

function stubModel(content: string) {
	answer = content;
	calls = [];
}

describe("AI service prompts and parsing", () => {
	const workspaceId = getTestWorkspaceId();

	beforeAll(() => {
		seam.callOpenRouter = async (_ws, system, user, purpose) => {
			calls.push({ purpose, system, user });
			return { content: answer, model: "test/model" };
		};
	});

	afterAll(() => {
		seam.callOpenRouter = realCall;
	});

	describe("suggestKeywords", () => {
		it("keeps competitor names out of the listing keywords and reports them separately", async () => {
			stubModel(
				[
					"Here you go:",
					"```json",
					JSON.stringify({
						category: ["productivity"],
						competitors: ["Notion", "Evernote"],
						feature: ["note taking", "voice memo"],
						longTail: ["quick notes offline"],
						problem: ["forget ideas"],
					}),
					"```",
				].join("\n"),
			);
			const result = await AIService.suggestKeywords(
				workspaceId,
				"Jot",
				"Capture ideas fast.",
				"Productivity",
				["notes"],
				{ language: "pl", platform: "android" },
			);
			expect(result.keywords).toEqual([
				"productivity",
				"note taking",
				"voice memo",
				"quick notes offline",
				"forget ideas",
			]);
			expect(result.keywords).not.toContain("Notion");
			expect(result.clusters.competitors).toBeUndefined();
			expect(result.trackingOnly).toEqual(["Notion", "Evernote"]);

			const [call] = calls;
			expect(call.user).toContain("Store: Google Play");
			expect(call.user).toContain("Market language: pl");
			expect(call.user).toContain("already used - do not repeat them");
			expect(call.system).toContain("for rank tracking");
			expect(call.system).toContain("never used as listing text");
		});

		it("rejects an answer that is not the JSON it asked for", async () => {
			stubModel("budget, money, savings");
			await expect(
				AIService.suggestKeywords(workspaceId, "Cash", "Track spending."),
			).rejects.toThrow();
		});
	});

	describe("suggestCategory", () => {
		it("offers Google Play its own categories and never a secondary one", async () => {
			stubModel(
				JSON.stringify({
					primary: "TOOLS",
					reasoning: "It is a utility.",
					secondary: "PRODUCTIVITY",
				}),
			);
			const result = await AIService.suggestCategory(
				workspaceId,
				APP_ID,
				"Flashlight",
				"android",
				"Turns the torch on.",
			);
			expect(result.primary).toBe("TOOLS");
			expect(result.secondary).toBeNull();
			const [call] = calls;
			expect(call.system).toContain("Store: Google Play");
			expect(call.system).toContain("TOOLS (Tools)");
			expect(call.system).not.toContain("UTILITIES (Utilities)");
			expect(call.system).toContain("always return secondary: null");
		});

		it("keeps a distinct valid secondary on the App Store and rejects unknown ids", async () => {
			stubModel(
				JSON.stringify({
					primary: "UTILITIES",
					reasoning: "A utility with a productivity angle.",
					secondary: "PRODUCTIVITY",
				}),
			);
			const result = await AIService.suggestCategory(
				workspaceId,
				APP_ID,
				"Flashlight",
				"ios",
				"Turns the torch on.",
			);
			expect(result.primary).toBe("UTILITIES");
			expect(result.secondary).toBe("PRODUCTIVITY");
			expect(calls[0].system).toContain("Store: Apple App Store");

			stubModel(
				JSON.stringify({
					primary: "TOOLS",
					reasoning: "Play id on the App Store.",
					secondary: null,
				}),
			);
			await expect(
				AIService.suggestCategory(workspaceId, APP_ID, "Flashlight", "ios"),
			).rejects.toThrow();
		});
	});

	describe("generated text clean-up", () => {
		it("keeps paragraph breaks and normalizes typographic characters", async () => {
			stubModel(
				"Plan your week — fast ✅\n\n“Every task” in one place…\n- Offline mode\n- Reminders\n\n\n\nStart today.",
			);
			const { result } = await AIService.generateDescription(
				workspaceId,
				"Planner",
				"A weekly planner.",
				"android",
				["weekly planner", "Todoist"],
			);
			expect(result).toBe(
				'Plan your week - fast\n\n"Every task" in one place...\n- Offline mode\n- Reminders\n\nStart today.',
			);
			const [call] = calls;
			expect(call.user).toContain("- weekly planner");
			expect(call.user).toContain("Store rules override this list");
		});

		it("writes release notes in generate mode from the change list, within the Play cap", async () => {
			stubModel("- Faster sync\n- Fixed a crash on launch");
			const { releaseNotes } = await AIService.generateReleaseNotes(
				workspaceId,
				"Planner",
				"2.1.0",
				["sync 2x faster", "crash on cold start fixed"],
				{ language: "pl", platform: "android" },
			);
			expect(releaseNotes).toBe("- Faster sync\n- Fixed a crash on launch");
			const [call] = calls;
			expect(call.system).toContain("max 500 characters");
			expect(call.system).not.toContain("Store rules come first");
			expect(call.user).toContain("Changes that shipped");
			expect(call.user).toContain("sync 2x faster");
			expect(call.user).toContain("Language: pl");
		});

		it("tells the model when the current listing is unknown instead of inventing one", async () => {
			stubModel("Weekly planner and to-do list");
			await AIService.generateListingField(
				workspaceId,
				"subtitle",
				"",
				"Planner",
				"ios",
				"en-US",
			);
			const [call] = calls;
			expect(call.user).toContain("Current listing: unknown");
			expect(call.user).toContain("No brief was provided");
			expect(call.user).toContain("limit 30 characters");
		});
	});
});
