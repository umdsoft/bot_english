// src/handlers/testFlow.js
const { Markup } = require("telegraf");
const { query } = require("../db");
const { safeReply, safeAnswerCallback } = require("../bot/helpers/telegram");
const { createLogger } = require("../core/logger");

const logger = createLogger("handlers:testFlow");

const CEFR_TO_GROUP = {
  A1: "BEGINNER",
  A2: "ELEMENTARY",
  B1: "PRE-INTERMEDIATE",
  B2: "INTERMEDIATE",
  C1: "UPPER-INTERMEDIATE",
  C2: "ADVANCED",
};

const GROUP_LABELS = {
  BEGINNER: "Beginner",
  ELEMENTARY: "Elementary",
  "PRE-INTERMEDIATE": "Pre-Intermediate",
  INTERMEDIATE: "Intermediate",
  "UPPER-INTERMEDIATE": "Upper-Intermediate",
  ADVANCED: "Advanced",
  IELTS: "IELTS",
  CEFR: "CEFR",
};

const GROUP_PATTERNS = [
  { key: "BEGINNER", re: /\bBEGINNER\b/i },
  { key: "ELEMENTARY", re: /\bELEMENTARY\b/i },
  { key: "PRE-INTERMEDIATE", re: /\bPRE[\s-]?INTERMEDIATE\b/i },
  { key: "UPPER-INTERMEDIATE", re: /\bUPPER[\s-]?INTERMEDIATE\b/i },
  { key: "INTERMEDIATE", re: /\bINTERMEDIATE\b/i },
  { key: "ADVANCED", re: /\bADVANCED\b/i },
  { key: "IELTS", re: /\bIELTS\b/i },
  { key: "CEFR", re: /\bCEFR\b/i },
];

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
};

const fastAck = (ctx, text) => safeAnswerCallback(ctx, text);

function parseGroupFromTestRow(row) {
  const haystack = `${row?.code || ""} ${row?.name || ""}`.toUpperCase();
  for (const { key, re } of GROUP_PATTERNS) {
    if (re.test(haystack)) {
      return key;
    }
  }
  const cefr = haystack.match(/(^|[^A-Z])(A1|A2|B1|B2|C1|C2)($|[^A-Z0-9])/i);
  if (cefr) {
    const key = CEFR_TO_GROUP[cefr[2].toUpperCase()];
    if (key) {
      return key;
    }
  }
  return null;
}

async function getActiveTestsGroupedByGroup() {
  try {
    const [rows] = await query(
      "SELECT * FROM tests WHERE is_active=1 ORDER BY id DESC"
    );
    const grouped = {};
    for (const row of rows) {
      const groupKey = parseGroupFromTestRow(row);
      if (!groupKey) continue;
      if (!grouped[groupKey]) grouped[groupKey] = [];
      grouped[groupKey].push(row);
    }
    return grouped;
  } catch (error) {
    logger.error("Failed to fetch tests", { message: error?.message });
    return {};
  }
}

function buildGroupButtons(grouped) {
  const order = [
    "BEGINNER",
    "ELEMENTARY",
    "PRE-INTERMEDIATE",
    "INTERMEDIATE",
    "UPPER-INTERMEDIATE",
    "ADVANCED",
    "IELTS",
    "CEFR",
  ];
  return order
    .filter((key) => grouped[key]?.length)
    .map((key) =>
      Markup.button.callback(
        `${GROUP_LABELS[key]} (${grouped[key].length})`,
        `group:${key}`
      )
    );
}

async function showGroupMenu(ctx) {
  const grouped = await getActiveTestsGroupedByGroup();
  const buttons = buildGroupButtons(grouped);

  if (!buttons.length) {
    return safeReply(
      ctx,
      "⏳ Hozircha faol test topilmadi yoki server band. Iltimos, keyinroq urinib ko‘ring."
    );
  }

  return safeReply(
    ctx,
    "Qaysi daraja/yo‘nalish bo‘yicha test topshirasiz?",
    Markup.inlineKeyboard(chunk(buttons, 2))
  );
}

