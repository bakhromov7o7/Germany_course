const fs = require("fs/promises");
const path = require("path");
const { pool } = require("../db");

async function run() {
  const schemaPath = path.resolve(__dirname, "../../db/schema.sql");
  const sql = await fs.readFile(schemaPath, "utf8");
  await pool.query(sql);
  console.log("Database schema applied.");
  await pool.end();
}

run().catch(async (error) => {
  console.error("Migration failed:", error);
  await pool.end();
  process.exit(1);
});
