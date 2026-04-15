const { healthcheck, closePool } = require("./db");
const { UstozBot } = require("./bot");

async function main() {
  await healthcheck();
  const bot = new UstozBot();
  await bot.start();
}

main().catch(async (error) => {
  console.error("Fatal error:", error);
  await closePool();
  process.exit(1);
});
