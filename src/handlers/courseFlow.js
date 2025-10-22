// src/handlers/courseFlow.js
const { Markup } = require("telegraf");
const { query } = require("../db");
const { safeReply, safeAnswerCallback } = require("../bot/helpers/telegram");
const { createLogger } = require("../core/logger");

const logger = createLogger("handlers:courseFlow");

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
};

async function getUserByTg(tgId) {
  const [[user]] = await query("SELECT id, is_student FROM users WHERE tg_id=?", [tgId]);
  return user || null;
}

async function isEnrolled(userId, subjectId) {
  const [[row]] = await query(
    "SELECT 1 FROM user_subjects WHERE user_id=? AND subject_id=? AND status='active' LIMIT 1",
    [userId, subjectId]
  );
  return !!row;
}

async function listMySubjects(userId) {
  const [rows] = await query(
    `SELECT s.id, s.name, s.code
       FROM user_subjects us
       JOIN subjects s ON s.id=us.subject_id
      WHERE us.user_id=? AND us.status='active' AND s.is_active=1
      ORDER BY s.name`,
    [userId]
  );
  return rows;
}

async function listTopics(subjectId) {
  const [rows] = await query(
    `SELECT id, title, order_no
       FROM topics
      WHERE subject_id=? AND is_active=1
      ORDER BY order_no, id`,
    [subjectId]
  );
  return rows;
}

async function listMaterials(topicId) {
  const [rows] = await query(
    `SELECT id, type, title, url, file_path, text, duration_sec, order_no
       FROM materials
      WHERE topic_id=? AND is_active=1
      ORDER BY order_no, id`,
    [topicId]
  );
  return rows;
}

async function listCourseTestsForTopic(topicId) {
  const [rows] = await query(
    `SELECT id, name, code
       FROM tests
      WHERE is_active=1 AND kind='course' AND topic_id=?`,
    [topicId]
  );
  return rows;
}

async function listCourseTestsForSubject(subjectId) {
  const [rows] = await query(
    `SELECT id, name, code
       FROM tests
      WHERE is_active=1 AND kind='course' AND subject_id=? AND topic_id IS NULL`,
    [subjectId]
  );
  return rows;
}

async function startCourseTest(ctx, userId, testId) {
  try {
    const [[test]] = await query(
      `SELECT id, name, code, subject_id
         FROM tests
        WHERE id=? AND is_active=1 AND kind='course'`,
      [testId]
    );

    if (!test) {
      return safeReply(ctx, "Kechirasiz, bu test topilmadi yoki faol emas.");
    }

    if (test.subject_id) {
      const enrolled = await isEnrolled(userId, test.subject_id);
      if (!enrolled) {
        return safeReply(ctx, "Ushbu testni yechish uchun bu fanga biriktirilmagansiz.");
      }
    }

    const [[activeAttempt]] = await query(
      "SELECT id FROM attempts WHERE user_id=? AND test_id=? AND status='started' ORDER BY id DESC LIMIT 1",
      [userId, test.id]
    );

    if (activeAttempt) {
      await safeReply(ctx, "Oldingi ochiq urinish topildi — davom ettiramiz.");
      return ctx.state.sendNextQuestion(ctx, test.id, activeAttempt.id);
    }

    const [insertResult] = await query(
      "INSERT INTO attempts (user_id, test_id, status, started_at) VALUES (?,?, 'started', NOW())",
      [userId, test.id]
    );

    await safeReply(ctx, `Boshladik! Test: ${test.name || test.code}\nOmad!`);
    return ctx.state.sendNextQuestion(ctx, test.id, insertResult.insertId);
  } catch (error) {
    logger.error("Failed to start course test", { message: error?.message });
    return safeReply(
      ctx,
      "Server bilan ulanishda muammo yuzaga keldi. Iltimos, keyinroq urinib ko‘ring."
    );
  }
}

