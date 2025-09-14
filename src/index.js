// src/index.js
require("dotenv").config();
const dayjs = require("dayjs");
const { Telegraf, Markup, Input } = require("telegraf");

// ⬅️ CHANNEL_ID ham configdan kelsa, shu yerda import qilamiz
const { TZ, CHANNEL_ID } = require("./config"); // ⬅️ YANGI: CHANNEL_ID qo'shildi

const { pool } = require("./db");
process.env.TZ = TZ;
const fs = require("fs");
const { sendResultPDF } = require("./services/pdf"); // pdf.js dan
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.catch((err, ctx) => {
  const code = err?.response?.error_code;
  const desc = err?.response?.description || err?.description || err?.message;

  if (code === 403 || code === 400 || code === 401) {
    console.warn("tg soft error:", code, desc, "chat:", ctx?.chat?.id);
    return; // protsess to‘xtamasin
  }
  console.error("bot.catch fatal:", err);
});

process.on("unhandledRejection", (reason) => {
  const code = reason?.response?.error_code;
  const desc = reason?.response?.description || reason?.message;
  if (code === 403 || code === 400 || code === 401) {
    console.warn("unhandledRejection tg soft error:", code, desc);
    return;
  }
  console.error("unhandledRejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
});
const {
  getNextQuestion,
  getOptions,
  computeAndFinishAttempt,
  getAttemptSummary,
} = require("./services/tests");
const { generateResultPDF } = require("./services/pdf");
const { awardPointsForTest } = require("./services/points");
const { askPhoneKeyboard } = require("./keyboards");
const { registerCourseFlow } = require("./handlers/courseFlow");
// Handlers & middlewares
const { registerStart } = require("./handlers/start");
const { registerInfo } = require("./handlers/info");
const { registerTestFlow } = require("./handlers/testFlow");
const { registerLead } = require("./handlers/leads");
const { registerAdmin } = require("./handlers/admin");
const { resumePrompt } = require("./middlewares/resumePrompt");
const { registerPolls } = require("./handlers/polls");
// ⬅️ Kanal relay handler (kanal postiga reply qilib nusxalash)
const { registerChannelRelay } = require("./handlers/channelRelay");
const { registerPollBotHandlers } = require("./handlers/polls.bot");
let wired = false; // handlerlar ikki marta registratsiya bo‘lib ketmasin
let launched = false;

// -------- SAFE HELPERS (app yiqilmasin) --------
function safeReply(ctx, text, extra) {
  // 403 (blocked) va boshqa xatolarni yutib yuboramiz
  return ctx.reply(text, extra).catch(() => null);
}
function safeAnswerCb(ctx, text, extra) {
  return ctx.answerCbQuery(text, extra).catch(() => {});
}

// --- ADD: savol yuborish / yakunlash sikli ---
async function sendNextQuestion(ctx, testId, attemptId) {
  // navbatdagi savolni olamiz
  const q = await getNextQuestion(testId, attemptId);

  // agar savol qolmagan bo‘lsa — urinishni yakunlaymiz
  if (!q) {
    const res = await computeAndFinishAttempt(attemptId);
    const summary = await getAttemptSummary(attemptId);

    // Kanal ID (env ustun, bo'lmasa config)
    const channelId = process.env.CHANNEL_ID || CHANNEL_ID; // ⬅️ CHANNEL_ID endi importdan keladi

    const caption =
      `✅ Test yakunlandi\n` +
      `👤 ${summary.full_name || "-"} ${
        summary.username ? "(@" + summary.username + ")" : ""
      }\n` +
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
        "ℹ️ Kanalga yuborishda muammo bo‘ldi, fayl sizga yuborildi.\n\n" +
          caption
      );
    }

    // 🎁 Ball (1 test = 1 marta; not-student cap=10)
    try {
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

      // Yakuniy natija xabari (safe)
      await safeReply(
        ctx,
        `✅ Test yakunlandi!\n` +
          `Foiz: ${res.percent}%\nDaraja: ${res.level}\n` +
          `✅ To‘g‘ri: ${res.correctCount} ta · ❌ ${res.wrongCount} ta` +
          ballMsg
      );
    } catch (e) {
      // ball hisoblash xatosi appni to'xtatmasin
      await safeReply(
        ctx,
        `✅ Test yakunlandi!\n` +
          `Foiz: ${res.percent}%\nDaraja: ${res.level}\n` +
          `✅ To‘g‘ri: ${res.correctCount} ta · ❌ ${res.wrongCount} ta`
      );
    }

    // 🔔 LEAD CTA tugmalari (handler ichidagi leads js ni ishga tushiradi) — safe
    await safeReply(
      ctx,
      "🎉 Natijangiz bilan tabriklaymiz!  \n" +
        "**Bugun ro‘yxatdan o‘tsangiz — 10% chegirma!**",
      Markup.inlineKeyboard([
        [Markup.button.callback("📚 Kursda o‘qimoqchiman", "lead:start")],
        [Markup.button.callback("ℹ️ Batafsil ma’lumot", "lead:info")],
      ])
    );

    return;
  }

  // savol variantlarini yuboramiz — safe
  const opts = await getOptions(q.id);
  const buttons = opts.map((o) => [
    Markup.button.callback(o.text, `ans:${q.id}:${o.id}:${attemptId}`),
  ]);
  await safeReply(ctx, `❓ ${q.text}`, Markup.inlineKeyboard(buttons));
}

