// src/main.js
require("dotenv").config();
const dayjs = require("dayjs");

const app = require("./web/server");
const { startBot, stopBot } = require("./index");
const { config } = require("./config");
const { createLogger } = require("./core/logger");

const logger = createLogger("bootstrap");
const PORT = config.admin.port || 4001;

async function bootstrap() {
  const server = app.listen(PORT, () => {
    logger.info(`Admin listening on :${PORT}`, {
      startedAt: dayjs().format("YYYY-MM-DD HH:mm:ss"),
    });
  });

  await startBot();

  const shutdown = async (signal) => {
    logger.warn(`${signal} received. Shutting down...`);
    try {
      await stopBot();
      server.close(() => {
        logger.info("HTTP server closed");
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 5000).unref();
    } catch (error) {
      logger.error("Shutdown error", { message: error?.message });
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((error) => {
  logger.error("Bootstrap error", { message: error?.message, stack: error?.stack });
});
