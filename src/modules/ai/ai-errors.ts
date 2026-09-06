/**
 * Last OpenRouter outcome per workspace, in memory. A key can be present and
 * still be rejected (expired, revoked, typo) - without this the panel would
 * say "AI is on" and then fail on every click. Lives outside AIService so
 * saving a new key can forget the old failure without importing the whole
 * AI module into settings.
 */
const lastErrors = new Map<string, string | null>();

export const AiErrors = {
	clear(workspaceId: string): void {
		lastErrors.delete(workspaceId);
	},
	get(workspaceId: string): string | null {
		return lastErrors.get(workspaceId) ?? null;
	},
	set(workspaceId: string, message: string | null): void {
		lastErrors.set(workspaceId, message);
	},
};
