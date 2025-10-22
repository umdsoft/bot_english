const express = require("express");
const router = express.Router();
const { pool } = require("../../db");
const { ensureAuth } = require("../middleware/auth");
const { loadPollFull } = require("../../handlers/polls");
const { sendActivePollToUsers } = require("../../services/polls.bcast");
// List
router.get("/", ensureAuth, async (req, res) => {
  const [polls] = await pool.query(`
    SELECT p.*, p.body AS description,
      (SELECT COUNT(*) FROM poll_votes v WHERE v.poll_id=p.id) AS votes
    FROM polls p
    ORDER BY p.id DESC
  `);
  res.render("polls_list", {
    user: req.session.adminUser,
    polls,
  });
});

// New form
router.get("/new", ensureAuth, (req, res) => {
  const [old] = req.flash("poll_old");
  res.render("polls_new", { user: req.session.adminUser, old: old || null });
});
router.get("/:id", ensureAuth, async (req, res) => {
  const pollId = Number(req.params.id || 0);
  if (!pollId) return res.redirect("/admin/polls");

  const [[poll]] = await pool.query("SELECT * FROM polls WHERE id=?", [pollId]);
  if (!poll) return res.redirect("/admin/polls");

  const [dist] = await pool.query(`
    SELECT
      o.id,
      o.text,
      o.sort_order,
      COUNT(v.id) AS votes,
      COUNT(DISTINCT COALESCE(v.user_id, v.tg_id)) AS voters
    FROM poll_options o
    LEFT JOIN poll_votes v ON v.option_id = o.id
    WHERE o.poll_id = ?
    GROUP BY o.id
    ORDER BY o.sort_order, o.id
  `, [pollId]);

  const [[tot]] = await pool.query(`
    SELECT COUNT(DISTINCT COALESCE(user_id, tg_id)) AS total_voters
    FROM poll_votes
    WHERE poll_id = ?
  `, [pollId]);

  const totalVoters = Number(tot.total_voters || 0);

  const page  = Math.max(1, Number(req.query.page || 1));
  const limit = 25;
  const offset = (page - 1) * limit;

  // 🚩 created_at ni SQLda formatlab olamiz:
  const [rows] = await pool.query(`
    SELECT
      v.id,
      v.created_at,
      DATE_FORMAT(v.created_at, '%d.%m.%Y %H:%i') AS created_fmt,
      v.tg_id,
      v.user_id,
      u.full_name,
      u.username,
      u.phone,
      o.text AS answer
    FROM poll_votes v
    LEFT JOIN users u ON u.id = v.user_id
    LEFT JOIN poll_options o ON o.id = v.option_id
    WHERE v.poll_id = ?
    ORDER BY v.id DESC
    LIMIT ? OFFSET ?
  `, [pollId, limit, offset]);

  const [[cnt]] = await pool.query(`
    SELECT COUNT(*) AS c
    FROM poll_votes
    WHERE poll_id = ?
  `, [pollId]);

  const pages = Math.max(1, Math.ceil(Number(cnt.c || 0) / limit));

  res.render("poll_detail", {
    user: req.session.adminUser,
    poll,
    dist,
    totalVoters,
    voters: rows,
    page, pages,
    query: req.query || {}
  });
});
// --- YANGI SO‘ROVNOMA YARATISH ---
router.post("/new", ensureAuth, async (req, res) => {
  const {
    title,
    description,
    target = "all",
    is_multi = "0",
    is_active = "0",
  } = req.body;
  let options = req.body["options[]"] || req.body.options || [];
  if (!Array.isArray(options)) options = [options];

  const opts = options.map((o) => String(o || "").trim()).filter(Boolean);
  if (!title || opts.length < 2) {
    req.flash("error", "Xatolik: sarlavha va kamida 2 ta variant shart.");
    req.flash("poll_old", {
      title,
      description,
      target,
      is_multi: Number(is_multi) ? 1 : 0,
      is_active: Number(is_active) ? 1 : 0,
      options: opts,
    });
    return res.redirect("/admin/polls/new");
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [ins] = await conn.query(
      `INSERT INTO polls (title, body, target, is_multi, is_active, created_at)
       VALUES (?,?,?,?,?, NOW())`,
      [
        title,
        description || null,
        target,
        Number(is_multi) ? 1 : 0,
        Number(is_active) ? 1 : 0,
      ]
    );
    const pollId = ins.insertId;

    if (opts.length) {
      const rows = opts.map((text, i) => [pollId, text, i + 1]);
      await conn.query(
        `INSERT INTO poll_options (poll_id, text, sort_order) VALUES ?`,
        [rows]
      );
    }

    if (Number(is_active)) {
      await conn.query(`UPDATE polls SET is_active=0 WHERE id<>?`, [pollId]);
    }

    await conn.commit();

    if (Number(is_active)) {
      try {
        const { bot } = require("../../index");
        await sendActivePollToUsers(bot, pollId);
      } catch (e) {
        console.error("broadcast start error:", e?.message || e);
      }
    }

    req.flash("msg", "So‘rovnoma yaratildi.");
    res.redirect("/admin/polls");
  } catch (e) {
    await conn.rollback();
    console.error("create poll error:", e);
    req.flash("error", "Xatolik: so‘rovnoma yaratilmadi.");
    req.flash("poll_old", {
      title,
      description,
      target,
      is_multi: Number(is_multi) ? 1 : 0,
      is_active: Number(is_active) ? 1 : 0,
      options: opts,
    });
    res.redirect("/admin/polls/new");
  } finally {
    conn.release();
  }
});

