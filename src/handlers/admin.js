const { pool } = require("../db");

function registerAdmin(bot) {
  bot.command("admin", async (ctx) => {
    const parts = (ctx.message.text || "").split(" ").slice(1);
    if (parts[0] !== process.env.ADMIN_PASS) return ctx.reply("❌ Ruxsat yo‘q");

    const [[uCount]] = await pool.query("SELECT COUNT(*) AS c FROM users");
    const [[aCount]] = await pool.query("SELECT COUNT(*) AS c FROM attempts WHERE status='completed'");
    const [[lCount]] = await pool.query("SELECT COUNT(*) AS c FROM leads");

    await ctx.reply(`👥 Users: ${uCount.c}\n🧪 Completed: ${aCount.c}\n🧲 Leads: ${lCount.c}`);
  });
}

module.exports = { registerAdmin };
