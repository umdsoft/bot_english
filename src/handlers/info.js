const { INTL_EDU_INFO } = require("../texts/intlInfo");
const { Markup } = require("telegraf");
const CENTER_TITLE = process.env.CENTER_TITLE || "Praktikum Academy";
const CENTER_ADDRESS = process.env.CENTER_ADDRESS || "Xorazm, Urganch shahri";
const CENTER_LAT = Number(process.env.CENTER_LAT || 0);
const CENTER_LNG = Number(process.env.CENTER_LNG || 0);

const CONTACT_MAIN_PHONE = (process.env.CONTACT_MAIN_PHONE || "").trim();
const CONTACT_SECOND_PHONE = (process.env.CONTACT_SECOND_PHONE || "").trim();
const CONTACT_EMAIL = (process.env.CONTACT_EMAIL || "").trim();
const CONTACT_TG = (process.env.CONTACT_TG || "").trim();
const CONTACT_IG = (process.env.CONTACT_IG || "").trim();
const CONTACT_SITE = (process.env.CONTACT_SITE || "").trim();
const CONTACT_WORKING_HOURS =
  process.env.CONTACT_WORKING_HOURS || "Dush–Yak: 9:00–20:00";
// 1) Kontakt card(lari) (Telegramning “Contact” kartochkasi)
const mainTel = toTelLink(CONTACT_MAIN_PHONE);
const secondTel = toTelLink(CONTACT_SECOND_PHONE);

// E.164/tel: link uchun tozalash
function toTelLink(num) {
  if (!num) return "";
  const clean = num.replace(/[^\d+]/g, "");
  return clean.startsWith("+") ? clean : "+" + clean;
}
// Telegram username link
function toTgLink(u) {
  if (!u) return "";
  const clean = u.replace(/^@+/, "");
  return `https://t.me/${clean}`;
}

function registerInfo(bot) {
  bot.hears("ℹ️ Ma’lumot", async (ctx) => {
    await ctx.reply(
      "A1 darajadagi test: yakunda foiz, taxminiy CEFR, to‘g‘ri/xato soni hisoblanadi va PDF hisobot administratorlar kanaliga yuboriladi.\n" +
        "Ball tizimi: birinchi marta testni yakunlasangiz 2 ball olasiz (o‘quvchi bo‘lmaganlar uchun umumiy cap 10 ball)."
    );
  });

  bot.hears("🌍 Xalqaro ta’lim haqida ma’lumot", async (ctx) => {
    await ctx.reply(INTL_EDU_INFO, { disable_web_page_preview: true });
  });
  bot.hears("📞 Bog‘lanish", async (ctx) => {
    try {
      if (CENTER_LAT && CENTER_LNG) {
        await ctx.replyWithVenue(
          CENTER_LAT,
          CENTER_LNG,
          CENTER_TITLE,
          CENTER_ADDRESS
        );
      }
      if (mainTel) {
        await ctx.replyWithContact(mainTel, "Praktikum Academy", "Call-center");
      }
      if (secondTel) {
        await ctx.replyWithContact(
          secondTel,
          "Praktikum Academy",
          "Administrator"
        );
      }

      // 2) Matn + foydali havolalar
      const tgUrl = CONTACT_TG ? toTgLink(CONTACT_TG) : "";
      const lines = [];

      if (CONTACT_WORKING_HOURS)
        lines.push(`🕒 Ish vaqti: ${CONTACT_WORKING_HOURS}`);
      if (CONTACT_EMAIL) lines.push(`✉️ Email: ${CONTACT_EMAIL}`);
      if (CONTACT_MAIN_PHONE)
        lines.push(`📞 Asosiy raqam: ${CONTACT_MAIN_PHONE}`);
      if (CONTACT_SECOND_PHONE)
        lines.push(`📞 Qo‘shimcha: ${CONTACT_SECOND_PHONE}`);

      // Xarita havolasi (CENTER_LAT/LNG oldin kiritgan edik)
      const hasCoords =
        typeof CENTER_LAT === "number" &&
        typeof CENTER_LNG === "number" &&
        CENTER_LAT &&
        CENTER_LNG;
      const gmapsUrl = hasCoords
        ? `https://maps.google.com/?q=${CENTER_LAT},${CENTER_LNG}`
        : "";

      const kbRows = [];
      if (mainTel)
        kbRows.push([
          Markup.button.url("📞 Qo‘ng‘iroq qilish:", `${mainTel}`),
        ]);
      if (gmapsUrl)
        kbRows.push([Markup.button.url("📍 Manzil (Google Maps)", gmapsUrl)]);
      if (tgUrl) kbRows.push([Markup.button.url("✈️ Telegram", tgUrl)]);
      if (CONTACT_IG)
        kbRows.push([Markup.button.url("📸 Instagram", CONTACT_IG)]);
      if (CONTACT_SITE)
        kbRows.push([Markup.button.url("🌐 Veb-sayt", CONTACT_SITE)]);
      if (CONTACT_EMAIL)
        kbRows.push([
          Markup.button.url("✉️ Email yozish", `${CONTACT_EMAIL}`),
        ]);

      await ctx.reply(
        `📞 **Bog‘lanish uchun ma’lumotlar**\n\n${lines.join("\n")}`,
        { parse_mode: "Markdown", ...Markup.inlineKeyboard(kbRows) }
      );
    } catch (e) {
      console.error("Contact handler error:", e);
      await ctx.reply(
        "Kutilmagan xatolik. Birozdan so‘ng yana urinib ko‘ring."
      );
    }
  });
  bot.hears("📍 Manzil", async (ctx) => {
    try {
      if (CENTER_LAT && CENTER_LNG) {
        // Telegram venue kartochkasi (xarita pin + nom + manzil)
        await ctx.replyWithVenue(
          CENTER_LAT,
          CENTER_LNG,
          CENTER_TITLE,
          CENTER_ADDRESS
        );
        const gmaps = `https://maps.google.com/?q=${CENTER_LAT},${CENTER_LNG}`;
        await ctx.reply("🧭 Yo‘l-yo‘riq: Google xarita 📍\n" + gmaps);
      } else {
        await ctx.reply(
          `📍 ${CENTER_TITLE}\n${CENTER_ADDRESS}\n\n` +
            "ℹ️ Koordinatalar aniqlanmagan. Admin .env faylga CENTER_LAT va CENTER_LNG qo‘ysin."
        );
      }
    } catch (e) {
      console.error("Location send error:", e);
      await ctx.reply(
        "Kutilmagan xatolik. Birozdan so‘ng yana urinib ko‘ring."
      );
    }
  });
}

module.exports = { registerInfo };
