// src/services/subscribers.db.js
const { pool } = require("../db");

/**
 * Barcha foydalanuvchilarning chat_id (Telegram user ID) ro'yxati.
 * Chat_id = users.tg_id
 * Natija: string[] (['123456789', '987654321', ...])
 */
async function getAllSubscribersFromDB() {
  // faqat tg_id bor bo‘lganlar
  const [rows] = await pool.query(`
    SELECT tg_id
    FROM users
    WHERE tg_id IS NOT NULL
  `);

  // string ko‘rinishda qaytaramiz, bo‘shlarni va 0 ni tashlaymiz, dublikatlarni olib tashlaymiz
  const ids = Array.from(
    new Set(
      rows
        .map(r => (r.tg_id != null ? String(r.tg_id).trim() : ""))
        .filter(v => v && v !== "0")
    )
  );

  return ids;
}

/**
 * (Ixtiyoriy) Faqat LEAD bo‘lgan foydalanuvchilarni olish.
 * Agar kerak bo‘lsa channelRelay’da shu funksiyani chaqiring.
 */
async function getLeadSubscribersFromDB() {
  const [rows] = await pool.query(`
    SELECT DISTINCT u.tg_id
    FROM leads l
    JOIN users u ON u.id = l.user_id
    WHERE u.tg_id IS NOT NULL
  `);

  return Array.from(
    new Set(
      rows
        .map(r => (r.tg_id != null ? String(r.tg_id).trim() : ""))
        .filter(v => v && v !== "0")
    )
  );
}
// foydalanuvchini DB dan o‘chirish
async function deleteUserByTgId(tgId) {
  await pool.query("DELETE FROM users WHERE tg_id=?", [tgId]);
}
/**
 * (Ixtiyoriy) Botni bloklagan foydalanuvchini users dan belgilash yoki o‘chirish uchun yordamchi.
 * Sizning siyosatingizga qarab ishlating (channelRelay ichida 403 bo‘lsa).
 */
async function markUserAsBlockedByTgId(tgId) {
  // Masalan: is_blocked degan ustun bo‘lsa, shuni 1 ga qo‘yish mumkin.
  // Agar sizda bunday ustun yo‘q bo‘lsa, bu funksiyani ishlatmasangiz ham bo‘ladi.
  try {
    await pool.query(`UPDATE users SET is_blocked=1 WHERE tg_id=?`, [tgId]);
  } catch (e) {
    // ustun bo‘lmasa jim qolamiz
  }
}

module.exports = {
  getAllSubscribersFromDB,
  getLeadSubscribersFromDB,
  markUserAsBlockedByTgId,
  deleteUserByTgId
};
 