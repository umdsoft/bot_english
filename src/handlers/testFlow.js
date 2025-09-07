// src/web/testflow.js
const { Markup } = require("telegraf");
const { pool } = require("../db");

// ====== LOCAL SAFE DB QUERY (retry + backoff, POOL O'ZGARMAYDI) ======
const TRANSIENT_DB_ERRORS = new Set([
  "ECONNREFUSED",
  "PROTOCOL_CONNECTION_LOST",
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
  "ETIMEDOUT",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "PROTOCOL_ENQUEUE_AFTER_QUIT",
  "PROTOCOL_ENQUEUE_HANDSHAKE_TWICE",
]);

async function dbQuery(sql, params = [], { retries = 3, baseDelay = 200 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await pool.query(sql, params);
    } catch (e) {
      lastErr = e;
      const code = e && (e.code || e.errno || e.sqlState);
      const transient = TRANSIENT_DB_ERRORS.has(code) || String(e.message || "").includes("ECONNREFUSED");
      const canRetry = transient && attempt < retries;
      console.error(
        `[DB] query failed (attempt ${attempt + 1}/${retries + 1}) code=${code} msg=${e.message || e}`
      );
      if (!canRetry) break;
      const waitMs = baseDelay * Math.pow(2, attempt); // 200ms, 400ms, 800ms, ...
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

// ====== FAST ACK + SAFE REPLY HELPERS ======
function fastAck(ctx, text) {
  return ctx.answerCbQuery(text).catch(() => {});
}
function safeReply(ctx, text, extra) {
  return ctx.reply(text, extra).catch(() => null);
}

// ====== GROUP DETECTION HELPERS ======
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
  try {
    const [rows] = await dbQuery(
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
  } catch (e) {
    console.error("getActiveTestsGroupedByGroup error:", e?.message || e);
    return {};
  }
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
      return safeReply(
        ctx,
        "⏳ Hozircha faol test topilmadi yoki server band. Iltimos, keyinroq urinib ko‘ring."
      );
    }
    const buttons = groups.map((key) => {
      const count = grouped[key].length;
      return Markup.button.callback(`${GROUP_LABELS[key]} (${count})`, `group:${key}`);
    });
    return safeReply(
      ctx,
      "Qaysi daraja/yo‘nalish bo‘yicha test topshirasiz?",
      Markup.inlineKeyboard(chunk(buttons, 2))
    );
  }

  // Tanlangan guruhdagi testlar ro'yxati
  async function showTestsOfGroup(ctx, groupKey) {
    let rows = [];
    try {
      [rows] = await dbQuery(
        "SELECT * FROM tests WHERE is_active=1 ORDER BY id DESC"
      );
    } catch (e) {
      console.error("showTestsOfGroup SELECT tests error:", e?.message || e);
      return safeReply(ctx, "Server band. Birozdan so‘ng yana urinib ko‘ring.");
    }

    const tests = rows.filter((r) => parseGroupFromTestRow(r) === groupKey);
    if (!tests.length) {
      await safeReply(
        ctx,
        `Bu yo‘nalish uchun test topilmadi: ${GROUP_LABELS[groupKey] || groupKey}`
      );
      return showGroupMenu(ctx);
    }
    const testButtons = tests.map((t) =>
      Markup.button.callback(t.name || t.code || `Test #${t.id}`, `test:${t.id}`)
    );
    testButtons.push(Markup.button.callback("⬅️ Darajalar", "groups"));
    return safeReply(
      ctx,
      `Tanlang: ${GROUP_LABELS[groupKey] || groupKey} bo‘yicha testlar`,
      Markup.inlineKeyboard(chunk(testButtons, 1))
    );
  }

  // Aniq testni boshlash (yoki davom ettirish)
  async function startSelectedTest(ctx, userId, testId) {
    try {
      const [[test]] = await dbQuery(
        "SELECT * FROM tests WHERE id=? AND is_active=1",
        [testId]
      );
      if (!test) {
        await safeReply(ctx, "Kechirasiz, bu test topilmadi yoki faol emas.");
        return showGroupMenu(ctx);
      }

      const [[active]] = await dbQuery(
        "SELECT id FROM attempts WHERE user_id=? AND test_id=? AND status='started' ORDER BY id DESC LIMIT 1",
        [userId, test.id]
      );
      if (active) {
        await safeReply(ctx, "Oldingi ochiq urinish topildi — davom ettiryapmiz.");
        return sendNextQuestion(ctx, test.id, active.id);
      }

      const [ins] = await dbQuery(
        "INSERT INTO attempts (user_id, test_id, status, started_at) VALUES (?,?, 'started', NOW())",
        [userId, test.id]
      );
      await safeReply(ctx, `Boshladik! Test: ${test.name || test.code}\nOmad!`);
      return sendNextQuestion(ctx, test.id, ins.insertId);
    } catch (e) {
      console.error("startSelectedTest error:", e?.message || e);
      return safeReply(
        ctx,
        "Server bilan ulanishda muammo yuzaga keldi. Iltimos, keyinroq urinib ko‘ring."
      );
    }
  }

  // Menyudagi "📝 Testni boshlash"
  bot.hears("📝 Testni boshlash", async (ctx) => {
    try {
      const tgId = ctx.from.id;
      const [[u]] = await dbQuery(
        "SELECT id, phone FROM users WHERE tg_id=?",
        [tgId]
      );
      if (!u) return safeReply(ctx, "Iltimos, /start buyrug‘ini bosing.");
      if (!u.phone)
        return safeReply(ctx, "Avval telefon raqamingizni yuboring.", askPhoneKeyboard());
      return showGroupMenu(ctx);
    } catch (e) {
      console.error("hears Testni boshlash error:", e?.message || e);
      return safeReply(ctx, "Server band. Birozdan so‘ng yana urinib ko‘ring.");
    }
  });

  // Inline callbacklar (ACK DARHOL!)
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
      const [[u]] = await dbQuery("SELECT id FROM users WHERE tg_id=?", [tgId]);
      if (!u) return safeReply(ctx, "Iltimos, /start buyrug‘ini bosing.");
      return startSelectedTest(ctx, u.id, testId);
    } catch (e) {
      console.error("action test:id error:", e?.message || e);
      return safeReply(
        ctx,
        "Server bilan ulanishda muammo yuzaga keldi. Iltimos, keyinroq urinib ko‘ring."
      );
    }
  });
}

module.exports = { registerTestFlow };
