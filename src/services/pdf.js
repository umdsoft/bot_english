const fs = require("fs");
const os = require("os");
const path = require("path");
const dayjs = require("dayjs");
const PDFDocument = require("pdfkit");
const { ASSETS_DIR } = require("../config");
const { getAttemptSummary, getAttemptAnswersDetailed } = require("./tests");

async function generateResultPDF(attemptId, counts) {
  const summary = await getAttemptSummary(attemptId);
  const details = await getAttemptAnswersDetailed(attemptId);
  if (!summary) throw new Error("Attempt summary not found");

  const safeCorrect =
    typeof counts?.correctCount === "number"
      ? counts.correctCount
      : details.filter((r) => Number(r.is_correct) === 1).length;
  const totalQ = details.length;
  const safeWrong =
    typeof counts?.wrongCount === "number"
      ? counts.wrongCount
      : Math.max(totalQ - safeCorrect, 0);

  const filePath = path.join(os.tmpdir(), `attempt_${attemptId}.pdf`);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 48 });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // fonts (ixtiyoriy)
      const fontRegular = path.join(ASSETS_DIR, "NotoSans-Regular.ttf");
      const fontBold = path.join(ASSETS_DIR, "NotoSans-Bold.ttf");
      if (fs.existsSync(fontRegular)) doc.registerFont("regular", fontRegular);
      if (fs.existsSync(fontBold)) doc.registerFont("bold", fontBold);
      if (doc._font) doc.font("regular");

      const logoPath = path.join(ASSETS_DIR, "logo.png");
      if (fs.existsSync(logoPath)) {
        const w = 120, x = (doc.page.width - w) / 2;
        doc.image(logoPath, x, 36, { width: w });
        doc.moveDown(3);
      } else {
        doc.moveDown(1);
      }

      if (doc._font) doc.font("bold");
      doc.fontSize(18).text("Ingliz Tili Placement Test — Natija Hisoboti", { align: "center" });
      if (doc._font) doc.font("regular");
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor("gray")
        .text(`Hisobot ID: ${attemptId}`, { align: "center" })
        .text(`Sana: ${dayjs().format("YYYY-MM-DD HH:mm")}`, { align: "center" });
      doc.moveDown(1).fillColor("black");

      if (doc._font) doc.font("bold");
      doc.fontSize(13).text("👤 O‘quvchi ma’lumotlari");
      if (doc._font) doc.font("regular");
      doc.moveDown(0.3);
      doc.fontSize(11)
        .text(`Ism: ${summary.full_name || "-"}`)
        .text(`Username: ${summary.username ? "@" + summary.username : "-"}`)
        .text(`Telefon: ${summary.phone || "-"}`)
        .moveDown(0.6);

      if (doc._font) doc.font("bold");
      doc.fontSize(13).text("🧪 Test ma’lumotlari");
      if (doc._font) doc.font("regular");
      doc.moveDown(0.3);
      doc.fontSize(11)
        .text(`Test: ${summary.test_name} (${summary.test_code})`)
        .text(`Boshlangan: ${dayjs(summary.started_at).format("YYYY-MM-DD HH:mm")}`)
        .text(`Tugagan: ${dayjs(summary.finished_at).format("YYYY-MM-DD HH:mm")}`)
        .text(`Davomiylik: ${summary.duration_sec || 0} sek.`)
        .moveDown(0.6);

      if (doc._font) doc.font("bold");
      doc.fontSize(13).text("📊 Natija");
      if (doc._font) doc.font("regular");
      doc.moveDown(0.3);
      doc.fontSize(12)
        .text(`Ball: ${summary.score}`)
        .text(`Foiz: ${summary.percent}%`)
        .text(`Taxminiy CEFR: ${summary.level_guess}`)
        .text(`✅ To‘g‘ri javoblar: ${safeCorrect} ta`)
        .text(`❌ Xato javoblar: ${safeWrong} ta`);
      doc.moveDown(0.8);

      if (doc._font) doc.font("bold");
      doc.fontSize(13).text("📝 Savollar bo‘yicha tafsilotlar");
      if (doc._font) doc.font("regular");
      doc.moveDown(0.4);
      details.forEach((r, i) => {
        const ok = Number(r.is_correct) === 1;
        doc.fontSize(12).fillColor(ok ? "green" : "red")
          .text(`Q${i + 1}. ${ok ? "To‘g‘ri" : "Noto‘g‘ri"}`);
        doc.fillColor("black").fontSize(11)
          .text(`Savol: ${r.q_text}`)
          .text(`Sizning javobingiz: ${r.user_answer || "(javob tanlanmagan)"}`)
          .text(`To‘g‘ri javob(lar): ${r.correct_answers || "-"}`);
        doc.moveDown(0.6);
      });

      doc.end();
      stream.on("finish", () => resolve(filePath));
      stream.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { generateResultPDF };
