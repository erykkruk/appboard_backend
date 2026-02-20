import cors from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import config from "@/config";
import { appsController } from "@/modules/apps";
import { assetsController } from "@/modules/assets";
import { historyController } from "@/modules/history";
import { listingsController } from "@/modules/listings";
import { reviewsController } from "@/modules/reviews";
import { storesController } from "@/modules/stores";
import { bootstrap, systemController } from "@/modules/system";
import { errorHandler } from "@/utils/errors/errorHandler";
import { createLogger } from "@/utils/logger";

const log = createLogger("app");

const port = Number(config.PORT) || 3001;

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
			.use(appsController)
			.use(listingsController)
			.use(historyController)
			.use(assetsController)
			.use(reviewsController),
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
