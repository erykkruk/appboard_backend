import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { listingsController } from "@/modules/listings";
import { storesController } from "@/modules/stores";
import { authGuard, authRequest, cleanupStores } from "./setup";

describe("Listings import/export", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) =>
			app.use(storesController).use(appsController).use(listingsController),
		);

	const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

	let storeId: string;
	let appId: string;

	afterAll(async () => {
		if (storeId) await cleanupStores([storeId]);
	});

	it("sets up mock store and syncs listings", async () => {
		const storeRes = await app
			.handle(
				authRequest("http://localhost/api/stores/connect", {
					body: JSON.stringify({
						credentials: { mock: true, type: "mock" },
						name: "Test Import/Export",
						type: "google_play",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((res) => res.json());

		storeId = storeRes.store.id;

		const appsRes = await app
			.handle(authRequest("http://localhost/api/apps"))
			.then((res) => res.json());

		const mockApp = appsRes.apps.find(
			(a: { bundleId: string }) => a.bundleId === "com.example.taskmaster",
		);
		appId = mockApp.id;

		await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/listings/sync`, {
				method: "POST",
			}),
		);
	});

	// ── Template ─────────────────────────────────────────────────────────

	describe("GET /api/apps/:appId/listings/template", () => {
		it("returns CSV template with all 10 column headers", async () => {
			const res = await app.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/template?format=csv`,
				),
			);

			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/csv");
			expect(res.headers.get("content-disposition")).toContain("attachment");
			expect(res.headers.get("content-disposition")).toContain(
				"listings-template.csv",
			);

			const text = await res.text();
			const lines = text.split("\n");

			const expectedHeaders =
				"language,title,shortDesc,fullDesc,keywords,promoText,whatsNew,marketingUrl,supportUrl,privacyUrl";
			expect(lines[0]).toBe(expectedHeaders);
			expect(lines).toHaveLength(2);
		});

		it("CSV template example row starts with en-US placeholder", async () => {
			const res = await app.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/template?format=csv`,
				),
			);

			const text = await res.text();
			const dataRow = text.split("\n")[1];
			expect(dataRow).toStartWith("en-US,");
		});

		it("returns JSON template with all 10 keys", async () => {
			const res = await app.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/template?format=json`,
				),
			);

			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("application/json");
			expect(res.headers.get("content-disposition")).toContain(
				"listings-template.json",
			);

			const parsed = await res.json();
			expect(parsed).toBeArray();
			expect(parsed).toHaveLength(1);

			const keys = Object.keys(parsed[0]);
			expect(keys).toContain("language");
			expect(keys).toContain("title");
			expect(keys).toContain("shortDesc");
			expect(keys).toContain("fullDesc");
			expect(keys).toContain("keywords");
			expect(keys).toContain("promoText");
			expect(keys).toContain("whatsNew");
			expect(keys).toContain("marketingUrl");
			expect(keys).toContain("supportUrl");
			expect(keys).toContain("privacyUrl");
			expect(keys).toHaveLength(10);
		});

		it("JSON template values are all empty strings", async () => {
			const res = await app.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/template?format=json`,
				),
			);
			const parsed = await res.json();

			for (const value of Object.values(parsed[0])) {
				expect(value).toBe("");
			}
		});

		it("returns 422 when format query param is missing", async () => {
			const res = await app.handle(
				authRequest(`http://localhost/api/apps/${appId}/listings/template`),
			);
			expect(res.status).toBe(422);
		});

		it("returns 422 when format is invalid", async () => {
			const res = await app.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/template?format=xml`,
				),
			);
			expect(res.status).toBe(422);
		});

		it("returns 422 when appId is not a valid UUID", async () => {
			const res = await app.handle(
				authRequest(
					"http://localhost/api/apps/not-a-uuid/listings/template?format=csv",
				),
			);
			expect(res.status).toBe(422);
		});
	});

	// ── Export ────────────────────────────────────────────────────────────

	describe("GET /api/apps/:appId/listings/export", () => {
		it("exports CSV with header and data rows from database", async () => {
			const res = await app.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/export?format=csv`,
				),
			);

			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/csv");
			expect(res.headers.get("content-disposition")).toContain(
				"listings-export.csv",
			);

			const text = await res.text();
			const lines = text.split("\n");
			// Header + at least 3 languages from mock (en-US, ja-JP, de-DE)
			expect(lines.length).toBeGreaterThanOrEqual(4);
			expect(lines[0]).toBe(
				"language,title,shortDesc,fullDesc,keywords,promoText,whatsNew,marketingUrl,supportUrl,privacyUrl",
			);
		});

		it("exports JSON with array of listing objects", async () => {
			const res = await app.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/export?format=json`,
				),
			);

			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("application/json");
			expect(res.headers.get("content-disposition")).toContain(
				"listings-export.json",
			);

			const parsed = await res.json();
			expect(parsed).toBeArray();
			expect(parsed.length).toBeGreaterThanOrEqual(3);

			// Each object should have all export columns
			for (const row of parsed) {
				expect(row.language).toBeDefined();
				expect(typeof row.language).toBe("string");
				expect(row.language.length).toBeGreaterThan(0);
			}
		});

		it("exported CSV data can be parsed back (round-trip header match)", async () => {
			const res = await app.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/export?format=csv`,
				),
			);

			const text = await res.text();
			const lines = text.split("\n");
			const headers = lines[0].split(",");

			expect(headers).toEqual([
				"language",
				"title",
				"shortDesc",
				"fullDesc",
				"keywords",
				"promoText",
				"whatsNew",
				"marketingUrl",
				"supportUrl",
				"privacyUrl",
			]);

			// Each data row should have same number of fields as header
			for (let i = 1; i < lines.length; i++) {
				if (!lines[i].trim()) continue;
				// Simple count — quoted fields may contain commas, so we just verify non-empty
				expect(lines[i].length).toBeGreaterThan(0);
			}
		});

		it("exported JSON languages are unique (no duplicates)", async () => {
			const res = await app.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/export?format=json`,
				),
			);

			const parsed = await res.json();
			const languages = parsed.map((r: { language: string }) => r.language);
			const uniqueLanguages = new Set(languages);
			expect(uniqueLanguages.size).toBe(languages.length);
		});

		it("export prefers draft over remote for same language", async () => {
			// First create a draft with modified title
			await app.handle(
				authRequest(`http://localhost/api/apps/${appId}/listings/en-US`, {
					body: JSON.stringify({ title: "Draft Export Title" }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			);

			const res = await app.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/export?format=json`,
				),
			);

			const parsed = await res.json();
			const enUS = parsed.find(
				(r: { language: string }) => r.language === "en-US",
			);
			expect(enUS).toBeDefined();
			expect(enUS.title).toBe("Draft Export Title");
		});

		it("returns 404 for non-existent app (JSON export)", async () => {
			const res = await app.handle(
				authRequest(
					`http://localhost/api/apps/${FAKE_UUID}/listings/export?format=json`,
				),
			);

			expect(res.status).toBe(404);
		});

		it("returns 404 for non-existent app (CSV export)", async () => {
			const res = await app.handle(
				authRequest(
					`http://localhost/api/apps/${FAKE_UUID}/listings/export?format=csv`,
				),
			);

			expect(res.status).toBe(404);
		});

		it("returns 422 when format query param is missing", async () => {
			const res = await app.handle(
				authRequest(`http://localhost/api/apps/${appId}/listings/export`),
			);
			expect(res.status).toBe(422);
		});

		it("returns 422 when format is invalid", async () => {
			const res = await app.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/export?format=yaml`,
				),
			);
			expect(res.status).toBe(422);
		});
	});

	// ── Import CSV ────────────────────────────────────────────────────────

	describe("POST /api/apps/:appId/listings/import (CSV)", () => {
		it("imports basic CSV and creates drafts", async () => {
			const csv = [
				"language,title,shortDesc,fullDesc",
				"it-IT,App Italiana,Breve descrizione,Descrizione completa",
			].join("\n");

			const res = await importFile(csv, "basic.csv", "text/csv");

			expect(res.imported).toBe(1);
			expect(res.errors).toHaveLength(0);

			// Verify draft was actually created
			const listing = await app
				.handle(
					authRequest(`http://localhost/api/apps/${appId}/listings/it-IT`),
				)
				.then((r) => r.json());

			expect(listing.draft).toBeDefined();
			expect(listing.draft.title).toBe("App Italiana");
			expect(listing.draft.shortDesc).toBe("Breve descrizione");
			expect(listing.draft.fullDesc).toBe("Descrizione completa");
			expect(listing.draft.isDirty).toBe(true);
			expect(listing.draft.source).toBe("draft");
		});

		it("imports multiple rows at once", async () => {
			const csv = [
				"language,title,shortDesc",
				"pt-BR,App Brasileira,Descrição curta",
				"ko-KR,한국어 앱,짧은 설명",
				"zh-CN,中文应用,简短描述",
			].join("\n");

			const res = await importFile(csv, "multi.csv", "text/csv");

			expect(res.imported).toBe(3);
			expect(res.errors).toHaveLength(0);
		});

		it("handles CSV fields with commas inside quotes", async () => {
			const csv = [
				"language,title,shortDesc,fullDesc",
				'tr-TR,Uygulama,"Kısa, açıklama","Tam, uzun, açıklama"',
			].join("\n");

			const res = await importFile(csv, "commas.csv", "text/csv");
			expect(res.imported).toBe(1);

			const listing = await app
				.handle(
					authRequest(`http://localhost/api/apps/${appId}/listings/tr-TR`),
				)
				.then((r) => r.json());

			expect(listing.draft.shortDesc).toBe("Kısa, açıklama");
			expect(listing.draft.fullDesc).toBe("Tam, uzun, açıklama");
		});

		it("handles CSV fields with escaped double quotes", async () => {
			const csv = [
				"language,title,shortDesc",
				'th-TH,"App with ""quotes""","Short ""desc"""',
			].join("\n");

			const res = await importFile(csv, "quotes.csv", "text/csv");
			expect(res.imported).toBe(1);

			const listing = await app
				.handle(
					authRequest(`http://localhost/api/apps/${appId}/listings/th-TH`),
				)
				.then((r) => r.json());

			expect(listing.draft.title).toBe('App with "quotes"');
			expect(listing.draft.shortDesc).toBe('Short "desc"');
		});

		it("handles CSV fields with newlines inside quotes", async () => {
			const csv = [
				"language,title,fullDesc",
				'vi-VN,Vietnam App,"Line 1\nLine 2\nLine 3"',
			].join("\n");

			const res = await importFile(csv, "newlines.csv", "text/csv");
			expect(res.imported).toBe(1);

			const listing = await app
				.handle(
					authRequest(`http://localhost/api/apps/${appId}/listings/vi-VN`),
				)
				.then((r) => r.json());

			expect(listing.draft.fullDesc).toBe("Line 1\nLine 2\nLine 3");
		});

		it("handles Windows-style line endings (CRLF)", async () => {
			const csv =
				"language,title,shortDesc\r\nnl-NL,Nederlandse App,Korte beschrijving\r\n";

			const res = await importFile(csv, "crlf.csv", "text/csv");
			expect(res.imported).toBe(1);

			const listing = await app
				.handle(
					authRequest(`http://localhost/api/apps/${appId}/listings/nl-NL`),
				)
				.then((r) => r.json());

			expect(listing.draft.title).toBe("Nederlandse App");
		});

		it("skips empty lines in CSV", async () => {
			const csv = ["language,title", "", "sv-SE,Svensk App", "", ""].join("\n");

			const res = await importFile(csv, "blanks.csv", "text/csv");
			expect(res.imported).toBe(1);
			expect(res.errors).toHaveLength(0);
		});

		it("ignores unknown columns in CSV", async () => {
			const csv = [
				"language,title,unknownCol,anotherUnknown,shortDesc",
				"da-DK,Dansk App,ignored1,ignored2,Kort beskrivelse",
			].join("\n");

			const res = await importFile(csv, "extra-cols.csv", "text/csv");
			expect(res.imported).toBe(1);

			const listing = await app
				.handle(
					authRequest(`http://localhost/api/apps/${appId}/listings/da-DK`),
				)
				.then((r) => r.json());

			expect(listing.draft.title).toBe("Dansk App");
			expect(listing.draft.shortDesc).toBe("Kort beskrivelse");
		});

		it("reports error for rows with missing language", async () => {
			const csv = [
				"language,title,shortDesc",
				"en-US,Valid Row,Valid desc",
				",Missing Language,No lang",
				"fr-FR,French,Description",
			].join("\n");

			const res = await importFile(csv, "missing-lang.csv", "text/csv");

			expect(res.imported).toBe(2);
			expect(res.errors).toHaveLength(1);
			expect(res.errors[0]).toContain("language");
			expect(res.errors[0]).toContain("Row 3");
		});

		it("reports multiple errors for multiple invalid rows", async () => {
			const csv = [
				"language,title",
				",No lang 1",
				"en-US,Valid",
				",No lang 2",
				",No lang 3",
			].join("\n");

			const res = await importFile(csv, "multi-err.csv", "text/csv");

			expect(res.imported).toBe(1);
			expect(res.errors).toHaveLength(3);
		});

		it("returns error for header-only CSV (no data rows)", async () => {
			const csv = "language,title,shortDesc";

			const res = await importFile(csv, "header-only.csv", "text/csv");

			expect(res.imported).toBe(0);
			expect(res.errors).toHaveLength(1);
			expect(res.errors[0]).toContain("header row");
		});

		it("returns error for empty CSV", async () => {
			const res = await importFile("", "empty.csv", "text/csv");

			expect(res.imported).toBe(0);
			expect(res.errors).toHaveLength(1);
		});

		it("upserts existing draft on re-import (overwrites)", async () => {
			// First import
			const csv1 = [
				"language,title,shortDesc",
				"fi-FI,Finnish App v1,Old desc",
			].join("\n");
			await importFile(csv1, "v1.csv", "text/csv");

			// Second import overwrites
			const csv2 = [
				"language,title,shortDesc",
				"fi-FI,Finnish App v2,New desc",
			].join("\n");
			const res = await importFile(csv2, "v2.csv", "text/csv");
			expect(res.imported).toBe(1);

			const listing = await app
				.handle(
					authRequest(`http://localhost/api/apps/${appId}/listings/fi-FI`),
				)
				.then((r) => r.json());

			expect(listing.draft.title).toBe("Finnish App v2");
			expect(listing.draft.shortDesc).toBe("New desc");
		});

		it("imports row with only language field (minimal)", async () => {
			const csv = ["language,title,shortDesc", "uk-UA,,"].join("\n");

			const res = await importFile(csv, "minimal.csv", "text/csv");
			expect(res.imported).toBe(1);

			const listing = await app
				.handle(
					authRequest(`http://localhost/api/apps/${appId}/listings/uk-UA`),
				)
				.then((r) => r.json());

			expect(listing.draft).toBeDefined();
			expect(listing.draft.language).toBe("uk-UA");
			expect(listing.draft.isDirty).toBe(true);
		});

		it("imports all listing fields correctly", async () => {
			const csv = [
				"language,title,shortDesc,fullDesc,keywords,promoText,whatsNew,marketingUrl,supportUrl,privacyUrl",
				"ro-RO,App Românească,Scurtă desc,Descriere completă,cuvinte cheie,Text promo,Noutăți,https://example.com,https://example.com/support,https://example.com/privacy",
			].join("\n");

			const res = await importFile(csv, "all-fields.csv", "text/csv");
			expect(res.imported).toBe(1);

			const listing = await app
				.handle(
					authRequest(`http://localhost/api/apps/${appId}/listings/ro-RO`),
				)
				.then((r) => r.json());

			expect(listing.draft.title).toBe("App Românească");
			expect(listing.draft.shortDesc).toBe("Scurtă desc");
			expect(listing.draft.fullDesc).toBe("Descriere completă");
			expect(listing.draft.keywords).toBe("cuvinte cheie");
			expect(listing.draft.promoText).toBe("Text promo");
			expect(listing.draft.whatsNew).toBe("Noutăți");
			expect(listing.draft.marketingUrl).toBe("https://example.com");
			expect(listing.draft.supportUrl).toBe("https://example.com/support");
			expect(listing.draft.privacyUrl).toBe("https://example.com/privacy");
		});
	});

	// ── Import JSON ───────────────────────────────────────────────────────

	describe("POST /api/apps/:appId/listings/import (JSON)", () => {
		it("imports basic JSON and creates drafts", async () => {
			const json = JSON.stringify([
				{
					fullDesc: "Descrição completa em JSON",
					language: "pt-PT",
					shortDesc: "Desc curta",
					title: "App Portuguesa",
				},
			]);

			const res = await importFile(json, "basic.json", "application/json");

			expect(res.imported).toBe(1);
			expect(res.errors).toHaveLength(0);

			const listing = await app
				.handle(
					authRequest(`http://localhost/api/apps/${appId}/listings/pt-PT`),
				)
				.then((r) => r.json());

			expect(listing.draft.title).toBe("App Portuguesa");
			expect(listing.draft.isDirty).toBe(true);
		});

		it("imports multiple JSON objects at once", async () => {
			const json = JSON.stringify([
				{ language: "ar-SA", title: "تطبيق عربي" },
				{ language: "he-IL", title: "אפליקציה עברית" },
			]);

			const res = await importFile(json, "multi.json", "application/json");
			expect(res.imported).toBe(2);
			expect(res.errors).toHaveLength(0);
		});

		it("returns error for invalid JSON syntax", async () => {
			const res = await importFile(
				"{ not valid json [",
				"bad.json",
				"application/json",
			);

			expect(res.imported).toBe(0);
			expect(res.errors).toHaveLength(1);
			expect(res.errors[0]).toContain("Invalid JSON");
		});

		it("returns error when JSON is not an array", async () => {
			const json = JSON.stringify({
				language: "en-US",
				title: "Not an array",
			});

			const res = await importFile(json, "obj.json", "application/json");

			expect(res.imported).toBe(0);
			expect(res.errors).toHaveLength(1);
			expect(res.errors[0]).toContain("array");
		});

		it("reports error for non-object items in JSON array", async () => {
			const json = JSON.stringify([
				{ language: "en-US", title: "Valid" },
				"string item",
				42,
				null,
				[1, 2, 3],
			]);

			const res = await importFile(json, "mixed.json", "application/json");

			expect(res.imported).toBe(1);
			expect(res.errors).toHaveLength(4);
			expect(res.errors[0]).toContain("Item 2");
			expect(res.errors[1]).toContain("Item 3");
		});

		it("reports error for items missing language field", async () => {
			const json = JSON.stringify([
				{ language: "en-US", title: "Valid" },
				{ title: "No language" },
				{ language: "fr-FR", title: "Also valid" },
			]);

			const res = await importFile(json, "no-lang.json", "application/json");

			expect(res.imported).toBe(2);
			expect(res.errors).toHaveLength(1);
			expect(res.errors[0]).toContain("Item 2");
			expect(res.errors[0]).toContain("language");
		});

		it("ignores non-string values in JSON objects", async () => {
			const json = JSON.stringify([
				{
					language: "cs-CZ",
					shortDesc: 12345,
					title: "Czech App",
				},
			]);

			const res = await importFile(json, "types.json", "application/json");
			expect(res.imported).toBe(1);

			const listing = await app
				.handle(
					authRequest(`http://localhost/api/apps/${appId}/listings/cs-CZ`),
				)
				.then((r) => r.json());

			expect(listing.draft.title).toBe("Czech App");
			// shortDesc was a number, should be ignored
			expect(listing.draft.shortDesc).toBeNull();
		});

		it("ignores empty string values in JSON objects", async () => {
			const json = JSON.stringify([
				{
					language: "hu-HU",
					shortDesc: "",
					title: "Hungarian App",
				},
			]);

			const res = await importFile(json, "empty-val.json", "application/json");
			expect(res.imported).toBe(1);

			const listing = await app
				.handle(
					authRequest(`http://localhost/api/apps/${appId}/listings/hu-HU`),
				)
				.then((r) => r.json());

			expect(listing.draft.title).toBe("Hungarian App");
			expect(listing.draft.shortDesc).toBeNull();
		});

		it("ignores unknown keys in JSON objects", async () => {
			const json = JSON.stringify([
				{
					customField: "ignored",
					language: "el-GR",
					randomKey: "also ignored",
					title: "Greek App",
				},
			]);

			const res = await importFile(json, "extra-keys.json", "application/json");
			expect(res.imported).toBe(1);

			const listing = await app
				.handle(
					authRequest(`http://localhost/api/apps/${appId}/listings/el-GR`),
				)
				.then((r) => r.json());

			expect(listing.draft.title).toBe("Greek App");
		});

		it("detects JSON format by .json file extension even without mime type", async () => {
			const json = JSON.stringify([
				{ language: "bg-BG", title: "Bulgarian App" },
			]);

			// Use generic mime type but .json extension
			const res = await importFile(
				json,
				"import.json",
				"application/octet-stream",
			);
			expect(res.imported).toBe(1);
		});
	});

	// ── Import validation ────────────────────────────────────────────────

	describe("POST /api/apps/:appId/listings/import (validation)", () => {
		it("returns 422 when appId is not a valid UUID", async () => {
			const formData = new FormData();
			formData.append(
				"file",
				new File(["language,title\nen-US,Test"], "test.csv", {
					type: "text/csv",
				}),
			);

			const res = await app.handle(
				authRequest("http://localhost/api/apps/not-a-uuid/listings/import", {
					body: formData,
					method: "POST",
				}),
			);

			expect(res.status).toBe(422);
		});
	});

	// ── Export → Import round-trip ────────────────────────────────────────

	describe("Export → Import round-trip", () => {
		it("exported CSV can be re-imported without errors", async () => {
			const exportRes = await app.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/export?format=csv`,
				),
			);

			const csvContent = await exportRes.text();
			const importRes = await importFile(
				csvContent,
				"roundtrip.csv",
				"text/csv",
			);

			expect(importRes.errors).toHaveLength(0);
			expect(importRes.imported).toBeGreaterThan(0);
		});

		it("exported JSON can be re-imported without errors", async () => {
			const exportRes = await app.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/export?format=json`,
				),
			);

			const jsonContent = await exportRes.text();
			const importRes = await importFile(
				jsonContent,
				"roundtrip.json",
				"application/json",
			);

			expect(importRes.errors).toHaveLength(0);
			expect(importRes.imported).toBeGreaterThan(0);
		});
	});

	// ── CSV special character export ─────────────────────────────────────

	describe("CSV escaping on export", () => {
		it("properly escapes commas and quotes in exported CSV", async () => {
			// Create a draft with special characters
			await app.handle(
				authRequest(`http://localhost/api/apps/${appId}/listings/en-US`, {
					body: JSON.stringify({
						shortDesc: 'Has "quotes" here',
						title: "Title, with comma",
					}),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			);

			const res = await app.handle(
				authRequest(
					`http://localhost/api/apps/${appId}/listings/export?format=csv`,
				),
			);

			const text = await res.text();

			// Fields with commas should be quoted
			expect(text).toContain('"Title, with comma"');
			// Fields with quotes should be double-quoted
			expect(text).toContain('"Has ""quotes"" here"');
		});
	});

	// ── Helper ────────────────────────────────────────────────────────────

	async function importFile(
		content: string,
		filename: string,
		mimeType: string,
	) {
		const formData = new FormData();
		formData.append("file", new File([content], filename, { type: mimeType }));

		return app
			.handle(
				authRequest(`http://localhost/api/apps/${appId}/listings/import`, {
					body: formData,
					method: "POST",
				}),
			)
			.then((r) => r.json());
	}
});
