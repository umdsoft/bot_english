const { pool } = require("../db");

async function upsertUserByCtx(ctx, lang = "uz") {
  const tg = ctx.from;
  const fullName = [tg.first_name, tg.last_name].filter(Boolean).join(" ");
  const username = tg.username || null;

  const [rows] = await pool.query("SELECT id FROM users WHERE tg_id=?", [tg.id]);
  if (rows.length) return rows[0].id;

  const [ins] = await pool.query(
    "INSERT INTO users (tg_id, full_name, username, lang) VALUES (?,?,?,?)",
    [tg.id, fullName, username, lang]
  );
  return ins.insertId;
}

async function getUserByTgId(tgId) {
  const [[u]] = await pool.query("SELECT * FROM users WHERE tg_id=?", [tgId]);
  return u || null;
}

async function saveContact(ctx) {
  const tgId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;
  const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");

  await pool.query("UPDATE users SET phone=?, full_name=? WHERE tg_id=?", [
    phone,
    fullName,
    tgId,
  ]);
}

module.exports = { upsertUserByCtx, getUserByTgId, saveContact };
