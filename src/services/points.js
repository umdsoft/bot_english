const dayjs = require("dayjs");
const { pool } = require("../db");

async function getUserIsStudent(userId) {
  const [[u]] = await pool.query("SELECT is_student FROM users WHERE id=?", [userId]);
  return Number(u?.is_student) === 1;
}

async function getUserTotalPoints(userId) {
  const [[row]] = await pool.query(
    "SELECT COALESCE(SUM(points),0) AS total FROM points_log WHERE user_id=?",
    [userId]
  );
  return Number(row?.total || 0);
}

async function getUserMonthlyPoints(userId, monthKey) {
  const [[row]] = await pool.query(
    "SELECT COALESCE(SUM(points),0) AS total FROM points_log WHERE user_id=? AND period_month=?",
    [userId, monthKey]
  );
  return Number(row?.total || 0);
}

/**
 * Jadvalingizda ustunlar: user_id, test_id, attempt_id, points, period_month, reason, created_at
 * (Sizda 'period_year' ham bo‘lsa — trigger yoki INSERT paytida to‘ldirish mumkin)
 */
async function awardPointsForTest({ userId, testId, attemptId, basePoints = 2 }) {
  // shu test uchun allaqachon berilganmi?
  const [exist] = await pool.query(
    "SELECT id FROM points_log WHERE user_id=? AND test_id=? AND reason='complete_test' LIMIT 1",
    [userId, testId]
  );
  if (exist.length) {
    const monthKey = dayjs().format("MM"); // sizning jadvalingizga mos olindi
    const monthly = await getUserMonthlyPoints(userId, monthKey);
    const total = await getUserTotalPoints(userId);
    return { awarded: 0, monthly, total };
  }

  // not-student uchun limit 10
  const isStudent = await getUserIsStudent(userId);
  let award = basePoints;
  if (!isStudent) {
    const currentTotal = await getUserTotalPoints(userId);
    const remaining = Math.max(0, 10 - currentTotal);
    award = Math.min(award, remaining);
    if (award <= 0) {
      const monthKey = dayjs().format("MM");
      const monthly = await getUserMonthlyPoints(userId, monthKey);
      const total = await getUserTotalPoints(userId);
      return { awarded: 0, monthly, total };
    }
  }

  const periodMonth = dayjs().format("MM");
  await pool.query(
    `INSERT INTO points_log (user_id, test_id, attempt_id, points, period_month, reason, created_at)
     VALUES (?,?,?,?,?,'complete_test', NOW())`,
    [userId, testId, attemptId, award, periodMonth]
  );

  const monthly = await getUserMonthlyPoints(userId, periodMonth);
  const total = await getUserTotalPoints(userId);
  return { awarded: award, monthly, total };
}

module.exports = { awardPointsForTest };
