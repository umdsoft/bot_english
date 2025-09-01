const { upsertUserByCtx, saveContact } = require("../services/users");
const { askPhoneKeyboard, mainMenuKeyboard } = require("../keyboards");

function registerStart(bot) {
  bot.start(async (ctx) => {
    await upsertUserByCtx(ctx, "uz");
    await ctx.reply(
      "Assalomu alaykum! Ingliz tili bo‘yicha qisqa placement testini topshirib darajangizni bilib oling.",
      mainMenuKeyboard()
    );
    await ctx.reply("Davom etishdan oldin telefon raqamingizni yuboring:", askPhoneKeyboard());
  });

  bot.on("contact", async (ctx) => {
    await saveContact(ctx);
    await ctx.reply("Rahmat! Endi testni boshlashingiz mumkin. 👇", mainMenuKeyboard());
  });

  bot.command("menu", async (ctx) => ctx.reply("Menyu 👇", mainMenuKeyboard()));
  bot.command("help", async (ctx) => ctx.reply("Savollar bo‘lsa, administratorga yozing."));
}

module.exports = { registerStart };
