const dayjs = require("dayjs");

const LEVELS = ["debug", "info", "warn", "error"];

function format(level, namespace, message) {
  const ts = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const ns = namespace ? `[${namespace}]` : "";
  return `${ts} ${level.toUpperCase()} ${ns}`.trim() + ` ${message}`;
}

function serializeMeta(meta) {
  if (!meta) {
    return "";
  }
  if (typeof meta === "string") {
    return meta;
  }
  try {
    return JSON.stringify(meta);
  } catch (err) {
    return String(meta);
  }
}

function log(level, namespace, message, meta) {
  const output = format(level, namespace, message);
  const serialized = serializeMeta(meta);
  const finalMessage = serialized ? `${output} ${serialized}` : output;

  const target = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  target(finalMessage);
}

function createLogger(namespace = "") {
  const logger = {};
  for (const level of LEVELS) {
    logger[level] = (message, meta) => log(level, namespace, message, meta);
  }
  return logger;
}

const rootLogger = createLogger();

module.exports = {
  createLogger,
  rootLogger,
};
