// src/lib/telegram.js
const { pool } = require("../db");

// ixtiyoriy: agar users jadvalingizda is_blocked bo'lmasa, bu UPDATE'ni olib tashlang yoki try/catch qoldiring.
async function markBlocked(tgId) {
  try {
    await pool.query("UPDATE users SET is_blocked=1 WHERE tg_id=?", [tgId]);
  } catch {}
}

/** Xavfsiz sendMessage */
async function sendSafe(tg, chatId, text, extra = {}) {
  try {
    return await tg.sendMessage(chatId, text, extra);
  } catch (err) {
    const code = err?.response?.error_code;
    const desc = err?.response?.description || err?.description || err?.message;

    if (code === 403 || code === 400 || code === 401) { // user blocked / chat not found / unauthorized
      await markBlocked(chatId);
      console.warn("sendSafe soft error:", code, desc, "chat:", chatId);
      return null; // protsessni to‘xtatmaymiz
    }

    console.error("sendSafe error:", chatId, code, desc);
    return null;
  }
}

/** Xavfsiz editMessageText */
async function editSafe(tg, chatId, messageId, text, extra = {}) {
  try {
    return await tg.editMessageText(chatId, messageId, undefined, text, extra);
  } catch {
    return null;
  }
}

/** Xavfsiz deleteMessage */
async function deleteSafe(tg, chatId, messageId) {
  try {
    return await tg.deleteMessage(chatId, messageId);
  } catch {
    return null;
  }
}

/** Xavfsiz copyMessage (kanaldan relay va h.k. uchun) */
async function copySafe(tg, toChatId, fromChatId, messageId, extra = {}) {
  try {
    return await tg.copyMessage(toChatId, fromChatId, messageId, extra);
  } catch (err) {
    const code = err?.response?.error_code;
    const desc = err?.response?.description || err?.message;
    if (code === 403 || code === 400 || code === 401) {
      await markBlocked(toChatId);
      console.warn("copySafe soft error:", code, desc, "to:", toChatId);
      return null;
    }
    console.error("copySafe error:", toChatId, code, desc);
    return null;
  }
}

module.exports = { sendSafe, editSafe, deleteSafe, copySafe };
