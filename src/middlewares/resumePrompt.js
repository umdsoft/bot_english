const { query } = require("../db");
const { safeReply } = require("../bot/helpers/telegram");

async function resumePrompt(ctx, next) {
  try {
    const tgId = ctx.from?.id;
    if (!tgId) {
      return next();
    }

    const [[user]] = await query("SELECT id FROM users WHERE tg_id=?", [tgId]);
    if (!user) {
      return next();
    }

    const [[attempt]] = await query(
      "SELECT id FROM attempts WHERE user_id=? AND status='started' ORDER BY id DESC LIMIT 1",
      [user.id]
    );

    if (attempt) {
      await safeReply(
        ctx,
        "⏳ Sizda yakunlanmagan test mavjud. Davom ettirish uchun menyudan foydalaning."
      );
    }
  } catch (error) {
    // middleware xatoliklari umumiy oqimni to‘xtatmasin
  }

  return next();
}

module.exports = { resumePrompt };
