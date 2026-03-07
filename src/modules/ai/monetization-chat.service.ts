import { eq } from "drizzle-orm";
import { ASC_TERRITORIES } from "@/config/const";
import { PurchasesService } from "@/modules/purchases/purchases.service";
import { SettingsService } from "@/modules/settings/settings.service";
import { db } from "@/utils/db";
import { apps } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("monetization-chat");

const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.0-flash-001";

interface ChatMessage {
	content: string;
	role: "assistant" | "system" | "user";
}

interface AppContext {
	bundleId: string | null;
	existingGroups: Array<{
		id: string;
		name: string;
		subscriptions: Array<{
			duration: string | null;
			id: string;
			name: string;
			productId: string;
		}>;
	}>;
	existingPurchases: Array<{
		id: string;
		name: string;
		productId: string;
		productType: string;
	}>;
	name: string;
	platform: string;
}

interface ExecutePlanResult {
	created: Array<{ id: string; name: string; type: string }>;
	deleted: string[];
	edited: Array<{ id: string; name: string }>;
	failed: Array<{ error: string; item: string }>;
}

interface PlanData {
	deletes?: string[];
	edits?: Array<{
		localizations?: Array<{
			description?: string;
			language: string;
			name?: string;
		}>;
		name?: string;
		prices?: Array<{ currency: string; price: string; territory: string }>;
		purchaseId: string;
	}>;
	groupDeletes?: string[];
	groupEdits?: Array<{
		groupId: string;
		name?: string;
	}>;
	groups?: Array<{
		id?: string;
		name?: string;
		subscriptions: Array<{
			duration: string;
			localizations?: Array<{
				description?: string;
				language: string;
				name?: string;
			}>;
			name: string;
			prices?: Array<{ currency: string; price: string; territory: string }>;
			productId: string;
		}>;
	}>;
	purchases?: Array<{
		localizations?: Array<{
			description?: string;
			language: string;
			name?: string;
		}>;
		name: string;
		prices?: Array<{ currency: string; price: string; territory: string }>;
		productId: string;
		productType: string;
	}>;
}

async function getAppContext(
	appId: string,
	_workspaceId: string,
): Promise<AppContext> {
	const [app] = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);

	if (!app) buildError("notFound", { info: "App not found" });

	const groups = await PurchasesService.listSubscriptionGroups(appId);
	const purchases = await PurchasesService.listPurchases(appId);

	const iaps = purchases.filter((p) => !p.groupId);

	return {
		bundleId: app.bundleId,
		existingGroups: groups.map((g) => ({
			id: g.id,
			name: g.name,
			subscriptions: g.subscriptions.map((s) => ({
				duration: s.duration,
				id: s.id,
				name: s.name,
				productId: s.productId,
			})),
		})),
		existingPurchases: iaps.map((p) => ({
			id: p.id,
			name: p.name,
			productId: p.productId,
			productType: p.productType,
		})),
		name: app.name,
		platform: app.platform,
	};
}

function buildTerritoryBlock(territories?: string[]): string {
	const territoryList =
		territories && territories.length > 0
			? ASC_TERRITORIES.filter((t) => territories.includes(t.code))
			: ASC_TERRITORIES;

	const formatted = territoryList
		.map((t) => `${t.code} (${t.currency})`)
		.join(", ");

	return `\nPRICING TERRITORIES:
Generate prices for the following territories: ${formatted}
Always include prices for ALL listed territories in every product.`;
}

