// src/services/pdf.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const dayjs = require("dayjs");
const PDFDocument = require("pdfkit");
const { ASSETS_DIR } = require("../config");
const { getAttemptSummary, getAttemptAnswersDetailed } = require("./tests");

// ------- helpers -------
const safe = (v, fallback = "-") =>
  v === null || v === undefined || v === "" ? fallback : String(v);

const fmt = (dt, def = "-") => {
  if (!dt) return def;
  const d = dayjs(dt);
  return d.isValid() ? d.format("YYYY-MM-DD HH:mm") : def;
};

function makeTempFilePath(prefix = "attempt") {
  const rnd = crypto.randomBytes(6).toString("hex");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-"));
  return path.join(dir, `${prefix}_${Date.now()}_${process.pid}_${rnd}.pdf`);
}

function tryRegisterFont(doc, name, filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      doc.registerFont(name, filePath);
      return true;
    }
  } catch (_) {}
  return false;
}

function text(doc, str, opts = {}) {
  // pdfkit text wrapper
  return doc.text(str ?? "", { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, ...opts });
}

// ------- core -------
async function generateResultPDF(attemptId, counts) {
  const summary = await getAttemptSummary(attemptId);
  const details = (await getAttemptAnswersDetailed(attemptId)) || [];
  if (!summary) throw new Error("Attempt summary not found");

  const computedCorrect =
    Array.isArray(details)
      ? details.filter((r) => Number(r?.is_correct) === 1).length
      : 0;

  const safeCorrect =
    typeof counts?.correctCount === "number" ? counts.correctCount : computedCorrect;

  const totalQ = Array.isArray(details) ? details.length : 0;
  const safeWrong =
    typeof counts?.wrongCount === "number" ? counts.wrongCount : Math.max(totalQ - safeCorrect, 0);

  const filePath = makeTempFilePath("attempt");

  await new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 48 });
      const out = fs.createWriteStream(filePath);
      doc.pipe(out);

      // Fonts (ixtiyoriy)
      const fontRegular = path.join(ASSETS_DIR || "", "NotoSans-Regular.ttf");
      const fontBold = path.join(ASSETS_DIR || "", "NotoSans-Bold.ttf");
      const hasRegular = tryRegisterFont(doc, "regular", fontRegular);
      const hasBold = tryRegisterFont(doc, "bold", fontBold);

      if (hasRegular) doc.font("regular");

      // Logo (ixtiyoriy)
      try {
        const logoPath = path.join(ASSETS_DIR || "", "logo.png");
        if (fs.existsSync(logoPath)) {
          const w = 120;
          const x = (doc.page.width - w) / 2;
          doc.image(logoPath, x, 36, { width: w });
          doc.moveDown(3);
        } else {
          doc.moveDown(1);
        }
      } catch (_) {
        doc.moveDown(1);
      }

      if (hasBold) doc.font("bold");
      doc.fontSize(18);
      text(doc, "Ingliz Tili Placement Test — Natija Hisoboti", { align: "center" });

      if (hasRegular) doc.font("regular");
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor("gray");
      text(doc, `Hisobot ID: ${attemptId}`, { align: "center" });
      text(doc, `Sana: ${dayjs().format("YYYY-MM-DD HH:mm")}`, { align: "center" });
      doc.moveDown(1).fillColor("black");

      // Student info
      if (hasBold) doc.font("bold");
      doc.fontSize(13);
      text(doc, "👤 O‘quvchi ma’lumotlari");
      if (hasRegular) doc.font("regular");
      doc.moveDown(0.3);
      doc.fontSize(11);
      text(doc, `Ism: ${safe(summary.full_name)}`);
      text(doc, `Username: ${summary.username ? "@" + summary.username : "-"}`);
      text(doc, `Telefon: ${safe(summary.phone)}`);
      doc.moveDown(0.6);

      // Test info
      if (hasBold) doc.font("bold");
      doc.fontSize(13);
      text(doc, "🧪 Test ma’lumotlari");
      if (hasRegular) doc.font("regular");
      doc.moveDown(0.3);
      doc.fontSize(11);
      text(doc, `Test: ${safe(summary.test_name)} (${safe(summary.test_code)})`);
      text(doc, `Boshlangan: ${fmt(summary.started_at)}`);
      text(doc, `Tugagan: ${fmt(summary.finished_at)}`);
      text(doc, `Davomiylik: ${Number(summary.duration_sec) || 0} sek.`);
      doc.moveDown(0.6);

      // Result
      if (hasBold) doc.font("bold");
      doc.fontSize(13);
      text(doc, "📊 Natija");
      if (hasRegular) doc.font("regular");
      doc.moveDown(0.3);
      doc.fontSize(12);
      text(doc, `Ball: ${safe(summary.score)}`);
      text(doc, `Foiz: ${safe(summary.percent)}%`);
      text(doc, `Taxminiy CEFR: ${safe(summary.level_guess)}`);
      text(doc, `✅ To‘g‘ri javoblar: ${safeCorrect} ta`);
      text(doc, `❌ Xato javoblar: ${safeWrong} ta`);
      doc.moveDown(0.8);

      // Details
      if (hasBold) doc.font("bold");
      doc.fontSize(13);
      text(doc, "📝 Savollar bo‘yicha tafsilotlar");
      if (hasRegular) doc.font("regular");
      doc.moveDown(0.4);

      (details || []).forEach((r, i) => {
        const ok = Number(r?.is_correct) === 1;
        doc.fontSize(12).fillColor(ok ? "green" : "red");
        text(doc, `Q${i + 1}. ${ok ? "To‘g‘ri" : "Noto‘g‘ri"}`);
        doc.fillColor("black").fontSize(11);
        text(doc, `Savol: ${safe(r?.q_text)}`);
        text(doc, `Sizning javobingiz: ${safe(r?.user_answer, "(javob tanlanmagan)")}`);
        text(doc, `To‘g‘ri javob(lar): ${safe(r?.correct_answers)}`);
        doc.moveDown(0.6);
      });

      doc.end();

      out.once("finish", resolve);
      out.once("error", (e) => {
        try { fs.unlinkSync(filePath); } catch (_) {}
        reject(e);
      });
    } catch (e) {
      try { fs.unlinkSync(filePath); } catch (_) {}
      reject(e);
    }
  });

  return filePath;
}

async function sendResultPDF(telegram, chatId, attemptId, counts, caption = "") {
  try {
    const filePath = await generateResultPDF(attemptId, counts);

    // o'qish streamida xatoni yutish
    const read = fs.createReadStream(filePath);
    read.on("error", () => {});

    await telegram.sendDocument(
      chatId,
      { source: read, filename: `result_${attemptId}.pdf` },
      { caption }
    );

    // vaqtinchalik faylni tozalash
    try { fs.unlinkSync(filePath); } catch (_) {}
    return true;
  } catch (err) {
    console.error("sendResultPDF error:", err?.description || err?.message || err);
    return false;
  }
}

module.exports = { generateResultPDF, sendResultPDF };
