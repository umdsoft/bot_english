// src/main.js
require("dotenv").config();
const dayjs = require("dayjs");

const app = require("./web/server"); // Express app (admin panel)
const { startBot, stopBot } = require("./index"); // Bot moduli (start/stop)

const PORT = process.env.ADMIN_PORT || 4001;

async function bootstrap() {
  // 1) Admin HTTP server
  const server = app.listen(PORT, () => {
    console.log(
      `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] Admin listening on :${PORT}`
    );
  });

  // 2) Telegram bot
  await startBot();

  // 3) Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down...`);
    try {
      await stopBot();
      server.close(() => {
        console.log("HTTP server closed");
        process.exit(0);
      });
      // agar 5s ichida yopilmasa, majburan chiqamiz
      setTimeout(() => process.exit(0), 5000).unref();
    } catch (e) {
      console.error("Shutdown error:", e);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((e) => {
  console.error("Bootstrap error:", e);
  process.exit(1);
});
