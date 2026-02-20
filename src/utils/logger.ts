import pino from "pino";

const logger = pino({
	level: process.env.LOG_LEVEL ?? "info",
	transport:
		process.env.NODE_ENV === "development"
			? { target: "pino-pretty" }
			: undefined,
});

export function createLogger(module: string) {
	return logger.child({ module });
}

export default logger;