// --- AKTIVLASH / DEAKTIVLASH ---
router.post("/:id/activate", ensureAuth, async (req, res) => {
  const pollId = Number(req.params.id);
  if (!pollId) {
    req.flash("error", "Noto‘g‘ri so‘rovnoma ID si.");
    return res.redirect("/admin/polls");
  }

  await pool.query(`UPDATE polls SET is_active=0 WHERE id<>?`, [pollId]);
  await pool.query(`UPDATE polls SET is_active=1 WHERE id=?`, [pollId]);

  // shu paytda darhol tarqatamiz
  try {
    const { bot } = require("../../index"); // bot instance (sizda qayerda export qilingan bo‘lsa)
    const result = await sendActivePollToUsers(bot, pollId);
    console.log(`Poll #${pollId} broadcast: sent=${result.sent}, removed=${result.removed}`);
    const removedInfo = result.removed
      ? ` ${result.removed} ta foydalanuvchi bloklagani uchun o‘chirildi.`
      : "";
    req.flash(
      "msg",
      result.sent
        ? `So‘rovnoma aktivlashtirildi va ${result.sent} foydalanuvchiga yuborildi.${removedInfo}`
        : `So‘rovnoma aktivlashtirildi.${removedInfo || " Foydalanuvchilarga yuborilmadi."}`
    );
  } catch (e) {
    console.error("broadcast start error:", e?.message || e);
    req.flash("error", "So‘rovnomani yuborishda xatolik yuz berdi.");
  }

  res.redirect("/admin/polls");
});
// Create
router.post("/", ensureAuth, async (req, res) => {
  const { title, body, is_multi, target } = req.body;
  const options = (req.body.options || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!title || !options.length)
    return res.status(400).send("Sarlavha va variantlar kerak.");

  const [ins] = await pool.query(
    "INSERT INTO polls (title, body, is_multi, target, created_by) VALUES (?,?,?,?,?)",
    [
      title,
      body || null,
      Number(!!is_multi),
      target || "all",
      req.session.adminUser?.id || null,
    ]
  );
  const pollId = ins.insertId;
  for (let i = 0; i < options.length; i++) {
    await pool.query(
      "INSERT INTO poll_options (poll_id, text, sort_order) VALUES (?,?,?)",
      [pollId, options[i], i + 1]
    );
  }

  res.redirect("/admin/polls?flash=created");
});

