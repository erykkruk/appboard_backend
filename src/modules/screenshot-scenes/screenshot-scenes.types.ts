/**
 * Editor scene payload persisted for the browser-based screenshot editor.
 *
 * The frontend owns the exact rendering/export shape — the backend stores and
 * returns this object intact. The interface is intentionally permissive and
 * forward-compatible: new editor capabilities can extend the scene without a
 * migration, since it is persisted as a single `jsonb` column.
 */
export interface SceneData {
	width: number;
	height: number;
	background: {
		type: "color" | "gradient" | "image";
		value: string;
		gradient?: { from: string; to: string; angle: number };
	};
	device?: {
		frame: string;
		scale: number;
		offsetX: number;
		offsetY: number;
		rotation?: number;
	};
	screenshot?: { assetId?: string; url?: string; fit?: string };
	textLayers: Array<{
		id: string;
		text: string;
		x: number;
		y: number;
		fontFamily: string;
		fontSize: number;
		color: string;
		align: "left" | "center" | "right";
		weight?: number;
	}>;
	annotations?: Array<{
		id: string;
		type: string;
		x: number;
		y: number;
		[key: string]: unknown;
	}>;
}

export interface CreateSceneInput {
	language: string;
	displayType: string;
	name: string;
	scene: SceneData;
	sortOrder?: number;
}

export interface UpdateSceneInput {
	name?: string;
	scene?: SceneData;
	sortOrder?: number;
	assetId?: string | null;
}
