const express = require("express");
const multer = require("multer");
const { parse } = require("csv-parse/sync");
const { pool } = require("../../db");
const { ensureAuth, ensureGuest } = require("../middleware/auth");
const xlsx = require("xlsx"); // ← qo'shildi
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---- ENV-based admin cred ----
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@local")
  .trim()
  .toLowerCase();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "admin123").trim();

// ---- LOGIN / LOGOUT ----
router.get("/login", ensureGuest, (req, res) => {
  res.render("login", { error: req.flash("error") });
});

router.post("/login", ensureGuest, async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = (req.body.password || "").trim();

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    req.session.adminUser = { email: ADMIN_EMAIL, role: "owner" };
    return res.redirect("/admin");
  }
  req.flash("error", "Noto‘g‘ri email yoki parol");
  return res.redirect("/admin/login");
});

router.get("/logout", ensureAuth, (req, res) => {
  req.session.destroy(() => res.redirect("/admin/login"));
});

// ---- DASHBOARD ----
router.get("/", ensureAuth, async (req, res) => {
  const [[cUsers]] = await pool.query("SELECT COUNT(*) AS c FROM users");
  const [[cTests]] = await pool.query("SELECT COUNT(*) AS c FROM tests");
  const [[cAttempts]] = await pool.query("SELECT COUNT(*) AS c FROM attempts");
  res.render("dashboard", {
    user: req.session.adminUser,
    stats: { users: cUsers.c, tests: cTests.c, attempts: cAttempts.c },
  });
});

// ---- TESTS CRUD ----
router.get("/tests", ensureAuth, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM tests ORDER BY id DESC");
  res.render("tests", { tests: rows });
});

router.get("/tests/new", ensureAuth, (req, res) => {
  res.render("test_form", { test: null });
});

router.post("/tests/new", ensureAuth, async (req, res) => {
  const { code, name, lang, time_limit_sec, is_active, category, audience } =
    req.body;
  try {
    await pool.query(
      "INSERT INTO tests (code,name,lang,time_limit_sec,is_active,category,audience) VALUES (?,?,?,?,?,?,?)",
      [
        code,
        name,
        lang || "uz",
        Number(time_limit_sec || 0),
        is_active ? 1 : 0,
        category || "placement",
        audience || "public",
      ]
    );
    res.redirect("/admin/tests");
  } catch (e) {
    req.flash("error", e.message);
    res.redirect("/admin/tests/new");
  }
});

router.get("/tests/:id/edit", ensureAuth, async (req, res) => {
  const [[t]] = await pool.query("SELECT * FROM tests WHERE id=?", [
    req.params.id,
  ]);
  if (!t) return res.redirect("/admin/tests");
  res.render("test_form", { test: t });
});

router.post("/tests/:id/edit", ensureAuth, async (req, res) => {
  const { name, lang, time_limit_sec, is_active, category, audience } =
    req.body;
  await pool.query(
    "UPDATE tests SET name=?, lang=?, time_limit_sec=?, is_active=?, category=?, audience=? WHERE id=?",
    [
      name,
      lang || "uz",
      Number(time_limit_sec || 0),
      is_active ? 1 : 0,
      category,
      audience,
      req.params.id,
    ]
  );
  res.redirect("/admin/tests");
});
// ----------------- BULK IMPORT XLSX (test_id, question, correct_answer, answer_1...) -----------------
router.get("/questions/bulk", ensureAuth, async (req, res) => {
  res.render("bulk_import", { title: "Bulk import" });
});

