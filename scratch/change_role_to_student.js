const { pool } = require('../src/db');

async function makeStudent() {
  try {
    await pool.query("UPDATE users SET role = 'student'");
    console.log("Updated all users to student.");
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

makeStudent();