function buildSystemPrompt(
	context: AppContext,
	territories?: string[],
): string {
	const existingProductsBlock =
		context.existingGroups.length > 0 || context.existingPurchases.length > 0
			? `
EXISTING PRODUCTS (already configured):
${
	context.existingGroups.length > 0
		? `Subscription Groups:
${context.existingGroups
	.map(
		(g) =>
			`  - Group "${g.name}" (id: ${g.id})
${g.subscriptions.map((s) => `    - "${s.name}" productId: ${s.productId}, duration: ${s.duration}, id: ${s.id}`).join("\n")}`,
	)
	.join("\n")}`
		: ""
}
${
	context.existingPurchases.length > 0
		? `In-App Purchases:
${context.existingPurchases.map((p) => `  - "${p.name}" productId: ${p.productId}, type: ${p.productType}, id: ${p.id}`).join("\n")}`
		: ""
}`
			: "\nNo existing products configured yet.";

	return `You are an expert mobile app monetization consultant. You help developers plan and implement in-app purchases and subscriptions.

APP CONTEXT:
- Name: ${context.name}
- Platform: ${context.platform}
- Bundle ID: ${context.bundleId ?? "unknown"}
${existingProductsBlock}

MONETIZATION KNOWLEDGE:
- Product types: "consumable", "non_consumable", "auto_renewable" (subscriptions)
- Subscription durations use ISO 8601: P1W (weekly), P1M (monthly), P3M (quarterly), P6M (semi-annual), P1Y (annual)
- Product IDs should follow convention: lowercase_snake_case (e.g. "pro_monthly", "remove_ads", "coins_100")
- Common pricing: subscriptions at $4.99/mo, $29.99/yr (40% discount), $49.99/yr (premium)
- Always create subscription groups to organize related subscription tiers
- Non-consumable = one-time (e.g. remove ads, unlock feature). Consumable = repeatable (e.g. coins, gems)

CRITICAL PRICING RULES — PURCHASING POWER PARITY:
Prices MUST be adjusted per country based on local purchasing power. NEVER use flat currency conversion. Use these approximate tiers relative to US price (1.0x):
- Tier 1 (1.0x): US, CH, NO, AU, CA, GB, SE, DK, SG, JP, NZ, IE, DE, FR, NL, BE, AT, FI, IT, ES, KR, IL, AE, SA, HK
- Tier 2 (0.55x): PT, CZ, GR, SI, EE, HR, SK, LT, LV, TW, CL, MY, PL, HU, RO, BG, MX, BR, TH, ZA, TR, AR, CO, PE, PH
- Tier 3 (0.30x): IN, VN, EG, NG, ID, UA, KE, PK
Example: If US price = $4.99/week, then PL should be ~10.99 PLN (not 22 PLN), IN should be ~79 INR (not 400 INR), BR should be ~14.90 BRL, etc.
Round prices to psychologically attractive values (.99, .49, whole numbers for large currencies like JPY, KRW, VND).
Each territory MUST have a DIFFERENT price appropriate to its purchasing power — do NOT just convert USD to local currency at market exchange rate.

CONVERSATION GUIDELINES:
- You already have FULL context about the app and ALL its existing products (names, productIds, UUIDs, groups) in the EXISTING PRODUCTS section above. DO NOT ask the user for information that is already provided.
- When the user references a product by name or productId, IMMEDIATELY match it to the existing products list and act on it. Never ask "does this product exist?" or "what group does it belong to?" — you already know.
- Act decisively. Generate the monetization_plan block right away based on the user's instruction. Only ask questions if the user's request is genuinely ambiguous (e.g. they mention a product that doesn't exist at all).
- Explain briefly what you're doing, then output the plan block. Keep explanations short.

PLAN OUTPUT FORMAT:
When you are ready to propose a concrete plan, include it in a special block:
\`\`\`monetization_plan
{
  "groups": [
    {
      "name": "Group Name",
      "subscriptions": [
        { "name": "Pro Monthly", "productId": "pro_monthly", "duration": "P1M", "prices": [{"territory":"US","currency":"USD","price":"9.99"}] }
      ]
    }
  ],
  "purchases": [
    { "name": "Remove Ads", "productId": "remove_ads", "productType": "non_consumable", "prices": [{"territory":"US","currency":"USD","price":"4.99"}] }
  ],
  "edits": [
    { "purchaseId": "uuid-here", "name": "New Name", "prices": [{"territory":"US","currency":"USD","price":"5.99"}] }
  ],
  "groupEdits": [
    { "groupId": "uuid-here", "name": "New Group Name" }
  ],
  "deletes": ["purchase-uuid-to-remove"],
  "groupDeletes": ["group-uuid-to-remove"]
}
\`\`\`

IMPORTANT RULES FOR GROUPS:
- ALWAYS prefer using EXISTING groups. If groups already exist, add new subscriptions to them using "groups" WITH "id" set to the existing group's UUID or name.
- NEVER create a new group if an existing group could serve the same purpose. Only create a new group when the user EXPLICITLY asks for a new/separate group.
- To ADD subscriptions to an EXISTING group: use "groups" WITH "id" field — you can use either the UUID or the exact group name from EXISTING PRODUCTS.
- To CREATE a new group (ONLY when explicitly requested): use "groups" WITHOUT "id" field.
- To RENAME an existing group: use "groupEdits" with the group UUID or name.
- To DELETE an existing subscription group: use "groupDeletes" with the group UUID or name.
- To EDIT an existing subscription (price, name, localizations): use "edits" with the subscription's UUID, name, or productId.
- You can reference existing products by their UUID, name, or productId — the system will resolve them automatically.
- When the user mentions a product by name (e.g. "Museo Pro" group, "Pro Weekly" subscription), match it to the EXISTING PRODUCTS list above and use the corresponding identifier.

Include ONLY the sections that apply (omit empty arrays). Reference existing product UUIDs in "edits", "deletes", "groupEdits", and "groupDeletes".
Always include the plan block when making a concrete proposal so the user can review and execute it.
${buildTerritoryBlock(territories)}`;
}

