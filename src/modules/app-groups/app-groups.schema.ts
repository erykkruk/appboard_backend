import { t } from "elysia";

export const createGroupBody = t.Object({
	iconUrl: t.Optional(t.String({ maxLength: 1024 })),
	name: t.String({ maxLength: 255, minLength: 1 }),
});

export const updateGroupBody = t.Object({
	iconUrl: t.Optional(t.Nullable(t.String({ maxLength: 1024 }))),
	name: t.Optional(t.String({ maxLength: 255, minLength: 1 })),
});

export const groupIdParams = t.Object({
	groupId: t.String({ format: "uuid" }),
});

export const addMemberBody = t.Object({
	appId: t.String({ format: "uuid" }),
});

export const memberParams = t.Object({
	appId: t.String({ format: "uuid" }),
	groupId: t.String({ format: "uuid" }),
});

export const reorderGroupsBody = t.Object({
	groupIds: t.Array(t.String({ format: "uuid" }), { minItems: 1 }),
});

export const reorderMembersBody = t.Object({
	appIds: t.Array(t.String({ format: "uuid" }), { minItems: 1 }),
});