// input name="xlsx"
router.post(
  "/questions/bulk",
  ensureAuth,
  upload.single("xlsx"),
  async (req, res) => {
    if (!req.file) {
      req.flash("error", "Fayl tanlanmadi");
      return res.redirect("/admin/questions/bulk");
    }

    let ok = 0,
      skipped = 0,
      warnings = 0;
    try {
      const wb = xlsx.read(req.file.buffer, { type: "buffer" });
      const ws = wb.Sheets["Questions"] || wb.Sheets[wb.SheetNames[0]];
      const rows = xlsx.utils.sheet_to_json(ws, { defval: "" }); // headerlarga qarab obyektlar

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // test mavjudligini cache’da tekshirish
        const testExists = new Map();
        async function ensureTest(id) {
          if (testExists.has(id)) return testExists.get(id);
          const [[t]] = await conn.query("SELECT id FROM tests WHERE id=?", [
            id,
          ]);
          const exists = !!t;
          testExists.set(id, exists);
          return exists;
        }

        // har bir test uchun sort_order navbatini ushlab boramiz
        const nextOrder = new Map();
        async function allocOrder(testId) {
          if (!nextOrder.has(testId)) {
            const [[m]] = await conn.query(
              "SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM questions WHERE test_id=?",
              [testId]
            );
            nextOrder.set(testId, Number(m.next || 1));
          }
          const v = nextOrder.get(testId);
          nextOrder.set(testId, v + 1);
          return v;
        }

        for (const r of rows) {
          // headerlarni case-insensitive o'qiymiz
          const row = {};
          Object.keys(r).forEach((k) => (row[k.trim().toLowerCase()] = r[k]));

          const testId = Number(row["test_id"] || 0);
          const qtext = String(row["question"] || "").trim();
          let correct = String(row["correct_answer"] || "").trim();

          if (!testId || !qtext) {
            skipped++;
            continue;
          }
          if (!(await ensureTest(testId))) {
            skipped++;
            continue;
          }

          // variantlarni oldindan tartib bilan tuzamiz
          const options = [];
          for (let i = 1; i <= 8; i++) {
            const key = i <= 3 ? `answer_${i}` : `answer_${i}`; // shu yerda nomlar bir xil, baribir
            const val = (row[key] ?? "").toString().trim();
            if (val) options.push(val);
          }

          // kamida 2 ta variant shart
          if (options.length < 2 && !correct) {
            skipped++;
            continue;
          }

          // correct variant ro'yxatda bo'lmasa — boshiga qo'shamiz (warning)
          let correctIndex = options.findIndex((x) => x === correct);
          if (correct && correctIndex === -1) {
            options.unshift(correct);
            correctIndex = 0;
            warnings++;
          }
          // agar correct bo'sh bo'lsa — 1-variantni to'g'ri deb olamiz (lekin warning)
          if (!correct) {
            correctIndex = 0;
            warnings++;
          }

          // sort_order
          const order = await allocOrder(testId);

          // savol
          const [insQ] = await conn.query(
            "INSERT INTO questions (test_id, text, sort_order) VALUES (?,?,?)",
            [testId, qtext, order]
          );

          // variantlar
          let sort = 1;
          for (let i = 0; i < options.length; i++) {
            const isCor = i === correctIndex ? 1 : 0;
            await conn.query(
              "INSERT INTO options (question_id, text, is_correct, sort_order, weight) VALUES (?,?,?,?,?)",
              [insQ.insertId, options[i], isCor, sort++, isCor ? 1 : 0]
            );
          }

          ok++;
        }

        await conn.commit();
        conn.release();
      } catch (e) {
        await conn.rollback();
        conn.release();
        throw e;
      }

      req.flash(
        "msg",
        `✅ Yuklandi: ${ok} ta savol. ⏭ O‘tkazib yuborilgan: ${skipped}. ⚠️ Ogohlantirish: ${warnings}.`
      );
    } catch (e) {
      console.error("Bulk XLSX import error:", e);
      req.flash("error", "Faylni o‘qishda xatolik: " + e.message);
    }

    res.redirect("/admin/questions/bulk");
  }
);

router.post("/tests/:id/delete", ensureAuth, async (req, res) => {
  await pool.query("DELETE FROM tests WHERE id=?", [req.params.id]);
  res.redirect("/admin/tests");
});

// ---- QUESTIONS (CSV import) ----
// CSV: sort_order,question_text,option1,is_correct1,option2,is_correct2, ...
router.get("/tests/:id/questions", ensureAuth, async (req, res) => {
  const [[t]] = await pool.query("SELECT * FROM tests WHERE id=?", [
    req.params.id,
  ]);
  const [q] = await pool.query(
    "SELECT * FROM questions WHERE test_id=? ORDER BY sort_order,id",
    [req.params.id]
  );
  res.render("questions", {
    test: t,
    questions: q,
    msg: req.flash("msg"),
    error: req.flash("error"),
  });
});

router.post(
  "/tests/:id/questions/upload",
  ensureAuth,
  upload.single("csv"),
  async (req, res) => {
    try {
      const rows = parse(req.file.buffer.toString("utf-8"), {
        skip_empty_lines: true,
      });
      for (const row of rows) {
        const sort_order = Number(row[0] || 0);
        const text = row[1];
        const [insQ] = await pool.query(
          "INSERT INTO questions (test_id, text, sort_order) VALUES (?,?,?)",
          [req.params.id, text, sort_order]
        );
        let idx = 2,
          sort = 1;
        while (idx < row.length) {
          const optText = row[idx++];
          const isCor = Number(row[idx++] || 0);
          if (optText) {
            await pool.query(
              "INSERT INTO options (question_id,text,is_correct,sort_order,weight) VALUES (?,?,?,?,?)",
              [insQ.insertId, optText, isCor ? 1 : 0, sort++, isCor ? 1 : 0]
            );
          }
        }
      }
      req.flash("msg", "Savollar yuklandi");
    } catch (e) {
      req.flash("error", "CSV xato: " + e.message);
    }
    res.redirect(`/admin/tests/${req.params.id}/questions`);
  }
);

// ---- ATTEMPTS (Natijalar) ----
router.get("/attempts", ensureAuth, async (req, res) => {
  const [rows] = await pool.query(`
    SELECT a.id, a.started_at, a.finished_at, a.percent, a.level_guess,
           u.full_name, u.phone, t.name AS test_name, t.category
    FROM attempts a
    JOIN users u ON u.id=a.user_id
    JOIN tests t ON t.id=a.test_id
    ORDER BY a.id DESC
    LIMIT 200
  `);
  res.render("attempts", { attempts: rows });
});

// ---- USERS (student flag) ----
router.get("/users", ensureAuth, async (req, res) => {
  const [rows] = await pool.query(
    "SELECT id,tg_id,full_name,username,phone,is_student FROM users ORDER BY id DESC LIMIT 200"
  );
  res.render("users", { users: rows });
});

router.post("/users/:id/toggle-student", ensureAuth, async (req, res) => {
  await pool.query("UPDATE users SET is_student = 1 - is_student WHERE id=?", [
    req.params.id,
  ]);
  res.redirect("/admin/users");
});

module.exports = router;