interface FocusContext {
	duration?: string;
	groupName?: string;
	id: string;
	localizations?: Array<{
		description?: string;
		language: string;
		name?: string;
	}>;
	name: string;
	prices?: Array<{ currency: string; price: string; territory: string }>;
	productId?: string;
	productType?: string;
	type: "group" | "purchase";
}

function buildFocusContextBlock(focus: FocusContext): string {
	const lines: string[] = ["\nFOCUS CONTEXT:"];

	if (focus.type === "purchase") {
		lines.push(
			`User is viewing purchase "${focus.name}" (id: ${focus.id}${focus.productId ? `, productId: ${focus.productId}` : ""}${focus.productType ? `, type: ${focus.productType}` : ""}${focus.duration ? `, duration: ${focus.duration}` : ""}).`,
		);
	} else {
		lines.push(
			`User is viewing subscription group "${focus.name}" (id: ${focus.id}).`,
		);
	}

	if (focus.prices && focus.prices.length > 0) {
		const pricesStr = focus.prices
			.map(
				(p) =>
					`{territory: "${p.territory}", currency: "${p.currency}", price: "${p.price}"}`,
			)
			.join(", ");
		lines.push(`Current prices: [${pricesStr}]`);
	}

	if (focus.localizations && focus.localizations.length > 0) {
		const locsStr = focus.localizations
			.map(
				(l) =>
					`{language: "${l.language}"${l.name ? `, name: "${l.name}"` : ""}${l.description ? `, description: "${l.description}"` : ""}}`,
			)
			.join(", ");
		lines.push(`Current localizations: [${locsStr}]`);
	}

	lines.push(
		"\nYou have ALL the information you need — the item's UUID, name, prices, and localizations are listed above.",
		"DO NOT ask the user for any of this information. Act immediately on the instruction.",
		'Apply the instruction to this item. If adding subscriptions, use this group (set "id" to the UUID above).',
		'If the instruction mentions other items or "all", handle accordingly.',
		"Output a monetization_plan block immediately — no questions needed.",
	);

	return lines.join("\n");
}

function extractPlanFromResponse(text: string): PlanData | null {
	const match = text.match(/```monetization_plan\s*\n([\s\S]*?)\n```/);
	if (!match) return null;
	try {
		return JSON.parse(match[1]) as PlanData;
	} catch {
		return null;
	}
}

