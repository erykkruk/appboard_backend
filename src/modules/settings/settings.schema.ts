import { t } from "elysia";

export const settingKeyParams = t.Object({
	key: t.String({ minLength: 1 }),
});

export const setSettingBody = t.Object({
	value: t.String(),
});

export const updateSettingsBody = t.Record(t.String(), t.String());
