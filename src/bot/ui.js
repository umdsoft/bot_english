// src/bot/ui.js
const { Markup } = require('telegraf');

function askPhoneKeyboard() {
  return Markup.keyboard([ Markup.button.contactRequest('📲 Raqamni yuborish') ])
    .oneTime()
    .resize();
}

function mainMenuKeyboard() {
  return Markup.keyboard([
    ['📝 Testni boshlash'],
    ['📍 Manzil', '📞 Bog‘lanish'],
    ['ℹ️ Ma’lumot']
  ]).resize();
}

module.exports = { askPhoneKeyboard, mainMenuKeyboard };
