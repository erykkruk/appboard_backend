import { t } from "elysia";

export function unionEnum<T extends readonly string[]>(values: T) {
	return t.Union(values.map((v) => t.Literal(v)));
}
