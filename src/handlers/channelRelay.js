// src/handlers/channelRelay.js
const {
  getAllSubscribersFromDB,
  deleteUserByTgId,
} = require("../services/subscribers.db");
const { copySafe } = require("../lib/telegram");
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function registerChannelRelay(bot) {
  bot.on(["channel_post", "edited_channel_post"], async (ctx) => {
    const post = ctx.update.channel_post || ctx.update.edited_channel_post;
    if (!post) return;

    // faqat o'z kanalimizdan kelganini qabul qilamiz
    const sourceId = String(process.env.SOURCE_CHANNEL_ID || "-1002924184898");
    if (!sourceId || String(post.chat.id) !== sourceId) return;

    // DB dan foydalanuvchilar ro'yxatini olamiz
    let subs = [];
    try {
      subs = await getAllSubscribersFromDB();
    } catch (e) {
      console.error("getAllSubscribersFromDB error:", e?.message || e);
      return;
    }
    if (!subs.length) return;

    const batchSize = Number(process.env.RELAY_BATCH_SIZE || 25);
    const waitMs = Number(process.env.RELAY_BATCH_WAIT_MS || 60);

    for (let i = 0; i < subs.length; i += batchSize) {
      const batch = subs.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (uid) => {
          try {
            await ctx.telegram.copyMessage(
              uid, // ➜ foydalanuvchi chat ID
              post.chat.id, // ← manba kanal
              post.message_id // ← kanal posti
            );
          } catch (err) {
            const code = err?.response?.error_code;
            // 403 — user botni block qilgan (DB dan o‘chirib tashlashni xohlasangiz shu yerda yozing)
            await deleteUserByTgId(uid);
            if (code === 429) {
              // rate-limit: kichik backoff
              await sleep(1000);
            } else {
              // Diagnostika uchun log
              console.error(
                "relay error:",
                uid,
                err?.description || err?.message || err
              );
            }
          }
        })
      );

      // batchlar orasida kichik pauza
      await sleep(waitMs);
    }
  });
}

module.exports = { registerChannelRelay };
