// src/handlers/courseFlow.js
const { Markup } = require("telegraf");
const { pool } = require("../db");

// ------- small helpers -------
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
const fastAck = (ctx, text) => ctx.answerCbQuery(text).catch(() => {});
const safeReply = (ctx, text, extra) => ctx.reply(text, extra).catch(() => null);

async function getUserByTg(tgId) {
  const [[u]] = await pool.query("SELECT id, is_student FROM users WHERE tg_id=?", [tgId]);
  return u || null;
}
async function isEnrolled(userId, subjectId) {
  const [[r]] = await pool.query(
    "SELECT 1 FROM user_subjects WHERE user_id=? AND subject_id=? AND status='active' LIMIT 1",
    [userId, subjectId]
  );
  return !!r;
}

async function listMySubjects(userId) {
  const [rows] = await pool.query(
    `SELECT s.id, s.name, s.code
       FROM user_subjects us
       JOIN subjects s ON s.id=us.subject_id
      WHERE us.user_id=? AND us.status='active' AND s.is_active=1
      ORDER BY s.name`, [userId]
  );
  return rows;
}
async function listTopics(subjectId) {
  const [rows] = await pool.query(
    `SELECT id, title, order_no
       FROM topics
      WHERE subject_id=? AND is_active=1
      ORDER BY order_no, id`, [subjectId]
  );
  return rows;
}
async function listMaterials(topicId) {
  const [rows] = await pool.query(
    `SELECT id, type, title, url, file_path, text, duration_sec, order_no
       FROM materials
      WHERE topic_id=? AND is_active=1
      ORDER BY order_no, id`, [topicId]
  );
  return rows;
}
async function listCourseTestsForTopic(topicId) {
  const [rows] = await pool.query(
    `SELECT id, name, code
       FROM tests
      WHERE is_active=1 AND kind='course' AND topic_id=?`, [topicId]
  );
  return rows;
}
async function listCourseTestsForSubject(subjectId) {
  const [rows] = await pool.query(
    `SELECT id, name, code
       FROM tests
      WHERE is_active=1 AND kind='course' AND subject_id=? AND topic_id IS NULL`,
    [subjectId]
  );
  return rows;
}

async function startCourseTest(ctx, userId, testId) {
  // testni topamiz
  const [[t]] = await pool.query(
    `SELECT id, name, code, subject_id
       FROM tests
      WHERE id=? AND is_active=1 AND kind='course'`,
    [testId]
  );
  if (!t) return safeReply(ctx, "Kechirasiz, bu test topilmadi yoki faol emas.");

  // enroll tekshirish (agar subject_id bor bo'lsa)
  if (t.subject_id) {
    const ok = await isEnrolled(userId, t.subject_id);
    if (!ok) return safeReply(ctx, "Ushbu testni yechish uchun bu fanga biriktirilmagansiz.");
  }

  // bor urinishni davom ettirish
  const [[active]] = await pool.query(
    "SELECT id FROM attempts WHERE user_id=? AND test_id=? AND status='started' ORDER BY id DESC LIMIT 1",
    [userId, t.id]
  );
  if (active) {
    await safeReply(ctx, "Oldingi ochiq urinish topildi — davom ettiramiz.");
    // sendNextQuestion ni index.js dan injekt qilamiz
    return ctx.state.sendNextQuestion(ctx, t.id, active.id);
  }

  // yangi urinish
  const [ins] = await pool.query(
    "INSERT INTO attempts (user_id, test_id, status, started_at) VALUES (?,?, 'started', NOW())",
    [userId, t.id]
  );
  await safeReply(ctx, `Boshladik! Test: ${t.name || t.code}\nOmad!`);
  return ctx.state.sendNextQuestion(ctx, t.id, ins.insertId);
}

