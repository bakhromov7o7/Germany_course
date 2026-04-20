const { query, withTransaction } = require("../db");

function mapDictionaryRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    entry_count: Number(row.entry_count || 0),
  };
}

function normalizeJsonNumberArray(value) {
  return Array.isArray(value)
    ? value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
    : [];
}

function normalizeJsonObjectArray(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
}

async function getDictionaryByIdWithClient(client, dictionaryId) {
  const result = await client.query(
    `
      select
        dictionaries.*,
        coalesce(entry_stats.entry_count, 0) as entry_count
      from dictionaries
      left join (
        select dictionary_id, count(*) as entry_count
        from dictionary_entries
        group by dictionary_id
      ) as entry_stats on entry_stats.dictionary_id = dictionaries.id
      where dictionaries.id = $1
      limit 1
    `,
    [dictionaryId],
  );

  return mapDictionaryRow(result.rows[0] || null);
}

async function insertDictionaryEntries(client, dictionaryId, entries, startOrder = 0) {
  let insertedCount = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const item = entries[index];

    const insertResult = await client.query(
      `
        insert into dictionary_entries (
          dictionary_id,
          german_text,
          uzbek_text,
          entry_order
        )
        values ($1, $2, $3, $4)
        on conflict (dictionary_id, german_text, uzbek_text) do nothing
      `,
      [dictionaryId, item.german, item.uzbek, startOrder + index],
    );

    insertedCount += Number(insertResult.rowCount || 0);
  }

  await client.query(
    `
      update dictionaries
      set updated_at = now()
      where id = $1
    `,
    [dictionaryId],
  );

  return insertedCount;
}

async function getDictionaryById(dictionaryId) {
  return getDictionaryByIdWithClient({ query }, dictionaryId);
}

async function createDictionary({ employeeUserId, title, entries }) {
  return withTransaction(async (client) => {
    const dictionaryResult = await client.query(
      `
        insert into dictionaries (
          employee_user_id,
          title
        )
        values ($1, $2)
        returning *
      `,
      [employeeUserId, title],
    );

    const dictionary = dictionaryResult.rows[0];
    const insertedCount = await insertDictionaryEntries(client, dictionary.id, entries);
    return {
      ...(await getDictionaryByIdWithClient(client, dictionary.id)),
      inserted_count: insertedCount,
    };
  });
}

async function listDictionariesByEmployee(employeeUserId) {
  const result = await query(
    `
      select
        dictionaries.*,
        coalesce(entry_stats.entry_count, 0) as entry_count
      from dictionaries
      left join (
        select dictionary_id, count(*) as entry_count
        from dictionary_entries
        group by dictionary_id
      ) as entry_stats on entry_stats.dictionary_id = dictionaries.id
      where dictionaries.employee_user_id = $1
      order by dictionaries.updated_at desc, dictionaries.id desc
    `,
    [employeeUserId],
  );

  return result.rows.map(mapDictionaryRow);
}

async function getDictionaryByIdForEmployee(dictionaryId, employeeUserId) {
  const result = await query(
    `
      select
        dictionaries.*,
        coalesce(entry_stats.entry_count, 0) as entry_count
      from dictionaries
      left join (
        select dictionary_id, count(*) as entry_count
        from dictionary_entries
        group by dictionary_id
      ) as entry_stats on entry_stats.dictionary_id = dictionaries.id
      where dictionaries.id = $1
        and dictionaries.employee_user_id = $2
      limit 1
    `,
    [dictionaryId, employeeUserId],
  );

  return mapDictionaryRow(result.rows[0] || null);
}

async function addDictionaryEntries({ dictionaryId, entries }) {
  return withTransaction(async (client) => {
    const orderResult = await client.query(
      `
        select coalesce(max(entry_order), -1) as max_order
        from dictionary_entries
        where dictionary_id = $1
      `,
      [dictionaryId],
    );

    const startOrder = Number(orderResult.rows[0]?.max_order || -1) + 1;
    const insertedCount = await insertDictionaryEntries(client, dictionaryId, entries, startOrder);
    return {
      ...(await getDictionaryByIdWithClient(client, dictionaryId)),
      inserted_count: insertedCount,
    };
  });
}

