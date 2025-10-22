// src/index.js
require("dotenv").config();
const dayjs = require("dayjs");
const { Telegraf, Markup } = require("telegraf");

const { config, TZ } = require("./config");
const { query } = require("./db");
const { QuestionFlowService } = require("./bot/services/questionFlowService");
const { safeReply, safeAnswerCallback } = require("./bot/helpers/telegram");
const { createLogger } = require("./core/logger");
const { sendResultPDF } = require("./services/pdf");
const { awardPointsForTest } = require("./services/points");
const {
  getNextQuestion,
  getOptions,
  computeAndFinishAttempt,
  getAttemptSummary,
  saveAnswer,
} = require("./services/tests");
const { askPhoneKeyboard } = require("./keyboards");
const { registerCourseFlow } = require("./handlers/courseFlow");
const { registerStart } = require("./handlers/start");
const { registerInfo } = require("./handlers/info");
const { registerTestFlow } = require("./handlers/testFlow");
const { registerLead } = require("./handlers/leads");
const { registerAdmin } = require("./handlers/admin");
const { resumePrompt } = require("./middlewares/resumePrompt");
const { registerPolls } = require("./handlers/polls");
const { registerChannelRelay } = require("./handlers/channelRelay");
const { registerPollBotHandlers } = require("./handlers/polls.bot");

process.env.TZ = TZ;

const logger = createLogger("bot");

function ensureToken(token) {
  if (!token) {
    throw new Error("BOT_TOKEN environment variable is required");
  }
  return token;
}

const bot = new Telegraf(ensureToken(config.telegram.botToken));
const questionFlowService = new QuestionFlowService({
  tests: {
    getNextQuestion,
    getOptions,
    computeAndFinishAttempt,
    getAttemptSummary,
  },
  pdfService: { sendResultPDF },
  pointsService: { awardPointsForTest },
});

bot.catch((error, ctx) => {
  const code = error?.response?.error_code;
  const description = error?.response?.description || error?.description || error?.message;

  if (code === 400 || code === 401 || code === 403) {
    logger.warn("telegram soft error", {
      code,
      description,
      chatId: ctx?.chat?.id,
    });
    return;
  }

  logger.error("bot.catch fatal", { code, description });
});

process.on("unhandledRejection", (reason) => {
  const code = reason?.response?.error_code;
  const description = reason?.response?.description || reason?.message;
  if (code === 400 || code === 401 || code === 403) {
    logger.warn("unhandledRejection telegram soft error", { code, description });
    return;
  }
  logger.error("unhandledRejection", { code, description });
});

process.on("uncaughtException", (error) => {
  logger.error("uncaughtException", { message: error?.message, stack: error?.stack });
});

let wired = false;
let launched = false;

async function wireUp() {
  if (wired) {
    return;
  }

  const sendNextQuestion = questionFlowService.sendNextQuestion.bind(questionFlowService);

  registerStart(bot);
  registerInfo(bot);
  registerTestFlow(bot, { sendNextQuestion, askPhoneKeyboard });
  registerCourseFlow(bot, { sendNextQuestion, askPhoneKeyboard });
  registerLead(bot);
  registerPollBotHandlers(bot);
  registerAdmin(bot);
  bot.use(resumePrompt);
  registerChannelRelay(bot);
  registerPolls(bot);

  wired = true;
}

bot.command("menu", async (ctx) => {
  const tgId = ctx.from.id;
  const [[user]] = await query("SELECT is_student FROM users WHERE tg_id=?", [tgId]);
  const rows = [[Markup.button.text("📝 Testni boshlash")]];
  if (user?.is_student) {
    rows.push([Markup.button.text("📚 Kurslarim")]);
  }
  return ctx.reply("Menyu:", Markup.keyboard(rows).resize());
});

bot.on("callback_query", async (ctx, next) => {
  const data = ctx.callbackQuery?.data || "";

  if (!data.startsWith("ans:")) {
    return next();
  }

  safeAnswerCallback(ctx, "Qabul qilindi ✅", { show_alert: false });

  try {
    const [, qIdStr, optIdStr, attemptStr] = data.split(":");
    const qId = Number(qIdStr);
    const optId = Number(optIdStr);
    const attemptId = Number(attemptStr);

    if (!qId || !optId || !attemptId) {
      return;
    }

    await saveAnswer(attemptId, qId, optId);

    const [[attempt]] = await query(
      "SELECT test_id FROM attempts WHERE id=?",
      [attemptId]
    );

    if (!attempt) {
      await safeReply(ctx, "Urinish topilmadi.");
      return;
    }

    await questionFlowService.sendNextQuestion(ctx, attempt.test_id, attemptId);
  } catch (error) {
    logger.error("callback ans error", { message: error?.message });
  }
});

async function startBot() {
  await wireUp();

  try {
    await bot.telegram.setMyCommands([
      { command: "start", description: "Boshlash" },
      { command: "menu", description: "Menyuni ko‘rsatish" },
      { command: "help", description: "Yordam" },
    ]);
  } catch (error) {
    logger.warn("setMyCommands failed", { message: error?.message });
  }

  if (!launched) {
    await bot.launch();
    launched = true;
    logger.info(`Bot started at ${dayjs().format("YYYY-MM-DD HH:mm:ss")}`);
  }

  return bot;
}

async function stopBot() {
  try {
    await bot.stop("SIGTERM");
  } catch (error) {
    logger.warn("Failed to stop bot", { message: error?.message });
  }
  launched = false;
}

module.exports = { startBot, stopBot, bot };
