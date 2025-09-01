const { pool } = require("../db");

const REASONS = [
  { code: "school", label: "Maktab baholarini yaxshilash" },
  { code: "ielts_get", label: "IELTS / CEFR olish" },
  { code: "ielts_up", label: "IELTS / CEFR darajamni oshirish" },
  { code: "study_abroad", label: "Chet elda o‘qish" },
  { code: "personal", label: "Shaxsiy rivojlanish" },
];

const DISTRICTS = [
  "Urganch shahri","Urganch tumani","Xiva shahri","Xiva tumani",
  "Xonqa","Gurlan","Qo‘shko‘pir","Bog‘ot","Shovot",
  "Yangiariq","Yangibozor","Hazorasp","Tuproqqal’a"
];

const GROUPS = [
  "Beginner","Elementary","Pre-Intermediate","Intermediate",
  "Upper-Intermediate","Advanced","IELTS","CEFR"
];

const TIME_SLOTS = [
  "9:00-11:00","11:00-13:00","14:30-16:30","16:00-18:00","18:00-20:00"
];

const DAYS_PREF = [
  { code: "odd", label: "Toq kunlari" },
  { code: "even", label: "Juft kunlari" },
  { code: "any", label: "Farqi yo‘q" },
];

/**
 * leads jadvali (sizdagi hozirgi struktura):
 *  id, user_id, tg_id, source('bot'...), stage, intent, purpose, district,
 *  group_preference, preferred_time, preferred_days, note, created_at
 */
async function saveLead({
  userId, tgId, phone, reason, district, group, timeSlot, daysCode,
}) {
  await pool.query(
    `INSERT INTO leads
      (user_id, tg_id, source, stage, intent, purpose, district, group_preference, preferred_time, preferred_days, note, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, NOW())`,
    [
      userId || null,
      tgId,
      "bot",
      "new",
      "info",
      reason,
      district,
      group,
      timeSlot,
      daysCode,
      phone,
    ]
  );
}

module.exports = {
  REASONS,
  DISTRICTS,
  GROUPS,
  TIME_SLOTS,
  DAYS_PREF,
  saveLead,
};
