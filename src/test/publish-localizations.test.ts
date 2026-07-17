import { afterAll, describe, expect, it } from "bun:test";
import { PublishingService } from "@/modules/publishing/publishing.service";
import { cleanupStores, getTestWorkspaceId } from "@/test/setup";
import { seedTestApp, seedTestStore } from "@/test/test-helpers";

describe("publishAllDirtyLocalizations", () => {
	const storeIds: string[] = [];

	afterAll(async () => {
		await cleanupStores(storeIds);
	});

	it("returns published:0 with no errors when nothing is dirty", async () => {
		const store = await seedTestStore(getTestWorkspaceId());
		storeIds.push(store.id);
		const app = await seedTestApp(store.id);

		const result = await PublishingService.publishAllDirtyLocalizations(app.id);

		// No version localizations exist → nothing to push, no ASC call made.
		expect(result.published).toBe(0);
		expect(result.errors).toEqual([]);
	});

	it("reports no version-localization changes for a fresh app", async () => {
		const store = await seedTestStore(getTestWorkspaceId());
		storeIds.push(store.id);
		const app = await seedTestApp(store.id);

		const changes = await PublishingService.getDirtyVersionLocalizationChanges(
			app.id,
		);

		expect(changes).toEqual([]);
	});
});
