// src/index.js
require("dotenv").config();
const dayjs = require("dayjs");
const { Telegraf } = require("telegraf");
const { TZ } = require("./config");

process.env.TZ = TZ;

const bot = new Telegraf(process.env.BOT_TOKEN);

// Handlers & middlewares
const { registerStart }    = require("./handlers/start");
const { registerInfo }     = require("./handlers/info");
const { registerTestFlow } = require("./handlers/testFlow");
const { registerLead }     = require("./handlers/leads");
const { registerAdmin }    = require("./handlers/admin");
const { resumePrompt }     = require("./middlewares/resumePrompt");

let wired = false;   // handlerlar ikki marta registratsiya bo‘lib ketmasin
let launched = false;

async function wireUp() {
  if (wired) return;
  registerStart(bot);
  registerInfo(bot);
  registerTestFlow(bot);
  registerLead(bot);
  registerAdmin(bot);
  bot.use(resumePrompt);
  wired = true;
}

async function startBot() {
  await wireUp();

  // /start, /menu, /help komandalarini set qilish
  try {
    await bot.telegram.setMyCommands([
      { command: "start", description: "Boshlash" },
      { command: "menu",  description: "Menyuni ko‘rsatish" },
      { command: "help",  description: "Yordam" },
    ]);
  } catch (e) {
    console.warn("setMyCommands:", e.message);
  }

  if (!launched) {
    await bot.launch();
    launched = true;
    console.log(`[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] Bot started`);
  }
  return bot;
}

async function stopBot() {
  try { await bot.stop("SIGTERM"); } catch {}
  launched = false;
}

module.exports = { startBot, stopBot, bot };
