const path = require("path");

const parseInteger = (value, fallback) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const num = Number(value);
  return Number.isNaN(num) ? fallback : num;
};

const pickFirstDefined = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
};

const defaultChannelId = "-1002937713606";

const config = {
  timezone: process.env.TZ || "Asia/Tashkent",
  assetsDir: path.join(__dirname, "..", "assets"),
  telegram: {
    botToken: process.env.BOT_TOKEN || "",
    resultChannelId: pickFirstDefined(
      process.env.CHANNEL_ID,
      process.env.TARGET_CHANNEL_ID,
      defaultChannelId
    ),
  },
  leads: {
    targetChannelId: pickFirstDefined(
      process.env.LEADS_CHANNEL_ID,
      process.env.TARGET_CHANNEL_ID,
      process.env.CHANNEL_ID,
      defaultChannelId
    ),
  },
  admin: {
    port: parseInteger(process.env.ADMIN_PORT, 4001),
    sessionSecret: process.env.ADMIN_SESSION_SECRET || "supersecret_session_key",
  },
  database: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: parseInteger(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || "root",
    password: Object.prototype.hasOwnProperty.call(process.env, "DB_PASS")
      ? process.env.DB_PASS
      : "",
    name: process.env.DB_NAME || "eng_test_bot",
    connectionLimit: parseInteger(process.env.DB_POOL_SIZE, 10),
    enableSqlLogging: String(process.env.SQL_DEBUG || "").toLowerCase() === "true",
    maxRetries: parseInteger(process.env.DB_MAX_RETRIES, 2),
    retryDelayMs: parseInteger(process.env.DB_RETRY_DELAY_MS, 200),
  },
};

if (!process.env.TZ) {
  process.env.TZ = config.timezone;
}

module.exports = {
  config,
  TZ: config.timezone,
  ASSETS_DIR: config.assetsDir,
  CHANNEL_ID: config.telegram.resultChannelId,
  TARGET_CHANNEL_ID: config.leads.targetChannelId,
};
