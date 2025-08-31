// src/web/routes/exam.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');
const { pool } = require('../../db');

const DIFF_WEIGHT = { easy: 1.0, medium: 1.5, hard: 2.0 };

/* ---------- helpers ---------- */
function normalizePhone(p) {
  if (!p) return '';
  const digits = String(p).replace(/\D/g, '');
  return digits; // faqat raqamlar; solishtirishda shu ishlatiladi
}

function ensureStudent(req, res, next) {
  if (req.session && req.session.student) return next();
  return res.redirect('/exam/login');
}

/* ---------- auth pages ---------- */
router.get('/login', (req, res) => {
  res.render('exam_login', { title: 'Oraliq test — Kirish', msg: req.flash('msg'), error: req.flash('error') });
});

router.post('/login', async (req, res) => {
  try {
    const phoneInput = normalizePhone(req.body.phone);
    const otpInput = String(req.body.otp || '').trim();

    if (!phoneInput || !otpInput) {
      req.flash('error', 'Telefon va parol (OTP) kiriting.');
      return res.redirect('/exam/login');
    }

    // users dan telefonni normalizatsiya qilib izlaymiz (sodda yo'l)
    const [rows] = await pool.query('SELECT id, full_name, phone, web_otp_hash, web_otp_expires_at, web_otp_used_at FROM users WHERE phone IS NOT NULL');
    let user = null;
    for (const r of rows) {
      const rp = normalizePhone(r.phone);
      if (rp && rp.endsWith(phoneInput)) { user = r; break; } // oxirgi raqamlar bo'yicha mos
    }
    if (!user) {
      req.flash('error', 'Bunday telefon raqam topilmadi.');
      return res.redirect('/exam/login');
    }

    if (!user.web_otp_hash || !user.web_otp_expires_at) {
      req.flash('error', 'OTP olinmagan yoki muddati tugagan.');
      return res.redirect('/exam/login');
    }
    if (user.web_otp_used_at) {
      req.flash('error', 'Bu OTP allaqachon ishlatilgan.');
      return res.redirect('/exam/login');
    }
    if (dayjs().isAfter(dayjs(user.web_otp_expires_at))) {
      req.flash('error', 'OTP muddati tugagan. Yangi OTP oling.');
      return res.redirect('/exam/login');
    }
    const ok = await bcrypt.compare(otpInput, user.web_otp_hash);
    if (!ok) {
      req.flash('error', 'Parol (OTP) noto‘g‘ri.');
      return res.redirect('/exam/login');
    }

    // success: OTP ni ishlatilgan deb belgilaymiz, sessiya ochamiz
    await pool.query('UPDATE users SET web_otp_used_at=NOW() WHERE id=?', [user.id]);
    req.session.student = { id: user.id, name: user.full_name };
    req.flash('msg', 'Xush kelibsiz!');
    res.redirect('/exam');
  } catch (e) {
    console.error('exam login error', e);
    req.flash('error', 'Server xatosi.');
    res.redirect('/exam/login');
  }
});

router.get('/logout', (req, res) => {
  req.session.student = null;
  res.redirect('/exam/login');
});

/* ---------- dashboard: testlar ro'yxati + urinishlar ---------- */
router.get('/', ensureStudent, async (req, res) => {
  const sid = req.session.student.id;
  const [tests] = await pool.query("SELECT id, name, level FROM tests WHERE category='midterm' AND is_active=1 ORDER BY id DESC");
  const [attempts] = await pool.query(`
    SELECT a.id, a.test_id, t.name AS test_name, a.status, a.percent, a.started_at, a.finished_at
    FROM attempts a JOIN tests t ON t.id=a.test_id
    WHERE a.user_id=? AND a.purpose='midterm'
    ORDER BY a.id DESC
  `, [sid]);

  res.render('exam_dashboard', {
    title: 'Oraliq testlar',
    tests, attempts,
    student: req.session.student
  });
});

/* ---------- testni boshlash ---------- */
router.post('/start/:testId', ensureStudent, async (req, res) => {
  const testId = Number(req.params.testId);
  const sid = req.session.student.id;
  const [[t]] = await pool.query("SELECT id FROM tests WHERE id=? AND category='midterm' AND is_active=1", [testId]);
  if (!t) { req.flash('error','Test topilmadi.'); return res.redirect('/exam'); }

  const [ins] = await pool.query(
    'INSERT INTO attempts (user_id, test_id, purpose, status, started_at) VALUES (?,?, "midterm", "started", NOW())',
    [sid, testId]
  );
  res.redirect(`/exam/q/${ins.insertId}`);
});

