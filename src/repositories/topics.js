const { query } = require("../db");

async function createTopic({ employeeUserId, title, description, status = "active" }) {
  const result = await query(
    `
      insert into topics (employee_user_id, title, description, status)
      values ($1, $2, $3, $4)
      returning *
    `,
    [employeeUserId, title, description || null, status],
  );

  return result.rows[0];
}

async function updateTopic(topicId, { title, description, status }) {
  const result = await query(
    `
      update topics
      set title = coalesce($2, title),
          description = coalesce($3, description),
          status = coalesce($4, status),
          updated_at = now()
      where id = $1
      returning *
    `,
    [topicId, title, description, status],
  );
  return result.rows[0] || null;
}

async function deleteTopic(topicId) {
  await query("update user_states set active_topic_id = null where active_topic_id = $1", [topicId]);
  await query("update user_states set pending_topic_id = null where pending_topic_id = $1", [topicId]);
  await query(
    "update student_sessions set active_quiz_attempt_id = null where active_quiz_attempt_id in (select id from quiz_attempts where topic_id = $1)",
    [topicId],
  );
  await query("delete from student_sessions where topic_id = $1", [topicId]);
  await query(
    "delete from quiz_questions where quiz_attempt_id in (select id from quiz_attempts where topic_id = $1)",
    [topicId],
  );
  await query("delete from quiz_attempts where topic_id = $1", [topicId]);
  await query("delete from knowledge_chunks where topic_id = $1", [topicId]);
  await query("delete from topic_materials where topic_id = $1", [topicId]);
  await query("delete from student_topic_access where topic_id = $1", [topicId]);
  await query("delete from topics where id = $1", [topicId]);
}

async function listTopicsByEmployee(_employeeUserId) {
  const result = await query(
    `
      select *
      from topics
      order by id desc
    `,
  );

  return result.rows;
}

async function listTopicsByEmployeeWithStats(_employeeUserId) {
  const result = await query(
    `
      select
        topics.*,
        users.full_name as creator_name,
        coalesce(material_stats.material_count, 0)::int as material_count,
        coalesce(material_stats.video_count, 0)::int as video_count,
        coalesce(material_stats.text_count, 0)::int as text_count,
        coalesce(material_stats.transcript_count, 0)::int as transcript_count,
        coalesce(chunk_stats.chunk_count, 0)::int as chunk_count,
        coalesce(student_stats.student_count, 0)::int as student_count,
        coalesce(quiz_stats.quiz_count, 0)::int as quiz_count,
        coalesce(quiz_stats.avg_percent, 0)::float as avg_percent
      from topics
      left join users on users.id = topics.employee_user_id
      left join (
        select
          topic_id,
          count(*) as material_count,
          count(*) filter (where material_type = 'video') as video_count,
          count(*) filter (where material_type = 'text') as text_count,
          count(*) filter (where material_type = 'transcript') as transcript_count
        from topic_materials
        group by topic_id
      ) as material_stats on material_stats.topic_id = topics.id
      left join (
        select
          topic_id,
          count(*) as chunk_count
        from knowledge_chunks
        group by topic_id
      ) as chunk_stats on chunk_stats.topic_id = topics.id
      left join (
        select
          topic_id,
          count(*) as student_count
        from student_topic_access
        group by topic_id
      ) as student_stats on student_stats.topic_id = topics.id
      left join (
        select
          topic_id,
          count(*) as quiz_count,
          round(avg((correct_answers::numeric / nullif(total_questions, 0)) * 100), 1) as avg_percent
        from quiz_attempts
        where finished_at is not null
        group by topic_id
      ) as quiz_stats on quiz_stats.topic_id = topics.id
      order by topics.id desc
    `,
  );

  return result.rows;
}

async function getTopicById(topicId) {
  const result = await query(
    `
      select
        topics.*,
        users.full_name as creator_name
      from topics
      left join users on users.id = topics.employee_user_id
      where topics.id = $1
      limit 1
    `,
    [topicId],
  );

  return result.rows[0] || null;
}

async function getTopicByIdForEmployee(topicId, _employeeUserId) {
  return getTopicById(topicId);
}

async function assignTopicToStudent({ studentUserId, topicId, assignedByUserId }) {
  const result = await query(
    `
      insert into student_topic_access (student_user_id, topic_id, assigned_by_user_id)
      values ($1, $2, $3)
      on conflict (student_user_id, topic_id)
      do update set
        assigned_by_user_id = excluded.assigned_by_user_id,
        assigned_at = now()
      returning *
    `,
    [studentUserId, topicId, assignedByUserId],
  );

  return result.rows[0];
}

async function listTopicsForStudent() {
  const result = await query(
    `
      select
        topics.*,
        coalesce(material_stats.material_count, 0)::int as material_count,
        coalesce(chunk_stats.chunk_count, 0)::int as chunk_count
      from topics
      left join (
        select topic_id, count(*) as material_count
        from topic_materials
        group by topic_id
      ) as material_stats on material_stats.topic_id = topics.id
      left join (
        select topic_id, count(*) as chunk_count
        from knowledge_chunks
        group by topic_id
      ) as chunk_stats on chunk_stats.topic_id = topics.id
      where topics.status = 'active'
      order by topics.id desc
    `,
  );

  return result.rows;
}

async function studentHasTopicAccess(_studentUserId, topicId) {
  const result = await query(
    `
      select 1
      from topics
      where id = $1
        and status = 'active'
      limit 1
    `,
    [topicId],
  );

  return Boolean(result.rows[0]);
}

module.exports = {
  assignTopicToStudent,
  createTopic,
  updateTopic,
  deleteTopic,
  getTopicById,
  getTopicByIdForEmployee,
  listTopicsByEmployee,
  listTopicsByEmployeeWithStats,
  listTopicsForStudent,
  studentHasTopicAccess,
};
