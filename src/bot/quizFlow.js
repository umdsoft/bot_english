// src/bot/quizFlow.js
const { Markup } = require('telegraf');
const dayjs = require('dayjs');
const { pool } = require('../db');

// ---- DB yordamchilari (minimal keraklilari) ----
async function findActiveAttempt(userId) {
  const [rows] = await pool.query(
    "SELECT id, test_id FROM attempts WHERE user_id=? AND status='started' ORDER BY id DESC LIMIT 1",
    [userId]
  );
  return rows[0] || null;
}

async function startAttempt(userId, testId) {
  const [ins] = await pool.query(
    "INSERT INTO attempts (user_id, test_id, status, started_at) VALUES (?,?, 'started', NOW())",
    [userId, testId]
  );
  return ins.insertId;
}

async function getNextQuestion(testId, attemptId) {
  const [rows] = await pool.query(
    `
    SELECT q.*
    FROM questions q
    WHERE q.test_id=? AND q.id NOT IN (
      SELECT question_id FROM answers WHERE attempt_id=?
    )
    ORDER BY q.sort_order ASC, q.id ASC
    LIMIT 1
    `,
    [testId, attemptId]
  );
  return rows[0] || null;
}

async function getOptions(questionId) {
  const [rows] = await pool.query(
    "SELECT * FROM options WHERE question_id=? ORDER BY sort_order ASC, id ASC",
    [questionId]
  );
  return rows;
}

async function saveAnswer(attemptId, questionId, optionId) {
  const [[opt]] = await pool.query(
    "SELECT is_correct, weight FROM options WHERE id=?",
    [optionId]
  );
  const isCorrect = opt ? Number(opt.is_correct) : 0;
  const awarded   = opt ? (isCorrect ? Number(opt.weight || 1) : 0) : 0;

  await pool.query(
    `INSERT INTO answers (attempt_id, question_id, option_id, is_correct, awarded_score)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE 
       option_id=VALUES(option_id),
       is_correct=VALUES(is_correct),
       awarded_score=VALUES(awarded_score)`,
    [attemptId, questionId, optionId, isCorrect, awarded]
  );
}

async function computeAndFinishAttempt(attemptId) {
  // jami savollar
  const [[meta]] = await pool.query(
    `SELECT at.test_id, at.user_id,
            (SELECT COUNT(*) FROM questions WHERE test_id = at.test_id) AS total_questions
     FROM attempts at WHERE at.id=?`,
    [attemptId]
  );

  const totalQ = Number(meta?.total_questions || 0);

  const [[agg]] = await pool.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN o.is_correct=1 THEN COALESCE(o.weight,1) ELSE 0 END),0) AS total_score,
      COALESCE(SUM(CASE WHEN o.is_correct=1 THEN 1 ELSE 0 END),0) AS correct_count
    FROM answers a
    JOIN options o ON o.id=a.option_id
    WHERE a.attempt_id=?`,
    [attemptId]
  );

  const totalScore   = Number(agg.total_score || 0);
  const correctCount = Number(agg.correct_count || 0);
  const wrongCount   = Math.max(totalQ - correctCount, 0);
  const maxScore     = totalQ * 1.0;
  const percent      = maxScore ? (totalScore / maxScore) * 100 : 0;

  // soddalashtirilgan level taxmini
  let level = 'Beginner';
  if (percent >= 60) level = 'Elementary';
  if (percent >= 75) level = 'Pre-Intermediate';
  if (percent >= 90) level = 'Intermediate';

  await pool.query(
    `UPDATE attempts
       SET status='completed',
           finished_at=NOW(),
           score=?,
           percent=?,
           level_guess=?,
           duration_sec=TIMESTAMPDIFF(SECOND, started_at, NOW())
     WHERE id=?`,
    [totalScore, Number(percent.toFixed(2)), level, attemptId]
  );

  return { totalQ, totalScore, percent: Number(percent.toFixed(2)), level, correctCount, wrongCount };
}

// ---- Foydalanuvchiga navbatdagi savolni yuborish ----
async function sendNextQuestion(ctx, testId, attemptId) {
  const q = await getNextQuestion(testId, attemptId);
  if (!q) {
    const res = await computeAndFinishAttempt(attemptId);
    await ctx.reply(
      `✅ Test yakunlandi!\n` +
      `Foiz: ${res.percent}%\nDaraja: ${res.level}\n` +
      `✅ To‘g‘ri: ${res.correctCount} ta · ❌ ${res.wrongCount} ta`
    );
    return;
  }

  const opts = await getOptions(q.id);
  const buttons = opts.map(o => [Markup.button.callback(o.text, `ans:${q.id}:${o.id}:${attemptId}`)]);
  await ctx.reply(`❓ ${q.text}`, Markup.inlineKeyboard(buttons));
}

// ---- "ans:" callback’ini ro‘yxatdan o‘tkazish ----
function registerAnswerHandler(bot) {
  bot.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery?.data || '';
    if (!data.startsWith('ans:')) return next();

    try {
      const [, qIdStr, optIdStr, attemptStr] = data.split(':');
      const qId = Number(qIdStr), optId = Number(optIdStr), attemptId = Number(attemptStr);

      await saveAnswer(attemptId, qId, optId);
      await ctx.answerCbQuery('Qabul qilindi ✅');

      const [[att]] = await pool.query("SELECT test_id FROM attempts WHERE id=?", [attemptId]);
      if (!att) return ctx.reply('Urinish topilmadi.');
      return sendNextQuestion(ctx, att.test_id, attemptId);
    } catch (e) {
      console.error('Answer handler error:', e);
      return ctx.answerCbQuery('Xatolik', { show_alert: true });
    }
  });
}

module.exports = {
  sendNextQuestion,
  registerAnswerHandler,
  // qo‘shimcha: kerak bo‘lsa tashqarida ham ishlatasiz
  findActiveAttempt,
  startAttempt,
};
