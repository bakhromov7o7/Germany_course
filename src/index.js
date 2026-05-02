const { healthcheck, closePool } = require("./db");
const { UstozBot } = require("./bot");
const { startServer } = require("./api");

async function main() {
  console.log("Initializing Germanybot system...");
  
  await healthcheck();
  
  // Start API Server
  await startServer();
  
  // Start Telegram Bot
  const bot = new UstozBot();
  await bot.start();
}

main().catch(async (error) => {
  console.error("Fatal error during startup:", error);
  await closePool();
  process.exit(1);
});
