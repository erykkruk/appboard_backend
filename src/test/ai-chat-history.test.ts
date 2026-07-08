import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import Elysia from "elysia";
import { aiChatHistoryController } from "@/modules/ai-chat-history";
import { db } from "@/utils/db";
import { aiChatMessages } from "@/utils/db/schema";
import {
	authGuard,
	authRequest,
	authRequestB,
	getTestWorkspaceId,
	getTestWorkspaceIdB,
} from "./setup";
import { seedTestApp, seedTestStore } from "./test-helpers";

const BASE = "http://localhost/api";

describe("AI Chat History", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) => app.use(aiChatHistoryController));

	let appIdA: string;
	let storeIdA: string;
	let appIdB: string;
	let storeIdB: string;

	// Seed data
	beforeAll(async () => {
		const storeA = await seedTestStore(getTestWorkspaceId());
		storeIdA = storeA.id;
		const appA = await seedTestApp(storeA.id);
		appIdA = appA.id;

		const storeB = await seedTestStore(getTestWorkspaceIdB());
		storeIdB = storeB.id;
		const appB = await seedTestApp(storeB.id);
		appIdB = appB.id;
	});

	afterAll(async () => {
		// Cleanup chat messages
		if (appIdA) {
			await db.delete(aiChatMessages).where(eq(aiChatMessages.appId, appIdA));
		}
		if (appIdB) {
			await db.delete(aiChatMessages).where(eq(aiChatMessages.appId, appIdB));
		}
		// Cleanup stores (cascades to apps)
		const { stores } = await import("@/utils/db/schema");
		for (const id of [storeIdA, storeIdB].filter(Boolean)) {
			await db.delete(stores).where(eq(stores.id, id));
		}
	});

	// ── GET — empty initially ──────────────────────────────────────

	it("returns empty messages initially", async () => {
		const res = await app.handle(
			authRequest(
				`${BASE}/ai/chat-history?appId=${appIdA}&chatType=monetization`,
			),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.messages).toEqual([]);
	});

	// ── POST — add message ─────────────────────────────────────────

	it("adds a user message", async () => {
		const res = await app.handle(
			authRequest(`${BASE}/ai/chat-history`, {
				body: JSON.stringify({
					appId: appIdA,
					chatType: "monetization",
					content: "Hello AI",
					role: "user",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.message.role).toBe("user");
		expect(data.message.content).toBe("Hello AI");
		expect(data.message.sortOrder).toBe(0);
	});

	it("adds an assistant message with incremented sortOrder", async () => {
		const res = await app.handle(
			authRequest(`${BASE}/ai/chat-history`, {
				body: JSON.stringify({
					appId: appIdA,
					chatType: "monetization",
					content: "Hi there!",
					role: "assistant",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.message.sortOrder).toBe(1);
	});

	// ── GET — returns messages sorted ──────────────────────────────

	it("returns messages sorted by sortOrder", async () => {
		const res = await app.handle(
			authRequest(
				`${BASE}/ai/chat-history?appId=${appIdA}&chatType=monetization`,
			),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.messages.length).toBe(2);
		expect(data.messages[0].sortOrder).toBe(0);
		expect(data.messages[1].sortOrder).toBe(1);
		expect(data.messages[0].content).toBe("Hello AI");
		expect(data.messages[1].content).toBe("Hi there!");
	});

	// ── Workspace isolation ────────────────────────────────────────

	it("workspace B cannot see workspace A messages", async () => {
		// Workspace B tries to access workspace A's app — should fail
		const res = await app.handle(
			authRequestB(
				`${BASE}/ai/chat-history?appId=${appIdA}&chatType=monetization`,
			),
		);

		// verifyAppOwnership should reject — 403 or 404
		expect(res.status).toBeGreaterThanOrEqual(400);
	});

	it("workspace B can add messages to its own app", async () => {
		const res = await app.handle(
			authRequestB(`${BASE}/ai/chat-history`, {
				body: JSON.stringify({
					appId: appIdB,
					chatType: "monetization",
					content: "B's message",
					role: "user",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.message.content).toBe("B's message");
	});

	// ── Limit 10 messages ──────────────────────────────────────────

	it("rejects 11th message with limit error", async () => {
		// Clear first, then add 10
		await app.handle(
			authRequest(
				`${BASE}/ai/chat-history?appId=${appIdA}&chatType=monetization`,
				{ method: "DELETE" },
			),
		);

		// Add 10 messages
		for (let i = 0; i < 10; i++) {
			const res = await app.handle(
				authRequest(`${BASE}/ai/chat-history`, {
					body: JSON.stringify({
						appId: appIdA,
						chatType: "monetization",
						content: `Message ${i}`,
						role: i % 2 === 0 ? "user" : "assistant",
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			);
			expect(res.status).toBe(200);
		}

		// 11th should fail
		const res = await app.handle(
			authRequest(`${BASE}/ai/chat-history`, {
				body: JSON.stringify({
					appId: appIdA,
					chatType: "monetization",
					content: "This should fail",
					role: "user",
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(422);
	});

	// ── DELETE — clear messages ────────────────────────────────────

	it("clears all messages for a chat", async () => {
		const res = await app.handle(
			authRequest(
				`${BASE}/ai/chat-history?appId=${appIdA}&chatType=monetization`,
				{ method: "DELETE" },
			),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.success).toBe(true);

		// Verify empty
		const getRes = await app.handle(
			authRequest(
				`${BASE}/ai/chat-history?appId=${appIdA}&chatType=monetization`,
			),
		);
		const getData = await getRes.json();
		expect(getData.messages.length).toBe(0);
	});
});
