// src/db.js
require("dotenv").config();
const mysql = require("mysql2/promise");
const { config } = require("./config");
const { createLogger } = require("./core/logger");

const logger = createLogger("db");

const RETRYABLE_ERRORS = new Set([
  "ECONNREFUSED",
  "PROTOCOL_CONNECTION_LOST",
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
  "ETIMEDOUT",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "PROTOCOL_ENQUEUE_AFTER_QUIT",
  "PROTOCOL_ENQUEUE_HANDSHAKE_TWICE",
]);

const pool = mysql.createPool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
  connectionLimit: config.database.connectionLimit,
  charset: "utf8mb4_unicode_ci",
  waitForConnections: true,
});

function shouldRetry(error) {
  if (!error) return false;
  if (RETRYABLE_ERRORS.has(error.code)) return true;
  const message = String(error.message || "");
  return message.includes("ECONNREFUSED") || message.includes("PROTOCOL_CONNECTION_LOST");
}

function logQuery(sql, params) {
  if (!config.database.enableSqlLogging) {
    return;
  }
  const text = sql.replace(/\s+/g, " ").trim();
  logger.debug(`SQL: ${text}`, Array.isArray(params) && params.length ? params : undefined);
}

async function query(sql, params = [], options = {}) {
  const { retries = config.database.maxRetries, retryDelayMs = config.database.retryDelayMs } = options;
  let attempt = 0;
  let lastError;

  logQuery(sql, params);

  while (attempt <= retries) {
    try {
      return await pool.query(sql, params);
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt === retries) {
        logger.error(`Query failed after ${attempt + 1} attempt(s)`, {
          code: error?.code,
          message: error?.message,
        });
        throw error;
      }
      const waitMs = retryDelayMs * Math.pow(2, attempt);
      logger.warn(`Query failed, retrying in ${waitMs}ms`, {
        code: error?.code,
        message: error?.message,
      });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      attempt += 1;
    }
  }

  throw lastError;
}

async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      logger.error("Transaction rollback failed", { message: rollbackError?.message });
    }
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { pool, query, withTransaction };
