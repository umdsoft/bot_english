const { createLogger } = require("../../core/logger");

const logger = createLogger("bot:telegram");

async function safeReply(ctx, text, extra) {
  try {
    return await ctx.reply(text, extra);
  } catch (error) {
    logger.debug("Failed to reply", {
      chatId: ctx?.chat?.id,
      code: error?.code,
      message: error?.description || error?.message,
    });
    return null;
  }
}

function safeAnswerCallback(ctx, text, extra) {
  return ctx.answerCbQuery(text, extra).catch((error) => {
    logger.debug("Failed to answer callback", {
      chatId: ctx?.chat?.id,
      code: error?.code,
      message: error?.description || error?.message,
    });
    return null;
  });
}

async function safeSendMessage(telegram, chatId, text, extra) {
  try {
    return await telegram.sendMessage(chatId, text, extra);
  } catch (error) {
    logger.warn("Failed to send message", {
      chatId,
      code: error?.code,
      message: error?.description || error?.message,
    });
    return null;
  }
}

module.exports = {
  safeReply,
  safeAnswerCallback,
  safeSendMessage,
};
