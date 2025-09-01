function registerInfo(bot) {
  bot.hears("ℹ️ Ma’lumot", async (ctx) => {
    await ctx.reply(
      "A1 darajadagi test: yakunda foiz, taxminiy CEFR, to‘g‘ri/xato soni hisoblanadi va PDF hisobot administratorlar kanaliga yuboriladi.\n" +
      "Ball tizimi: birinchi marta testni yakunlasangiz 2 ball olasiz (o‘quvchi bo‘lmaganlar uchun umumiy cap 10 ball)."
    );
  });

  bot.hears("🌍 Xalqaro ta’lim haqida ma’lumot", async (ctx) => {
    await ctx.reply(
      "Xalqaro ta’lim (IELTS/CEFR, Foundation, Undergraduate, Graduate) bo‘yicha qisqa qo‘llanma va yo‘riqnoma.\n\n" +
      "Tez orada batafsil ma’lumotni shu yerda taqdim etamiz."
    );
  });
}

module.exports = { registerInfo };
