import cors from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import config from "@/config";
import {
	ageRatingController,
	ageRatingPresetsController,
} from "@/modules/age-rating";
import { aiController } from "@/modules/ai";
import { appAiPromptsController } from "@/modules/app-ai-prompts";
import { appsController } from "@/modules/apps";
import { asoProfileController } from "@/modules/aso-profile";
import { listingsController } from "@/modules/listings";
import {
	privacyDeclarationController,
	privacyTemplatesController,
} from "@/modules/privacy-declaration";
import { publishingController } from "@/modules/publishing";
import { reviewsController } from "@/modules/reviews";
import { settingsController } from "@/modules/settings";
import { storesController } from "@/modules/stores";
import { bootstrap, systemController } from "@/modules/system";
import { errorHandler } from "@/utils/errors/errorHandler";
import { createLogger } from "@/utils/logger";

const log = createLogger("app");

const port = Number(config.PORT) || 6667;

const app = new Elysia()
	.use(
		cors({
			origin: config.ALLOWED_ORIGINS?.split(",") ?? [],
		}),
	)
	.use(openapi())
	.use(errorHandler)
	.group("/api", (app) =>
		app
			.use(systemController)
			.use(storesController)
			.use(reviewsController)
			.use(publishingController)
			.use(appsController)
			.use(asoProfileController)
			.use(privacyTemplatesController)
			.use(privacyDeclarationController)
			.use(ageRatingPresetsController)
			.use(ageRatingController)
			.use(settingsController)
			.use(aiController)
			.use(appAiPromptsController)
			.use(listingsController),
	)
	.listen(port);

export type App = typeof app;

await bootstrap();

log.info(`AppBoard backend running on http://localhost:${port}`);

function shutdown() {
	log.info("Shutting down...");
	app.stop();
	process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
