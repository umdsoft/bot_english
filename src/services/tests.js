const { pool } = require("../db");

async function getActiveTest(opts = {}) {
  const [rows] = await pool.query(
    "SELECT * FROM tests WHERE code=? AND is_active=1",
    [code]
  );
  return rows[0] || null;
}

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
      WHERE q.test_id=? 
        AND q.id NOT IN (
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
  const awarded = opt ? (isCorrect ? Number(opt.weight || 1) : 0) : 0;

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
  const [[meta]] = await pool.query(
    `
    SELECT at.test_id, at.user_id,
           (SELECT COUNT(*) FROM questions WHERE test_id = at.test_id) AS total_questions
      FROM attempts at 
     WHERE at.id=?`,
    [attemptId]
  );
  const totalQ = Number(meta?.total_questions || 0);

  const [[agg]] = await pool.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN o.is_correct=1 THEN COALESCE(o.weight,1.00) ELSE 0 END), 0) AS total_score,
      COALESCE(SUM(CASE WHEN o.is_correct=1 THEN 1 ELSE 0 END), 0) AS correct_count
      FROM answers a
      JOIN options o ON o.id=a.option_id
     WHERE a.attempt_id=?`,
    [attemptId]
  );

  const totalScore = Number(agg.total_score || 0);
  const correctCount = Number(agg.correct_count || 0);
  const wrongCount = Math.max(totalQ - correctCount, 0);
  const maxScore = totalQ * 1.0;
  const percent = maxScore ? (totalScore / maxScore) * 100 : 0;

  let level = "A1";
  if (percent >= 85) level = "A2";
  if (percent >= 95) level = "B1";

  await pool.query(
    `
    UPDATE attempts
       SET status='completed',
           finished_at=NOW(),
           score=?,
           percent=?,
           level_guess=?,
           duration_sec=TIMESTAMPDIFF(SECOND, started_at, NOW())
     WHERE id=?`,
    [totalScore, Number(percent.toFixed(2)), level, attemptId]
  );

  return {
    totalQ,
    totalScore,
    percent: Number(percent.toFixed(2)),
    level,
    correctCount,
    wrongCount,
    testId: meta?.test_id,
    userId: meta?.user_id,
  };
}

async function getAttemptSummary(attemptId) {
  const [[row]] = await pool.query(
    `
    SELECT at.id, at.user_id, at.test_id, at.started_at, at.finished_at, at.score, at.percent, 
           at.level_guess, at.duration_sec,
           u.full_name, u.username, u.phone, u.tg_id,
           t.name AS test_name, t.code AS test_code
      FROM attempts at
      JOIN users u ON u.id=at.user_id
      JOIN tests t ON t.id=at.test_id
     WHERE at.id=?`,
    [attemptId]
  );
  return row || null;
}

async function getAttemptAnswersDetailed(attemptId) {
  const [rows] = await pool.query(
    `
    SELECT a.question_id, a.is_correct,
           q.text AS q_text, q.sort_order,
           uo.text AS user_answer,
           (SELECT GROUP_CONCAT(o2.text ORDER BY o2.sort_order SEPARATOR ', ')
              FROM options o2 WHERE o2.question_id=q.id AND o2.is_correct=1) AS correct_answers
      FROM answers a
      JOIN questions q ON q.id=a.question_id
 LEFT JOIN options uo ON uo.id=a.option_id
     WHERE a.attempt_id=?
  ORDER BY q.sort_order ASC, q.id ASC`,
    [attemptId]
  );
  return rows;
}

module.exports = {
  getActiveTest,
  findActiveAttempt,
  startAttempt,
  getNextQuestion,
  getOptions,
  saveAnswer,
  computeAndFinishAttempt,
  getAttemptSummary,
  getAttemptAnswersDetailed,
};
