// src/polls/publisher.js
const { pool } = require("../db");
const { Markup } = require("telegraf");

/** HTML-ni Telegram uchun xavfsiz holga keltirish:
 *  faqat <b>,<i>,<u>,<s>,<a>,<br> teglari qoldiriladi */
function cleanHtml(html = "") {
  const str = String(html);
  // ruxsat berilmagan teglardan tozalash
  const cleaned = str
    .replace(/<\/?(?!b|i|u|s|a|br)\w+[^>]*>/gi, '')
    // <a ...> ni faqat href bilan cheklaymiz
    .replace(/<a\s+([^>]+)>/gi, (m, attrs) => {
      const href = (attrs.match(/href\s*=\s*"(.*?)"/i) || [,'#'])[1];
      return `<a href="${href}">`;
    });
  return cleaned;
}

/** Xabar matnini (title+body+variantlar ro‘yxati) HTML ko‘rinishda yasash */
function composePollHtml(poll) {
  const title = poll.title ? `<b>🗳 So‘rovnoma:</b>\n<b>${cleanHtml(poll.title)}</b>` : '<b>🗳 So‘rovnoma</b>';
  const body  = poll.body ? cleanHtml(poll.body) : '';                // DB da 'body' ustuni bor
  const list  = (poll.options || [])
    .map((o, i) => `<b>${i + 1}.</b> ${cleanHtml(o.text)}`)
    .join('\n');

  return [title, body, list].filter(Boolean).join('\n\n');
}

/** HAR BIR variant BITTA qator bo‘lsin */
function onePerRowButtons(options, pollId) {
  return options.map((o, i) => ([
    Markup.button.callback(`${i + 1} — Tanlayman`, `poll:${pollId}:${o.id}`)
  ]));
}

async function getActivePollWithOptions() {
  const [[poll]] = await pool.query(
    `SELECT * FROM polls WHERE is_active=1 ORDER BY id DESC LIMIT 1`
  );
  if (!poll) return null;

  const [opts] = await pool.query(
    `SELECT id, poll_id, text, sort_order
       FROM poll_options
      WHERE poll_id=? ORDER BY sort_order, id`,
    [poll.id]
  );
  poll.options = opts;
  return poll;
}

/**
 * Aktiv so'rovnomani faqat hali ovoz bermagan foydalanuvchilarga yuboradi.
 * target = all | students | non_students
 */
async function sendActivePollToUsers(bot) {
  const poll = await getActivePollWithOptions();
  if (!poll) return { sent: 0 };

  // Target filtri
  let targetFilter = '1=1';
  if (poll.target === 'students')     targetFilter = 'u.is_student=1';
  else if (poll.target === 'non_students') targetFilter = 'u.is_student=0';

  // Hali ovoz bermaganlar
  const [rows] = await pool.query(
    `
    SELECT u.id AS user_id, u.tg_id
      FROM users u
     WHERE ${targetFilter}
       AND u.tg_id IS NOT NULL
       AND NOT EXISTS (
             SELECT 1
               FROM poll_votes v
              WHERE v.poll_id = ?
                AND (v.user_id = u.id OR v.tg_id = u.tg_id)
           )
    `,
    [poll.id]
  );
  if (!rows.length) return { sent: 0 };

  const textHtml = composePollHtml(poll);
  const keyboard = Markup.inlineKeyboard(onePerRowButtons(poll.options, poll.id));

  let sent = 0;
  for (const r of rows) {
    const chatId = Number(r.tg_id);
    if (!chatId) continue;

    try {
      await bot.telegram.sendMessage(chatId, textHtml, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...keyboard
      });
      sent++;
    } catch (err) {
      // foydalanuvchi bloklagan/yaroqsiz chat — server to‘xtamasin
      const code = err?.response?.error_code;
      if (![400, 401, 403].includes(code)) {
        console.error('poll send error:', chatId, err?.description || err?.message || err);
      }
    }
  }
  return { sent };
}

module.exports = { getActivePollWithOptions, sendActivePollToUsers };
