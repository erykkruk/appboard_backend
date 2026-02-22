import { describe, expect, it } from "bun:test";

/**
 * Unit tests for the field inclusion logic used in publishVersionLocalizations.
 * These test the null-check vs truthy-check pattern to ensure empty strings
 * are included when publishing to ASC.
 */

describe("publishVersionLocalizations field inclusion logic", () => {
	// Simulates the backend logic: building versionLocAttrs from draft
	function buildVersionLocAttrs(draft: Record<string, string | null>) {
		const attrs: Record<string, string> = {};
		if (draft.description != null) attrs.description = draft.description;
		if (draft.keywords != null) attrs.keywords = draft.keywords;
		if (draft.whatsNew != null) attrs.whatsNew = draft.whatsNew;
		if (draft.promotionalText != null)
			attrs.promotionalText = draft.promotionalText;
		if (draft.marketingUrl != null) attrs.marketingUrl = draft.marketingUrl;
		if (draft.supportUrl != null) attrs.supportUrl = draft.supportUrl;
		return attrs;
	}

	// Simulates the old (buggy) logic using truthy checks
	function buildVersionLocAttrsTruthy(draft: Record<string, string | null>) {
		const attrs: Record<string, string> = {};
		if (draft.description) attrs.description = draft.description;
		if (draft.keywords) attrs.keywords = draft.keywords;
		if (draft.whatsNew) attrs.whatsNew = draft.whatsNew;
		if (draft.promotionalText) attrs.promotionalText = draft.promotionalText;
		if (draft.marketingUrl) attrs.marketingUrl = draft.marketingUrl;
		if (draft.supportUrl) attrs.supportUrl = draft.supportUrl;
		return attrs;
	}

	it("includes non-empty string fields", () => {
		const draft = {
			description: "A description",
			keywords: "key1, key2",
			marketingUrl: "https://example.com",
			promotionalText: "Promo",
			supportUrl: "https://support.example.com",
			whatsNew: "Bug fixes",
		};

		const attrs = buildVersionLocAttrs(draft);
		expect(Object.keys(attrs).length).toBe(6);
		expect(attrs.description).toBe("A description");
		expect(attrs.keywords).toBe("key1, key2");
	});

	it("includes empty string fields (null-check allows clearing)", () => {
		const draft = {
			description: "",
			keywords: "",
			marketingUrl: "",
			promotionalText: "",
			supportUrl: "",
			whatsNew: "",
		};

		const attrs = buildVersionLocAttrs(draft);

		// With null-check, empty strings ARE included (allows clearing fields)
		expect(Object.keys(attrs).length).toBe(6);
		expect(attrs.description).toBe("");
		expect(attrs.keywords).toBe("");
	});

	it("excludes null fields", () => {
		const draft = {
			description: null,
			keywords: "some keywords",
			marketingUrl: null,
			promotionalText: null,
			supportUrl: null,
			whatsNew: null,
		};

		const attrs = buildVersionLocAttrs(draft);
		expect(Object.keys(attrs).length).toBe(1);
		expect(attrs.keywords).toBe("some keywords");
	});

	it("old truthy-check would skip empty strings (regression proof)", () => {
		const draft = {
			description: "",
			keywords: "key1",
			marketingUrl: "",
			promotionalText: "",
			supportUrl: "",
			whatsNew: "",
		};

		const oldAttrs = buildVersionLocAttrsTruthy(draft);
		const newAttrs = buildVersionLocAttrs(draft);

		// Old logic skips empty strings
		expect(Object.keys(oldAttrs).length).toBe(1);
		// New logic includes them
		expect(Object.keys(newAttrs).length).toBe(6);
	});

	// Simulates title/subtitle inclusion logic
	function shouldPushTitleSubtitle(draft: {
		title: string | null;
		subtitle: string | null;
	}) {
		return draft.title != null || draft.subtitle != null;
	}

	it("pushes title/subtitle when title is set", () => {
		expect(shouldPushTitleSubtitle({ subtitle: null, title: "My App" })).toBe(
			true,
		);
	});

	it("pushes title/subtitle when subtitle is set", () => {
		expect(
			shouldPushTitleSubtitle({ subtitle: "A subtitle", title: null }),
		).toBe(true);
	});

	it("pushes title/subtitle when both are empty strings (clearing)", () => {
		expect(shouldPushTitleSubtitle({ subtitle: "", title: "" })).toBe(true);
	});

	it("does not push title/subtitle when both are null", () => {
		expect(shouldPushTitleSubtitle({ subtitle: null, title: null })).toBe(
			false,
		);
	});
});

describe("extractAscError utility logic", () => {
	// Simulates the extractAscError function
	function extractAscError(err: unknown): string {
		if (err instanceof Error) {
			const msg = err.message;
			try {
				const jsonMatch = msg.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					const parsed = JSON.parse(jsonMatch[0]);
					if (parsed.errors?.length) {
						return parsed.errors
							.map(
								(e: { detail?: string; title?: string }) => e.detail || e.title,
							)
							.join("; ");
					}
				}
			} catch {
				// Ignore parse errors
			}
			return msg;
		}
		return String(err);
	}

	it("extracts detail from ASC JSON error", () => {
		const err = new Error(
			'Request failed: {"errors":[{"title":"CONFLICT","detail":"Version already exists"}]}',
		);
		expect(extractAscError(err)).toBe("Version already exists");
	});

	it("joins multiple ASC errors", () => {
		const err = new Error(
			'Failed: {"errors":[{"detail":"Error 1"},{"detail":"Error 2"}]}',
		);
		expect(extractAscError(err)).toBe("Error 1; Error 2");
	});

	it("falls back to title when detail is missing", () => {
		const err = new Error('Response: {"errors":[{"title":"NOT_FOUND"}]}');
		expect(extractAscError(err)).toBe("NOT_FOUND");
	});

	it("returns message when no JSON found", () => {
		const err = new Error("Network timeout");
		expect(extractAscError(err)).toBe("Network timeout");
	});

	it("handles non-Error values", () => {
		expect(extractAscError("string error")).toBe("string error");
		expect(extractAscError(42)).toBe("42");
		expect(extractAscError(null)).toBe("null");
	});

	it("handles malformed JSON gracefully", () => {
		const err = new Error("Partial: {invalid json}");
		expect(extractAscError(err)).toBe("Partial: {invalid json}");
	});
});
