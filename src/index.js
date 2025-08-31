// src/index.js
require("dotenv").config();
process.env.TZ = process.env.TZ || "Asia/Tashkent";

const bcrypt = require("bcryptjs");
const WEB_APP_URL = process.env.WEB_APP_URL || "http://localhost:4001";

const { Telegraf, Markup } = require("telegraf");
const dayjs = require("dayjs");
const { pool } = require("./db");
const fs = require("fs");
const os = require("os");
const path = require("path");
const PDFDocument = require("pdfkit");

const bot = new Telegraf(process.env.BOT_TOKEN);
const TARGET_CHANNEL_ID = -1002937713606;

/* ----------------- HELPERS: DB ----------------- */
async function upsertUser(ctx, lang = "uz") {
  const tg = ctx.from;
  const fullName = [tg.first_name, tg.last_name].filter(Boolean).join(" ");
  const username = tg.username || null;
  const [rows] = await pool.query("SELECT id FROM users WHERE tg_id=?", [tg.id]);
  if (rows.length) return rows[0].id;
  const [ins] = await pool.query(
    "INSERT INTO users (tg_id, full_name, username, lang) VALUES (?,?,?,?)",
    [tg.id, fullName, username, lang]
  );
  return ins.insertId;
}

async function getActiveTest(code = "eng_a1") {
  const [rows] = await pool.query(
    "SELECT * FROM tests WHERE code=? AND is_active=1",
    [code]
  );
  return rows[0] || null;
}

async function findActiveAttempt(userId) {
  const [rows] = await pool.query(
    "SELECT id, test_id FROM attempts WHERE user_id=? AND status='started' ORDER BY id DESC LIMIT 1",
    [userId]
  );
  return rows[0] || null;
}

async function startAttempt(userId, testId) {
  const [ins] = await pool.query(
    "INSERT INTO attempts (user_id, test_id, status, started_at) VALUES (?,?, 'started', NOW())",
    [userId, testId]
  );
  return ins.insertId;
}

async function getNextQuestion(testId, attemptId) {
  const [rows] = await pool.query(
    `
    SELECT q.*
    FROM questions q
    WHERE q.test_id=? AND q.id NOT IN (
      SELECT question_id FROM answers WHERE attempt_id=?
    )
    ORDER BY q.sort_order ASC, q.id ASC
    LIMIT 1
  `,
    [testId, attemptId]
  );
  return rows[0] || null;
}

async function getOptions(questionId) {
  const [rows] = await pool.query(
    "SELECT * FROM options WHERE question_id=? ORDER BY sort_order ASC, id ASC",
    [questionId]
  );
  return rows;
}

async function saveAnswer(attemptId, questionId, optionId) {
  const [[opt]] = await pool.query(
    "SELECT is_correct, weight FROM options WHERE id=?",
    [optionId]
  );
  const isCorrect = opt ? Number(opt.is_correct) : 0;
  const awarded = opt ? (isCorrect ? Number(opt.weight || 1) : 0) : 0;

  await pool.query(
    `INSERT INTO answers (attempt_id, question_id, option_id, is_correct, awarded_score)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE option_id=VALUES(option_id),
                             is_correct=VALUES(is_correct),
                             awarded_score=VALUES(awarded_score)`,
    [attemptId, questionId, optionId, isCorrect, awarded]
  );
}

