import { afterAll, beforeAll } from "bun:test";

let app: import("@/index").App;

beforeAll(async () => {
	const mod = await import("@/index");
	app = mod.default as unknown as import("@/index").App;
});

afterAll(() => {
	app?.stop?.();
});

export function getBaseUrl() {
	return "http://localhost:3001";
}
