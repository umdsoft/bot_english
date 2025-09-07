// src/services/users.js
const { pool } = require("../db");

async function upsertUserByCtx(ctx, lang = "uz") {
  const tg = ctx.from;
  if (!tg?.id) throw new Error("from.id yo'q");

  const fullName = [tg.first_name, tg.last_name].filter(Boolean).join(" ") || null;
  const username = tg.username || null;

  const sql = `
    INSERT INTO users (tg_id, full_name, username, lang)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      full_name = VALUES(full_name),
      username  = VALUES(username),
      lang      = VALUES(lang),
      id        = LAST_INSERT_ID(id)
  `;
  const params = [tg.id, fullName, username, lang];

  const [res] = await pool.query(sql, params);
  // Yangi yozuv bo'lsa insertId = yangi id, bor bo'lsa LAST_INSERT_ID(id) orqali mavjud id
  return res.insertId;
}

async function getUserByTgId(tgId) {
  const [[u]] = await pool.query("SELECT * FROM users WHERE tg_id=?", [tgId]);
  return u || null;
}

async function saveContact(ctx) {
  const tgId = ctx.from.id;
  const phone = ctx.message?.contact?.phone_number || null;
  const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || null;

  await pool.query(
    "UPDATE users SET phone = ?, full_name = ? WHERE tg_id = ?",
    [phone, fullName, tgId]
  );
}

module.exports = { upsertUserByCtx, getUserByTgId, saveContact };