/* ----------------- Yakuniy hisob-kitob ----------------- */
async function computeAndFinishAttempt(attemptId) {
  const [[meta]] = await pool.query(
    `
    SELECT at.test_id,
           (SELECT COUNT(*) FROM questions WHERE test_id = at.test_id) AS total_questions
    FROM attempts at WHERE at.id=?`,
    [attemptId]
  );
  const totalQ = Number(meta?.total_questions || 0);

  const [[agg]] = await pool.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN o.is_correct=1 THEN COALESCE(o.weight,1.00) ELSE 0 END), 0) AS total_score,
      COALESCE(SUM(CASE WHEN o.is_correct=1 THEN 1 ELSE 0 END), 0) AS correct_count
    FROM answers a
    JOIN options o ON o.id=a.option_id
    WHERE a.attempt_id=?`,
    [attemptId]
  );

  const totalScore = Number(agg.total_score || 0);
  const correctCount = Number(agg.correct_count || 0);
  const wrongCount = Math.max(totalQ - correctCount, 0);
  const maxScore = totalQ * 1.0;
  const percent = maxScore ? (totalScore / maxScore) * 100 : 0;

  let level = "A1";
  if (percent >= 85) level = "A2";
  if (percent >= 95) level = "B1";

  await pool.query(
    `
    UPDATE attempts
       SET status='completed',
           finished_at=NOW(),
           score=?,
           percent=?,
           level_guess=?,
           duration_sec=TIMESTAMPDIFF(SECOND, started_at, NOW())
     WHERE id=?`,
    [totalScore, Number(percent.toFixed(2)), level, attemptId]
  );

  return { totalQ, totalScore, percent: Number(percent.toFixed(2)), level, correctCount, wrongCount };
}

/* ----------------- Report queries + PDF ----------------- */
async function getAttemptSummary(attemptId) {
  const [[row]] = await pool.query(
    `
    SELECT at.id, at.user_id, at.started_at, at.finished_at, at.score, at.percent, at.level_guess, at.duration_sec,
           u.full_name, u.username, u.phone, u.tg_id,
           t.name AS test_name, t.code AS test_code
    FROM attempts at
    JOIN users u ON u.id=at.user_id
    JOIN tests t ON t.id=at.test_id
    WHERE at.id=?`,
    [attemptId]
  );
  return row || null;
}

async function getAttemptAnswersDetailed(attemptId) {
  const [rows] = await pool.query(
    `
    SELECT a.question_id, a.is_correct,
           q.text AS q_text, q.sort_order,
           uo.text AS user_answer,
           (SELECT GROUP_CONCAT(o2.text ORDER BY o2.sort_order SEPARATOR ', ')
              FROM options o2 WHERE o2.question_id=q.id AND o2.is_correct=1) AS correct_answers
    FROM answers a
    JOIN questions q ON q.id=a.question_id
    LEFT JOIN options uo ON uo.id=a.option_id
    WHERE a.attempt_id=?
    ORDER BY q.sort_order ASC, q.id ASC`,
    [attemptId]
  );
  return rows;
}

async function generateResultPDF(attemptId, counts) {
  const summary = await getAttemptSummary(attemptId);
  const details = await getAttemptAnswersDetailed(attemptId);
  if (!summary) throw new Error("Attempt summary not found");

  const safeCorrect =
    typeof counts?.correctCount === "number"
      ? counts.correctCount
      : details.filter((r) => Number(r.is_correct) === 1).length;
  const totalQ = details.length;
  const safeWrong =
    typeof counts?.wrongCount === "number"
      ? counts.wrongCount
      : Math.max(totalQ - safeCorrect, 0);

  const filePath = path.join(os.tmpdir(), `attempt_${attemptId}.pdf`);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 48 });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      const assetsDir = path.join(__dirname, "..", "assets");
      const fontRegular = path.join(assetsDir, "NotoSans-Regular.ttf");
      const fontBold = path.join(assetsDir, "NotoSans-Bold.ttf");
      if (fs.existsSync(fontRegular)) doc.registerFont("regular", fontRegular);
      if (fs.existsSync(fontBold)) doc.registerFont("bold", fontBold);
      if (doc._font) doc.font("regular");

      const logoPath = path.join(assetsDir, "logo.png");
      if (fs.existsSync(logoPath)) {
        const w = 120, x = (doc.page.width - w)/2;
        doc.image(logoPath, x, 36, { width: w });
        doc.moveDown(3);
      } else doc.moveDown(1);

      if (doc._font) doc.font("bold");
      doc.fontSize(18).text("Ingliz Tili Placement Test — Natija Hisoboti", { align: "center" });
      if (doc._font) doc.font("regular");
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor("gray")
        .text(`Hisobot ID: ${attemptId}`, { align: "center" })
        .text(`Sana: ${dayjs().format("YYYY-MM-DD HH:mm")}`, { align: "center" });
      doc.moveDown(1).fillColor("black");

      if (doc._font) doc.font("bold");
      doc.fontSize(13).text("👤 O‘quvchi ma’lumotlari");
      if (doc._font) doc.font("regular");
      doc.moveDown(0.3);
      doc.fontSize(11)
        .text(`Ism: ${summary.full_name || "-"}`)
        .text(`Username: ${summary.username ? "@" + summary.username : "-"}`)
        .text(`Telefon: ${summary.phone || "-"}`)
        .moveDown(0.6);

      if (doc._font) doc.font("bold");
      doc.fontSize(13).text("🧪 Test ma’lumotlari");
      if (doc._font) doc.font("regular");
      doc.moveDown(0.3);
      doc.fontSize(11)
        .text(`Test: ${summary.test_name} (${summary.test_code})`)
        .text(`Boshlangan: ${dayjs(summary.started_at).format("YYYY-MM-DD HH:mm")}`)
        .text(`Tugagan: ${dayjs(summary.finished_at).format("YYYY-MM-DD HH:mm")}`)
        .text(`Davomiylik: ${summary.duration_sec || 0} sek.`)
        .moveDown(0.6);

      if (doc._font) doc.font("bold");
      doc.fontSize(13).text("📊 Natija");
      if (doc._font) doc.font("regular");
      doc.moveDown(0.3);
      doc.fontSize(12)
        .text(`Ball: ${summary.score}`)
        .text(`Foiz: ${summary.percent}%`)
        .text(`Taxminiy CEFR: ${summary.level_guess}`)
        .text(`✅ To‘g‘ri javoblar: ${safeCorrect} ta`)
        .text(`❌ Xato javoblar: ${safeWrong} ta`);
      doc.moveDown(0.8);

      if (doc._font) doc.font("bold");
      doc.fontSize(13).text("📝 Savollar bo‘yicha tafsilotlar");
      if (doc._font) doc.font("regular");
      doc.moveDown(0.4);
      details.forEach((r, i) => {
        const ok = Number(r.is_correct) === 1;
        doc.fontSize(12).fillColor(ok ? "green" : "red")
          .text(`Q${i+1}. ${ok ? "To‘g‘ri" : "Noto‘g‘ri"}`);
        doc.fillColor("black").fontSize(11)
          .text(`Savol: ${r.q_text}`)
          .text(`Sizning javobingiz: ${r.user_answer || "(javob tanlanmagan)"}`)
          .text(`To‘g‘ri javob(lar): ${r.correct_answers || "-"}`);
        doc.moveDown(0.6);
      });

      doc.end();
      stream.on("finish", () => resolve(filePath));
      stream.on("error", reject);
    } catch (e) { reject(e); }
  });
}

/* ----------------- UI HELPERS ----------------- */
function askPhoneKeyboard() {
  return Markup.keyboard([Markup.button.contactRequest("📲 Raqamni yuborish")])
    .oneTime()
    .resize();
}
function mainMenuKeyboard() {
  return Markup.keyboard([
    ["📝 Testni boshlash"],
    ["🔑 Veb-kirish kodi"],
    ["ℹ️ Ma’lumot"],
  ]).resize();
}
async function ensureStudent(ctx, opts = { needPhone: true }) {
  const tgId = ctx.from.id;
  const [[u]] = await pool.query(
    "SELECT id, phone, is_student FROM users WHERE tg_id=?",
    [tgId]
  );
  if (!u) { await ctx.reply("Iltimos, /start buyrug‘ini bosing."); return null; }
  if (opts.needPhone && !u.phone) {
    await ctx.reply("Avval telefon raqamingizni yuboring.", askPhoneKeyboard());
    return null;
  }
  if (!Number(u.is_student)) {
    await ctx.reply("Bu xizmat faqat bizning o‘quvchilar uchun. Administrator bilan bog‘laning.");
    return null;
  }
  return u;
}

/* ----------------- BOT FLOWS (STATELESS) ----------------- */
bot.launch().then(async () => {
  // komandalar doim yangilab turilsin
  try {
    await bot.telegram.setMyCommands([
      { command: "start", description: "Boshlash" },
      { command: "menu", description: "Menyuni ko‘rsatish" },
      { command: "help", description: "Yordam" }
    ]);
  } catch (e) { console.warn("setMyCommands failed", e.message); }
  console.log(`[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] Bot started`);
});

// umumiy handler: agar ochiq urinish bo‘lsa, foydalanuvchiga davom tugmasini ko‘rsatamiz
bot.on("message", async (ctx, next) => {
  try {
    if (ctx.updateType === "callback_query" || ctx.message?.contact) return next();
    const tgId = ctx.from.id;
    const [[u]] = await pool.query("SELECT id FROM users WHERE tg_id=?", [tgId]);
    if (!u) return next();
    const active = await findActiveAttempt(u.id);
    if (active) {
      await ctx.reply(
        "Sizda tugallanmagan test bor. Davom ettirasizmi?",
        Markup.inlineKeyboard([Markup.button.callback("▶️ Davom ettirish", `resume:${active.id}`)])
      );
    }
  } catch (e) { /* yutib yuboramiz */ }
  return next();
});

bot.command("menu", async (ctx) => ctx.reply("Menyu yangilandi 👇", mainMenuKeyboard()));
bot.command("help", async (ctx) => ctx.reply("Savollar bo‘lsa, administratorga yozing."));

bot.start(async (ctx) => {
  await upsertUser(ctx, "uz");
  await ctx.reply(
    "Assalomu alaykum! Bu bot faqat ro‘yxatdagi o‘quvchilar uchun.\n" +
    "Davom etishdan oldin telefon raqamingizni yuboring.",
    askPhoneKeyboard()
  );
  await ctx.reply("Menyudan keraklisini tanlang 👇", mainMenuKeyboard());
});

bot.on("contact", async (ctx) => {
  const tgId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;
  const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
  await pool.query("UPDATE users SET phone=?, full_name=? WHERE tg_id=?", [phone, fullName, tgId]);
  await ctx.reply("Rahmat! Endi menyudan tanlang 👇", mainMenuKeyboard());
});

bot.hears("ℹ️ Ma’lumot", async (ctx) => {
  await ctx.reply(
    "A1 placement testi yakunida foiz, taxminiy CEFR va PDF hisobot administratorlar kanaliga yuboriladi.\n" +
    "Eslatma: xizmat faqat o‘quvchilar uchun."
  );
});

// 🔑 OTP (faqat o‘quvchilar)
bot.hears("🔑 Veb-kirish kodi", async (ctx) => {
  const u = await ensureStudent(ctx);
  if (!u) return;

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const hash = await bcrypt.hash(otp, 10);
  await pool.query(
    `UPDATE users
        SET web_otp_hash=?,
            web_otp_expires_at=DATE_ADD(NOW(), INTERVAL 10 MINUTE),
            web_otp_used_at=NULL
      WHERE id=?`,
    [hash, u.id]
  );

  const phone = u.phone.startsWith("+") ? u.phone : "+" + u.phone.replace(/\D/g, "");
  await ctx.reply(
    "🧾 Veb-kirish ma’lumotlari (1 marta ishlaydi):\n" +
    `• Login (telefon): ${phone}\n` +
    `• Parol (OTP): ${otp}\n` +
    "⏱ Amal qilish muddati: 10 daqiqa\n\n" +
    `Sayt: ${WEB_APP_URL}/exam/login`
  );
});

// 📝 Boshlash (stateless): bor bo‘lsa — davom, bo‘lmasa — yangi
bot.hears("📝 Testni boshlash", async (ctx) => {
  const u = await ensureStudent(ctx);
  if (!u) return;

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

// Savol yuborish / yakun
async function sendNextQuestion(ctx, testId, attemptId) {
  const q = await getNextQuestion(testId, attemptId);
  if (!q) {
    const res = await computeAndFinishAttempt(attemptId);
    try {
      const pdfPath = await generateResultPDF(attemptId, { correctCount: res.correctCount, wrongCount: res.wrongCount });
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

      await ctx.reply(
        `✅ Test yakunlandi!\n` +
        `Foiz: ${res.percent}%\nDaraja: ${res.level}\n` +
        `✅ To‘g‘ri: ${res.correctCount} ta · ❌ ${res.wrongCount} ta\n\n` +
        `Natijangiz administratorlar kanaliga jo‘natildi.`
      );
      try { fs.unlinkSync(pdfPath); } catch {}
    } catch (e) {
      console.error("PDF yoki kanalga yuborish xatosi:", e);
      await ctx.reply("Natija yaratishda xatolik yuz berdi. Administratorlar tekshiradi.");
    }
    return;
  }

  const opts = await getOptions(q.id);
  const buttons = opts.map(o => [Markup.button.callback(o.text, `ans:${q.id}:${o.id}:${attemptId}`)]);
  await ctx.reply(q.text, Markup.inlineKeyboard(buttons));
}

// Callbacklar: javob va resume
bot.on("callback_query", async (ctx) => {
  const data = ctx.callbackQuery?.data || "";
  try {
    if (data.startsWith("ans:")) {
      const [, qIdStr, optIdStr, attemptStr] = data.split(":");
      const qId = Number(qIdStr), optId = Number(optIdStr), attemptId = Number(attemptStr);
      await saveAnswer(attemptId, qId, optId);
      await ctx.answerCbQuery("Qabul qilindi ✅");
      const [[att]] = await pool.query("SELECT test_id FROM attempts WHERE id=?", [attemptId]);
      return sendNextQuestion(ctx, att.test_id, attemptId);
    }
    if (data.startsWith("resume:")) {
      const attemptId = Number(data.split(":")[1]);
      const [[att]] = await pool.query("SELECT test_id FROM attempts WHERE id=?", [attemptId]);
      await ctx.answerCbQuery();
      if (!att) return ctx.reply("Urinish topilmadi.");
      return sendNextQuestion(ctx, att.test_id, attemptId);
    }
  } catch (e) {
    console.error(e);
    await ctx.answerCbQuery("Xatolik", { show_alert: true });
  }
});

// Oddiy admin statistikasi
bot.command("admin", async (ctx) => {
  const parts = (ctx.message.text || "").split(" ").slice(1);
  if (parts[0] !== process.env.ADMIN_PASS) return ctx.reply("❌ Ruxsat yo‘q");
  const [[uCount]] = await pool.query("SELECT COUNT(*) AS c FROM users WHERE is_student=1");
  const [[aCount]] = await pool.query("SELECT COUNT(*) AS c FROM attempts WHERE status='completed'");
  await ctx.reply(`👥 O‘quvchilar: ${uCount.c}\n🧪 Yakunlangan testlar: ${aCount.c}`);
});

// Silliq to‘xtash (nodemon/pm2 uchun)
process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

module.exports = {
  startBot: async () => {},         // bot.launch yuqorida chaqirilgan — server bilan birga ishlaydi
  stopBot: async () => bot.stop("SIGTERM"),
};
