const { config } = require("./config");
const { healthcheck, closePool } = require("./db");
const { startServer } = require("./api");
const { UstozBot } = require("./bot");
const { bootstrapDatabase } = require("./scripts/seed");
const { hasOpenAi } = require("./services/openai-service");

async function main() {
  console.log("Initializing LernFreund (Ustoz AI) Backend & Telegram Bot...");

  await healthcheck();
  await bootstrapDatabase();

  console.log(`OpenAI/Groq AI configured: ${hasOpenAi() ? "yes" : "no"}`);

  await startServer();

  if (config.telegramBotToken) {
    const bot = new UstozBot();
    bot.start().catch((error) => {
      console.error("Telegram Bot error:", error);
    });
  } else {
    console.warn("TELEGRAM_BOT_TOKEN not set — Telegram Bot polling skipped.");
  }
}

main().catch(async (error) => {
  console.error("Fatal error during startup:", error);
  await closePool();
  process.exit(1);
});
