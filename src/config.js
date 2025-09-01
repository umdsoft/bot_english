const path = require("path");

module.exports = {
  TARGET_CHANNEL_ID: Number(process.env.TARGET_CHANNEL_ID || "-1002937713606"),
  ASSETS_DIR: path.join(__dirname, "..", "assets"),
  TZ: process.env.TZ || "Asia/Tashkent",
};
