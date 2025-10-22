const path = require("path");
const express = require("express");
const session = require("express-session");
const flash = require("connect-flash");
const engine = require("ejs-mate");
const adminRoutes = require("./routes/admin");
const morgan = require('morgan');
const { config } = require("../config");
const app = express();

// EJS
app.engine("ejs", engine); // <- qo'shildi
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// morgan: URL, status, vaqt, va POST body (sanitizatsiya) ni ko’rsatamiz
morgan.token("body", (req) => {
  if (!req.body || Object.keys(req.body).length === 0) return "";
  // sirlilarni yashirib loglaymiz
  const clone = { ...req.body };
  if (clone.password) clone.password = "***";
  if (clone.web_otp) clone.web_otp = "***";
  return JSON.stringify(clone);
});
app.use(morgan(":method :url :status :response-time ms :body"));
// middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: config.admin.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 soat
  })
);
app.use(flash());
app.use((req, res, next) => {
  res.locals.title = "Admin";
  res.locals.path = req.originalUrl || req.path || ""; // ← active menu uchun
  next();
});
app.use((req, res, next) => {
  const messages = req.flash("msg");
  res.locals.msg = messages && messages.length ? messages : null;
  const errors = req.flash("error");
  res.locals.error = errors && errors.length ? errors : null;
  next();
});
// static (logo va h.k.)
// Barcha admin routelardan oldin qo'yiladi
app.use((req, res, next) => {
  res.locals.cur = req.originalUrl || "";
  next();
});
app.use("/assets", express.static(path.join(__dirname, "..", "..", "assets")));

// routes
app.use("/admin", adminRoutes);
app.use("/exam", require("./routes/exam"));
app.use("/admin/courses", require("./routes/adminCourses"));
app.use("/admin/polls", require("./routes/admin.polls"));
// 404
app.use((req, res) => res.status(404).send("Not Found"));

// server start (faqat alohida ishga tushirmoqchi bo‘lsangiz)
if (require.main === module) {
  const PORT = process.env.ADMIN_PORT || 4001;
  app.listen(PORT, () => console.log("Admin panel listening on :" + PORT));
}

module.exports = app;