export class MonetizationChatService {
	static async quickAction(
		appId: string,
		workspaceId: string,
		instruction: string,
		focusContext?: FocusContext,
		territories?: string[],
	): Promise<{ explanation: string; plan: PlanData | null }> {
		const apiKey = await SettingsService.getRaw(
			workspaceId,
			"OPENROUTER_API_KEY",
		);
		if (!apiKey) {
			buildError("badRequest", {
				info: "OpenRouter API key not configured. Go to Settings to add it.",
			});
		}

		const selectedModel =
			(await SettingsService.getRaw(workspaceId, "AI_MODEL_GENERATE")) ||
			DEFAULT_MODEL;

		const context = await getAppContext(appId, workspaceId);
		let systemPrompt = buildSystemPrompt(context, territories);

		if (focusContext) {
			systemPrompt += buildFocusContextBlock(focusContext);
		}

		const messages: ChatMessage[] = [
			{ content: systemPrompt, role: "system" },
			{ content: instruction, role: "user" },
		];

		log.info(
			{ appId, focusType: focusContext?.type, instruction },
			"Quick action request",
		);

		const response = await fetch(OPENROUTER_URL, {
			body: JSON.stringify({
				messages,
				model: selectedModel,
				stream: false,
				temperature: 0.3,
			}),
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});

		if (!response.ok) {
			const errorBody = await response.text().catch(() => "Unknown error");
			log.error(
				{ errorBody, status: response.status },
				"OpenRouter API error in quickAction",
			);

			if (response.status === 402) {
				buildError("badRequest", {
					info: "OpenRouter API: out of credits.",
				});
			}
			if (response.status === 401) {
				buildError("badRequest", {
					info: "OpenRouter API: invalid API key.",
				});
			}
			if (response.status === 429) {
				buildError("badRequest", {
					info: "OpenRouter API: rate limit exceeded.",
				});
			}
			buildError("storeApiError", {
				info: `OpenRouter API error: ${response.status}`,
			});
		}

		const data = (await response.json()) as {
			choices?: Array<{
				message?: { content?: string };
			}>;
		};

		const content = data.choices?.[0]?.message?.content ?? "";
		const plan = extractPlanFromResponse(content);
		const explanation = content
			.replace(/```monetization_plan\s*\n[\s\S]*?\n```/g, "")
			.trim();

		return { explanation, plan };
	}

