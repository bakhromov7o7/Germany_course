const { query, withTransaction } = require("../db");

async function createQuizAttempt({ studentUserId, topicId, employeeUserId, questions }) {
  return withTransaction(async (client) => {
    const attemptResult = await client.query(
      `
        insert into quiz_attempts (
          student_user_id,
          topic_id,
          employee_user_id,
          total_questions
        )
        values ($1, $2, $3, $4)
        returning *
      `,
      [studentUserId, topicId, employeeUserId, questions.length],
    );

    const attempt = attemptResult.rows[0];

    for (let index = 0; index < questions.length; index += 1) {
      const item = questions[index];

      await client.query(
        `
          insert into quiz_questions (
            quiz_attempt_id,
            question_order,
            question_text,
            expected_answer
          )
          values ($1, $2, $3, $4)
        `,
        [attempt.id, index + 1, item.question, item.answer],
      );
    }

    return attempt;
  });
}

async function getAttemptById(attemptId) {
  const result = await query("select * from quiz_attempts where id = $1 limit 1", [attemptId]);
  return result.rows[0] || null;
}

async function getNextUnansweredQuestion(quizAttemptId) {
  const result = await query(
    `
      select *
      from quiz_questions
      where quiz_attempt_id = $1
        and student_answer is null
      order by question_order asc
      limit 1
    `,
    [quizAttemptId],
  );

  return result.rows[0] || null;
}

async function saveQuestionAnswer({ questionId, studentAnswer, isCorrect, feedbackText }) {
  const result = await query(
    `
      update quiz_questions
      set
        student_answer = $2,
        is_correct = $3,
        feedback_text = $4,
        checked_at = now()
      where id = $1
      returning *
    `,
    [questionId, studentAnswer, isCorrect, feedbackText || null],
  );

  return result.rows[0] || null;
}

async function finalizeAttempt(quizAttemptId) {
  const result = await query(
    `
      update quiz_attempts
      set
        correct_answers = (
          select count(*)
          from quiz_questions
          where quiz_attempt_id = $1
            and is_correct = true
        ),
        finished_at = now()
      where id = $1
      returning *
    `,
    [quizAttemptId],
  );

  return result.rows[0] || null;
}

async function markReportSent(quizAttemptId) {
  const result = await query(
    `
      update quiz_attempts
      set report_sent_at = now()
      where id = $1
      returning *
    `,
    [quizAttemptId],
  );

  return result.rows[0] || null;
}

async function getAttemptSummary(quizAttemptId) {
  const attemptResult = await query(
    `
      select
        quiz_attempts.*,
        topics.title as topic_title,
        students.full_name as student_full_name,
        students.telegram_user_id as student_telegram_user_id,
        employees.full_name as employee_full_name,
        employees.telegram_user_id as employee_telegram_user_id
      from quiz_attempts
      join topics on topics.id = quiz_attempts.topic_id
      join users as students on students.id = quiz_attempts.student_user_id
      join users as employees on employees.id = quiz_attempts.employee_user_id
      where quiz_attempts.id = $1
      limit 1
    `,
    [quizAttemptId],
  );

  const questionsResult = await query(
    `
      select *
      from quiz_questions
      where quiz_attempt_id = $1
      order by question_order asc
    `,
    [quizAttemptId],
  );

  return {
    attempt: attemptResult.rows[0] || null,
    questions: questionsResult.rows,
  };
}

async function listRecentQuizResultsForEmployee(employeeUserId, limit = 8) {
  const result = await query(
    `
      select
        quiz_attempts.*,
        students.full_name as student_full_name,
        topics.title as topic_title,
        round((quiz_attempts.correct_answers::numeric / nullif(quiz_attempts.total_questions, 0)) * 100, 1) as percent
      from quiz_attempts
      join users as students on students.id = quiz_attempts.student_user_id
      join topics on topics.id = quiz_attempts.topic_id
      where quiz_attempts.employee_user_id = $1
        and quiz_attempts.finished_at is not null
      order by quiz_attempts.finished_at desc, quiz_attempts.id desc
      limit $2
    `,
    [employeeUserId, limit],
  );

  return result.rows;
}

async function listEmployeeStudentStats(employeeUserId) {
  const result = await query(
    `
      with managed_students as (
        select users.id, users.full_name, users.telegram_user_id
        from users
        where users.created_by_user_id = $1
          and users.role = 'student'
          and users.is_active = true

        union

        select students.id, students.full_name, students.telegram_user_id
        from student_topic_access
        join topics on topics.id = student_topic_access.topic_id
        join users as students on students.id = student_topic_access.student_user_id
        where topics.employee_user_id = $1
          and students.role = 'student'
          and students.is_active = true
      )
      select
        managed_students.id,
        managed_students.full_name,
        managed_students.telegram_user_id,
        count(quiz_attempts.id) as attempt_count,
        coalesce(sum(quiz_attempts.correct_answers), 0) as correct_answers,
        coalesce(sum(quiz_attempts.total_questions), 0) as total_answers,
        round(
          case
            when coalesce(sum(quiz_attempts.total_questions), 0) = 0 then 0
            else (coalesce(sum(quiz_attempts.correct_answers), 0)::numeric / sum(quiz_attempts.total_questions)) * 100
          end,
          1
        ) as avg_percent,
        max(quiz_attempts.finished_at) as last_finished_at
      from managed_students
      left join quiz_attempts on quiz_attempts.student_user_id = managed_students.id
        and quiz_attempts.employee_user_id = $1
        and quiz_attempts.finished_at is not null
      group by managed_students.id, managed_students.full_name, managed_students.telegram_user_id
      order by avg_percent asc, attempt_count desc, managed_students.full_name asc
    `,
    [employeeUserId],
  );

  return result.rows;
}

async function listStudentMistakes({ studentUserId, topicId = null, limit = 5 }) {
  const result = await query(
    `
      select
        quiz_questions.id,
        quiz_questions.question_text,
        quiz_questions.expected_answer,
        quiz_questions.student_answer,
        quiz_questions.feedback_text,
        quiz_attempts.topic_id,
        topics.title as topic_title,
        quiz_attempts.finished_at
      from quiz_questions
      join quiz_attempts on quiz_attempts.id = quiz_questions.quiz_attempt_id
      join topics on topics.id = quiz_attempts.topic_id
      where quiz_attempts.student_user_id = $1
        and quiz_questions.is_correct = false
        and ($2::bigint is null or quiz_attempts.topic_id = $2)
      order by quiz_attempts.finished_at desc nulls last, quiz_questions.id desc
      limit $3
    `,
    [studentUserId, topicId, limit],
  );

  return result.rows;
}

module.exports = {
  createQuizAttempt,
  finalizeAttempt,
  getAttemptById,
  getAttemptSummary,
  getNextUnansweredQuestion,
  listEmployeeStudentStats,
  listRecentQuizResultsForEmployee,
  listStudentMistakes,
  markReportSent,
  saveQuestionAnswer,
};
