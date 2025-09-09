// src/web/routes/adminCourses.js
const path = require("path");
const fs = require("fs");
const express = require("express");
const router = express.Router();
const multer = require("multer");
const { pool } = require("../../db");

// ---------- uploads/materials ----------
const uploadDir = path.join(process.cwd(), "uploads", "materials");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ts = Date.now();
      const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
      cb(null, `${ts}_${safe}`);
    },
  }),
});

// ---------- helpers ----------
function paginate(q) {
  const page = Math.max(1, Number(q.page || 1));
  const perPage = Math.max(1, Math.min(100, Number(q.perPage || 15)));
  const offset = (page - 1) * perPage;
  return { page, perPage, offset };
}
const ensureInt = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ===================== SUBJECTS =====================

// GET /admin/courses/subjects
router.get("/subjects", async (req, res) => {
  const { page, perPage, offset } = paginate(req.query);

  const [[{ c }]] = await pool.query("SELECT COUNT(*) c FROM subjects");
  const [rows] = await pool.query(
    `SELECT s.*,
            (SELECT COUNT(*) FROM topics t WHERE t.subject_id = s.id) AS topics_count
       FROM subjects s
      ORDER BY s.name
      LIMIT ? OFFSET ?`,
    [perPage, offset]
  );

  const pages = Math.max(1, Math.ceil(c / perPage));
  const pageNumbers = Array.from({ length: Math.min(10, pages) }, (_, i) => {
    const base = Math.max(1, Math.min(pages - 9, page - 4)); // window
    return base + i;
  }).filter(p => p >= 1 && p <= pages);

  res.render("subjects", {
    user: req.session.adminUser,
    subjects: rows,
    total: c,
    page,
    perPage,
    pages,
    pageNumbers,
    hasPrev: page > 1,
    hasNext: page < pages,
  });
});

// POST /admin/courses/subjects (create)
router.post("/subjects", async (req, res) => {
  const code = (req.body.code || "").trim();
  const name = (req.body.name || "").trim();
  const is_active = req.body.is_active ? 1 : 0;
  if (!name) return res.status(400).send("Name required");
  await pool.query(
    "INSERT INTO subjects (code, name, is_active, created_at, updated_at) VALUES (?,?,?,NOW(),NOW())",
    [code || null, name, is_active]
  );
  res.redirect("/admin/courses/subjects");
});

// POST /admin/courses/subjects/:id
router.post("/subjects/:id", async (req, res) => {
  const id = Number(req.params.id);
  const code = (req.body.code || "").trim();
  const name = (req.body.name || "").trim();
  const is_active = req.body.is_active ? 1 : 0;
  await pool.query(
    "UPDATE subjects SET code=?, name=?, is_active=?, updated_at=NOW() WHERE id=?",
    [code || null, name, is_active, id]
  );
  res.redirect("/admin/courses/subjects");
});

// POST /admin/courses/subjects/:id/toggle
router.post("/subjects/:id/toggle", async (req, res) => {
  const id = Number(req.params.id);
  await pool.query(
    "UPDATE subjects SET is_active=1-is_active, updated_at=NOW() WHERE id=?",
    [id]
  );
  res.redirect("/admin/courses/subjects");
});

// ===================== TOPICS =====================

// GET /admin/courses/subjects/:sid/topics
router.get("/subjects/:sid/topics", async (req, res) => {
  const sid = Number(req.params.sid);
  const [[subj]] = await pool.query("SELECT * FROM subjects WHERE id=?", [sid]);
  if (!subj) return res.status(404).send("Subject not found");

  const [topics] = await pool.query(
    `SELECT * FROM topics WHERE subject_id=? ORDER BY order_no, id`,
    [sid]
  );

  res.render("topics", {
    user: req.session.adminUser,
    subject: subj,
    topics,
  });
});

// POST /admin/courses/subjects/:sid/topics (create)
router.post("/subjects/:sid/topics", async (req, res) => {
  const sid = Number(req.params.sid);
  const title = (req.body.title || "").trim();
  const order_no = ensureInt(req.body.order_no, 0);
  const is_active = req.body.is_active ? 1 : 0;
  if (!title) return res.status(400).send("title required");

  await pool.query(
    `INSERT INTO topics (subject_id, title, order_no, is_active, created_at, updated_at)
     VALUES (?,?,?,?,NOW(),NOW())`,
    [sid, title, order_no, is_active]
  );
  res.redirect(`/admin/courses/subjects/${sid}/topics`);
});

// POST /admin/courses/topics/:id (update)
router.post("/topics/:id", async (req, res) => {
  const id = Number(req.params.id);
  const title = (req.body.title || "").trim();
  const order_no = ensureInt(req.body.order_no, 0);
  const is_active = req.body.is_active ? 1 : 0;
  const [[t]] = await pool.query("SELECT subject_id FROM topics WHERE id=?", [id]);
  if (!t) return res.status(404).send("Topic not found");

  await pool.query(
    "UPDATE topics SET title=?, order_no=?, is_active=?, updated_at=NOW() WHERE id=?",
    [title, order_no, is_active, id]
  );
  res.redirect(`/admin/courses/subjects/${t.subject_id}/topics`);
});

