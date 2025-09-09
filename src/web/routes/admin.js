const express = require("express");
const multer = require("multer");
const { parse } = require("csv-parse/sync");
const { pool } = require("../../db");
const { ensureAuth, ensureGuest } = require("../middleware/auth");
const xlsx = require("xlsx"); // ← qo'shildi
const router = express.Router();
const dayjs = require("dayjs");
const ExcelJS = require("exceljs");
const { q } = require("../../db"); // <— SHU QATOR SHART
// ---- ENV-based admin cred ----
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@local")
  .trim()
  .toLowerCase();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "admin123").trim();
// memoryStorage: eng sodda va ishonchli
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    // ruxsat berilgan mimetype lar
    const ok = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream", // ba'zi brauzerlar .xlsx ni shunday yuboradi
    ];
    if (!ok.includes(file.mimetype)) {
      return cb(new Error("XLSX fayl emas (mimetype: " + file.mimetype + ")"));
    }
    cb(null, true);
  },
});
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
  const groupOrder = [
    'Beginner','Elementary','Pre-Intermediate','Intermediate',
    'Upper-Intermediate','Advanced','IELTS','CEFR'
  ];

  const [[cUsers]]    = await pool.query("SELECT COUNT(*) AS c FROM users");
  const [[cTests]]    = await pool.query("SELECT COUNT(*) AS c FROM tests");
  const [[cAttempts]] = await pool.query("SELECT COUNT(*) AS c FROM attempts");

  const [[today]] = await pool.query(`
    SELECT COUNT(*) AS count, AVG(percent) AS avg_percent
    FROM attempts
    WHERE status='completed' AND DATE(started_at)=CURDATE()
  `);

  // tests.code asosida guruhlash (BEGINNER/ELEMENTARY/...)
  const [byGroup] = await pool.query(`
    SELECT
      CASE
        WHEN LOWER(t.code) LIKE '%beginner%'               THEN 'Beginner'
        WHEN LOWER(t.code) LIKE '%elementary%'             THEN 'Elementary'
        WHEN LOWER(t.code) REGEXP 'pre[-_ ]?intermediate'  THEN 'Pre-Intermediate'
        WHEN LOWER(t.code) REGEXP 'upper[-_ ]?intermediate' THEN 'Upper-Intermediate'
        WHEN LOWER(t.code) LIKE '%intermediate%'           THEN 'Intermediate'
        WHEN LOWER(t.code) LIKE '%advanced%'               THEN 'Advanced'
        WHEN LOWER(t.code) LIKE '%ielts%'                  THEN 'IELTS'
        WHEN LOWER(t.code) LIKE '%cefr%'                   THEN 'CEFR'
        ELSE 'Other'
      END AS gname,
      COUNT(*) AS cnt,
      AVG(a.percent) AS avg_percent
    FROM attempts a
    JOIN tests t ON t.id = a.test_id
    WHERE a.status='completed'
    GROUP BY gname
  `);

  const m = new Map(byGroup.map(r => [r.gname, r]));
  // PIE uchun faqat avg % kerak (nol bo‘lgan guruhlarni ham ko‘rsatamiz, lekin xohlasaq filtrlaymiz)
  const chartPie = {
    labels: groupOrder,
    averages: groupOrder.map(n => Number(m.get(n)?.avg_percent || 0)),
    counts: groupOrder.map(n => Number(m.get(n)?.cnt || 0)) // tooltip’da foydali
  };

  // --- TOP-5 bir xil qoladi (oldingi koddan) ---
  const [topRows] = await pool.query(`
    SELECT * FROM (
      SELECT
        CASE
          WHEN LOWER(t.code) LIKE '%beginner%'               THEN 'Beginner'
          WHEN LOWER(t.code) LIKE '%elementary%'             THEN 'Elementary'
          WHEN LOWER(t.code) REGEXP 'pre[-_ ]?intermediate'  THEN 'Pre-Intermediate'
          WHEN LOWER(t.code) REGEXP 'upper[-_ ]?intermediate' THEN 'Upper-Intermediate'
          WHEN LOWER(t.code) LIKE '%intermediate%'           THEN 'Intermediate'
          WHEN LOWER(t.code) LIKE '%advanced%'               THEN 'Advanced'
          WHEN LOWER(t.code) LIKE '%ielts%'                  THEN 'IELTS'
          WHEN LOWER(t.code) LIKE '%cefr%'                   THEN 'CEFR'
          ELSE 'Other'
        END AS gname,
        a.user_id, u.full_name, u.username, a.percent,
        ROW_NUMBER() OVER (
          PARTITION BY
            CASE
              WHEN LOWER(t.code) LIKE '%beginner%'               THEN 'Beginner'
              WHEN LOWER(t.code) LIKE '%elementary%'             THEN 'Elementary'
              WHEN LOWER(t.code) REGEXP 'pre[-_ ]?intermediate'  THEN 'Pre-Intermediate'
              WHEN LOWER(t.code) REGEXP 'upper[-_ ]?intermediate' THEN 'Upper-Intermediate'
              WHEN LOWER(t.code) LIKE '%intermediate%'           THEN 'Intermediate'
              WHEN LOWER(t.code) LIKE '%advanced%'               THEN 'Advanced'
              WHEN LOWER(t.code) LIKE '%ielts%'                  THEN 'IELTS'
              WHEN LOWER(t.code) LIKE '%cefr%'                   THEN 'CEFR'
              ELSE 'Other'
            END
          ORDER BY a.percent DESC
        ) AS rn
      FROM attempts a
      JOIN tests t ON t.id = a.test_id
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.status='completed'
    ) x
    WHERE x.rn <= 5
    ORDER BY FIELD(gname, ${groupOrder.map(s => pool.escape(s)).join(', ')}), rn
  `);

  const top5 = groupOrder.reduce((acc, g) => (acc[g] = [], acc), {});
  for (const r of topRows) top5[r.gname]?.push(r);

  res.render("dashboard", {
    user: req.session.adminUser,
    stats: { users: cUsers.c, tests: cTests.c, attempts: cAttempts.c },
    today: { count: Number(today.count || 0), avg_percent: Number(today.avg_percent || 0) },
    // pie uchun
    chartPie,
    levels: groupOrder,
    top5
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

// POST: test yaratish
router.post("/tests", async (req, res) => {
  try {
    const {
      code = "",
      name = "",
      lang = "uz",
      time_limit_sec = 0,
      category = "diagnostic", // yoki 'placement' bo’lsa, DB enum bilan mos bo’lishi kerak
      audience = "public",
      is_active,
      level = "A1", // agar formda level yo’q bo’lsa, default
    } = req.body;

    if (!code.trim() || !name.trim()) {
      req.flash?.("error", "Code va nom majburiy");
      return res.redirect("/admin/tests/new");
    }

    // enumlarni himoyalash (ixtiyoriy)
    const okCat = new Set(["diagnostic", "level", "midterm", "placement"]);
    const okAudience = new Set(["public", "students"]);
    const okLevel = new Set(["starter", "A1", "A2", "B1", "B2", "C1", "C2"]);

    const finalCategory = okCat.has(category) ? category : "diagnostic";
    const finalAudience = okAudience.has(audience) ? audience : "public";
    const finalLevel = okLevel.has(level) ? level : "A1";
    const activeFlag = is_active ? 1 : 0;
    const tl = Number(time_limit_sec) || 0;

    await q(
      `INSERT INTO tests
       (code, name, category, level, is_active)
       VALUES (?,?,?,?,?)`,
      [code.trim(), name.trim(), finalCategory, finalLevel, activeFlag]
    );

    req.flash?.("success", "Test yaratildi");
    res.redirect("/admin/tests");
  } catch (err) {
    console.error("Create test error:", err);
    req.flash?.(
      "error",
      err.code === "ER_DUP_ENTRY"
        ? "Bu code bilan test allaqachon bor"
        : "Server xatosi"
    );
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

// Import amali
router.post(
  "/questions/bulk",
  ensureAuth,
  upload.single("xlsx"),
  async (req, res) => {
    if (!req.file) {
      req.flash("error", "Fayl tanlanmadi");
      return res.redirect("/admin/questions/bulk");
    }

    // kichik yordamchilar
    const norm = (s) => (s ?? "").toString().replace(/\s+/g, " ").trim();
    const key = (s) => (s ?? "").toString().trim().toLowerCase();

    // correct index: 1..8 | A..H | matn
    function resolveCorrectIndex(options, correctRaw) {
      const c = norm(correctRaw);
      if (!c) return 0;
      // raqam
      if (/^\d+$/.test(c)) {
        const n = parseInt(c, 10);
        if (n >= 1 && n <= options.length) return n - 1;
      }
      // A..H
      if (/^[A-Ha-h]$/.test(c)) {
        const i = c.toUpperCase().charCodeAt(0) - 65;
        if (i >= 0 && i < options.length) return i;
      }
      // matn orqali
      const i = options.findIndex(
        (o) => norm(o).toLowerCase() === c.toLowerCase()
      );
      return i >= 0 ? i : 0;
    }

    let ok = 0,
      skipped = 0,
      warnings = 0;
    let conn;

    try {
      const wb = xlsx.read(req.file.buffer, { type: "buffer" });
      const sheetName =
        wb.SheetNames.find((n) => n.toLowerCase().includes("question")) ||
        wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      if (!ws) throw new Error("Excelda sheet topilmadi");

      // sarlavhali obyektlar
      const rawRows = xlsx.utils.sheet_to_json(ws, { defval: "" });
      if (!rawRows.length) {
        req.flash("error", "Jadval bo‘sh ko‘rindi.");
        return res.redirect("/admin/questions/bulk");
      }

      conn = await pool.getConnection();
      await conn.beginTransaction();

      // tezkor keshlar
      const testExists = new Map();
      async function ensureTest(id) {
        if (testExists.has(id)) return testExists.get(id);
        const [[t]] = await conn.query("SELECT id FROM tests WHERE id=?", [id]);
        const ex = !!t;
        testExists.set(id, ex);
        return ex;
      }

      const nextOrder = new Map();
      async function allocOrder(testId) {
        if (!nextOrder.has(testId)) {
          const [[m]] = await conn.query(
            "SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM questions WHERE test_id=?",
            [testId]
          );
          nextOrder.set(testId, Number(m?.next || 1));
        }
        const v = nextOrder.get(testId);
        nextOrder.set(testId, v + 1);
        return v;
      }

      for (let r of rawRows) {
        // sarlavhalarni kichik harfga moslab o‘qiymiz
        const row = {};
        for (const k of Object.keys(r)) row[key(k)] = r[k];

        const testId = Number(row["test_id"] || 0);
        const qtext = norm(row["question"]);
        const correctRaw = row["correct_answer"];

        if (!testId || !qtext) {
          skipped++;
          continue;
        }
        if (!(await ensureTest(testId))) {
          skipped++;
          continue;
        }

        // answer_1..answer_8
        const options = [];
        for (let i = 1; i <= 8; i++) {
          const v = norm(row[`answer_${i}`]);
          if (v) options.push(v);
        }

        // kamida 2 variant yoki correct bo‘lishi shart
        if (options.length < 2 && !norm(correctRaw)) {
          skipped++;
          continue;
        }

        const correctIndex = resolveCorrectIndex(options, correctRaw);

        // savol
        const order = await allocOrder(testId);
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

        // ogohlantirish: correct topilmasa yoki bo‘sh bo‘lsa
        if (!norm(correctRaw)) warnings++;
        else {
          const cr = norm(correctRaw);
          const numLike = /^\d+$/.test(cr) || /^[A-Ha-h]$/.test(cr);
          if (!numLike) {
            const matched = options.some(
              (o) => norm(o).toLowerCase() === cr.toLowerCase()
            );
            if (!matched) warnings++;
          }
        }

        ok++;
      }

      await conn.commit();
      req.flash(
        "msg",
        `✅ Yuklandi: ${ok}. ⏭ O‘tkazildi: ${skipped}. ⚠️ Ogohlantirish: ${warnings}.`
      );
    } catch (e) {
      if (conn) {
        try {
          await conn.rollback();
        } catch (_) {}
      }
      console.error("Bulk XLSX import error:", e);
      req.flash("error", "Import xatosi: " + e.message);
    } finally {
      if (conn) conn.release();
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
const dbg = (...a) => console.log("[BULK XLSX]", ...a);
// ---- XLSX import (bardoshli + keng debug) ----
router.post(
  "/tests/:id/questions/upload-xlsx",
  ensureAuth,
  upload.single("xlsx"),
  async (req, res) => {
    const testId = Number(req.params.id);
    const log = (...a) => console.log("[BULK XLSX]", ...a);

    let ok = 0,
      skipped = 0,
      warnings = 0,
      failed = 0;
    const rowErrors = [];

    try {
      if (!req.file)
        throw new Error('Fayl topilmadi. input name="xlsx" bo‘lsin');

      // test borligini tekshir
      const [[t]] = await pool.query("SELECT id FROM tests WHERE id=?", [
        testId,
      ]);
      if (!t) throw new Error("Test topilmadi: id=" + testId);

      // Excel o‘qish
      const wb = xlsx.read(req.file.buffer, { type: "buffer" });
      const rows = [];
      for (const name of wb.SheetNames) {
        const low = name.toLowerCase();
        if (low.startsWith("instruction")) {
          log(`sheet "${name}" skipped`);
          continue;
        }
        const ws = wb.Sheets[name];
        if (!ws) continue;
        const arr = xlsx.utils.sheet_to_json(ws, { defval: "", raw: false });
        if (arr[0]) {
          const keys = Object.keys(arr[0]).map(
            (k) =>
              `"${k
                .toString()
                .replace(/\u00A0/g, " ")
                .trim()
                .toLowerCase()}"`
          );
          log(`"${name}" first row keys:`, keys.join(", "));
        }
        rows.push(...arr);
      }
      log("TOTAL rows:", rows.length);

      const cleanKey = (s) =>
        s
          .toString()
          .replace(/\u00A0/g, " ")
          .trim()
          .toLowerCase();
      const cleanVal = (s) =>
        s == null
          ? ""
          : s
              .toString()
              .replace(/\u00A0/g, " ")
              .trim();
      const pick = (obj, candidates) => {
        for (const k of Object.keys(obj)) {
          const ck = cleanKey(k);
          if (candidates.includes(ck)) return obj[k];
        }
        return undefined;
      };

      // options jadval tuzilmasini auto-aniqlash
      const [hasIsCorrectCol] = await pool.query(
        "SHOW COLUMNS FROM `options` LIKE 'is_correct'"
      );
      const [hasWeightCol] = await pool.query(
        "SHOW COLUMNS FROM `options` LIKE 'weight'"
      );
      const haveIsCorrect = hasIsCorrectCol.length > 0;
      const haveWeight = hasWeightCol.length > 0;

      const insertOptionSQL = (() => {
        if (haveIsCorrect && haveWeight) {
          return "INSERT INTO options (question_id,text,is_correct,sort_order,weight) VALUES (?,?,?,?,?)";
        } else if (haveIsCorrect && !haveWeight) {
          return "INSERT INTO options (question_id,text,is_correct,sort_order) VALUES (?,?,?,?)";
        } else {
          return "INSERT INTO options (question_id,text,sort_order) VALUES (?,?,?)";
        }
      })();

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        const [[mx]] = await conn.query(
          "SELECT COALESCE(MAX(sort_order),0) AS maxo FROM questions WHERE test_id=?",
          [testId]
        );
        let nextOrder = Number(mx?.maxo || 0);

        for (let i = 0; i < rows.length; i++) {
          const raw = rows[i];
          const excelRow = i + 2; // 1-qator header

          try {
            // Agar faylda test_id ustuni bo‘lsa – tekshiramiz
            const rid =
              Number(cleanVal(pick(raw, ["test_id", "testid"]))) || testId;
            if (rid !== testId) {
              skipped++;
              log(`row ${excelRow} skipped: other test_id=${rid}`);
              continue;
            }

            // Savol matni
            const question = cleanVal(
              pick(raw, ["question", "question_text", "savol", "questiontext"])
            );
            if (!question) {
              skipped++;
              log(`row ${excelRow} skipped: empty question`);
              continue;
            }

            // To‘g‘ri javob
            const correct = cleanVal(
              pick(raw, ["correct_answer", "correct", "answer_correct"])
            );

            // Variantlar: answer_1..8 YOKI option_a..h
            const options = [];
            for (let n = 1; n <= 8; n++) {
              const v = pick(raw, [`answer_${n}`, `answer${n}`]);
              const val = cleanVal(v || "");
              if (val) options.push(val);
            }
            if (options.length === 0) {
              const letters = "abcdefgh".split("");
              for (const ch of letters) {
                const v = pick(raw, [`option_${ch}`, `option${ch}`]);
                const val = cleanVal(v || "");
                if (val) options.push(val);
              }
            }

            if (options.length < 2 && !correct) {
              skipped++;
              log(`row ${excelRow} skipped: not enough options`);
              continue;
            }

            // correct ro‘yxatda yo‘q bo‘lsa – boshiga qo‘shamiz
            const norm = (s) => s.replace(/\s+/g, " ").toLowerCase();
            let cIdx = -1;
            if (correct) {
              const target = norm(correct);
              cIdx = options.findIndex((o) => norm(o) === target);
              if (cIdx === -1) {
                options.unshift(correct);
                cIdx = 0;
                warnings++;
                log(`row ${excelRow} warn: correct injected at 0`);
              }
            } else {
              cIdx = 0;
              warnings++;
              log(`row ${excelRow} warn: empty correct -> option[0] true`);
            }

            if (options.length < 2) {
              skipped++;
              log(`row ${excelRow} skipped: <2 options after normalize`);
              continue;
            }

            // Savolni yozish
            const sort_order = ++nextOrder;
            const [insQ] = await conn.query(
              "INSERT INTO questions (test_id, text, sort_order) VALUES (?,?,?)",
              [testId, question, sort_order]
            );

            // Variantlarni yozish
            let wrote = 0,
              sort = 1;
            for (let k = 0; k < options.length; k++) {
              const isCor = k === cIdx ? 1 : 0;
              if (haveIsCorrect && haveWeight) {
                await conn.query(insertOptionSQL, [
                  insQ.insertId,
                  options[k],
                  isCor,
                  sort++,
                  isCor ? 1 : 0,
                ]);
              } else if (haveIsCorrect && !haveWeight) {
                await conn.query(insertOptionSQL, [
                  insQ.insertId,
                  options[k],
                  isCor,
                  sort++,
                ]);
              } else {
                await conn.query(insertOptionSQL, [
                  insQ.insertId,
                  options[k],
                  sort++,
                ]);
              }
              wrote++;
            }
            log(
              `row ${excelRow} -> Q#${insQ.insertId} | options written: ${wrote}`
            );

            ok++;
          } catch (rowErr) {
            failed++;
            rowErrors.push(`row ${excelRow}: ${rowErr.message}`);
            console.error("[BULK XLSX] row error:", rowErr, "raw=", rows[i]);
          }
        }

        await conn.commit();
      } catch (txErr) {
        try {
          await conn.rollback();
        } catch {}
        throw txErr;
      } finally {
        conn.release();
      }

      const summary = `✅ Savollar: ${ok} | ⏭ Skip: ${skipped} | ⚠️ Ogohl.: ${warnings} | ❌ Xato: ${failed}`;
      if (failed)
        req.flash("error", summary + ". " + rowErrors.slice(0, 5).join(" | "));
      else req.flash("msg", summary);
    } catch (e) {
      console.error("[BULK XLSX] FATAL:", e);
      req.flash("error", "Import xatosi: " + e.message);
    }

    res.redirect(`/admin/tests/${testId}/questions`);
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
// /web/routes/admin.js yoki sizdagi router faylida
router.get("/users", ensureAuth, async (req, res) => {
  const limit = 15;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * limit;

  // 1) Sahifadagi yozuvlar
  const [rows] = await pool.query(
    `SELECT id, tg_id, full_name, username, phone, is_student
     FROM users
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  // 2) Umumiy son
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users`);

  const pages = Math.max(1, Math.ceil(total / limit));
  const hasPrev = page > 1;
  const hasNext = page < pages;

  // Page raqamlarini ixcham ko‘rsatish (5 ta oynacha)
  const windowSize = 5;
  let startPage = Math.max(1, page - Math.floor(windowSize / 2));
  let endPage = Math.min(pages, startPage + windowSize - 1);
  if (endPage - startPage + 1 < windowSize) {
    startPage = Math.max(1, endPage - windowSize + 1);
  }
  const pageNumbers = Array.from(
    { length: endPage - startPage + 1 },
    (_, i) => startPage + i
  );

  res.render("users", {
    users: rows,
    page,
    pages,
    total,
    limit,
    hasPrev,
    hasNext,
    pageNumbers,
  });
});

router.post("/users/:id/toggle-student", ensureAuth, async (req, res) => {
  await pool.query("UPDATE users SET is_student = 1 - is_student WHERE id=?", [
    req.params.id,
  ]);
  res.redirect("/admin/users");
});

// routes/admin/leads.js
router.get("/leads", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const offset = (page - 1) * limit;

  const [[{ total }]] = await pool.query("SELECT COUNT(*) as total FROM leads");
  const [rows] = await pool.query(`
    SELECT l.*, u.full_name, u.username
    FROM leads l
    LEFT JOIN users u ON u.id = l.user_id
    ORDER BY l.created_at DESC
    LIMIT ? OFFSET ?
  `, [limit, offset]);

  const pages = Math.ceil(total / limit);
  const pageNumbers = Array.from({ length: pages }, (_, i) => i + 1);

  
  res.render("leads", {
    leads: rows,
    total,
    page,
    pages,
    hasPrev: page > 1,
    hasNext: page < pages,
    pageNumbers,
    dayjs
  });
});

// Excel eksport route (leads + user phone)
router.get("/leads/export", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        l.*,
        u.full_name,
        u.username,
        u.phone AS user_phone
      FROM leads l
      LEFT JOIN users u ON u.id = l.user_id
      ORDER BY l.created_at DESC
    `);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Leads");

    // Header
    ws.addRow([
      "ID","FIO","Username","Phone (users)","tg_id","source","stage","intent","purpose",
      "district","group_pref","pref_time","pref_days","note","created_at"
    ]);

    // Rows
    rows.forEach(r => {
      ws.addRow([
        r.id,
        r.full_name || "",
        r.username ? "@" + r.username : "",
        r.user_phone || "",                 // ← users.phone
        r.tg_id,
        r.source,
        r.stage,
        r.intent,
        r.purpose,
        r.district,
        r.group_preference,
        r.preferred_time,
        r.preferred_days,
        r.note,                              // ← leads.note (odatda telefon ham bo‘lishi mumkin)
        dayjs(r.created_at).format("YYYY-MM-DD HH:mm"),
      ]);
    });

    // ixtiyoriy: ustunlarni biroz kengaytirish
    ws.columns.forEach(col => { col.width = Math.min(40, Math.max(12, (col.header + "").length + 2)); });

    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition","attachment; filename=leads.xlsx");
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error("leads/export error:", e);
    res.status(500).send("Exportda xatolik yuz berdi.");
  }
});


module.exports = router;
