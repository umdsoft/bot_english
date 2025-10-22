// src/handlers/leads.js
const { Markup } = require("telegraf");
const { query } = require("../db");
const { saveLead, REASONS, DISTRICTS, GROUPS, TIME_SLOTS, DAYS_PREF } = require("../services/leads");
const { TARGET_CHANNEL_ID } = require("../config");
const { safeReply, safeAnswerCallback } = require("../bot/helpers/telegram");
const { createLogger } = require("../core/logger");

const logger = createLogger("handlers:leads");

const leadState = new Map();

function registerLead(bot) {
  bot.on("callback_query", async (ctx, next) => {
    const data = ctx.callbackQuery?.data || "";

    if (data === "lead:info") {
      safeAnswerCallback(ctx);
      return safeReply(
        ctx,
        "Kurslarimiz bo‘yicha batafsil ma’lumot: \n" +
          "— Darajali guruhlar, malakali ustozlar, zamonaviy metodika.\n" +
          "— IELTS/CEFR va umumiy ingliz tili dasturlari.\n\n" +
          "Savollar bo‘lsa, shu yerga yozing."
      );
    }

    if (data === "lead:start") {
      safeAnswerCallback(ctx);
      const tgId = ctx.from.id;
      leadState.set(tgId, { step: "reason", data: {} });
      return safeReply(
        ctx,
        "Ingliz tilini **nima uchun** o‘rganmoqchisiz?",
        Markup.inlineKeyboard(
          REASONS.map((reason) => [
            Markup.button.callback(reason.label, `lead:reason:${reason.code}`),
          ])
        )
      );
    }

    if (data.startsWith("lead:reason:")) {
      safeAnswerCallback(ctx);
      const code = data.split(":")[2];
      const tgId = ctx.from.id;
      const state = leadState.get(tgId) || { data: {} };
      state.step = "district";
      state.data.reason = code;
      leadState.set(tgId, state);

      const rows = [];
      for (let i = 0; i < DISTRICTS.length; i += 2) {
        rows.push(
          DISTRICTS.slice(i, i + 2).map((district) =>
            Markup.button.callback(district, `lead:district:${district}`)
          )
        );
      }
      return safeReply(ctx, "Qaysi tumanda yashaysiz?", Markup.inlineKeyboard(rows));
    }

    if (data.startsWith("lead:district:")) {
      safeAnswerCallback(ctx);
      const name = data.split(":").slice(2).join(":");
      const tgId = ctx.from.id;
      const state = leadState.get(tgId) || { data: {} };
      state.step = "group";
      state.data.district = name;
      leadState.set(tgId, state);

      return safeReply(
        ctx,
        "Qaysi **guruh**da o‘qishni xohlaysiz?",
        Markup.inlineKeyboard(
          GROUPS.map((group) => [Markup.button.callback(group, `lead:group:${group}`)])
        )
      );
    }

    if (data.startsWith("lead:group:")) {
      safeAnswerCallback(ctx);
      const group = data.split(":").slice(2).join(":");
      const tgId = ctx.from.id;
      const state = leadState.get(tgId) || { data: {} };
      state.step = "time";
      state.data.group = group;
      leadState.set(tgId, state);

      return safeReply(
        ctx,
        "Qaysi **vaqtlar** sizga qulay?",
        Markup.inlineKeyboard(
          TIME_SLOTS.map((slot) => [Markup.button.callback(slot, `lead:time:${slot}`)])
        )
      );
    }

    if (data.startsWith("lead:time:")) {
      safeAnswerCallback(ctx);
      const slot = data.split(":").slice(2).join(":");
      const tgId = ctx.from.id;
      const state = leadState.get(tgId) || { data: {} };
      state.step = "days";
      state.data.time_slot = slot;
      leadState.set(tgId, state);

      return safeReply(
        ctx,
        "Qaysi **kunlar** sizga qulay?",
        Markup.inlineKeyboard(
          DAYS_PREF.map((day) => [Markup.button.callback(day.label, `lead:days:${day.code}`)])
        )
      );
    }

    if (data.startsWith("lead:days:")) {
      safeAnswerCallback(ctx);
      const code = data.split(":")[2];
      const tgId = ctx.from.id;
      const state = leadState.get(tgId) || { data: {} };
      state.step = "phone";
      state.data.days_pref = code;
      leadState.set(tgId, state);

      return safeReply(
        ctx,
        "Siz bilan bog‘lanish uchun telefon raqamingizni yozing (masalan, +998901234567):"
      );
    }

    return next();
  });

  bot.on("text", async (ctx, next) => {
    const tgId = ctx.from.id;
    const state = leadState.get(tgId);
    if (!state || state.step !== "phone") {
      return next();
    }

    const raw = (ctx.message.text || "").trim();
    const digits = raw.replace(/[^\d+]/g, "");
    if (!/^\+?\d{9,15}$/.test(digits)) {
      return safeReply(ctx, "Iltimos, raqamni to‘g‘ri kiriting (masalan, +998901234567).");
    }

    state.data.phone = digits;
    state.step = "done";
    leadState.set(tgId, state);

    try {
      const [[user]] = await query(
        "SELECT id, full_name, username, phone FROM users WHERE tg_id=?",
        [tgId]
      );

      const data = state.data;

      await saveLead({
        userId: user?.id || null,
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

      const reasonLabel = (REASONS.find((item) => item.code === data.reason) || {}).label || data.reason;
      const daysLabel = (DAYS_PREF.find((item) => item.code === data.days_pref) || {}).label || data.days_pref;

      await ctx.telegram
        .sendMessage(
          TARGET_CHANNEL_ID,
          "🆕 Yangi lead:\n" +
            `👤 ${user?.full_name || "-"} ${ctx.from.username ? "(@" + ctx.from.username + ")" : ""}\n` +
            `📞 ${data.phone}\n` +
            `🎯 Sabab: ${reasonLabel}\n` +
            `📍 Tuman: ${data.district}\n` +
            `🏷 Guruh: ${data.group}\n` +
            `⏰ Vaqt: ${data.time_slot}\n` +
            `📅 Kunlar: ${daysLabel}\n`
        )
        .catch((error) => {
          logger.warn("Failed to notify target channel", { message: error?.message });
        });
    } catch (error) {
      logger.error("Failed to process lead", { message: error?.message });
      await safeReply(
        ctx,
        "Kutilmagan xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko‘ring."
      );
    } finally {
      leadState.delete(tgId);
    }
  });
}

module.exports = { registerLead };
