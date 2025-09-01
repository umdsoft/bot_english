const { pool } = require("../db");
const { Markup } = require("telegraf");

async function resumePrompt(ctx, next) {
  try {
    if (ctx.updateType === "callback_query" || ctx.message?.contact) return next();
    const tgId = ctx.from.id;
    const [[u]] = await pool.query("SELECT id FROM users WHERE tg_id=?", [tgId]);
    if (!u) return next();
    const [[att]] = await pool.query(
      "SELECT id FROM attempts WHERE user_id=? AND status='started' ORDER BY id DESC LIMIT 1",
      [u.id]
    );
    if (att) {
      await ctx.reply(
        "Sizda tugallanmagan test bor. Davom ettirasizmi?",
        Markup.inlineKeyboard([Markup.button.callback("▶️ Davom ettirish", `resume:${att.id}`)])
      );
    }
  } catch {}
  return next();
}

module.exports = { resumePrompt };
