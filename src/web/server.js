require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");
const flash = require("connect-flash");
const engine = require("ejs-mate");
const adminRoutes = require("./routes/admin");

const app = express();

// EJS
app.engine("ejs", engine); // <- qo'shildi
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.ADMIN_SESSION_SECRET || "supersecret_session_key",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 soat
  })
);
app.use(flash());
app.use((req, res, next) => {
  res.locals.title = "Admin";
  res.locals.error = req.flash("error");
  res.locals.msg = req.flash("msg");
  res.locals.path = req.originalUrl || req.path || ""; // ← active menu uchun
  next();
});
app.use((req, res, next) => {
  const m = req.flash("msg");
  res.locals.msg = m && m.length ? m : null;
  const e = req.flash("error");
  res.locals.error = e && e.length ? e : null;
  next();
});
// static (logo va h.k.)
app.use("/assets", express.static(path.join(__dirname, "..", "..", "assets")));

// routes
app.use("/admin", adminRoutes);
app.use("/exam", require("./routes/exam"));
// 404
app.use((req, res) => res.status(404).send("Not Found"));

// server start (faqat alohida ishga tushirmoqchi bo‘lsangiz)
if (require.main === module) {
  const PORT = process.env.ADMIN_PORT || 4001;
  app.listen(PORT, () => console.log("Admin panel listening on :" + PORT));
}

module.exports = app;
