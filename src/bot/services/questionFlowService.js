const { Markup } = require("telegraf");
const { createLogger } = require("../../core/logger");
const { CHANNEL_ID, config } = require("../../config");
const {
  getNextQuestion,
  getOptions,
  computeAndFinishAttempt,
  getAttemptSummary,
} = require("../../services/tests");
const { sendResultPDF } = require("../../services/pdf");
const { awardPointsForTest } = require("../../services/points");
const { safeReply } = require("../helpers/telegram");

class QuestionFlowService {
  constructor(options = {}) {
    this.logger = options.logger || createLogger("bot:questions");
    this.tests = options.tests || {
      getNextQuestion,
      getOptions,
      computeAndFinishAttempt,
      getAttemptSummary,
    };
    this.pdfService = options.pdfService || { sendResultPDF };
    this.pointsService = options.pointsService || { awardPointsForTest };
    this.channelId = options.channelId || CHANNEL_ID || config.telegram.resultChannelId;
  }

  async sendNextQuestion(ctx, testId, attemptId) {
    const question = await this.tests.getNextQuestion(testId, attemptId);

    if (!question) {
      await this.finishAttempt(ctx, attemptId);
      return;
    }

    const options = await this.tests.getOptions(question.id);
    const buttons = options.map((option) => [
      Markup.button.callback(
        option.text,
        `ans:${question.id}:${option.id}:${attemptId}`
      ),
    ]);

    await safeReply(ctx, `❓ ${question.text}`, Markup.inlineKeyboard(buttons));
  }

  async finishAttempt(ctx, attemptId) {
    const result = await this.tests.computeAndFinishAttempt(attemptId);
    const summary = await this.tests.getAttemptSummary(attemptId);

    if (!summary) {
      this.logger.error("Attempt summary not found", { attemptId });
      await safeReply(ctx, "Natija hisoboti topilmadi.");
      return;
    }

    const caption = this.buildResultCaption(summary, result);
    const counts = { correctCount: result.correctCount, wrongCount: result.wrongCount };

    const channelId = this.channelId || ctx.chat?.id;

    const sentToChannel = await this.pdfService.sendResultPDF(
      ctx.telegram,
      channelId,
      attemptId,
      counts,
      caption
    );

    if (!sentToChannel) {
      await this.pdfService.sendResultPDF(
        ctx.telegram,
        ctx.chat.id,
        attemptId,
        counts,
        `ℹ️ Kanalga yuborishda muammo bo‘ldi.\n\n${caption}`
      );
    }

    await this.notifyUser(ctx, { ...result, attemptId });
    await this.showLeadCta(ctx);
  }

  buildResultCaption(summary, result) {
    return (
      `✅ Test yakunlandi\n` +
      `👤 ${summary.full_name || "-"} ${
        summary.username ? "(@" + summary.username + ")" : ""
      }\n` +
      `📱 ${summary.phone || "-"}\n` +
      `🧪 ${summary.test_name}\n` +
      `📊 ${result.percent}% | ${result.level} | ✅ ${result.correctCount} | ❌ ${result.wrongCount}\n` +
      `🕒 ${summary.duration_sec || 0}s`
    );
  }

  async notifyUser(ctx, result) {
    const baseMessage =
      `✅ Test yakunlandi!\n` +
      `Foiz: ${result.percent}%\nDaraja: ${result.level}\n` +
      `✅ To‘g‘ri: ${result.correctCount} ta · ❌ ${result.wrongCount} ta`;

    try {
      const award = await this.pointsService.awardPointsForTest({
        userId: result.userId,
        testId: result.testId,
        attemptId: result.attemptId || null,
        basePoints: 2,
      });

      const bonusMessage =
        `\n🎁 Ballar: Bu test uchun sizga **${award.awarded} ball** berildi.\n` +
        `🗓 Joriy oy: **${award.monthly} / 100** ball\n` +
        `📈 Umumiy: **${award.total}** ball\n` +
        `ℹ️ Ballarni kelajakda chegirmalarga almashtirishingiz mumkin.`;

      await safeReply(ctx, baseMessage + bonusMessage);
    } catch (error) {
      this.logger.warn("Failed to award points", {
        message: error?.message,
        userId: result.userId,
        testId: result.testId,
      });
      await safeReply(ctx, baseMessage);
    }
  }

  async showLeadCta(ctx) {
    await safeReply(
      ctx,
      "🎉 Natijangiz bilan tabriklaymiz!  \n" +
        "**Bugun ro‘yxatdan o‘tsangiz — 10% chegirma!**",
      Markup.inlineKeyboard([
        [Markup.button.callback("📚 Kursda o‘qimoqchiman", "lead:start")],
        [Markup.button.callback("ℹ️ Batafsil ma’lumot", "lead:info")],
      ])
    );
  }
}

module.exports = { QuestionFlowService };
