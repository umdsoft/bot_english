const { Markup } = require("telegraf");

function askPhoneKeyboard() {
  return Markup.keyboard([Markup.button.contactRequest("📲 Raqamni yuborish")])
    .oneTime()
    .resize();
}

function mainMenuKeyboard() {
  return Markup.keyboard([
    ["📝 Testni boshlash"],
    ["ℹ️ Ma’lumot", "🌍 Xalqaro ta’lim haqida ma’lumot"],
  ]).resize();
}

module.exports = { askPhoneKeyboard, mainMenuKeyboard };