// ===================== MATERIALS =====================

// GET /admin/courses/topics/:tid/materials
router.get("/topics/:tid/materials", async (req, res) => {
  const tid = Number(req.params.tid);
  const [[topic]] = await pool.query(
    "SELECT t.*, s.name AS subject_name FROM topics t JOIN subjects s ON s.id=t.subject_id WHERE t.id=?",
    [tid]
  );
  if (!topic) return res.status(404).send("Topic not found");

  const [rows] = await pool.query(
    "SELECT * FROM materials WHERE topic_id=? ORDER BY order_no, id",
    [tid]
  );

  res.render("materials", {
    user: req.session.adminUser,
    topic,
    materials: rows,
  });
});

// POST /admin/courses/topics/:tid/materials (create)
router.post("/topics/:tid/materials", upload.single("file"), async (req, res) => {
  const tid = Number(req.params.tid);
  const type = (req.body.type || "text").toLowerCase(); // text, link, pdf, video
  const title = (req.body.title || "").trim();
  const url = (req.body.url || "").trim() || null;
  const text = (req.body.text || "").trim() || null;
  const order_no = ensureInt(req.body.order_no, 0);
  const duration_sec = ensureInt(req.body.duration_sec, null);
  const is_active = req.body.is_active ? 1 : 0;

  let file_path = null;
  if (req.file) {
    file_path = path.join("uploads", "materials", req.file.filename);
  }

  await pool.query(
    `INSERT INTO materials
      (topic_id, type, title, url, file_path, text, duration_sec, order_no, is_active, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
    [tid, type, title, url, file_path, text, duration_sec, order_no, is_active]
  );
  res.redirect(`/admin/courses/topics/${tid}/materials`);
});

// POST /admin/courses/materials/:id (update)
router.post("/materials/:id", upload.single("file"), async (req, res) => {
  const id = Number(req.params.id);
  const type = (req.body.type || "text").toLowerCase();
  const title = (req.body.title || "").trim();
  const url = (req.body.url || "").trim() || null;
  const text = (req.body.text || "").trim() || null;
  const order_no = ensureInt(req.body.order_no, 0);
  const duration_sec = ensureInt(req.body.duration_sec, null);
  const is_active = req.body.is_active ? 1 : 0;

  const [[m]] = await pool.query("SELECT topic_id, file_path FROM materials WHERE id=?", [id]);
  if (!m) return res.status(404).send("Material not found");

  let file_path = m.file_path;
  if (req.file) {
    // eski faylni xohlasangiz o‘chirishingiz mumkin
    file_path = path.join("uploads", "materials", req.file.filename);
  }

  await pool.query(
    `UPDATE materials
        SET type=?, title=?, url=?, file_path=?, text=?, duration_sec=?, order_no=?, is_active=?, updated_at=NOW()
      WHERE id=?`,
    [type, title, url, file_path, text, duration_sec, order_no, is_active, id]
  );
  res.redirect(`/admin/courses/topics/${m.topic_id}/materials`);
});

// ===================== COURSE TESTS (qisqa) =====================
// Testlar uchun sizda mavjud CRUD bor; faqat form va insert/update’da
// kind='course', subject_id va topic_id ni qo‘shish kerak bo‘ladi.
// Quyida 2 ta oddiy endpoint (ro‘yxat + "kurs testini qo‘shish" formi) namunasi:

// GET /admin/courses/topics/:tid/tests
router.get("/topics/:tid/tests", async (req, res) => {
  const tid = Number(req.params.tid);
  const [[topic]] = await pool.query(
    "SELECT t.*, s.name AS subject_name FROM topics t JOIN subjects s ON s.id=t.subject_id WHERE t.id=?",
    [tid]
  );
  if (!topic) return res.status(404).send("Topic not found");

  const [rows] = await pool.query(
    "SELECT id, name, code, is_active FROM tests WHERE kind='course' AND topic_id=? ORDER BY id DESC",
    [tid]
  );
  res.render("course_tests", { user: req.session.adminUser, topic, tests: rows });
});

// POST /admin/courses/topics/:tid/tests  (create minimal)
router.post("/topics/:tid/tests", async (req, res) => {
  const tid = Number(req.params.tid);
  const name = (req.body.name || "").trim();
  const code = (req.body.code || "").trim() || null;
  if (!name) return res.status(400).send("name required");

  // topicdan subject_id ni olamiz
  const [[topic]] = await pool.query("SELECT subject_id FROM topics WHERE id=?", [tid]);
  if (!topic) return res.status(404).send("Topic not found");

  await pool.query(
    `INSERT INTO tests (name, code, kind, subject_id, topic_id, is_active, created_at)
     VALUES (?,?,?,?,?,1,NOW())`,
    [name, code, "course", topic.subject_id, tid]
  );
  res.redirect(`/admin/courses/topics/${tid}/tests`);
});

module.exports = router;
