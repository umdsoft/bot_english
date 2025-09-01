// src/db.js
require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS ?? '',
  database: process.env.DB_NAME || 'eng_test_bot',
  connectionLimit: 10,
  charset: 'utf8mb4_unicode_ci',
});

async function q(sql, params = []) {
  console.log('[SQL]', sql, params?.length ? params : '');
  return pool.query(sql, params);
}

module.exports = { pool, q };