async function showTestsOfGroup(ctx, groupKey) {
  try {
    const [rows] = await query(
      "SELECT * FROM tests WHERE is_active=1 ORDER BY id DESC"
    );
    const tests = rows.filter((row) => parseGroupFromTestRow(row) === groupKey);

    if (!tests.length) {
      await safeReply(
        ctx,
        `Bu yo‘nalish uchun test topilmadi: ${GROUP_LABELS[groupKey] || groupKey}`
      );
      return showGroupMenu(ctx);
    }

    const buttons = tests.map((test) =>
      Markup.button.callback(
        test.name || test.code || `Test #${test.id}`,
        `test:${test.id}`
      )
    );
    buttons.push(Markup.button.callback("⬅️ Darajalar", "groups"));

    return safeReply(
      ctx,
      `Tanlang: ${GROUP_LABELS[groupKey] || groupKey} bo‘yicha testlar`,
      Markup.inlineKeyboard(chunk(buttons, 1))
    );
  } catch (error) {
    logger.error("Failed to fetch tests for group", {
      message: error?.message,
      groupKey,
    });
    return safeReply(
      ctx,
      "Server band. Birozdan so‘ng yana urinib ko‘ring."
    );
  }
}

async function startSelectedTest(ctx, userId, testId, sendNextQuestion) {
  try {
    const [[test]] = await query(
      "SELECT * FROM tests WHERE id=? AND is_active=1",
      [testId]
    );

    if (!test) {
      await safeReply(ctx, "Kechirasiz, bu test topilmadi yoki faol emas.");
      return showGroupMenu(ctx);
    }

    const [[activeAttempt]] = await query(
      "SELECT id FROM attempts WHERE user_id=? AND test_id=? AND status='started' ORDER BY id DESC LIMIT 1",
      [userId, test.id]
    );

    if (activeAttempt) {
      await safeReply(ctx, "Oldingi ochiq urinish topildi — davom ettiryapmiz.");
      return sendNextQuestion(ctx, test.id, activeAttempt.id);
    }

    const [insertResult] = await query(
      "INSERT INTO attempts (user_id, test_id, status, started_at) VALUES (?,?, 'started', NOW())",
      [userId, test.id]
    );

    await safeReply(ctx, `Boshladik! Test: ${test.name || test.code}\nOmad!`);
    return sendNextQuestion(ctx, test.id, insertResult.insertId);
  } catch (error) {
    logger.error("Failed to start test", { message: error?.message, userId, testId });
    return safeReply(
      ctx,
      "Server bilan ulanishda muammo yuzaga keldi. Iltimos, keyinroq urinib ko‘ring."
    );
  }
}

function registerTestFlow(bot, { sendNextQuestion, askPhoneKeyboard }) {
  if (typeof sendNextQuestion !== "function") {
    throw new Error("registerTestFlow: sendNextQuestion funksiyasi majburiy.");
  }
  if (typeof askPhoneKeyboard !== "function") {
    throw new Error("registerTestFlow: askPhoneKeyboard funksiyasi majburiy.");
  }

  bot.hears("📝 Testni boshlash", async (ctx) => {
    try {
      const tgId = ctx.from.id;
      const [[user]] = await query(
        "SELECT id, phone FROM users WHERE tg_id=?",
        [tgId]
      );

      if (!user) {
        return safeReply(ctx, "Iltimos, /start buyrug‘ini bosing.");
      }

      if (!user.phone) {
        return safeReply(
          ctx,
          "Avval telefon raqamingizni yuboring.",
          askPhoneKeyboard()
        );
      }

      return showGroupMenu(ctx);
    } catch (error) {
      logger.error("Failed to handle test start", { message: error?.message });
      return safeReply(
        ctx,
        "Server band. Birozdan so‘ng yana urinib ko‘ring."
      );
    }
  });

  bot.action("groups", async (ctx) => {
    fastAck(ctx);
    return showGroupMenu(ctx);
  });

  bot.action(/^group:(.+)$/, async (ctx) => {
    fastAck(ctx);
    const groupKey = ctx.match[1];
    return showTestsOfGroup(ctx, groupKey);
  });

  bot.action(/^test:(\d+)$/, async (ctx) => {
    fastAck(ctx);
    const testId = Number(ctx.match[1]);
    try {
      const tgId = ctx.from.id;
      const [[user]] = await query("SELECT id FROM users WHERE tg_id=?", [tgId]);
      if (!user) {
        return safeReply(ctx, "Iltimos, /start buyrug‘ini bosing.");
      }
      return startSelectedTest(ctx, user.id, testId, sendNextQuestion);
    } catch (error) {
      logger.error("Failed to start selected test", {
        message: error?.message,
        testId,
      });
      return safeReply(
        ctx,
        "Server bilan ulanishda muammo yuzaga keldi. Iltimos, keyinroq urinib ko‘ring."
      );
    }
  });
}

module.exports = { registerTestFlow };
