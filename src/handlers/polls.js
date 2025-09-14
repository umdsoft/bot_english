// src/handlers/polls.js
const { Markup } = require("telegraf");
const { pool } = require("../db");

async function loadPollFull(pollId) {
  const [[poll]] = await pool.query("SELECT * FROM polls WHERE id=?", [pollId]);
  if (!poll) return null;
  const [opts] = await pool.query(
    "SELECT * FROM poll_options WHERE poll_id=? ORDER BY sort_order,id",
    [pollId]
  );
  poll.options = opts;
  return poll;
}

async function sendPollToUser(tg, chatId, poll) {
  const body = [];
  body.push(`📋 <b>${poll.title}</b>`);
  if (poll.body) body.push(poll.body);
  if (poll.is_multi)
    body.push(
      `\n<i>Bir nechta variantni tanlashingiz mumkin. ✅ Yakunlash tugmasini bosing.</i>`
    );
  const text = body.join("\n");

  const rows = poll.options.map((o) => [
    Markup.button.callback(o.text, `poll:${poll.id}:${o.id}`),
  ]);
  if (poll.is_multi)
    rows.push([Markup.button.callback("✅ Yakunlash", `poll:done:${poll.id}`)]);
  rows.push([Markup.button.callback("📊 Natija", `poll:res:${poll.id}`)]);

  return tg.sendMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup: Markup.inlineKeyboard(rows),
  });
}

async function recordVote({ poll, optionId, userId, tgId }) {
  if (!poll.is_multi) {
    await pool.query("DELETE FROM poll_votes WHERE poll_id=? AND tg_id=?", [
      poll.id,
      tgId,
    ]);
  }
  await pool.query(
    "INSERT IGNORE INTO poll_votes (poll_id, option_id, user_id, tg_id) VALUES (?,?,?,?)",
    [poll.id, optionId, userId || null, tgId]
  );
}

async function loadResults(pollId) {
  const [[tot]] = await pool.query(
    "SELECT COUNT(*) AS c FROM poll_votes WHERE poll_id=?",
    [pollId]
  );
  const [rows] = await pool.query(
    `
    SELECT o.id, o.text, COUNT(v.id) AS votes
    FROM poll_options o
    LEFT JOIN poll_votes v ON v.option_id=o.id
    WHERE o.poll_id=?
    GROUP BY o.id
    ORDER BY o.sort_order, o.id
  `,
    [pollId]
  );
  const total = Number(tot.c || 0);
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    votes: Number(r.votes || 0),
    percent: total ? (Number(r.votes || 0) * 100) / total : 0,
  }));
}

function registerPolls(bot) {
  // ❌ MENYU yo'q. Faqat tarqatilgan xabarlar orqali ishlaydi.

  bot.action(/^poll:vote:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const pollId = Number(ctx.match[1]);
    const optId = Number(ctx.match[2]);

    const poll = await loadPollFull(pollId);
    if (!poll || !poll.is_active) return ctx.reply("So‘rovnoma faol emas.");

    const tgId = ctx.from.id;
    const [[u]] = await pool.query("SELECT id FROM users WHERE tg_id=?", [
      tgId,
    ]);
    await recordVote({ poll, optionId: optId, userId: u?.id, tgId });

    if (!poll.is_multi) return ctx.reply("Rahmat! Javobingiz qabul qilindi.");
    return ctx.reply(
      "✅ Variant belgilandi. Tugatish uchun “✅ Yakunlash” tugmasini bosing."
    );
  });

  bot.action(/^poll:done:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    return ctx.reply("Rahmat! So‘rovnomada ishtirok etdingiz.");
  });

  bot.action(/^poll:res:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const pollId = Number(ctx.match[1]);
    const res = await loadResults(pollId);
    if (!res.length) return ctx.reply("Hali ovozlar yo‘q.");
    const txt = [
      "📊 <b>Joriy natijalar</b>",
      ...res.map(
        (r) => `• ${r.text} — <b>${r.votes}</b> ta (${r.percent.toFixed(1)}%)`
      ),
    ].join("\n");
    return ctx.reply(txt, { parse_mode: "HTML" });
  });
}

module.exports = { registerPolls, sendPollToUser, loadPollFull };