async function wireUp() {
  if (wired) return;
  registerStart(bot);
  registerInfo(bot);
  registerTestFlow(bot, { sendNextQuestion, askPhoneKeyboard });
  registerCourseFlow(bot, { sendNextQuestion, askPhoneKeyboard });
  registerLead(bot);
  registerPollBotHandlers(bot);
  registerAdmin(bot);
  bot.use(resumePrompt);

  // ⬅️ Kanalga post joylanganda, bot o‘sha postga reply qilib nusxa qoldiradi
  registerChannelRelay(bot);
  registerPolls(bot);

  wired = true;
}
bot.command("menu", async (ctx) => {
  const tgId = ctx.from.id;
  const [[u]] = await pool.query("SELECT is_student FROM users WHERE tg_id=?", [
    tgId,
  ]);
  const rows = [
    [Markup.button.text("📝 Testni boshlash")], // placement
  ];
  if (u?.is_student) {
    rows.push([Markup.button.text("📚 Kurslarim")]); // kurs oqimi
  }
  return ctx.reply("Menyu:", Markup.keyboard(rows).resize());
});
bot.on("callback_query", async (ctx, next) => {
  const data = ctx.callbackQuery?.data || "";

  if (data.startsWith("ans:")) {
    // DARHOL ack — 15s limitdan o'tmaslik uchun
    safeAnswerCb(ctx, "Qabul qilindi ✅", { show_alert: false });

    try {
      const [, qIdStr, optIdStr, attemptStr] = data.split(":");
      const qId = Number(qIdStr);
      const optId = Number(optIdStr);
      const attemptId = Number(attemptStr);

      if (!qId || !optId || !attemptId) return; // yaroqsiz payload

      // Javobni saqlash
      const { saveAnswer } = require("./services/tests");
      await saveAnswer(attemptId, qId, optId);

      // Keyingi savolga o'tish
      const [[att]] = await pool.query(
        "SELECT test_id FROM attempts WHERE id=?",
        [attemptId]
      );
      if (!att) {
        await safeReply(ctx, "Urinish topilmadi.");
        return;
      }

      await sendNextQuestion(ctx, att.test_id, attemptId);
    } catch (e) {
      console.error(
        "callback 'ans:' error:",
        e?.description || e?.message || e
      );
    }

    return; // shu yerda tugatamiz
  }

  return next(); // boshqa callbacklar ham ishlashi uchun
});

async function startBot() {
  await wireUp();

  // /start, /menu, /help komandalarini set qilishdd
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
    // Polling rejimi — channel_post/edited_channel_post avtomatik keladi
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
