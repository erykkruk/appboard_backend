import { describe, expect, it } from "bun:test";
import type { androidpublisher_v3 } from "googleapis";
import { commitEdit } from "@/providers/google-play/client";

type CommitParams = { changesNotSentForReview?: boolean; editId: string };

/**
 * Fake androidpublisher whose `edits.commit` fails with `failWith` until the
 * given number of calls have been made, recording every call.
 */
function fakeApi(failWith?: { message: string; times: number }) {
	const calls: CommitParams[] = [];
	let failures = 0;

	const api = {
		edits: {
			commit: async (params: CommitParams) => {
				calls.push({
					changesNotSentForReview: params.changesNotSentForReview,
					editId: params.editId,
				});
				if (failWith && failures < failWith.times) {
					failures++;
					throw new Error(failWith.message);
				}
				return { data: {} };
			},
		},
	} as unknown as androidpublisher_v3.Androidpublisher;

	return { api, calls };
}

describe("Google Play commitEdit", () => {
	it("commits as a draft by default, without sending for review", async () => {
		const { api, calls } = fakeApi();

		await commitEdit(api, "com.example.app", "edit-1");

		expect(calls).toHaveLength(1);
		expect(calls[0].changesNotSentForReview).toBe(true);
	});

	it("sends changes for review when asked", async () => {
		const { api, calls } = fakeApi();

		await commitEdit(api, "com.example.app", "edit-1", {
			sendForReview: true,
		});

		expect(calls).toHaveLength(1);
		expect(calls[0].changesNotSentForReview).toBe(false);
	});

	it("drops the flag when Google says it must not be set", async () => {
		const { api, calls } = fakeApi({
			message:
				"Bad Request: The query parameter changesNotSentForReview must not be set for this app.",
			times: 1,
		});

		await commitEdit(api, "com.example.app", "edit-1");

		expect(calls).toHaveLength(2);
		expect(calls[0].changesNotSentForReview).toBe(true);
		expect(calls[1].changesNotSentForReview).toBeUndefined();
		// The retry reuses the same edit — a rejected commit does not consume it.
		expect(calls[1].editId).toBe("edit-1");
	});

	it("sets the flag when Google demands it", async () => {
		const { api, calls } = fakeApi({
			message:
				"Please set the query parameter changesNotSentForReview to true.",
			times: 1,
		});

		await commitEdit(api, "com.example.app", "edit-1", {
			sendForReview: true,
		});

		expect(calls).toHaveLength(2);
		expect(calls[0].changesNotSentForReview).toBe(false);
		expect(calls[1].changesNotSentForReview).toBe(true);
	});

	it("never silently sends changes for review on an unrelated failure", async () => {
		const { api, calls } = fakeApi({
			message: "Internal error encountered.",
			times: 1,
		});

		expect(commitEdit(api, "com.example.app", "edit-1")).rejects.toThrow(
			"Internal error",
		);

		// The old code retried on ANY error without the flag, which pushed the app
		// into review behind the user's back. One attempt, then surface the error.
		await Bun.sleep(0);
		expect(calls).toHaveLength(1);
		expect(calls[0].changesNotSentForReview).toBe(true);
	});
});