function registerCourseFlow(bot, { sendNextQuestion, askPhoneKeyboard }) {
  if (typeof sendNextQuestion !== "function") {
    throw new Error("registerCourseFlow: sendNextQuestion kerak.");
  }
  if (typeof askPhoneKeyboard !== "function") {
    throw new Error("registerCourseFlow: askPhoneKeyboard kerak.");
  }

  bot.use((ctx, next) => {
    ctx.state.sendNextQuestion = sendNextQuestion;
    return next();
  });

  bot.hears("📚 Kurslarim", async (ctx) => {
    try {
      const tgId = ctx.from.id;
      const user = await getUserByTg(tgId);
      if (!user) {
        return safeReply(ctx, "Iltimos, /start buyrug‘ini bosing.");
      }
      if (!user.is_student) {
        return safeReply(ctx, "Bu bo‘lim faqat o‘quvchilar uchun.");
      }

      const subjects = await listMySubjects(user.id);
      if (!subjects.length) {
        return safeReply(ctx, "Hali bironta fandan biriktirilmagansiz.");
      }

      const buttons = subjects.map((subject) =>
        Markup.button.callback(`📘 ${subject.name}`, `crs:s:${subject.id}`)
      );
      return safeReply(
        ctx,
        "Kurslarim (fanlar):",
        Markup.inlineKeyboard(chunk(buttons, 2))
      );
    } catch (error) {
      logger.error("Failed to show subjects", { message: error?.message });
      return safeReply(ctx, "Server band. Birozdan so‘ng yana urinib ko‘ring.");
    }
  });

  bot.action(/^crs:s:(\d+)$/, async (ctx) => {
    safeAnswerCallback(ctx);
    const subjectId = Number(ctx.match[1]);
    try {
      const tgId = ctx.from.id;
      const user = await getUserByTg(tgId);
      if (!user) {
        return safeReply(ctx, "Iltimos, /start buyrug‘ini bosing.");
      }

      const enrolled = await isEnrolled(user.id, subjectId);
      if (!enrolled) {
        return safeReply(ctx, "Ushbu fanga biriktirilmagansiz.");
      }

      const topics = await listTopics(subjectId);
      const subjectTests = await listCourseTestsForSubject(subjectId);

      const rows = [];
      if (topics.length) {
        const topicButtons = topics.map((topic) =>
          Markup.button.callback(`• ${topic.title}`, `crs:t:${topic.id}`)
        );
        rows.push(...chunk(topicButtons, 1));
      }
      if (subjectTests.length) {
        rows.push([
          Markup.button.callback("🧪 Fan bo‘yicha testlar", `crs:tsub:${subjectId}`),
        ]);
      }
      rows.push([Markup.button.callback("⬅️ Kurslarim", "crs:subjects")]);

      await safeReply(
        ctx,
        "Mavzu tanlang (yoki fan bo‘yicha testlar):",
        Markup.inlineKeyboard(rows)
      );
    } catch (error) {
      logger.error("Failed to show subject detail", { message: error?.message });
      await safeReply(ctx, "Server band. Birozdan so‘ng yana urinib ko‘ring.");
    }
  });

  bot.action("crs:subjects", async (ctx) => {
    safeAnswerCallback(ctx);
    try {
      const tgId = ctx.from.id;
      const user = await getUserByTg(tgId);
      if (!user) {
        return safeReply(ctx, "Iltimos, /start buyrug‘ini bosing.");
      }

      const subjects = await listMySubjects(user.id);
      if (!subjects.length) {
        return safeReply(ctx, "Hali bironta fandan biriktirilmagansiz.");
      }

      const buttons = subjects.map((subject) =>
        Markup.button.callback(`📘 ${subject.name}`, `crs:s:${subject.id}`)
      );
      return safeReply(
        ctx,
        "Kurslarim (fanlar):",
        Markup.inlineKeyboard(chunk(buttons, 2))
      );
    } catch (error) {
      logger.error("Failed to show subjects list", { message: error?.message });
      return safeReply(ctx, "Server band. Birozdan so‘ng yana urinib ko‘ring.");
    }
  });

  bot.action(/^crs:t:(\d+)$/, async (ctx) => {
    safeAnswerCallback(ctx);
    const topicId = Number(ctx.match[1]);
    try {
      const materials = await listMaterials(topicId);
      const tests = await listCourseTestsForTopic(topicId);

      const rows = [];
      if (materials.length) {
        rows.push([Markup.button.callback("📄 Materiallar", `crs:mat:${topicId}`)]);
      }
      if (tests.length) {
        rows.push([Markup.button.callback("🧪 Testlar", `crs:ttopic:${topicId}`)]);
      }
      rows.push([Markup.button.callback("⬅️ Orqaga", "crs:subjects")]);

      await safeReply(
        ctx,
        "Nima qilishni xohlaysiz?",
        Markup.inlineKeyboard(rows)
      );
    } catch (error) {
      logger.error("Failed to show topic detail", { message: error?.message });
      await safeReply(ctx, "Server band. Birozdan so‘ng yana urinib ko‘ring.");
    }
  });

  bot.action(/^crs:mat:(\d+)$/, async (ctx) => {
    safeAnswerCallback(ctx);
    const topicId = Number(ctx.match[1]);
    try {
      const materials = await listMaterials(topicId);
      if (!materials.length) {
        return safeReply(ctx, "Bu mavzuda materiallar topilmadi.");
      }

      for (const material of materials) {
        const parts = [
          `📘 ${material.title || "Material"}`,
          material.url ? `🔗 ${material.url}` : null,
          material.duration_sec ? `⏱ ${material.duration_sec} sek.` : null,
          material.text || null,
        ].filter(Boolean);

        if (parts.length) {
          await safeReply(ctx, parts.join("\n"));
        }
      }
    } catch (error) {
      logger.error("Failed to show materials", { message: error?.message });
      await safeReply(ctx, "Materiallarni yuklashda xatolik yuz berdi.");
    }
  });

  bot.action(/^crs:ttopic:(\d+)$/, async (ctx) => {
    safeAnswerCallback(ctx);
    const topicId = Number(ctx.match[1]);
    try {
      const tests = await listCourseTestsForTopic(topicId);
      if (!tests.length) {
        return safeReply(ctx, "Bu mavzuda testlar topilmadi.");
      }

      const buttons = tests.map((test) =>
        Markup.button.callback(test.name || test.code || `Test #${test.id}`, `crs:start:${test.id}`)
      );
      buttons.push(Markup.button.callback("⬅️ Orqaga", `crs:t:${topicId}`));

      await safeReply(
        ctx,
        "Test tanlang:",
        Markup.inlineKeyboard(chunk(buttons, 1))
      );
    } catch (error) {
      logger.error("Failed to show topic tests", { message: error?.message });
      await safeReply(ctx, "Server band. Birozdan so‘ng yana urinib ko‘ring.");
    }
  });

  bot.action(/^crs:tsub:(\d+)$/, async (ctx) => {
    safeAnswerCallback(ctx);
    const subjectId = Number(ctx.match[1]);
    try {
      const tests = await listCourseTestsForSubject(subjectId);
      if (!tests.length) {
        return safeReply(ctx, "Bu fan uchun testlar topilmadi.");
      }

      const buttons = tests.map((test) =>
        Markup.button.callback(test.name || test.code || `Test #${test.id}`, `crs:start:${test.id}`)
      );
      buttons.push(Markup.button.callback("⬅️ Orqaga", `crs:s:${subjectId}`));

      await safeReply(
        ctx,
        "Test tanlang:",
        Markup.inlineKeyboard(chunk(buttons, 1))
      );
    } catch (error) {
      logger.error("Failed to show subject tests", { message: error?.message });
      await safeReply(ctx, "Server band. Birozdan so‘ng yana urinib ko‘ring.");
    }
  });

  bot.action(/^crs:start:(\d+)$/, async (ctx) => {
    safeAnswerCallback(ctx);
    const testId = Number(ctx.match[1]);
    try {
      const tgId = ctx.from.id;
      const user = await getUserByTg(tgId);
      if (!user) {
        return safeReply(ctx, "Iltimos, /start buyrug‘ini bosing.");
      }
      return startCourseTest(ctx, user.id, testId);
    } catch (error) {
      logger.error("Failed to initiate course test", { message: error?.message });
      return safeReply(ctx, "Server band. Birozdan so‘ng yana urinib ko‘ring.");
    }
  });

  bot.action("crs:materials", (ctx) => safeAnswerCallback(ctx));
}

module.exports = { registerCourseFlow };
