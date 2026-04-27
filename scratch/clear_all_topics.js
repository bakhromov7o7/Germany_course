
const { pool } = require('../src/db');

async function clearTopics() {
  try {
    await pool.query('BEGIN');
    
    console.log("Deleting knowledge_chunks...");
    await pool.query('DELETE FROM knowledge_chunks;');
    
    console.log("Deleting topic_materials...");
    await pool.query('DELETE FROM topic_materials;');
    
    console.log("Deleting student_topic_access...");
    await pool.query('DELETE FROM student_topic_access;');
    
    console.log("Deleting quiz_questions...");
    await pool.query('DELETE FROM quiz_questions;');
    
    console.log("Deleting quiz_attempts...");
    await pool.query('DELETE FROM quiz_attempts;');
    
    console.log("Clearing topic references in user_states...");
    await pool.query('UPDATE user_states SET active_topic_id = NULL, pending_topic_id = NULL;');
    
    console.log("Clearing topic references in student_sessions...");
    await pool.query('UPDATE student_sessions SET topic_id = NULL;');
    
    console.log("Deleting topics...");
    const res = await pool.query('DELETE FROM topics;');
    
    await pool.query('COMMIT');
    console.log(`Successfully deleted ${res.rowCount} topics.`);
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error("Error clearing topics:", error);
  } finally {
    await pool.end();
  }
}

clearTopics();
