const { Pool } = require("pg");
const { config } = require("./config");

const pool = new Pool({
  connectionString: config.databaseUrl,
});

async function query(text, params = [], client = pool) {
  return client.query(text, params);
}

async function withTransaction(work) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function healthcheck() {
  await pool.query("select 1");
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  query,
  withTransaction,
  healthcheck,
  closePool,
};
