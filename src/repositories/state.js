const { query } = require("../db");

async function getUserState(userId) {
  const result = await query("select * from user_states where user_id = $1 limit 1", [userId]);
  return result.rows[0] || null;
}

async function setPendingAction({ userId, pendingAction, pendingTopicId, pendingTitle, pendingPayload = {} }) {
  const result = await query(
    `
      insert into user_states (
        user_id,
        pending_action,
        pending_topic_id,
        pending_title,
        pending_payload
      )
      values ($1, $2, $3, $4, $5::jsonb)
      on conflict (user_id)
      do update set
        pending_action = excluded.pending_action,
        pending_topic_id = excluded.pending_topic_id,
        pending_title = excluded.pending_title,
        pending_payload = excluded.pending_payload,
        updated_at = now()
      returning *
    `,
    [userId, pendingAction, pendingTopicId || null, pendingTitle || null, JSON.stringify(pendingPayload)],
  );

  return result.rows[0];
}

async function clearPendingAction(userId) {
  const result = await query(
    `
      insert into user_states (user_id)
      values ($1)
      on conflict (user_id)
      do update set
        pending_action = null,
        pending_topic_id = null,
        pending_title = null,
        pending_payload = '{}'::jsonb,
        updated_at = now()
      returning *
    `,
    [userId],
  );

  return result.rows[0];
}

async function setActiveTopic(userId, topicId) {
  const result = await query(
    `
      insert into user_states (user_id, active_topic_id)
      values ($1, $2)
      on conflict (user_id)
      do update set
        active_topic_id = excluded.active_topic_id,
        updated_at = now()
      returning *
    `,
    [userId, topicId || null],
  );

  return result.rows[0];
}

async function setPreferredLanguage(userId, preferredLanguage) {
  const result = await query(
    `
      insert into user_states (user_id, preferred_language)
      values ($1, $2)
      on conflict (user_id)
      do update set
        preferred_language = excluded.preferred_language,
        updated_at = now()
      returning *
    `,
    [userId, preferredLanguage],
  );

  return result.rows[0];
}

async function getStudentSession(studentUserId) {
  const result = await query(
    `
      select *
      from student_sessions
      where student_user_id = $1
      limit 1
    `,
    [studentUserId],
  );

  return result.rows[0] || null;
}

async function upsertStudentSession({
  studentUserId,
  topicId,
  state,
  activeQuizAttemptId = null,
  questionCount = 0,
  lastUserMessage = null,
}) {
  const result = await query(
    `
      insert into student_sessions (
        student_user_id,
        topic_id,
        state,
        active_quiz_attempt_id,
        question_count,
        last_user_message
      )
      values ($1, $2, $3, $4, $5, $6)
      on conflict (student_user_id)
      do update set
        topic_id = excluded.topic_id,
        state = excluded.state,
        active_quiz_attempt_id = excluded.active_quiz_attempt_id,
        question_count = excluded.question_count,
        last_user_message = excluded.last_user_message,
        updated_at = now()
      returning *
    `,
    [studentUserId, topicId || null, state, activeQuizAttemptId, questionCount, lastUserMessage],
  );

  return result.rows[0];
}

module.exports = {
  clearPendingAction,
  getStudentSession,
  getUserState,
  setActiveTopic,
  setPreferredLanguage,
  setPendingAction,
  upsertStudentSession,
};
