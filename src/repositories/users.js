const { query } = require("../db");

async function findById(userId) {
  const result = await query("select * from users where id = $1 limit 1", [userId]);
  return result.rows[0] || null;
}

async function findByTelegramUserId(telegramUserId) {
  const result = await query("select * from users where telegram_user_id = $1 limit 1", [telegramUserId]);
  return result.rows[0] || null;
}

async function findAnySuperadmin() {
  const result = await query("select * from users where role = 'superadmin' order by id asc limit 1");
  return result.rows[0] || null;
}

async function ensureSuperadmin({ telegramUserId, fullName, username }) {
  const result = await query(
    `
      insert into users (
        telegram_user_id,
        full_name,
        username,
        role,
        is_active
      )
      values ($1, $2, $3, 'superadmin', true)
      on conflict (telegram_user_id)
      do update set
        full_name = excluded.full_name,
        username = excluded.username,
        role = 'superadmin',
        is_active = true,
        updated_at = now()
      returning *
    `,
    [telegramUserId, fullName, username || null],
  );

  return result.rows[0];
}

async function touchKnownUser({ telegramUserId, fullName, username }) {
  const result = await query(
    `
      update users
      set
        full_name = $2,
        username = $3,
        updated_at = now()
      where telegram_user_id = $1
      returning *
    `,
    [telegramUserId, fullName, username || null],
  );

  return result.rows[0] || null;
}

async function createManagedUser({ telegramUserId, fullName, username, role, createdByUserId }) {
  const result = await query(
    `
      insert into users (
        telegram_user_id,
        full_name,
        username,
        role,
        created_by_user_id,
        is_active
      )
      values ($1, $2, $3, $4, $5, true)
      on conflict (telegram_user_id)
      do update set
        full_name = excluded.full_name,
        username = excluded.username,
        role = case
          when users.role = 'superadmin' then users.role
          else excluded.role
        end,
        created_by_user_id = coalesce(users.created_by_user_id, excluded.created_by_user_id),
        is_active = true,
        updated_at = now()
      returning *
    `,
    [telegramUserId, fullName, username || null, role, createdByUserId],
  );

  return result.rows[0];
}

async function listManagedUsersByRole({ createdByUserId, role }) {
  const result = await query(
    `
      select *
      from users
      where created_by_user_id = $1
        and role = $2
        and is_active = true
      order by full_name asc, id asc
    `,
    [createdByUserId, role],
  );

  return result.rows;
}

async function listAccessibleStudentsForEmployee(_employeeUserId) {
  const result = await query(
    `
      select id, full_name, telegram_user_id
      from users
      where role = 'student'
        and is_active = true
      order by full_name asc, id asc
    `
  );

  return result.rows;
}

async function ensureStudent({ telegramUserId, fullName, username }) {
  const result = await query(
    `
      insert into users (
        telegram_user_id,
        full_name,
        username,
        role,
        is_active
      )
      values ($1, $2, $3, 'student', true)
      on conflict (telegram_user_id)
      do update set
        full_name = excluded.full_name,
        username = excluded.username,
        is_active = true,
        updated_at = now()
      returning *
    `,
    [telegramUserId, fullName, username || null],
  );

  return result.rows[0];
}

async function listStaffMembers() {
  const result = await query(
    "select * from users where role in ('employee', 'superadmin') and is_active = true"
  );
  return result.rows;
}

module.exports = {
  createManagedUser,
  ensureStudent,
  ensureSuperadmin,
  findAnySuperadmin,
  findById,
  findByTelegramUserId,
  listAccessibleStudentsForEmployee,
  listManagedUsersByRole,
  listStaffMembers,
  touchKnownUser,
};
