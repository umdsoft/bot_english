const { Markup } = require("telegraf");
const { TARGET_CHANNEL_ID } = require("../config");
const {
  getActiveTest, findActiveAttempt, startAttempt,
  getNextQuestion, getOptions, saveAnswer,
  computeAndFinishAttempt, getAttemptSummary
} = require("../services/tests");
const { generateResultPDF } = require("../services/pdf");
const { awardPointsForTest } = require("../services/points");
const { getUserByTgId } = require("../services/users");
const { askPhoneKeyboard } = require("../keyboards");
const { pool } = require("../db");

function registerTestFlow(bot) {
  bot.hears("📝 Testni boshlash", async (ctx) => {
    const tgId = ctx.from.id;
    const u = await getUserByTgId(tgId);
    if (!u) return ctx.reply("Iltimos, /start buyrug‘ini bosing.");
    if (!u.phone) return ctx.reply("Avval telefon raqamingizni yuboring.", askPhoneKeyboard());

    const active = await findActiveAttempt(u.id);
    if (active) {
      await ctx.reply("Sizda ochiq test bor — davom ettiryapmiz.");
      return sendNextQuestion(ctx, active.test_id, active.id);
    }

    const test = await getActiveTest("eng_a1");
    if (!test) return ctx.reply("Hozircha faol test topilmadi. Keyinroq urinib ko‘ring.");

    const attemptId = await startAttempt(u.id, test.id);
    await ctx.reply(`Boshladik! Test: ${test.name}\nOmad!`);
    await sendNextQuestion(ctx, test.id, attemptId);
  });

  bot.on("callback_query", async (ctx, next) => {
    const data = ctx.callbackQuery?.data || "";

    if (data.startsWith("ans:")) {
      const [, qIdStr, optIdStr, attemptStr] = data.split(":");
      const qId = Number(qIdStr), optId = Number(optIdStr), attemptId = Number(attemptStr);
      try {
        await saveAnswer(attemptId, qId, optId);
        await ctx.answerCbQuery("Qabul qilindi ✅");
        const [[att]] = await pool.query("SELECT test_id FROM attempts WHERE id=?", [attemptId]);
        return sendNextQuestion(ctx, att.test_id, attemptId);
      } catch (e) {
        console.error(e);
        return ctx.answerCbQuery("Xatolik", { show_alert: true });
      }
    }

    if (data.startsWith("resume:")) {
      const attemptId = Number(data.split(":")[1]);
      const [[att]] = await pool.query("SELECT test_id FROM attempts WHERE id=?", [attemptId]);
      await ctx.answerCbQuery();
      if (!att) return ctx.reply("Urinish topilmadi.");
      return sendNextQuestion(ctx, att.test_id, attemptId);
    }

    return next();
  });
}

async function sendNextQuestion(ctx, testId, attemptId) {
  const q = await getNextQuestion(testId, attemptId);
  if (!q) {
    // yakun
    const res = await computeAndFinishAttempt(attemptId);
    try {
      const pdfPath = await generateResultPDF(attemptId, {
        correctCount: res.correctCount,
        wrongCount: res.wrongCount
      });
      const summary = await getAttemptSummary(attemptId);

      const caption =
        `✅ Test yakunlandi\n` +
        `👤 ${summary.full_name || "-"} ${summary.username ? "(@" + summary.username + ")" : ""}\n` +
        `📱 ${summary.phone || "-"}\n` +
        `🧪 ${summary.test_name}\n` +
        `📊 ${summary.percent}% | ${summary.level_guess} | ✅ ${res.correctCount} | ❌ ${res.wrongCount}\n` +
        `🕒 ${summary.duration_sec || 0}s`;

      await ctx.telegram.sendDocument(
        TARGET_CHANNEL_ID,
        { source: pdfPath, filename: `result_${attemptId}.pdf` },
        { caption }
      );

      try { require("fs").unlinkSync(pdfPath); } catch {}
    } catch (e) {
      console.error("PDF yoki kanalga yuborish xatosi:", e);
    }

    // Ballar
    let ballMsg = "";
    try {
      const award = await awardPointsForTest({
        userId: res.userId, testId: res.testId, attemptId, basePoints: 2
      });
      ballMsg =
        `\n🎁 Ballar: Bu test uchun sizga **${award.awarded} ball** berildi.\n` +
        `🗓 Joriy oy: **${award.monthly} / 100** ball\n` +
        `📈 Umumiy: **${award.total}** ball\n` +
        `ℹ️ Ballarni kelajakda chegirmalarga almashtirishingiz mumkin.`;
    } catch (e) {
      console.error("Points error:", e);
    }

    await ctx.reply(
      `✅ Test yakunlandi!\n` +
      `Foiz: ${res.percent}%\nDaraja: ${res.level}\n` +
      `✅ To‘g‘ri: ${res.correctCount} ta · ❌ ${res.wrongCount} ta` +
      ballMsg
    );

    // Leadga CTA
    const { Markup } = require("telegraf");
    await ctx.reply(
      "🎉 Natijangiz bilan tabriklaymiz!\n" +
      "Bizning kurslarda o‘qishni boshlamoqchimisiz?\n" +
      "**Bugun ro‘yxatdan o‘tsangiz — 10% chegirma!**",
      Markup.inlineKeyboard([
        [Markup.button.callback("📚 Kursda o‘qimoqchiman", "lead:start")],
        [Markup.button.callback("ℹ️ Batafsil ma’lumot", "lead:info")],
      ])
    );
    return;
  }

  const opts = await getOptions(q.id);
  const { Markup } = require("telegraf");
  const buttons = opts.map(o => [Markup.button.callback(o.text, `ans:${q.id}:${o.id}:${attemptId}`)]);
  await ctx.reply(`❓ ${q.text}`, Markup.inlineKeyboard(buttons));
}

module.exports = { registerTestFlow };