router.post("/:id/deactivate", ensureAuth, async (req, res) => {
  const pollId = Number(req.params.id);
  if (!pollId) {
    req.flash("error", "Noto‘g‘ri so‘rovnoma ID si.");
    return res.redirect("/admin/polls");
  }

  await pool.query("UPDATE polls SET is_active=0 WHERE id=?", [pollId]);
  req.flash("msg", "So‘rovnoma deaktiv qilindi.");
  res.redirect("/admin/polls");
});

router.post("/:id/start", ensureAuth, async (req, res) => {
  const pollId = Number(req.params.id);
  if (!pollId) {
    req.flash("error", "Noto‘g‘ri so‘rovnoma ID si.");
    return res.redirect("/admin/polls");
  }

  await pool.query("UPDATE polls SET is_active=0 WHERE id<>?", [pollId]);
  await pool.query("UPDATE polls SET is_active=1 WHERE id=?", [pollId]);

  // shu paytda darhol tarqatamiz
  try {
    const { bot } = require("../../index"); // bot instance (sizda qayerda export qilingan bo‘lsa)
    const result = await sendActivePollToUsers(bot, pollId);
    console.log(`Poll #${pollId} broadcast: sent=${result.sent}, removed=${result.removed}`);
    const removedInfo = result.removed
      ? ` ${result.removed} ta foydalanuvchi bloklagani uchun o‘chirildi.`
      : "";
    req.flash(
      "msg",
      result.sent
        ? `So‘rovnoma aktiv qilindi va ${result.sent} foydalanuvchiga yuborildi.${removedInfo}`
        : `So‘rovnoma aktiv qilindi.${removedInfo || " Foydalanuvchilarga yuborilmadi."}`
    );
  } catch (e) {
    console.error("broadcast start error:", e?.message || e);
    req.flash("error", "So‘rovnomani yuborishda xatolik yuz berdi.");
  }

  res.redirect("/admin/polls");
});

router.post("/:id/stop", ensureAuth, async (req, res) => {
  const pollId = Number(req.params.id);
  if (!pollId) {
    req.flash("error", "Noto‘g‘ri so‘rovnoma ID si.");
    return res.redirect("/admin/polls");
  }

  await pool.query("UPDATE polls SET is_active=0 WHERE id=?", [pollId]);
  req.flash("msg", "So‘rovnoma to‘xtatildi.");
  res.redirect("/admin/polls");
});

// PUBLISH: faqat qatnashmaganlarga yuborish
router.post("/:id/publish", ensureAuth, async (req, res) => {
  const pollId = Number(req.params.id);
  if (!pollId) {
    req.flash("error", "Noto‘g‘ri so‘rovnoma ID si.");
    return res.redirect("/admin/polls");
  }

  const { bot } = require("../../index"); // bot export qilingan bo‘lsin
  const poll = await loadPollFull(pollId);
  if (!poll || !poll.is_active) {
    req.flash("error", "So‘rovnoma aktiv emas.");
    return res.redirect("/admin/polls");
  }
  try {
    const { sent, removed } = await sendActivePollToUsers(bot, pollId);
    console.log(`[poll] #${pollId} published to ${sent} users (not-voted), removed=${removed}`);
    const messages = [];
    messages.push(
      sent
        ? `So‘rovnoma qatnashmagan ${sent} foydalanuvchiga yuborildi.`
        : "Qayta yuborish uchun foydalanuvchi topilmadi."
    );
    if (removed) {
      messages.push(`${removed} ta foydalanuvchi botni bloklagani uchun bazadan o‘chirildi.`);
    }
    req.flash("msg", messages.join(" "));
    return res.redirect(`/admin/polls`);
  } catch (e) {
    console.error("publish error:", e?.message || e);
    req.flash("error", "So‘rovnomani yuborishda xatolik yuz berdi.");
    return res.redirect("/admin/polls");
  }
});

module.exports = router;
