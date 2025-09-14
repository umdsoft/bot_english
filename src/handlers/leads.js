// src/handlers/leads.js
const { Markup } = require("telegraf");
const { pool } = require("../db");
const { saveLead, REASONS, DISTRICTS, GROUPS, TIME_SLOTS, DAYS_PREF } = require("../services/leads");
const { TARGET_CHANNEL_ID } = require("../config");

const leadState = new Map(); // tg_id -> { step, data:{} }

// --- helpers: fast ack & safe reply ---
function fastAck(ctx, text) {
  // callback_query 15s limitini buzmaslik uchun darhol ACK
  return ctx.answerCbQuery(text).catch(() => {});
}
function safeReply(ctx, text, extra) {
  return ctx.reply(text, extra).catch(() => null);
}

function registerLead(bot) {
  // Funnel tugmalari testdan keyin yuboriladi (testFlow ichida), lekin handlerlar bu yerda
  bot.on("callback_query", async (ctx, next) => {
    const data = ctx.callbackQuery?.data || "";

    // --- Batafsil info
    if (data === "lead:info") {
      fastAck(ctx);
      return safeReply(
        ctx,
        "Kurslarimiz bo‘yicha batafsil ma’lumot: \n" +
          "— Darajali guruhlar, malakali ustozlar, zamonaviy metodika.\n" +
          "— IELTS/CEFR va umumiy ingliz tili dasturlari.\n\n" +
          "Savollar bo‘lsa, shu yerga yozing."
      );
    }

    // --- Funnelni boshlash
    if (data === "lead:start") {
      fastAck(ctx);
      const tgId = ctx.from.id;
      leadState.set(tgId, { step: "reason", data: {} });
      return safeReply(
        ctx,
        "Ingliz tilini **nima uchun** o‘rganmoqchisiz?",
        Markup.inlineKeyboard(
          REASONS.map((r) => [Markup.button.callback(r.label, `lead:reason:${r.code}`)])
        )
      );
    }

    // --- Sabab tanlandi
    if (data.startsWith("lead:reason:")) {
      fastAck(ctx);
      const code = data.split(":")[2];
      const tgId = ctx.from.id;
      const st = leadState.get(tgId) || { data: {} };
      st.step = "district";
      st.data.reason = code;
      leadState.set(tgId, st);

      const rows = [];
      for (let i = 0; i < DISTRICTS.length; i += 2) {
        rows.push(
          DISTRICTS.slice(i, i + 2).map((d) =>
            Markup.button.callback(d, `lead:district:${d}`)
          )
        );
      }
      return safeReply(ctx, "Qaysi tumanda yashaysiz?", Markup.inlineKeyboard(rows));
    }

    // --- Tuman tanlandi
    if (data.startsWith("lead:district:")) {
      fastAck(ctx);
      const name = data.split(":").slice(2).join(":"); // tuman
      const tgId = ctx.from.id;
      const st = leadState.get(tgId) || { data: {} };
      st.step = "group";
      st.data.district = name;
      leadState.set(tgId, st);

      return safeReply(
        ctx,
        "Qaysi **guruh**da o‘qishni xohlaysiz?",
        Markup.inlineKeyboard(
          GROUPS.map((g) => [Markup.button.callback(g, `lead:group:${g}`)])
        )
      );
    }

    // --- Guruh tanlandi
    if (data.startsWith("lead:group:")) {
      fastAck(ctx);
      const group = data.split(":").slice(2).join(":");
      const tgId = ctx.from.id;
      const st = leadState.get(tgId) || { data: {} };
      st.step = "time";
      st.data.group = group;
      leadState.set(tgId, st);

      return safeReply(
        ctx,
        "Qaysi **vaqtlar** sizga qulay?",
        Markup.inlineKeyboard(
          TIME_SLOTS.map((t) => [Markup.button.callback(t, `lead:time:${t}`)])
        )
      );
    }

    // --- Vaqt tanlandi
    if (data.startsWith("lead:time:")) {
      fastAck(ctx);
      const slot = data.split(":").slice(2).join(":");
      const tgId = ctx.from.id;
      const st = leadState.get(tgId) || { data: {} };
      st.step = "days";
      st.data.time_slot = slot;
      leadState.set(tgId, st);

      return safeReply(
        ctx,
        "Qaysi **kunlar** sizga qulay?",
        Markup.inlineKeyboard(
          DAYS_PREF.map((d) => [Markup.button.callback(d.label, `lead:days:${d.code}`)])
        )
      );
    }

    // --- Kunlar tanlandi -> telefon bosqichi
    if (data.startsWith("lead:days:")) {
      fastAck(ctx);
      const code = data.split(":")[2];
      const tgId = ctx.from.id;
      const st = leadState.get(tgId) || { data: {} };
      st.step = "phone";
      st.data.days_pref = code;
      leadState.set(tgId, st);

      return safeReply(
        ctx,
        "Siz bilan bog‘lanish uchun telefon raqamingizni yozing (masalan, +998901234567):"
      );
    }

    return next();
  });

  // --- Telefonni qabul qilish
  bot.on("text", async (ctx, next) => {
    const tgId = ctx.from.id;
    const st = leadState.get(tgId);
    if (!st || st.step !== "phone") return next();

    const raw = (ctx.message.text || "").trim();
    const digits = raw.replace(/[^\d+]/g, "");
    if (!/^\+?\d{9,15}$/.test(digits)) {
      return safeReply(ctx, "Iltimos, raqamni to‘g‘ri kiriting (masalan, +998901234567).");
    }

    st.data.phone = digits;
    st.step = "done";
    leadState.set(tgId, st);

    try {
      const [[u]] = await pool.query(
        "SELECT id, full_name, username, phone FROM users WHERE tg_id=?",
        [tgId]
      );
      const data = st.data;

      await saveLead({
        userId: u?.id || null,
        tgId,
        phone: data.phone,
        reason: data.reason || null,
        district: data.district,
        group: data.group,
        timeSlot: data.time_slot,
        daysCode: data.days_pref,
      });

      await safeReply(
        ctx,
        "✅ Rahmat! Arizangiz qabul qilindi.\n" +
          "Tez orada menejerlarimiz siz bilan bog‘lanadi."
      );

      // admin kanaliga xabar (xatoni yutamiz)
      const reasonLabel = (REASONS.find((r) => r.code === data.reason) || {}).label || data.reason;
      const daysLabel = (DAYS_PREF.find((d) => d.code === data.days_pref) || {}).label || data.days_pref;

      await ctx.telegram
        .sendMessage(
          TARGET_CHANNEL_ID,
          "🆕 Yangi lead:\n" +
            `👤 ${u?.full_name || "-"} ${ctx.from.username ? "(@" + ctx.from.username + ")" : ""}\n` +
            `📞 ${data.phone}\n` +
            `🎯 Sabab: ${reasonLabel}\n` +
            `📍 Tuman: ${data.district}\n` +
            `🏷 Guruh: ${data.group}\n` +
            `⏰ Vaqt: ${data.time_slot}\n` +
            `📅 Kunlar: ${daysLabel}\n` +
            `💸 Taklif: 10% chegirma`
        )
        .catch(() => {});

    } catch (e) {
      console.error("Lead save error:", e?.message || e);
      await safeReply(ctx, "Kutilmagan xatolik. Iltimos, keyinroq urinib ko‘ring.");
    } finally {
      leadState.delete(tgId);
    }
  });
}

module.exports = { registerLead };
