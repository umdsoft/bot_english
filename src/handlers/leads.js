const { Markup } = require("telegraf");
const { pool } = require("../db");
const { saveLead, REASONS, DISTRICTS, GROUPS, TIME_SLOTS, DAYS_PREF } = require("../services/leads");
const { TARGET_CHANNEL_ID } = require("../config");

const leadState = new Map(); // tg_id -> { step, data:{} }

function registerLead(bot) {
  // Funnel tugmalari testdan keyin yuboriladi (testFlow ichida), lekin handlerlar bu yerda

  bot.on("callback_query", async (ctx, next) => {
    const data = ctx.callbackQuery?.data || "";

    if (data === "lead:info") {
      await ctx.answerCbQuery();
      return ctx.reply(
        "Kurslarimiz bo‘yicha batafsil ma’lumot: \n" +
          "— Darajali guruhlar, malakali ustozlar, zamonaviy metodika.\n" +
          "— IELTS/CEFR va umumiy ingliz tili dasturlari.\n\n" +
          "Savollar bo‘lsa, shu yerga yozing."
      );
    }

    if (data === "lead:start") {
      await ctx.answerCbQuery();
      const tgId = ctx.from.id;
      leadState.set(tgId, { step: "reason", data: {} });
      return ctx.reply(
        "Ingliz tilini **nima uchun** o‘rganmoqchisiz?",
        Markup.inlineKeyboard(REASONS.map(r => [Markup.button.callback(r.label, `lead:reason:${r.code}`)]))
      );
    }

    if (data.startsWith("lead:reason:")) {
      await ctx.answerCbQuery();
      const code = data.split(":")[2];
      const tgId = ctx.from.id;
      const st = leadState.get(tgId) || { data: {} };
      st.step = "district"; st.data.reason = code;
      leadState.set(tgId, st);

      const rows = [];
      for (let i=0;i<DISTRICTS.length;i+=2) {
        rows.push(DISTRICTS.slice(i,i+2).map(d => Markup.button.callback(d, `lead:district:${d}`)));
      }
      return ctx.reply("Qaysi tumanda yashaysiz?", Markup.inlineKeyboard(rows));
    }

    if (data.startsWith("lead:district:")) {
      await ctx.answerCbQuery();
      const name = data.split(":").slice(2).join(":"); // tuman
      const tgId = ctx.from.id;
      const st = leadState.get(tgId) || { data: {} };
      st.step = "group"; st.data.district = name;
      leadState.set(tgId, st);

      return ctx.reply(
        "Qaysi **guruh**da o‘qishni xohlaysiz?",
        Markup.inlineKeyboard(GROUPS.map(g => [Markup.button.callback(g, `lead:group:${g}`)]))
      );
    }

    if (data.startsWith("lead:group:")) {
      await ctx.answerCbQuery();
      const group = data.split(":").slice(2).join(":");
      const tgId = ctx.from.id;
      const st = leadState.get(tgId) || { data: {} };
      st.step = "time"; st.data.group = group;
      leadState.set(tgId, st);

      return ctx.reply(
        "Qaysi **vaqtlar** sizga qulay?",
        Markup.inlineKeyboard(TIME_SLOTS.map(t => [Markup.button.callback(t, `lead:time:${t}`)]))
      );
    }

    if (data.startsWith("lead:time:")) {
      await ctx.answerCbQuery();
      const slot = data.split(":").slice(2).join(":");
      const tgId = ctx.from.id;
      const st = leadState.get(tgId) || { data: {} };
      st.step = "days"; st.data.time_slot = slot;
      leadState.set(tgId, st);

      return ctx.reply(
        "Qaysi **kunlar** sizga qulay?",
        Markup.inlineKeyboard(DAYS_PREF.map(d => [Markup.button.callback(d.label, `lead:days:${d.code}`)]))
      );
    }

    if (data.startsWith("lead:days:")) {
      await ctx.answerCbQuery();
      const code = data.split(":")[2];
      const tgId = ctx.from.id;
      const st = leadState.get(tgId) || { data: {} };
      st.step = "phone"; st.data.days_pref = code;
      leadState.set(tgId, st);

      return ctx.reply("Siz bilan bog‘lanish uchun telefon raqamingizni yozing (masalan, +998901234567):");
    }

    return next();
  });

  // telefonni qabul qilish
  bot.on("text", async (ctx, next) => {
    const tgId = ctx.from.id;
    const st = leadState.get(tgId);
    if (!st || st.step !== "phone") return next();

    const raw = (ctx.message.text || "").trim();
    const digits = raw.replace(/[^\d+]/g, "");
    if (!/^\+?\d{9,15}$/.test(digits)) {
      return ctx.reply("Iltimos, raqamni to‘g‘ri kiriting (masalan, +998901234567).");
    }

    st.data.phone = digits;
    st.step = "done";
    leadState.set(tgId, st);

    try {
      const [[u]] = await pool.query("SELECT id, full_name, username, phone FROM users WHERE tg_id=?", [tgId]);
      const data = st.data;

      await saveLead({
        userId: u?.id || null,
        tgId,
        phone: data.phone,
        reason: data.reason,
        district: data.district,
        group: data.group,
        timeSlot: data.time_slot,
        daysCode: data.days_pref,
      });

      await ctx.reply(
        "✅ Rahmat! Arizangiz qabul qilindi.\n" +
        "Tez orada menejerlarimiz siz bilan bog‘lanadi."
      );

      try {
        await ctx.telegram.sendMessage(
          TARGET_CHANNEL_ID,
          "🆕 Yangi lead:\n" +
            `👤 ${u?.full_name || "-"} ${ctx.from.username ? "(@" + ctx.from.username + ")" : ""}\n` +
            `📞 ${data.phone}\n` +
            `🎯 Sabab: ${(REASONS.find(r=>r.code===data.reason)||{}).label || data.reason}\n` +
            `📍 Tuman: ${data.district}\n` +
            `🏷 Guruh: ${data.group}\n` +
            `⏰ Vaqt: ${data.time_slot}\n` +
            `📅 Kunlar: ${(DAYS_PREF.find(d=>d.code===data.days_pref)||{}).label || data.days_pref}\n` +
            `💸 Taklif: 10% chegirma`
        );
      } catch {}

    } catch (e) {
      console.error("Lead save error:", e);
      await ctx.reply("Kutilmagan xatolik. Iltimos, keyinroq urinib ko‘ring.");
    } finally {
      leadState.delete(tgId);
    }
  });
}

module.exports = { registerLead };