async function replaceDictionaryEntries({ dictionaryId, entries }) {
  return withTransaction(async (client) => {
    await client.query(
      `
        delete from dictionary_entries
        where dictionary_id = $1
      `,
      [dictionaryId],
    );

    const insertedCount = await insertDictionaryEntries(client, dictionaryId, entries);
    return {
      ...(await getDictionaryByIdWithClient(client, dictionaryId)),
      inserted_count: insertedCount,
    };
  });
}

async function deleteDictionary(dictionaryId) {
  const result = await query(
    `
      delete from dictionaries
      where id = $1
      returning *
    `,
    [dictionaryId],
  );

  return result.rows[0] || null;
}

async function listDictionariesForStudent(studentUserId) {
  const result = await query(
    `
      select
        dictionaries.*,
        coalesce(entry_stats.entry_count, 0) as entry_count
      from dictionaries
      left join (
        select dictionary_id, count(*) as entry_count
        from dictionary_entries
        group by dictionary_id
      ) as entry_stats on entry_stats.dictionary_id = dictionaries.id
      order by dictionaries.updated_at desc, dictionaries.id desc
    `,
    [],
  );

  return result.rows.map(mapDictionaryRow);
}

async function getDictionaryByIdForStudent(dictionaryId, studentUserId) {
  const result = await query(
    `
      select
        dictionaries.*,
        coalesce(entry_stats.entry_count, 0) as entry_count
      from dictionaries
      left join (
        select dictionary_id, count(*) as entry_count
        from dictionary_entries
        group by dictionary_id
      ) as entry_stats on entry_stats.dictionary_id = dictionaries.id
      where dictionaries.id = $1
      limit 1
    `,
    [dictionaryId],
  );

  return mapDictionaryRow(result.rows[0] || null);
}

async function getRandomDictionaryEntry({ dictionaryId, excludeEntryId = null }) {
  const result = await query(
    `
      select *
      from dictionary_entries
      where dictionary_id = $1
        and ($2::bigint is null or id <> $2)
      order by random()
      limit 1
    `,
    [dictionaryId, excludeEntryId],
  );

  return result.rows[0] || null;
}

async function getDictionaryEntryById(entryId) {
  const result = await query(
    `
      select *
      from dictionary_entries
      where id = $1
      limit 1
    `,
    [entryId],
  );

  return result.rows[0] || null;
}

async function getDictionarySession(studentUserId) {
  const result = await query(
    `
      select *
      from dictionary_sessions
      where student_user_id = $1
      limit 1
    `,
    [studentUserId],
  );

  const row = result.rows[0] || null;

  if (!row) {
    return null;
  }

  return {
    ...row,
    remaining_entry_ids: normalizeJsonNumberArray(row.remaining_entry_ids),
    preview_message_ids: normalizeJsonNumberArray(row.preview_message_ids),
    total_questions: Number(row.total_questions || 0),
    answered_questions: Number(row.answered_questions || 0),
    correct_answers: Number(row.correct_answers || 0),
    mistakes: normalizeJsonObjectArray(row.mistakes),
  };
}

async function listDictionaryEntries(dictionaryId) {
  const result = await query(
    `
      select *
      from dictionary_entries
      where dictionary_id = $1
      order by entry_order asc, id asc
    `,
    [dictionaryId],
  );

  return result.rows;
}

