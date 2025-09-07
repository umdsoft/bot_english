// src/services/leads.js
const { pool } = require("../db");

// --- kataloglar (o'zgarmagan) ---
const REASONS = [
  { code: "school",     label: "Maktab baholarini yaxshilash" },
  { code: "ielts_get",  label: "IELTS / CEFR olish" },
  { code: "ielts_up",   label: "IELTS / CEFR darajamni oshirish" },
  { code: "study_abroad", label: "Chet elda o‘qish" },
  { code: "personal",   label: "Shaxsiy rivojlanish" },
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
  { code: "odd",  label: "Toq kunlari" },
  { code: "even", label: "Juft kunlari" },
  { code: "any",  label: "Farqi yo‘q" },
];

// --- ichki helperlar (sanitizatsiya/validatsiya) ---
const S = {
  str(v, max = 200) {
    if (v === null || v === undefined) return null;
    let s = String(v).replace(/[\u0000-\u001F\u007F]/g, "").trim();
    if (!s) return null;
    if (s.length > max) s = s.slice(0, max);
    return s;
  },
  phone(v) {
    if (!v) return null;
    const s = String(v).replace(/[^\d+]/g, "");
    // E.164 ga yaqin format: + va 9-15 raqam
    return /^\+?\d{9,15}$/.test(s) ? s : null;
  },
  oneOf(v, allowed) {
    if (!v) return null;
    return allowed.includes(v) ? v : null;
  },
};

// leads jadvali (sizdagi struktura):
//  id, user_id, tg_id, source('bot'...), stage, intent, purpose, district,
//  group_preference, preferred_time, preferred_days, note, created_at
async function saveLead({
  userId,
  tgId,
  phone,
  reason,
  district,
  group,
  timeSlot,
  daysCode,
}) {
  // 1) Sanitizatsiya / validatsiya
  const user_id        = Number.isFinite(Number(userId)) ? Number(userId) : null;
  const tg_id          = Number.isFinite(Number(tgId))   ? Number(tgId)   : null;
  const note           = S.phone(phone) || S.str(phone, 64); // telefon yoki yozma kontakt
  const purpose        = S.oneOf(reason, REASONS.map(r => r.code)) || S.str(reason, 32);
  const district_clean = S.oneOf(district, DISTRICTS) || S.str(district, 64);
  const group_pref     = S.oneOf(group, GROUPS) || S.str(group, 32);
  const pref_time      = S.oneOf(timeSlot, TIME_SLOTS) || S.str(timeSlot, 32);
  const pref_days      = S.oneOf(daysCode, DAYS_PREF.map(d => d.code)) || S.str(daysCode, 8);

  if (!tg_id) throw new Error("saveLead: tg_id noto‘g‘ri.");
  // Reason va district majburiy deb hisoblaymiz (xohlasangiz yumshatishingiz mumkin)
  if (!purpose)  throw new Error("saveLead: reason/purpose ko‘rsatilmagan.");
  if (!district_clean) throw new Error("saveLead: district ko‘rsatilmagan.");

  // 2) DB ga yozish
  const sql = `
    INSERT INTO leads
      (user_id, tg_id, source, stage, intent, purpose, district,
       group_preference, preferred_time, preferred_days, note, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, NOW())
  `;
  const params = [
    user_id,
    tg_id,
    "bot",
    "new",
    "info",
    purpose,
    district_clean,
    group_pref,
    pref_time,
    pref_days,
    note,
  ];

  try {
    const [res] = await pool.query(sql, params);
    return res.insertId; // id ni qaytaramiz
  } catch (e) {
    // FK/CK xatolarini aniqroq qilish
    const msg = e?.sqlMessage || e?.message || String(e);
    throw new Error("saveLead DB error: " + msg);
  }
}

module.exports = {
  REASONS,
  DISTRICTS,
  GROUPS,
  TIME_SLOTS,
  DAYS_PREF,
  saveLead,
};