/* ---------- savol ko'rsatish ---------- */
async function getNextQuestion(testId, attemptId) {
  const [rows] = await pool.query(`
    SELECT q.* FROM questions q
    WHERE q.test_id=? AND q.id NOT IN (SELECT question_id FROM answers WHERE attempt_id=?)
    ORDER BY q.sort_order ASC, q.id ASC LIMIT 1
  `, [testId, attemptId]);
  return rows[0] || null;
}
async function getOptions(questionId) {
  const [rows] = await pool.query('SELECT * FROM options WHERE question_id=? ORDER BY sort_order ASC, id ASC', [questionId]);
  return rows;
}

router.get('/q/:attemptId', ensureStudent, async (req, res) => {
  const attId = Number(req.params.attemptId);
  const [[a]] = await pool.query('SELECT id, test_id, status FROM attempts WHERE id=? AND user_id=?', [attId, req.session.student.id]);
  if (!a) { req.flash('error', 'Urinish topilmadi.'); return res.redirect('/exam'); }

  if (a.status === 'completed') return res.redirect(`/exam/result/${attId}`);

  const q = await getNextQuestion(a.test_id, attId);
  if (!q) return res.redirect(`/exam/result/${attId}`);

  const opts = await getOptions(q.id);
  res.render('exam_question', {
    title: 'Savol',
    attemptId: attId,
    q, opts
  });
});

router.post('/answer/:attemptId', ensureStudent, async (req, res) => {
  const attId = Number(req.params.attemptId);
  const qid = Number(req.body.question_id);
  const oid = Number(req.body.option_id);

  // eski javobni o'chirib, yangisini yozamiz
  await pool.query('DELETE FROM answers WHERE attempt_id=? AND question_id=?', [attId, qid]);
  const [[o]] = await pool.query('SELECT is_correct FROM options WHERE id=?', [oid]);
  const isCor = o ? Number(o.is_correct) : 0;
  await pool.query(
    'INSERT INTO answers (attempt_id, question_id, option_id, is_correct, awarded_score) VALUES (?,?,?,?,?)',
    [attId, qid, oid, isCor, isCor?1:0]
  );

  // navbatdagi savolga
  const [[a]] = await pool.query('SELECT test_id FROM attempts WHERE id=?', [attId]);
  const nxt = await getNextQuestion(a.test_id, attId);
  res.redirect(nxt ? `/exam/q/${attId}` : `/exam/result/${attId}`);
});

/* ---------- yakun: hisoblash va natija ---------- */
async function computeAndFinish(attId) {
  const [[meta]] = await pool.query('SELECT test_id, status FROM attempts WHERE id=?', [attId]);
  const details = await pool.query(`
    SELECT a.is_correct, q.difficulty, q.skill
    FROM answers a JOIN questions q ON q.id=a.question_id
    WHERE a.attempt_id=?`, [attId]);
  const rows = details[0];

  let correct = 0, total = rows.length, wCorr=0, wTotal=0;
  for (const r of rows) {
    if (Number(r.is_correct)===1) correct++;
    const w = DIFF_WEIGHT[r.difficulty] || 1.0; wTotal+=w; if (Number(r.is_correct)===1) wCorr+=w;
  }
  const percent = wTotal ? Number(((wCorr/wTotal)*100).toFixed(2)) : 0;
  await pool.query(
    `UPDATE attempts SET status='completed', finished_at=NOW(), score=?, percent=?, duration_sec=TIMESTAMPDIFF(SECOND, started_at, NOW())
     WHERE id=?`,
    [correct, percent, attId]
  );
  return { correct, total, percent };
}

router.get('/result/:attemptId', ensureStudent, async (req, res) => {
  const attId = Number(req.params.attemptId);
  const [[a]] = await pool.query('SELECT id, status FROM attempts WHERE id=? AND user_id=?', [attId, req.session.student.id]);
  if (!a) { req.flash('error','Urinish topilmadi.'); return res.redirect('/exam'); }

  if (a.status !== 'completed') await computeAndFinish(attId);

  const [[row]] = await pool.query(`
    SELECT a.id, a.percent, a.score, t.name AS test_name, a.started_at, a.finished_at
    FROM attempts a JOIN tests t ON t.id=a.test_id
    WHERE a.id=?`, [attId]);

  res.render('exam_result', { title: 'Natija', r: row });
});

module.exports = router;
