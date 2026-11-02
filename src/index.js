const { healthcheck, closePool } = require("./db");
const { startServer } = require("./api");
const { bootstrapDatabase } = require("./scripts/seed");
const { hasOpenAi } = require("./services/openai-service");

async function main() {
  console.log("Initializing Ustoz AI Backend API...");

  await healthcheck();
  await bootstrapDatabase();

  console.log(`OpenAI/Groq AI configured: ${hasOpenAi() ? "yes" : "no"}`);

  await startServer();
}

main().catch(async (error) => {
  console.error("Fatal error during startup:", error);
  await closePool();
  process.exit(1);
});
