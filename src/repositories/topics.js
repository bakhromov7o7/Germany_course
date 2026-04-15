const { query } = require("../db");

async function createTopic({ employeeUserId, title, description }) {
  const result = await query(
    `
      insert into topics (employee_user_id, title, description, status)
      values ($1, $2, $3, 'active')
      returning *
    `,
    [employeeUserId, title, description || null],
  );

  return result.rows[0];
}

async function listTopicsByEmployee(employeeUserId) {
  const result = await query(
    `
      select *
      from topics
      where employee_user_id = $1
      order by id desc
    `,
    [employeeUserId],
  );

  return result.rows;
}

async function listTopicsByEmployeeWithStats(employeeUserId) {
  const result = await query(
    `
      select
        topics.*,
        coalesce(material_stats.material_count, 0) as material_count,
        coalesce(material_stats.video_count, 0) as video_count,
        coalesce(material_stats.text_count, 0) as text_count,
        coalesce(material_stats.transcript_count, 0) as transcript_count,
        coalesce(chunk_stats.chunk_count, 0) as chunk_count,
        coalesce(student_stats.student_count, 0) as student_count,
        coalesce(quiz_stats.quiz_count, 0) as quiz_count,
        coalesce(quiz_stats.avg_percent, 0) as avg_percent
      from topics
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
      where topics.employee_user_id = $1
      order by topics.id desc
    `,
    [employeeUserId],
  );

  return result.rows;
}

async function getTopicById(topicId) {
  const result = await query(
    `
      select *
      from topics
      where id = $1
      limit 1
    `,
    [topicId],
  );

  return result.rows[0] || null;
}

async function getTopicByIdForEmployee(topicId, employeeUserId) {
  const result = await query(
    `
      select *
      from topics
      where id = $1
        and employee_user_id = $2
      limit 1
    `,
    [topicId, employeeUserId],
  );

  return result.rows[0] || null;
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

async function listTopicsForStudent(studentUserId) {
  const result = await query(
    `
      select topics.*
      from student_topic_access
      join topics on topics.id = student_topic_access.topic_id
      where student_topic_access.student_user_id = $1
        and topics.status = 'active'
      order by topics.id desc
    `,
    [studentUserId],
  );

  return result.rows;
}

async function studentHasTopicAccess(studentUserId, topicId) {
  const result = await query(
    `
      select 1
      from student_topic_access
      where student_user_id = $1
        and topic_id = $2
      limit 1
    `,
    [studentUserId, topicId],
  );

  return Boolean(result.rows[0]);
}

module.exports = {
  assignTopicToStudent,
  createTopic,
  getTopicById,
  getTopicByIdForEmployee,
  listTopicsByEmployee,
  listTopicsByEmployeeWithStats,
  listTopicsForStudent,
  studentHasTopicAccess,
};
