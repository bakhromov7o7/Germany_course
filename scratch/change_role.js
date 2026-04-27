const { pool } = require('../src/db');

async function changeRole() {
  try {
    await pool.query("UPDATE users SET role = 'employee' WHERE role = 'superadmin'");
    console.log("Updated all superadmins to employee.");
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

changeRole();
