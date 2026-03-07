import { and, asc, eq, inArray, max } from "drizzle-orm";
import { db } from "@/utils/db";
import { appGroupMembers, appGroups, apps, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";

export class AppGroupsService {
	static async list(workspaceId: string) {
		return db.query.appGroups.findMany({
			orderBy: asc(appGroups.sortOrder),
			where: eq(appGroups.workspaceId, workspaceId),
			with: {
				members: {
					orderBy: asc(appGroupMembers.sortOrder),
					with: {
						app: {
							columns: {
								bundleId: true,
								iconUrl: true,
								id: true,
								name: true,
								platform: true,
							},
						},
					},
				},
			},
		});
	}

	static async getById(groupId: string, workspaceId: string) {
		const group = await db.query.appGroups.findFirst({
			where: and(
				eq(appGroups.id, groupId),
				eq(appGroups.workspaceId, workspaceId),
			),
			with: {
				members: {
					orderBy: asc(appGroupMembers.sortOrder),
					with: {
						app: {
							columns: {
								bundleId: true,
								iconUrl: true,
								id: true,
								name: true,
								platform: true,
							},
						},
					},
				},
			},
		});
		if (!group) buildError("notFound", { info: "App group not found" });
		return group;
	}

	static async create(
		workspaceId: string,
		data: { iconUrl?: string; name: string },
	) {
		const [{ maxOrder }] = await db
			.select({ maxOrder: max(appGroups.sortOrder) })
			.from(appGroups)
			.where(eq(appGroups.workspaceId, workspaceId));

		const [group] = await db
			.insert(appGroups)
			.values({
				iconUrl: data.iconUrl,
				name: data.name,
				sortOrder: (maxOrder ?? -1) + 1,
				workspaceId,
			})
			.returning();
		return group;
	}

	static async update(
		groupId: string,
		workspaceId: string,
		data: {
			iconUrl?: string | null;
			name?: string;
			useSharedProfile?: boolean;
		},
	) {
		await AppGroupsService.verifyGroupOwnership(groupId, workspaceId);

		const updateData: Record<string, unknown> = {};
		if (data.name !== undefined) updateData.name = data.name;
		if (data.iconUrl !== undefined) updateData.iconUrl = data.iconUrl;
		if (data.useSharedProfile !== undefined)
			updateData.useSharedProfile = data.useSharedProfile;

		if (Object.keys(updateData).length === 0) {
			return AppGroupsService.getById(groupId, workspaceId);
		}

		const [updated] = await db
			.update(appGroups)
			.set(updateData)
			.where(eq(appGroups.id, groupId))
			.returning();
		return updated;
	}

	static async getGroupForApp(
		appId: string,
	): Promise<{ groupId: string; useSharedProfile: boolean } | null> {
		const [membership] = await db
			.select({
				groupId: appGroupMembers.groupId,
				useSharedProfile: appGroups.useSharedProfile,
			})
			.from(appGroupMembers)
			.innerJoin(appGroups, eq(appGroupMembers.groupId, appGroups.id))
			.where(eq(appGroupMembers.appId, appId))
			.limit(1);

		return membership ?? null;
	}

	static async remove(groupId: string, workspaceId: string) {
		await AppGroupsService.verifyGroupOwnership(groupId, workspaceId);
		await db.delete(appGroups).where(eq(appGroups.id, groupId));
		return { success: true };
	}

	static async addMember(groupId: string, appId: string, workspaceId: string) {
		await AppGroupsService.verifyGroupOwnership(groupId, workspaceId);

		// Verify app belongs to this workspace (through stores)
		const [app] = await db
			.select({ id: apps.id, platform: apps.platform })
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(and(eq(apps.id, appId), eq(stores.workspaceId, workspaceId)))
			.limit(1);
		if (!app) buildError("notFound", { info: "App not found" });

		// Check: app is not already in another group
		const [existingMembership] = await db
			.select({ groupId: appGroupMembers.groupId })
			.from(appGroupMembers)
			.where(eq(appGroupMembers.appId, appId))
			.limit(1);
		if (existingMembership) {
			buildError("badRequest", {
				info: "App is already in a group",
			});
		}

		// Check: max 1 app per platform in the group
		const existingMembers = await db
			.select({ platform: apps.platform })
			.from(appGroupMembers)
			.innerJoin(apps, eq(appGroupMembers.appId, apps.id))
			.where(eq(appGroupMembers.groupId, groupId));

		const hasSamePlatform = existingMembers.some(
			(m) => m.platform === app.platform,
		);
		if (hasSamePlatform) {
			buildError("badRequest", {
				info: `Group already has an app for platform "${app.platform}"`,
			});
		}

		const [{ maxOrder: memberMaxOrder }] = await db
			.select({ maxOrder: max(appGroupMembers.sortOrder) })
			.from(appGroupMembers)
			.where(eq(appGroupMembers.groupId, groupId));

		const [member] = await db
			.insert(appGroupMembers)
			.values({ appId, groupId, sortOrder: (memberMaxOrder ?? -1) + 1 })
			.returning();
		return member;
	}

	static async removeMember(
		groupId: string,
		appId: string,
		workspaceId: string,
	) {
		await AppGroupsService.verifyGroupOwnership(groupId, workspaceId);

		const [deleted] = await db
			.delete(appGroupMembers)
			.where(
				and(
					eq(appGroupMembers.groupId, groupId),
					eq(appGroupMembers.appId, appId),
				),
			)
			.returning();

		if (!deleted) {
			buildError("notFound", { info: "Member not found in group" });
		}

		return { success: true };
	}

	static async reorderGroups(workspaceId: string, groupIds: string[]) {
		// Verify all groups belong to workspace
		const groups = await db
			.select({ id: appGroups.id })
			.from(appGroups)
			.where(
				and(
					eq(appGroups.workspaceId, workspaceId),
					inArray(appGroups.id, groupIds),
				),
			);

		if (groups.length !== groupIds.length) {
			buildError("badRequest", { info: "Some groups not found" });
		}

		await Promise.all(
			groupIds.map((id, index) =>
				db
					.update(appGroups)
					.set({ sortOrder: index })
					.where(eq(appGroups.id, id)),
			),
		);

		return { success: true };
	}

	static async reorderMembers(
		groupId: string,
		workspaceId: string,
		appIds: string[],
	) {
		await AppGroupsService.verifyGroupOwnership(groupId, workspaceId);

		const members = await db
			.select({ appId: appGroupMembers.appId })
			.from(appGroupMembers)
			.where(eq(appGroupMembers.groupId, groupId));

		const memberAppIds = new Set(members.map((m) => m.appId));
		const allValid = appIds.every((id) => memberAppIds.has(id));
		if (!allValid || appIds.length !== members.length) {
			buildError("badRequest", { info: "Invalid member list" });
		}

		await Promise.all(
			appIds.map((appId, index) =>
				db
					.update(appGroupMembers)
					.set({ sortOrder: index })
					.where(
						and(
							eq(appGroupMembers.groupId, groupId),
							eq(appGroupMembers.appId, appId),
						),
					),
			),
		);

		return { success: true };
	}

	static async verifyGroupOwnership(groupId: string, workspaceId: string) {
		const [group] = await db
			.select({ id: appGroups.id })
			.from(appGroups)
			.where(
				and(eq(appGroups.id, groupId), eq(appGroups.workspaceId, workspaceId)),
			)
			.limit(1);
		if (!group) buildError("notFound", { info: "App group not found" });
		return group;
	}
}
