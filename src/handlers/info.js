// src/handlers/info.js
const { INTL_EDU_INFO } = require("../texts/intlInfo");
const { Markup } = require("telegraf");

const CENTER_TITLE   = process.env.CENTER_TITLE   || "Praktikum Academy";
const CENTER_ADDRESS = process.env.CENTER_ADDRESS || "Xorazm, Urganch shahri";
const CENTER_LAT     = Number(process.env.CENTER_LAT || 0);
const CENTER_LNG     = Number(process.env.CENTER_LNG || 0);

const CONTACT_MAIN_PHONE   = (process.env.CONTACT_MAIN_PHONE || "").trim();
const CONTACT_SECOND_PHONE = (process.env.CONTACT_SECOND_PHONE || "").trim();
const CONTACT_EMAIL        = (process.env.CONTACT_EMAIL || "").trim();
const CONTACT_TG           = (process.env.CONTACT_TG || "").trim();
const CONTACT_IG           = (process.env.CONTACT_IG || "").trim();
const CONTACT_SITE         = (process.env.CONTACT_SITE || "").trim();
const CONTACT_WORKING_HOURS =
  process.env.CONTACT_WORKING_HOURS || "Dush–Yak: 9:00–20:00";

// ---------- helpers ----------
function toTelLink(num) {
  if (!num) return "";
  const clean = num.replace(/[^\d+]/g, "");
  return clean.startsWith("+") ? clean : "+" + clean;
}
function toTgLink(u) {
  if (!u) return "";
  const clean = u.replace(/^@+/, "");
  return `https://t.me/${clean}`;
}

// Safe wrappers (xatoni yutib yuboradi)
function safeReply(ctx, text, extra) {
  return ctx.reply(text, extra).catch(() => null);
}
function safeVenue(ctx, lat, lng, title, address, extra) {
  return ctx.replyWithVenue(lat, lng, title, address, extra).catch(() => null);
}
function safeContact(ctx, phoneNumber, firstName, lastName) {
  return ctx.replyWithContact(phoneNumber, firstName, lastName).catch(() => null);
}

const mainTel   = toTelLink(CONTACT_MAIN_PHONE);
const secondTel = toTelLink(CONTACT_SECOND_PHONE);

function registerInfo(bot) {
  // ℹ️ Ma'lumot
  bot.hears("ℹ️ Ma’lumot", async (ctx) => {
    await safeReply(
      ctx,
      "A1 darajadagi test: yakunda foiz, taxminiy CEFR, to‘g‘ri/xato soni hisoblanadi va PDF hisobot administratorlar kanaliga yuboriladi.\n" +
        "Ball tizimi: birinchi marta testni yakunlasangiz 2 ball olasiz (o‘quvchi bo‘lmaganlar uchun umumiy cap 10 ball)."
    );
  });

  // 🌍 Xalqaro ta’lim
  bot.hears("🌍 Xalqaro ta’lim haqida ma’lumot", async (ctx) => {
    await safeReply(ctx, INTL_EDU_INFO, { disable_web_page_preview: true });
  });

  // 📞 Bog'lanish
  bot.hears("📞 Bog‘lanish", async (ctx) => {
    try {
      if (CENTER_LAT && CENTER_LNG) {
        await safeVenue(ctx, CENTER_LAT, CENTER_LNG, CENTER_TITLE, CENTER_ADDRESS);
      }
      if (mainTel) {
        await safeContact(ctx, mainTel, "Praktikum Academy", "Call-center");
      }
      if (secondTel) {
        await safeContact(ctx, secondTel, "Praktikum Academy", "Administrator");
      }

      // Matn + foydali havolalar
      const tgUrl = CONTACT_TG ? toTgLink(CONTACT_TG) : "";
      const lines = [];

      if (CONTACT_WORKING_HOURS) lines.push(`🕒 Ish vaqti: ${CONTACT_WORKING_HOURS}`);
      if (CONTACT_EMAIL)        lines.push(`✉️ Email: ${CONTACT_EMAIL}`);
      if (CONTACT_MAIN_PHONE)   lines.push(`📞 Asosiy raqam: ${CONTACT_MAIN_PHONE}`);
      if (CONTACT_SECOND_PHONE) lines.push(`📞 Qo‘shimcha: ${CONTACT_SECOND_PHONE}`);

      const hasCoords = Number.isFinite(CENTER_LAT) && Number.isFinite(CENTER_LNG) && CENTER_LAT && CENTER_LNG;
      const gmapsUrl  = hasCoords ? `https://maps.google.com/?q=${CENTER_LAT},${CENTER_LNG}` : "";

      const kbRows = [];
      if (mainTel)  kbRows.push([Markup.button.url("📞 Qo‘ng‘iroq qilish:", `${mainTel}`)]);
      if (gmapsUrl) kbRows.push([Markup.button.url("📍 Manzil (Google Maps)", gmapsUrl)]);
      if (tgUrl)    kbRows.push([Markup.button.url("✈️ Telegram", tgUrl)]);
      if (CONTACT_IG)   kbRows.push([Markup.button.url("📸 Instagram", CONTACT_IG)]);
      if (CONTACT_SITE) kbRows.push([Markup.button.url("🌐 Veb-sayt", CONTACT_SITE)]);
      if (CONTACT_EMAIL) kbRows.push([Markup.button.url("✉️ Email yozish", `mailto:${CONTACT_EMAIL}`)]);

      await safeReply(
        ctx,
        `📞 **Bog‘lanish uchun ma’lumotlar**\n\n${lines.join("\n")}`,
        { parse_mode: "Markdown", ...Markup.inlineKeyboard(kbRows) }
      );
    } catch (e) {
      console.error("Contact handler error:", e?.message || e);
      await safeReply(ctx, "Kutilmagan xatolik. Birozdan so‘ng yana urinib ko‘ring.");
    }
  });

  // 📍 Manzil
  bot.hears("📍 Manzil", async (ctx) => {
    try {
      if (CENTER_LAT && CENTER_LNG) {
        await safeVenue(ctx, CENTER_LAT, CENTER_LNG, CENTER_TITLE, CENTER_ADDRESS);
        const gmaps = `https://maps.google.com/?q=${CENTER_LAT},${CENTER_LNG}`;
        await safeReply(ctx, "🧭 Yo‘l-yo‘riq: Google xarita 📍\n" + gmaps);
      } else {
        await safeReply(
          ctx,
          `📍 ${CENTER_TITLE}\n${CENTER_ADDRESS}\n\n` +
            "ℹ️ Koordinatalar aniqlanmagan. Admin .env faylga CENTER_LAT va CENTER_LNG qo‘ysin."
        );
      }
    } catch (e) {
      console.error("Location send error:", e?.message || e);
      await safeReply(ctx, "Kutilmagan xatolik. Birozdan so‘ng yana urinib ko‘ring.");
    }
  });
}

module.exports = { registerInfo };
