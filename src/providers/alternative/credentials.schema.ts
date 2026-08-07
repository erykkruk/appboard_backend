import { ArkErrors, type } from "arktype";
import type { AlternativeStoreType, StoreType } from "@/config/const";
import { isAlternativeStoreType, STORE_TYPE_LABELS } from "@/config/const";
import { buildError } from "@/utils/errors";

/**
 * Credential contract for the alternative stores — the exact JSON field names
 * the panel sends on `POST /stores/connect`.
 *
 * Validated here rather than in the Elysia body schema because `credentials` is
 * a free-form record whose required shape depends on `type`.
 */

const PEM_KEY = type("string>0").narrow((value, ctx) =>
	value.includes("-----BEGIN")
		? true
		: ctx.mustBe("a PEM private key including the -----BEGIN----- header"),
);

const huaweiCredentials = type({
	clientId: "string>0",
	clientSecret: "string>0",
	"packageNames?": "string[]",
});

const samsungCredentials = type({
	privateKey: PEM_KEY,
	serviceAccountId: "string>0",
});

const amazonCredentials = type({
	clientId: "string>0",
	clientSecret: "string>0",
	"packageNames?": "string[]",
});

const rustoreCredentials = type({
	keyId: "string>0",
	privateKey: PEM_KEY,
});

const onestoreCredentials = type({
	clientId: "string>0",
	clientSecret: "string>0",
});

const xiaomiCredentials = type({
	email: "string.email",
	privateKey: PEM_KEY,
});

const CREDENTIAL_SCHEMAS: Record<
	AlternativeStoreType,
	// biome-ignore lint/suspicious/noExplicitAny: ArkType validators are heterogeneous by design
	type<any>
> = {
	amazon_appstore: amazonCredentials,
	huawei_appgallery: huaweiCredentials,
	onestore: onestoreCredentials,
	rustore: rustoreCredentials,
	samsung_galaxy: samsungCredentials,
	xiaomi_getapps: xiaomiCredentials,
};

/**
 * Raise a 422 naming the offending fields when an alternative store is
 * connected with the wrong credential shape. Primary stores keep their existing
 * provider-level validation.
 */
export function validateAlternativeCredentials(
	storeType: StoreType,
	credentials: Record<string, unknown>,
): void {
	if (!isAlternativeStoreType(storeType)) return;

	const schema = CREDENTIAL_SCHEMAS[storeType];
	const result = schema(credentials);

	if (result instanceof ArkErrors) {
		buildError("validationFailed", {
			info: `Invalid ${STORE_TYPE_LABELS[storeType]} credentials: ${result.summary}`,
		});
	}
}

/** Mock/demo connections bypass the live API but still need a shape check. */
export const ALTERNATIVE_CREDENTIAL_FIELDS: Record<
	AlternativeStoreType,
	string[]
> = {
	amazon_appstore: ["clientId", "clientSecret"],
	huawei_appgallery: ["clientId", "clientSecret"],
	onestore: ["clientId", "clientSecret"],
	rustore: ["keyId", "privateKey"],
	samsung_galaxy: ["serviceAccountId", "privateKey"],
	xiaomi_getapps: ["email", "privateKey"],
};
