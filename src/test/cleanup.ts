import { afterAll } from "bun:test";
import { cleanupTestData } from "./test-helpers";

afterAll(async () => {
	await cleanupTestData();
});
