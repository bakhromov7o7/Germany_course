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

async function deleteWebhook(dropPendingUpdates = false) {
  return telegramRequest("deleteWebhook", {
    drop_pending_updates: Boolean(dropPendingUpdates),
  }).catch(() => null);
}

async function getUpdates(offset) {
  return telegramRequest("getUpdates", {
    offset,
    timeout: config.telegramPollTimeoutSeconds,
    allowed_updates: ["message", "callback_query"],
  });
}

function splitLongMessage(text, maxLen = 3900) {
  const str = String(text || "");
  if (str.length <= maxLen) {
    return [str];
  }

  const lines = str.split("\n");
  const chunks = [];
  let current = "";

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLen && current) {
      chunks.push(current);
      current = line.length > maxLen ? line.slice(0, maxLen) : line;
    } else if (candidate.length > maxLen) {
      for (let i = 0; i < line.length; i += maxLen) {
        chunks.push(line.slice(i, i + maxLen));
      }
      current = "";
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length ? chunks : [str.slice(0, maxLen)];
}

async function sendMessage(chatId, text, options = {}) {
  const parts = splitLongMessage(text, 3900);
  let lastResult = null;

  for (let i = 0; i < parts.length; i += 1) {
    const isLast = i === parts.length - 1;
    const { reply_markup, ...restOptions } = options;
    lastResult = await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: parts[i],
      ...restOptions,
      ...(isLast && reply_markup ? { reply_markup } : {}),
    });
  }

  return lastResult;
}

async function sendVideo(chatId, fileId, caption = "") {
  return telegramRequest("sendVideo", {
    chat_id: chatId,
    video: fileId,
    caption: String(caption || "").slice(0, 1000),
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
    text: String(text || "").slice(0, 190),
  }).catch(() => null);
}

async function deleteMessage(chatId, messageId) {
  return telegramRequest("deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  }).catch(() => null);
}

module.exports = {
  answerCallbackQuery,
  deleteMessage,
  deleteWebhook,
  downloadTelegramFile,
  getFile,
  getUpdates,
  sendChatAction,
  sendMessage,
  sendVideo,
};
