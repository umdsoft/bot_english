// src/index.js
require("dotenv").config();
const dayjs = require("dayjs");
const { Telegraf, Markup, Input } = require("telegraf");
const { TZ } = require("./config");
const { pool } = require("./db");
process.env.TZ = TZ;
const fs = require("fs");
const { sendResultPDF } = require("./services/pdf"); // pdf.js dan
const bot = new Telegraf(process.env.BOT_TOKEN);
const {
  getNextQuestion,
  getOptions,
  computeAndFinishAttempt,
  getAttemptSummary,
} = require("./services/tests");
const { generateResultPDF } = require("./services/pdf");
const { awardPointsForTest } = require("./services/points");
const { askPhoneKeyboard } = require("./keyboards");
// Handlers & middlewares
const { registerStart } = require("./handlers/start");
const { registerInfo } = require("./handlers/info");
const { registerTestFlow } = require("./handlers/testFlow");
const { registerLead } = require("./handlers/leads");
const { registerAdmin } = require("./handlers/admin");
const { resumePrompt } = require("./middlewares/resumePrompt");
// const { registerTestFlow } = require("./handlers/testGroupFlow");
let wired = false; // handlerlar ikki marta registratsiya bo‘lib ketmasin
let launched = false;
// --- ADD: savol yuborish / yakunlash sikli ---
async function sendNextQuestion(ctx, testId, attemptId) {
  // navbatdagi savolni olamiz
  const q = await getNextQuestion(testId, attemptId);

  // agar savol qolmagan bo‘lsa — urinishni yakunlaymiz
  if (!q) {
    const res = await computeAndFinishAttempt(attemptId);
    const summary = await getAttemptSummary(attemptId);

    // Kanal ID (env ustun, bo'lmasa config)
    const channelId = process.env.CHANNEL_ID || CHANNEL_ID;

    const caption =
      `✅ Test yakunlandi\n` +
      `👤 ${summary.full_name || "-"} ${summary.username ? "(@" + summary.username + ")" : ""}\n` +
      `📱 ${summary.phone || "-"}\n` +
      `🧪 ${summary.test_name}\n` +
      `📊 ${res.percent}% | ${res.level} | ✅ ${res.correctCount} | ❌ ${res.wrongCount}\n` +
      `🕒 ${summary.duration_sec || 0}s`;

    // PDFni kanalga jo'natish (stream orqali). sendResultPDF ichida xatoliklar handle qilingan.
    const ok = await sendResultPDF(
      ctx.telegram,
      channelId,
      attemptId,
      { correctCount: res.correctCount, wrongCount: res.wrongCount },
      caption
    );

    // Agar kanalga yuborishda muammo bo'lsa — foydalanuvchining o'ziga yuboramiz
    if (!ok) {
      await sendResultPDF(
        ctx.telegram,
        ctx.chat.id,
        attemptId,
        { correctCount: res.correctCount, wrongCount: res.wrongCount },
        "ℹ️ Kanalga yuborishda muammo bo‘ldi, fayl sizga yuborildi.\n\n" + caption
      );
    }

    // 🎁 Ball (1 test = 1 marta; not-student cap=10) — try/catchsiz
    const award = await awardPointsForTest({
      userId: res.userId,
      testId: res.testId,
      attemptId,
      basePoints: 2,
    });

    const ballMsg =
      `\n🎁 Ballar: Bu test uchun sizga **${award.awarded} ball** berildi.\n` +
      `🗓 Joriy oy: **${award.monthly} / 100** ball\n` +
      `📈 Umumiy: **${award.total}** ball\n` +
      `ℹ️ Ballarni kelajakda chegirmalarga almashtirishingiz mumkin.`;

    // Yakuniy natija xabari
    await ctx.reply(
      `✅ Test yakunlandi!\n` +
      `Foiz: ${res.percent}%\nDaraja: ${res.level}\n` +
      `✅ To‘g‘ri: ${res.correctCount} ta · ❌ ${res.wrongCount} ta` +
      ballMsg
    );

    // 🔔 LEAD CTA tugmalari (handler ichidagi leads js ni ishga tushiradi)
    await ctx.reply(
      "🎉 Natijangiz bilan tabriklaymiz!  \n" +
      "**Bugun ro‘yxatdan o‘tsangiz — 10% chegirma!**",
      Markup.inlineKeyboard([
        [Markup.button.callback("📚 Kursda o‘qimoqchiman", "lead:start")],
        [Markup.button.callback("ℹ️ Batafsil ma’lumot", "lead:info")],
      ])
    );

    return;
  }

  // savol variantlarini yuboramiz
  const opts = await getOptions(q.id);
  const buttons = opts.map((o) => [
    Markup.button.callback(o.text, `ans:${q.id}:${o.id}:${attemptId}`),
  ]);
  await ctx.reply(`❓ ${q.text}`, Markup.inlineKeyboard(buttons));
}

async function wireUp() {
  if (wired) return;
  registerStart(bot);
  registerInfo(bot);
  registerTestFlow(bot, { sendNextQuestion, askPhoneKeyboard });
  registerLead(bot);
  registerAdmin(bot);
  bot.use(resumePrompt);
  wired = true;
}
// --- ADD: test varianti tanlanganda ishlovchi umumiy handler ---
bot.on("callback_query", async (ctx, next) => {
  const data = ctx.callbackQuery?.data || "";

  if (data.startsWith("ans:")) {
    const [, qIdStr, optIdStr, attemptStr] = data.split(":");
    const qId = Number(qIdStr),
      optId = Number(optIdStr),
      attemptId = Number(attemptStr);

    // javobni saqlaymiz
    const { saveAnswer } = require("./services/tests");
    await saveAnswer(attemptId, qId, optId);

    await ctx.answerCbQuery("Qabul qilindi ✅");

    // keyingi savolga o'tamiz
    const [[att]] = await pool.query(
      "SELECT test_id FROM attempts WHERE id=?",
      [attemptId]
    );
    if (!att) return ctx.reply("Urinish topilmadi.");
    return sendNextQuestion(ctx, att.test_id, attemptId);
  }

  return next(); // boshqa callbacklar ham ishlashi uchun
});
async function startBot() {
  await wireUp();

  // /start, /menu, /help komandalarini set qilish
  try {
    await bot.telegram.setMyCommands([
      { command: "start", description: "Boshlash" },
      { command: "menu", description: "Menyuni ko‘rsatish" },
      { command: "help", description: "Yordam" },
    ]);
  } catch (e) {
    console.warn("setMyCommands:", e.message);
  }

  if (!launched) {
    await bot.launch();
    launched = true;
    console.log(`[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] Bot started`);
  }
  return bot;
}

async function stopBot() {
  try {
    await bot.stop("SIGTERM");
  } catch {}
  launched = false;
}

module.exports = { startBot, stopBot, bot };
