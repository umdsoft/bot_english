// src/web/testflow.js (yoki sizdagi joyi)
const { Markup } = require("telegraf");
const { pool } = require("../db");

// ====== GROUP DETECTION HELPERS ======

// CEFR -> guruh xaritasi (fallback)
const CEFR_TO_GROUP = {
  A1: "BEGINNER",
  A2: "ELEMENTARY",
  B1: "PRE-INTERMEDIATE",
  B2: "INTERMEDIATE",
  C1: "UPPER-INTERMEDIATE",
  C2: "ADVANCED",
};

// foydalanuvchiga ko‘rinadigan label
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

// tests.code/name ichidan guruhni aniqlash uchun regexlar
const GROUP_PATTERNS = [
  { key: "BEGINNER", re: /\bBEGINNER\b/i },
  { key: "ELEMENTARY", re: /\bELEMENTARY\b/i },
  { key: "PRE-INTERMEDIATE", re: /\bPRE[\s-]?INTERMEDIATE\b/i },
  { key: "UPPER-INTERMEDIATE", re: /\bUPPER[\s-]?INTERMEDIATE\b/i },
  { key: "INTERMEDIATE", re: /\bINTERMEDIATE\b/i }, // PRE topilmasa umumiy Intermediate
  { key: "ADVANCED", re: /\bADVANCED\b/i },
  { key: "IELTS", re: /\bIELTS\b/i },
  { key: "CEFR", re: /\bCEFR\b/i },
];

function parseGroupFromTestRow(row) {
  const hay = `${row?.code || ""} ${row?.name || ""}`.toUpperCase();

  for (const { key, re } of GROUP_PATTERNS) {
    if (re.test(hay)) return key;
  }
  const cefr = hay.match(/(^|[^A-Z])(A1|A2|B1|B2|C1|C2)($|[^A-Z0-9])/i);
  if (cefr) {
    const k = CEFR_TO_GROUP[cefr[2].toUpperCase()];
    if (k) return k;
  }
  return null;
}

async function getActiveTestsGroupedByGroup() {
  const [rows] = await pool.query(
    "SELECT * FROM tests WHERE is_active=1 ORDER BY id DESC"
  );
  const grouped = {};
  for (const r of rows) {
    const g = parseGroupFromTestRow(r);
    if (!g) continue;
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(r);
  }
  return grouped;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ====== MAIN FLOW REGISTER ======
function registerTestFlow(bot, { sendNextQuestion, askPhoneKeyboard }) {
  if (typeof sendNextQuestion !== "function") {
    throw new Error("registerTestFlow: sendNextQuestion funksiyasi majburiy.");
  }
  if (typeof askPhoneKeyboard !== "function") {
    throw new Error("registerTestFlow: askPhoneKeyboard funksiyasi majburiy.");
  }

  // Darajalar menyusi
  async function showGroupMenu(ctx) {
    const grouped = await getActiveTestsGroupedByGroup();
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
    const groups = order.filter((k) => grouped[k]?.length);
    if (!groups.length) {
      return ctx.reply("Hozircha faol test topilmadi. Keyinroq urinib ko‘ring.");
    }
    const buttons = groups.map((key) => {
      const count = grouped[key].length;
      return Markup.button.callback(
        `${GROUP_LABELS[key]} (${count})`,
        `group:${key}`
      );
    });
    await ctx.reply(
      "Qaysi daraja/yo‘nalish bo‘yicha test topshirasiz?",
      Markup.inlineKeyboard(chunk(buttons, 2))
    );
  }

  // Tanlangan guruhdagi testlar ro'yxati
  async function showTestsOfGroup(ctx, groupKey) {
    const [rows] = await pool.query(
      "SELECT * FROM tests WHERE is_active=1 ORDER BY id DESC"
    );
    const tests = rows.filter((r) => parseGroupFromTestRow(r) === groupKey);
    if (!tests.length) {
      await ctx.reply(
        `Bu yo‘nalish uchun test topilmadi: ${GROUP_LABELS[groupKey] || groupKey}`
      );
      return showGroupMenu(ctx);
    }
    const testButtons = tests.map((t) =>
      Markup.button.callback(
        t.name || t.code || `Test #${t.id}`,
        `test:${t.id}`
      )
    );
    // Orqaga tugmasi
    testButtons.push(Markup.button.callback("⬅️ Darajalar", "groups"));
    await ctx.reply(
      `Tanlang: ${GROUP_LABELS[groupKey] || groupKey} bo‘yicha testlar`,
      Markup.inlineKeyboard(chunk(testButtons, 1))
    );
  }

  // Aniq testni boshlash (yoki davom ettirish)
  async function startSelectedTest(ctx, userId, testId) {
    const [[test]] = await pool.query(
      "SELECT * FROM tests WHERE id=? AND is_active=1",
      [testId]
    );
    if (!test) {
      await ctx.reply("Kechirasiz, bu test topilmadi yoki faol emas.");
      return showGroupMenu(ctx);
    }

    // Agar shu test bo‘yicha ochiq urinish bo‘lsa — davom ettiramiz
    const [[active]] = await pool.query(
      "SELECT id FROM attempts WHERE user_id=? AND test_id=? AND status='started' ORDER BY id DESC LIMIT 1",
      [userId, test.id]
    );
    if (active) {
      await ctx.reply("Oldingi ochiq urinish topildi — davom ettiryapmiz.");
      return sendNextQuestion(ctx, test.id, active.id);
    }

    // Yangi attempt
    const [ins] = await pool.query(
      "INSERT INTO attempts (user_id, test_id, status, started_at) VALUES (?,?, 'started', NOW())",
      [userId, test.id]
    );
    await ctx.reply(`Boshladik! Test: ${test.name || test.code}\nOmad!`);
    return sendNextQuestion(ctx, test.id, ins.insertId);
  }

  // Menyudagi "📝 Testni boshlash" — darajalar menyusi
  bot.hears("📝 Testni boshlash", async (ctx) => {
    const tgId = ctx.from.id;
    const [[u]] = await pool.query(
      "SELECT id, phone FROM users WHERE tg_id=?",
      [tgId]
    );
    if (!u) return ctx.reply("Iltimos, /start buyrug‘ini bosing.");
    if (!u.phone)
      return ctx.reply("Avval telefon raqamingizni yuboring.", askPhoneKeyboard());
    return showGroupMenu(ctx);
  });

  // Inline callbacklar:
  bot.action("groups", async (ctx) => {
    await ctx.answerCbQuery();
    return showGroupMenu(ctx);
  });

  bot.action(/^group:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const groupKey = ctx.match[1];
    return showTestsOfGroup(ctx, groupKey);
  });

  bot.action(/^test:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const testId = Number(ctx.match[1]);
    const tgId = ctx.from.id;
    const [[u]] = await pool.query("SELECT id FROM users WHERE tg_id=?", [tgId]);
    if (!u) return ctx.reply("Iltimos, /start buyrug‘ini bosing.");
    return startSelectedTest(ctx, u.id, testId);
  });
}

module.exports = { registerTestFlow };