	static async chat(
		appId: string,
		workspaceId: string,
		messages: Array<{ content: string; role: "assistant" | "user" }>,
		territories?: string[],
	): Promise<ReadableStream<Uint8Array>> {
		const apiKey = await SettingsService.getRaw(
			workspaceId,
			"OPENROUTER_API_KEY",
		);
		if (!apiKey) {
			buildError("badRequest", {
				info: "OpenRouter API key not configured. Go to Settings to add it.",
			});
		}

		const selectedModel =
			(await SettingsService.getRaw(workspaceId, "AI_MODEL_GENERATE")) ||
			DEFAULT_MODEL;

		const context = await getAppContext(appId, workspaceId);
		const systemPrompt = buildSystemPrompt(context, territories);

		const chatMessages: ChatMessage[] = [
			{ content: systemPrompt, role: "system" },
			...messages.map((m) => ({
				content: m.content,
				role: m.role as "assistant" | "user",
			})),
		];

		log.info(
			{ appId, messageCount: messages.length },
			"Starting monetization chat",
		);

		const response = await fetch(OPENROUTER_URL, {
			body: JSON.stringify({
				messages: chatMessages,
				model: selectedModel,
				stream: true,
				temperature: 0.7,
			}),
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});

		if (!response.ok) {
			const errorBody = await response.text().catch(() => "Unknown error");
			log.error(
				{ errorBody, status: response.status },
				"OpenRouter API error in chat",
			);

			if (response.status === 402) {
				buildError("badRequest", {
					info: "OpenRouter API: out of credits.",
				});
			}
			if (response.status === 401) {
				buildError("badRequest", {
					info: "OpenRouter API: invalid API key.",
				});
			}
			if (response.status === 429) {
				buildError("badRequest", {
					info: "OpenRouter API: rate limit exceeded.",
				});
			}
			buildError("storeApiError", {
				info: `OpenRouter API error: ${response.status}`,
			});
		}

		if (!response.body) {
			buildError("somethingWentWrong", {
				info: "No response body from AI",
			});
		}

		// Transform OpenRouter SSE stream into our SSE format
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		const encoder = new TextEncoder();

		return new ReadableStream<Uint8Array>({
			async start(controller) {
				let buffer = "";
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							controller.enqueue(encoder.encode("data: [DONE]\n\n"));
							controller.close();
							break;
						}

						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split("\n");
						buffer = lines.pop() ?? "";

						for (const line of lines) {
							const trimmed = line.trim();
							if (!trimmed || !trimmed.startsWith("data: ")) continue;

							const data = trimmed.slice(6);
							if (data === "[DONE]") {
								controller.enqueue(encoder.encode("data: [DONE]\n\n"));
								controller.close();
								return;
							}

							try {
								const parsed = JSON.parse(data) as {
									choices?: Array<{
										delta?: { content?: string };
									}>;
								};
								const content = parsed.choices?.[0]?.delta?.content;
								if (content) {
									const sseEvent = `data: ${JSON.stringify({ content })}\n\n`;
									controller.enqueue(encoder.encode(sseEvent));
								}
							} catch {
								// Skip malformed chunks
							}
						}
					}
				} catch (err) {
					log.error({ err }, "Stream processing error");
					controller.close();
				}
			},
		});
	}

	static async executePlan(
		appId: string,
		workspaceId: string,
		plan: PlanData,
	): Promise<ExecutePlanResult> {
		const results: ExecutePlanResult = {
			created: [],
			deleted: [],
			edited: [],
			failed: [],
		};

		// Build lookup maps for resolving names → UUIDs
		const context = await getAppContext(appId, workspaceId);

		const groupByName = new Map<string, string>();
		const purchaseByName = new Map<string, string>();
		const purchaseByProductId = new Map<string, string>();

		for (const g of context.existingGroups) {
			groupByName.set(g.name.toLowerCase(), g.id);
			for (const s of g.subscriptions) {
				purchaseByName.set(s.name.toLowerCase(), s.id);
				purchaseByProductId.set(s.productId.toLowerCase(), s.id);
			}
		}
		for (const p of context.existingPurchases) {
			purchaseByName.set(p.name.toLowerCase(), p.id);
			purchaseByProductId.set(p.productId.toLowerCase(), p.id);
		}

		function resolveGroupId(
			idOrName: string | undefined,
			name: string | undefined,
		): string | null {
			if (idOrName && UUID_REGEX.test(idOrName)) return idOrName;
			// Try to resolve by name
			if (name) {
				const found = groupByName.get(name.toLowerCase());
				if (found) return found;
			}
			// Try the id field as a name (AI sometimes puts name in id)
			if (idOrName) {
				const found = groupByName.get(idOrName.toLowerCase());
				if (found) return found;
			}
			return null;
		}

		function resolvePurchaseId(idOrRef: string): string | null {
			if (UUID_REGEX.test(idOrRef)) return idOrRef;
			// Try by name
			const byName = purchaseByName.get(idOrRef.toLowerCase());
			if (byName) return byName;
			// Try by productId
			const byProductId = purchaseByProductId.get(idOrRef.toLowerCase());
			if (byProductId) return byProductId;
			return null;
		}

		// 1. Create groups + subscriptions (or add subscriptions to existing groups)
		if (plan.groups?.length) {
			for (const groupData of plan.groups) {
				try {
					let groupId: string;

					const resolvedGroupId = resolveGroupId(
						groupData.id,
						groupData.name,
					);
					if (resolvedGroupId) {
						// Use existing group — just add subscriptions to it
						groupId = resolvedGroupId;
					} else if (groupData.name) {
						// Create new group
						const group = await PurchasesService.createGroup(
							appId,
							workspaceId,
							groupData.name,
						);
						groupId = group.id;
						results.created.push({
							id: group.id,
							name: group.name,
							type: "subscription_group",
						});
					} else {
						results.failed.push({
							error: "Group must have either 'id' (existing) or 'name' (new)",
							item: "group (missing id and name)",
						});
						continue;
					}

					for (const subData of groupData.subscriptions) {
						try {
							const sub = await PurchasesService.createSubscription(
								appId,
								workspaceId,
								groupId,
								{
									duration: subData.duration,
									localizations: subData.localizations,
									name: subData.name,
									prices: subData.prices,
									productId: subData.productId,
								},
							);
							results.created.push({
								id: sub.id,
								name: sub.name,
								type: "subscription",
							});
						} catch (err) {
							const msg = err instanceof Error ? err.message : "Unknown error";
							results.failed.push({
								error: msg,
								item: `subscription "${subData.name}"`,
							});
							log.error(
								{ err, name: subData.name },
								"Failed to create subscription",
							);
						}
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : "Unknown error";
					results.failed.push({
						error: msg,
						item: `group "${groupData.name}"`,
					});
					log.error({ err, name: groupData.name }, "Failed to create group");
				}
			}
		}

		// 1b. Edit existing groups (rename)
		if (plan.groupEdits?.length) {
			for (const editData of plan.groupEdits) {
				const resolvedId = resolveGroupId(editData.groupId, undefined);
				if (!resolvedId) {
					results.failed.push({
						error: `Could not resolve group: "${editData.groupId}" — not a valid UUID and no matching group name found`,
						item: `edit group ${editData.groupId}`,
					});
					continue;
				}
				try {
					const updated = await PurchasesService.updateGroup(
						resolvedId,
						appId,
						workspaceId,
						{ name: editData.name },
					);
					results.edited.push({
						id: updated.id,
						name: updated.name,
					});
				} catch (err) {
					const msg = err instanceof Error ? err.message : "Unknown error";
					results.failed.push({
						error: msg,
						item: `edit group ${editData.groupId}`,
					});
					log.error({ err, groupId: editData.groupId }, "Failed to edit group");
				}
			}
		}

		// 2. Create standalone IAPs
		if (plan.purchases?.length) {
			for (const purchaseData of plan.purchases) {
				try {
					const purchase = await PurchasesService.createPurchase(
						appId,
						workspaceId,
						{
							localizations: purchaseData.localizations,
							name: purchaseData.name,
							prices: purchaseData.prices,
							productId: purchaseData.productId,
							productType: purchaseData.productType,
						},
					);
					results.created.push({
						id: purchase.id,
						name: purchase.name,
						type: purchaseData.productType,
					});
				} catch (err) {
					const msg = err instanceof Error ? err.message : "Unknown error";
					results.failed.push({
						error: msg,
						item: `purchase "${purchaseData.name}"`,
					});
					log.error(
						{ err, name: purchaseData.name },
						"Failed to create purchase",
					);
				}
			}
		}

		// 3. Edit existing purchases
		if (plan.edits?.length) {
			for (const editData of plan.edits) {
				const resolvedId = resolvePurchaseId(editData.purchaseId);
				if (!resolvedId) {
					results.failed.push({
						error: `Could not resolve purchase: "${editData.purchaseId}" — not a valid UUID and no matching name/productId found`,
						item: `edit purchase ${editData.purchaseId}`,
					});
					continue;
				}
				try {
					const updated = await PurchasesService.updatePurchase(
						resolvedId,
						workspaceId,
						{
							localizations: editData.localizations,
							name: editData.name,
							prices: editData.prices,
						},
					);
					results.edited.push({
						id: updated.id,
						name: updated.name,
					});
				} catch (err) {
					const msg = err instanceof Error ? err.message : "Unknown error";
					results.failed.push({
						error: msg,
						item: `edit purchase ${editData.purchaseId}`,
					});
					log.error(
						{ err, purchaseId: editData.purchaseId },
						"Failed to edit purchase",
					);
				}
			}
		}

		// 4. Delete purchases
		if (plan.deletes?.length) {
			for (const purchaseId of plan.deletes) {
				const resolvedId = resolvePurchaseId(purchaseId);
				if (!resolvedId) {
					results.failed.push({
						error: `Could not resolve purchase: "${purchaseId}" — not a valid UUID and no matching name/productId found`,
						item: `delete purchase ${purchaseId}`,
					});
					continue;
				}
				try {
					await PurchasesService.deletePurchase(resolvedId, workspaceId);
					results.deleted.push(purchaseId);
				} catch (err) {
					const msg = err instanceof Error ? err.message : "Unknown error";
					results.failed.push({
						error: msg,
						item: `delete purchase ${purchaseId}`,
					});
					log.error({ err, purchaseId }, "Failed to delete purchase");
				}
			}
		}

		// 5. Delete subscription groups
		if (plan.groupDeletes?.length) {
			for (const groupId of plan.groupDeletes) {
				const resolvedId = resolveGroupId(groupId, undefined);
				if (!resolvedId) {
					results.failed.push({
						error: `Could not resolve group: "${groupId}" — not a valid UUID and no matching group name found`,
						item: `delete group ${groupId}`,
					});
					continue;
				}
				try {
					await PurchasesService.deleteGroup(resolvedId, appId, workspaceId);
					results.deleted.push(groupId);
				} catch (err) {
					const msg = err instanceof Error ? err.message : "Unknown error";
					results.failed.push({
						error: msg,
						item: `delete group ${groupId}`,
					});
					log.error({ err, groupId }, "Failed to delete group");
				}
			}
		}

		log.info(
			{
				appId,
				created: results.created.length,
				deleted: results.deleted.length,
				edited: results.edited.length,
				failed: results.failed.length,
			},
			"Monetization plan executed",
		);

		return results;
	}
}
