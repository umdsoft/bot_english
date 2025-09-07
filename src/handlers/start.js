// src/handlers/start.js
const { upsertUserByCtx, saveContact } = require("../services/users");
const { askPhoneKeyboard, mainMenuKeyboard } = require("../keyboards");

// — helper: 403/blockedni yutib yuboradigan xavfsiz yuborish
function isForbidden(e) {
  return e?.response?.error_code === 403; // "bot was blocked by the user"
}
async function safeReply(ctx, text, extra) {
  try {
    return await ctx.reply(text, extra);
  } catch (e) {
    if (isForbidden(e)) {
      console.warn("User blocked the bot:", ctx.from?.id);
      return null; // jim o'tamiz
    }
    console.error("reply error:", e?.description || e?.message || e);
    return null;
  }
}

function registerStart(bot) {
  bot.start(async (ctx) => {
    try {
      await upsertUserByCtx(ctx, "uz");
    } catch (e) {
      console.error("upsertUserByCtx error:", e?.message || e);
      // foydalanuvchiga baribir yozishga urinishimiz shart emas
    }

    await safeReply(
      ctx,
      "Assalomu alaykum! Ingliz tili bo‘yicha qisqa placement testini topshirib darajangizni bilib oling.",
      mainMenuKeyboard()
    );

    await safeReply(
      ctx,
      "Davom etishdan oldin telefon raqamingizni yuboring:",
      askPhoneKeyboard()
    );
  });

  bot.on("contact", async (ctx) => {
    try {
      await saveContact(ctx);
    } catch (e) {
      console.error("saveContact error:", e?.message || e);
    }
    await safeReply(ctx, "Rahmat! Endi testni boshlashingiz mumkin. 👇", mainMenuKeyboard());
  });

  bot.command("menu", async (ctx) => {
    await safeReply(ctx, "Menyu 👇", mainMenuKeyboard());
  });

  bot.command("help", async (ctx) => {
    await safeReply(ctx, "Savollar bo‘lsa, administratorga yozing.");
  });
}

module.exports = { registerStart };
