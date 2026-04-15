const { config } = require("../config");

async function telegramRequest(method, payload = {}) {
  const response = await fetch(`${config.telegramApiBase}/bot${config.telegramBotToken}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    const description = data?.description || response.statusText || "Telegram request failed";
    throw new Error(`Telegram ${method} failed: ${description}`);
  }

  return data.result;
}

async function getUpdates(offset) {
  return telegramRequest("getUpdates", {
    offset,
    timeout: config.telegramPollTimeoutSeconds,
    allowed_updates: ["message", "callback_query"],
  });
}

async function sendMessage(chatId, text, options = {}) {
  return telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
    ...options,
  });
}

async function sendVideo(chatId, fileId, caption = "") {
  return telegramRequest("sendVideo", {
    chat_id: chatId,
    video: fileId,
    caption,
  });
}

async function sendChatAction(chatId, action) {
  return telegramRequest("sendChatAction", {
    chat_id: chatId,
    action,
  });
}

async function getFile(fileId) {
  return telegramRequest("getFile", {
    file_id: fileId,
  });
}

async function downloadTelegramFile(filePath) {
  const response = await fetch(`${config.telegramApiBase}/file/bot${config.telegramBotToken}/${filePath}`);

  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function answerCallbackQuery(callbackQueryId, text = "") {
  return telegramRequest("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

async function deleteMessage(chatId, messageId) {
  return telegramRequest("deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

module.exports = {
  answerCallbackQuery,
  deleteMessage,
  downloadTelegramFile,
  getFile,
  getUpdates,
  sendChatAction,
  sendMessage,
  sendVideo,
};
