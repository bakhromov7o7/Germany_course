function getRequiredString(name) {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

function getOptionalString(name, fallback = "") {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function getOptionalNumber(name, fallback) {
  const raw = process.env[name];

  if (!raw || !raw.trim()) {
    return fallback;
  }

  const value = Number(raw);

  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }

  return value;
}

const config = {
  telegramBotToken: getRequiredString("TELEGRAM_BOT_TOKEN"),
  telegramApiBase: getOptionalString("TELEGRAM_API_BASE", "https://api.telegram.org"),
  telegramPollTimeoutSeconds: getOptionalNumber("TELEGRAM_POLL_TIMEOUT_SECONDS", 30),
  telegramDownloadLimitBytes: getOptionalNumber("TELEGRAM_DOWNLOAD_LIMIT_BYTES", 20 * 1024 * 1024),
  databaseUrl: getRequiredString("DATABASE_URL"),
  groqApiKey: getOptionalString("GROQ_API_KEY"),
  openAiApiKey: getOptionalString("OPENAI_API_KEY"),
  openAiApiBase: getOptionalString("OPENAI_API_BASE", "https://api.groq.com/openai/v1"),
  openAiModel: getOptionalString("OPENAI_MODEL", "openai/gpt-oss-20b"),
  transcriptionModel: getOptionalString("TRANSCRIPTION_MODEL", "whisper-large-v3-turbo"),
  superadminTelegramId: getOptionalNumber("SUPERADMIN_TELEGRAM_ID", 0),
  topicContextChunkLimit: getOptionalNumber("TOPIC_CONTEXT_CHUNK_LIMIT", 6),
  topicSourceSnippetLimit: getOptionalNumber("TOPIC_SOURCE_SNIPPET_LIMIT", 2),
  quizQuestionCount: getOptionalNumber("QUIZ_QUESTION_COUNT", 5),
  studentMistakeLimit: getOptionalNumber("STUDENT_MISTAKE_LIMIT", 5),
  weakStudentThresholdPercent: getOptionalNumber("WEAK_STUDENT_THRESHOLD_PERCENT", 70),
  pollRetryDelayMs: getOptionalNumber("POLL_RETRY_DELAY_MS", 4000),
};

module.exports = {
  config,
};