// ------- MAIN -------
function registerCourseFlow(bot, { sendNextQuestion, askPhoneKeyboard }) {
  if (typeof sendNextQuestion !== "function") {
    throw new Error("registerCourseFlow: sendNextQuestion kerak.");
  }
  if (typeof askPhoneKeyboard !== "function") {
    throw new Error("registerCourseFlow: askPhoneKeyboard kerak.");
  }

  // sendNextQuestion ni state orqali child handlerlarga uzatamiz
  bot.use((ctx, next) => {
    ctx.state.sendNextQuestion = sendNextQuestion;
    return next();
  });

  // HEARS: 📚 Kurslarim
  bot.hears("📚 Kurslarim", async (ctx) => {
    const tgId = ctx.from.id;
    const user = await getUserByTg(tgId);
    if (!user) return safeReply(ctx, "Iltimos, /start buyrug‘ini bosing.");
    if (!user.is_student) {
      return safeReply(ctx, "Bu bo‘lim faqat o‘quvchilar uchun.");
    }

    const subs = await listMySubjects(user.id);
    if (!subs.length) {
      return safeReply(ctx, "Hali bironta fandan biriktirilmagansiz.");
    }

    const buttons = subs.map(s =>
      Markup.button.callback(`📘 ${s.name}`, `crs:s:${s.id}`)
    );
    return safeReply(
      ctx,
      "Kurslarim (fanlar):",
      Markup.inlineKeyboard(chunk(buttons, 2))
    );
  });

  // Subjects -> Topics
  bot.action(/^crs:s:(\d+)$/, async (ctx) => {
    fastAck(ctx);
    const subjectId = Number(ctx.match[1]);
    const tgId = ctx.from.id;
    const user = await getUserByTg(tgId);
    if (!user) return safeReply(ctx, "Iltimos, /start buyrug‘ini bosing.");

    // enroll tekshirish
    const ok = await isEnrolled(user.id, subjectId);
    if (!ok) return safeReply(ctx, "Ushbu fanga biriktirilmagansiz.");

    const topics = await listTopics(subjectId);
    const subjTests = await listCourseTestsForSubject(subjectId);

    const rows = [];
    if (topics.length) {
      const topicButtons = topics.map(t => Markup.button.callback(`• ${t.title}`, `crs:t:${t.id}`));
      rows.push(...chunk(topicButtons, 1));
    }
    if (subjTests.length) {
      rows.push([Markup.button.callback("🧪 Fan bo‘yicha testlar", `crs:tsub:${subjectId}`)]);
    }
    rows.push([Markup.button.callback("⬅️ Kurslarim", "crs:subjects")]);

    await safeReply(ctx, "Mavzu tanlang (yoki fan bo‘yicha testlar):", Markup.inlineKeyboard(rows));
  });

  // Back to subjects
  bot.action("crs:subjects", async (ctx) => {
    fastAck(ctx);
    const tgId = ctx.from.id;
    const user = await getUserByTg(tgId);
    if (!user) return safeReply(ctx, "Iltimos, /start buyrug‘ini bosing.");

    const subs = await listMySubjects(user.id);
    if (!subs.length) return safeReply(ctx, "Hali bironta fandan biriktirilmagansiz.");

    const buttons = subs.map(s =>
      Markup.button.callback(`📘 ${s.name}`, `crs:s:${s.id}`)
    );
    return safeReply(ctx, "Kurslarim (fanlar):", Markup.inlineKeyboard(chunk(buttons, 2)));
  });

  // Topic -> materials / tests
  bot.action(/^crs:t:(\d+)$/, async (ctx) => {
    fastAck(ctx);
    const topicId = Number(ctx.match[1]);

    const mats = await listMaterials(topicId);
    const tests = await listCourseTestsForTopic(topicId);

    const rows = [];
    if (mats.length) rows.push([Markup.button.callback("📄 Materiallar", `crs:mat:${topicId}`)]);
    if (tests.length) rows.push([Markup.button.callback("🧪 Testlar", `crs:tt:${topicId}`)]);
    rows.push([Markup.button.callback("⬅️ Orqaga", "crs:subjects")]);

    await safeReply(ctx, "Bu mavzu bo‘yicha:", Markup.inlineKeyboard(rows));
  });

  // Show materials
  bot.action(/^crs:mat:(\d+)$/, async (ctx) => {
    fastAck(ctx);
    const topicId = Number(ctx.match[1]);
    const mats = await listMaterials(topicId);
    if (!mats.length) return safeReply(ctx, "Materiallar topilmadi.");

    // har birini yuboramiz (oddiy)
    for (const m of mats) {
      const title = m.title || "(nomlanmagan material)";
      if (m.type === "text") {
        await safeReply(ctx, `📄 *${title}*\n\n${m.text || ""}`, { parse_mode: "Markdown" });
      } else if (m.type === "link") {
        await safeReply(ctx, `🔗 *${title}*\n${m.url || ""}`, { parse_mode: "Markdown" });
      } else if (m.type === "pdf" && m.file_path) {
        await ctx.replyWithDocument({ source: m.file_path }).catch(() => {});
      } else if (m.type === "video") {
        if (m.url) {
          await safeReply(ctx, `🎬 *${title}*\n${m.url}`, { parse_mode: "Markdown" });
        } else if (m.file_path) {
          await ctx.replyWithVideo({ source: m.file_path }).catch(() => {});
        } else {
          await safeReply(ctx, `🎬 *${title}*`, { parse_mode: "Markdown" });
        }
      } else {
        await safeReply(ctx, `• ${title}`);
      }
    }
  });

  // Topic tests list
  bot.action(/^crs:tt:(\d+)$/, async (ctx) => {
    fastAck(ctx);
    const topicId = Number(ctx.match[1]);
    const tests = await listCourseTestsForTopic(topicId);
    if (!tests.length) return safeReply(ctx, "Bu mavzu uchun test topilmadi.");

    const btns = tests.map(t =>
      Markup.button.callback(`🧪 ${t.name || t.code || ("Test #"+t.id)}`, `crs:test:${t.id}`)
    );
    return safeReply(ctx, "Test tanlang:", Markup.inlineKeyboard(chunk(btns, 1)));
  });

  // Subject-level tests list
  bot.action(/^crs:tsub:(\d+)$/, async (ctx) => {
    fastAck(ctx);
    const subjectId = Number(ctx.match[1]);
    const tests = await listCourseTestsForSubject(subjectId);
    if (!tests.length) return safeReply(ctx, "Bu fan bo‘yicha umumiy testlar topilmadi.");

    const btns = tests.map(t =>
      Markup.button.callback(`🧪 ${t.name || t.code || ("Test #"+t.id)}`, `crs:test:${t.id}`)
    );
    btns.push(Markup.button.callback("⬅️ Mavzular", `crs:s:${subjectId}`));

    return safeReply(ctx, "Fan bo‘yicha testlar:", Markup.inlineKeyboard(chunk(btns, 1)));
  });

  // Start course test
  bot.action(/^crs:test:(\d+)$/, async (ctx) => {
    fastAck(ctx);
    const testId = Number(ctx.match[1]);
    const tgId = ctx.from.id;
    const u = await getUserByTg(tgId);
    if (!u) return safeReply(ctx, "Iltimos, /start buyrug‘ini bosing.");
    if (!u.is_student) return safeReply(ctx, "Bu bo‘lim faqat o‘quvchilar uchun.");
    return startCourseTest(ctx, u.id, testId);
  });
}

module.exports = { registerCourseFlow };
