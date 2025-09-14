// src/polls/handlers.js
const { pool } = require("../db");

function registerPollBotHandlers(bot) {
  bot.action(/^poll:(\d+):(\d+)$/, async (ctx) => {
    const pollId   = Number(ctx.match[1]);
    const optionId = Number(ctx.match[2]);
    const tgId     = ctx.from.id;

    const [[poll]] = await pool.query(
      `SELECT id, is_multi FROM polls WHERE id=? AND is_active=1`,
      [pollId]
    );
    if (!poll) {
      return ctx.answerCbQuery("So‘rovnoma topilmadi yoki faol emas.", { show_alert: true });
    }

    const [[u]] = await pool.query(`SELECT id FROM users WHERE tg_id=?`, [tgId]);
    const userId = u?.id || null;

    if (poll.is_multi) {
      const [[ex]] = await pool.query(
        `SELECT id FROM poll_votes
         WHERE poll_id=? AND option_id=? AND (user_id=? OR tg_id=?)
         LIMIT 1`,
        [pollId, optionId, userId, tgId]
      );
      if (ex) return ctx.answerCbQuery("Bu variantga ovoz bergansiz.", { show_alert: true });
    } else {
      const [[ex]] = await pool.query(
        `SELECT id FROM poll_votes
         WHERE poll_id=? AND (user_id=? OR tg_id=?)
         LIMIT 1`,
        [pollId, userId, tgId]
      );
      if (ex) return ctx.answerCbQuery("Siz bu so‘rovnomada ovoz bergansiz.", { show_alert: true });
    }

    await pool.query(
      `INSERT INTO poll_votes (poll_id, option_id, user_id, tg_id, created_at)
       VALUES (?,?,?,?, NOW())`,
      [pollId, optionId, userId, tgId]
    );

    // ✅ Javob qaytarib, so‘rovnoma xabarini yo‘q qilamiz
    await ctx.answerCbQuery("Ovoz qabul qilindi ✅", { show_alert: false });
    try {
      await ctx.deleteMessage(); // bot yuborgan xabar — private chatda o‘chira oladi
    } catch (e) {
      // agar o‘chira olmasak, hech bo‘lmasa matnni olib, tugmalarni yo‘q qilamiz
      try {
        await ctx.editMessageText("✅ Ovoz qabul qilindi");
      } catch {}
    }
  });
}

module.exports = { registerPollBotHandlers };