async function upsertDictionarySession(session) {
  const existing = await getDictionarySession(session.studentUserId);
  const has = (key) => Object.prototype.hasOwnProperty.call(session, key);

  const studentUserId = session.studentUserId;
  const dictionaryId = has("dictionaryId") ? session.dictionaryId : existing?.dictionary_id || null;
  const state = has("state") ? session.state : existing?.state || "idle";
  const currentEntryId = has("currentEntryId") ? session.currentEntryId : existing?.current_entry_id || null;
  const currentDirection = has("currentDirection") ? session.currentDirection : existing?.current_direction || null;
  const attemptsUsed = has("attemptsUsed") ? session.attemptsUsed : Number(existing?.attempts_used || 0);
  const remainingEntryIds = has("remainingEntryIds") ? session.remainingEntryIds : existing?.remaining_entry_ids || [];
  const totalQuestions = has("totalQuestions") ? session.totalQuestions : Number(existing?.total_questions || 0);
  const answeredQuestions = has("answeredQuestions") ? session.answeredQuestions : Number(existing?.answered_questions || 0);
  const correctAnswers = has("correctAnswers") ? session.correctAnswers : Number(existing?.correct_answers || 0);
  const mistakes = has("mistakes") ? session.mistakes : existing?.mistakes || [];
  const activeAttemptStartedAt = has("activeAttemptStartedAt")
    ? session.activeAttemptStartedAt
    : existing?.active_attempt_started_at || null;
  const previewMessageIds = has("previewMessageIds") ? session.previewMessageIds : existing?.preview_message_ids || [];

  const result = await query(
    `
      insert into dictionary_sessions (
        student_user_id,
        dictionary_id,
        state,
        current_entry_id,
        current_direction,
        attempts_used,
        remaining_entry_ids,
        total_questions,
        answered_questions,
        correct_answers,
        mistakes,
        active_attempt_started_at,
        preview_message_ids
      )
      values ($1, $2, $3::dictionary_session_state, $4, $5::dictionary_direction, $6, $7::jsonb, $8, $9, $10, $11::jsonb, $12, $13::jsonb)
      on conflict (student_user_id)
      do update set
        dictionary_id = excluded.dictionary_id,
        state = excluded.state,
        current_entry_id = excluded.current_entry_id,
        current_direction = excluded.current_direction,
        attempts_used = excluded.attempts_used,
        remaining_entry_ids = excluded.remaining_entry_ids,
        total_questions = excluded.total_questions,
        answered_questions = excluded.answered_questions,
        correct_answers = excluded.correct_answers,
        mistakes = excluded.mistakes,
        active_attempt_started_at = excluded.active_attempt_started_at,
        preview_message_ids = excluded.preview_message_ids,
        updated_at = now()
      returning *
    `,
    [
      studentUserId,
      dictionaryId,
      state,
      currentEntryId,
      currentDirection,
      attemptsUsed,
      JSON.stringify(remainingEntryIds),
      totalQuestions,
      answeredQuestions,
      correctAnswers,
      JSON.stringify(mistakes),
      activeAttemptStartedAt,
      JSON.stringify(previewMessageIds),
    ],
  );

  return getDictionarySession(studentUserId);
}

async function clearDictionarySession(studentUserId) {
  return upsertDictionarySession({
    studentUserId,
    dictionaryId: null,
    state: "idle",
    currentEntryId: null,
    currentDirection: null,
    attemptsUsed: 0,
    remainingEntryIds: [],
    totalQuestions: 0,
    answeredQuestions: 0,
    correctAnswers: 0,
    mistakes: [],
    activeAttemptStartedAt: null,
    previewMessageIds: [],
  });
}

module.exports = {
  addDictionaryEntries,
  clearDictionarySession,
  createDictionary,
  deleteDictionary,
  getDictionaryById,
  getDictionaryByIdForEmployee,
  getDictionaryByIdForStudent,
  getDictionaryEntryById,
  getDictionarySession,
  getRandomDictionaryEntry,
  listDictionariesByEmployee,
  listDictionariesForStudent,
  listDictionaryEntries,
  replaceDictionaryEntries,
  upsertDictionarySession,
};
