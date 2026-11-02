const { query } = require("../db");
const { hashPassword } = require("../utils/password");

function sanitizeUser(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return rest;
}

function normalizeUsername(username) {
  const cleaned = String(username || "").trim().replace(/^@+/, "");
  return cleaned ? cleaned : null;
}

async function resolveSafeUsername(username, telegramUserId = null, userId = null) {
  const clean = normalizeUsername(username);
  if (!clean) return null;

  const conflict = await query(
    `
      select id, telegram_user_id
      from users
      where lower(username) = lower($1)
      limit 1
    `,
    [clean],
  );

  if (!conflict.rows[0]) {
    return clean;
  }

  const row = conflict.rows[0];
  if (
    (telegramUserId && String(row.telegram_user_id) === String(telegramUserId)) ||
    (userId && String(row.id) === String(userId))
  ) {
    return clean;
  }

  return null;
}

async function findById(userId) {
  const result = await query("select * from users where id = $1 limit 1", [userId]);
  return sanitizeUser(result.rows[0] || null);
}

async function findByIdWithPassword(userId) {
  const result = await query("select * from users where id = $1 limit 1", [userId]);
  return result.rows[0] || null;
}

async function findByTelegramUserId(telegramUserId) {
  if (!telegramUserId) return null;
  const result = await query("select * from users where telegram_user_id = $1 limit 1", [telegramUserId]);
  return sanitizeUser(result.rows[0] || null);
}

async function findAnySuperadmin() {
  const result = await query(
    "select * from users where role = 'superadmin' and telegram_user_id is not null order by id asc limit 1",
  );
  return sanitizeUser(result.rows[0] || null);
}

async function ensureSuperadmin({ telegramUserId, fullName, username }) {
  const safeUsername = await resolveSafeUsername(username, telegramUserId);
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
        username = coalesce(excluded.username, users.username),
        role = 'superadmin',
        is_active = true,
        updated_at = now()
      returning *
    `,
    [telegramUserId, String(fullName || "Superadmin").trim(), safeUsername],
  );

  return sanitizeUser(result.rows[0]);
}

async function touchKnownUser({ telegramUserId, fullName, username }) {
  const safeUsername = await resolveSafeUsername(username, telegramUserId);
  const result = await query(
    `
      update users
      set
        full_name = coalesce(nullif($2, ''), full_name),
        username = coalesce($3, username),
        updated_at = now()
      where telegram_user_id = $1
      returning *
    `,
    [telegramUserId, String(fullName || "").trim(), safeUsername],
  );

  return sanitizeUser(result.rows[0] || null);
}

async function createManagedUser({ telegramUserId, fullName, username, role, createdByUserId }) {
  const safeUsername = await resolveSafeUsername(username, telegramUserId);
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
      values ($1, $2, $3, $4::user_role, $5, true)
      on conflict (telegram_user_id)
      do update set
        full_name = excluded.full_name,
        username = coalesce(excluded.username, users.username),
        role = case
          when users.role = 'superadmin' then users.role
          else excluded.role
        end,
        created_by_user_id = coalesce(users.created_by_user_id, excluded.created_by_user_id),
        is_active = true,
        updated_at = now()
      returning *
    `,
    [telegramUserId, String(fullName || "Foydalanuvchi").trim(), safeUsername, role, createdByUserId || null],
  );

  return sanitizeUser(result.rows[0]);
}

async function ensureStudent({ telegramUserId, fullName, username }) {
  const safeUsername = await resolveSafeUsername(username, telegramUserId);
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
        username = coalesce(excluded.username, users.username),
        is_active = true,
        updated_at = now()
      returning *
    `,
    [telegramUserId, String(fullName || "Student").trim(), safeUsername],
  );

  return sanitizeUser(result.rows[0]);
}

async function listManagedUsersByRole({ role = "student" } = {}) {
  const result = await query(
    `
      select *
      from users
      where role = $1::user_role
        and is_active = true
      order by full_name asc, id asc
    `,
    [role],
  );

  return result.rows.map(sanitizeUser);
}

async function findByLogin(login) {
  const normalized = String(login || "").trim();
  if (!normalized) return null;

  const result = await query(
    `
      select *
      from users
      where lower(username) = lower($1)
         or phone = $1
      limit 1
    `,
    [normalized],
  );
  return result.rows[0] || null;
}

async function createUser({
  fullName,
  username,
  phone,
  password,
  role = "student",
  createdByUserId = null,
}) {
  const cleanUsername = normalizeUsername(username)?.toLowerCase() || null;
  const cleanPhone = phone ? String(phone).trim() : null;
  const passwordHash = password ? hashPassword(password) : null;

  const result = await query(
    `
      insert into users (
        full_name,
        username,
        phone,
        password_hash,
        role,
        created_by_user_id,
        is_active
      )
      values ($1, $2, $3, $4, $5::user_role, $6, true)
      returning *
    `,
    [
      String(fullName).trim(),
      cleanUsername,
      cleanPhone,
      passwordHash,
      role,
      createdByUserId,
    ],
  );

  return sanitizeUser(result.rows[0]);
}

async function updateUser(
  userId,
  { fullName, username, phone, password, role, isActive },
) {
  const existing = await findByIdWithPassword(userId);
  if (!existing) return null;

  const nextFullName =
    fullName !== undefined ? String(fullName).trim() : existing.full_name;
  const nextUsername =
    username !== undefined
      ? username
        ? normalizeUsername(username)?.toLowerCase() || null
        : null
      : existing.username;
  const nextPhone =
    phone !== undefined
      ? phone
        ? String(phone).trim()
        : null
      : existing.phone;
  const nextPasswordHash =
    password !== undefined && String(password).trim()
      ? hashPassword(password)
      : existing.password_hash;
  const nextRole = role !== undefined ? role : existing.role;
  const nextIsActive =
    isActive !== undefined ? Boolean(isActive) : existing.is_active;

  const result = await query(
    `
      update users
      set
        full_name = $2,
        username = $3,
        phone = $4,
        password_hash = $5,
        role = $6::user_role,
        is_active = $7,
        updated_at = now()
      where id = $1
      returning *
    `,
    [
      userId,
      nextFullName,
      nextUsername,
      nextPhone,
      nextPasswordHash,
      nextRole,
      nextIsActive,
    ],
  );

  return sanitizeUser(result.rows[0] || null);
}

async function deleteUser(userId) {
  await query("delete from user_states where user_id = $1", [userId]);
  await query("delete from student_sessions where student_user_id = $1", [userId]);
  await query("delete from dictionary_sessions where student_user_id = $1", [userId]);
  await query("delete from student_topic_access where student_user_id = $1", [userId]);
  await query("delete from quiz_attempts where student_user_id = $1", [userId]);
  const result = await query("delete from users where id = $1 returning *", [userId]);
  return sanitizeUser(result.rows[0] || null);
}

async function listUsers({ role = null } = {}) {
  if (role) {
    const result = await query(
      `
        select *
        from users
        where role = $1::user_role
        order by is_active desc, id desc
      `,
      [role],
    );
    return result.rows.map(sanitizeUser);
  }

  const result = await query(
    `
      select *
      from users
      order by
        case role
          when 'superadmin' then 1
          when 'employee' then 2
          else 3
        end,
        id desc
    `,
  );
  return result.rows.map(sanitizeUser);
}

async function listAccessibleStudentsForEmployee() {
  const result = await query(
    `
      select id, full_name, username, phone, telegram_user_id, role, is_active, created_at
      from users
      where role = 'student'
        and is_active = true
      order by full_name asc, id asc
    `,
  );

  return result.rows;
}

async function listStaffMembers() {
  const result = await query(
    "select * from users where role in ('employee', 'superadmin') and is_active = true order by id asc",
  );
  return result.rows.map(sanitizeUser);
}

async function ensureDefaultAccount({
  username,
  phone,
  fullName,
  password,
  role,
}) {
  const existing = await findByLogin(username) || (phone ? await findByLogin(phone) : null);
  if (existing) {
    if (!existing.password_hash) {
      return updateUser(existing.id, { password, role, phone, fullName });
    }
    return sanitizeUser(existing);
  }

  return createUser({
    fullName,
    username,
    phone,
    password,
    role,
  });
}

async function ensureDefaultUsers() {
  const admin = await ensureDefaultAccount({
    username: "admin",
    phone: "+998901111111",
    fullName: "Bosh Admin",
    password: "admin123",
    role: "superadmin",
  });

  const teacher = await ensureDefaultAccount({
    username: "teacher",
    phone: "+998902222222",
    fullName: "Ustoz (O'qituvchi)",
    password: "teacher123",
    role: "employee",
  });

  const student = await ensureDefaultAccount({
    username: "student",
    phone: "+998903333333",
    fullName: "Namuna O'quvchi",
    password: "student123",
    role: "student",
  });

  return { admin, teacher, student };
}

module.exports = {
  createManagedUser,
  createUser,
  deleteUser,
  ensureDefaultUsers,
  ensureStudent,
  ensureSuperadmin,
  findAnySuperadmin,
  findById,
  findByIdWithPassword,
  findByLogin,
  findByTelegramUserId,
  listAccessibleStudentsForEmployee,
  listManagedUsersByRole,
  listStaffMembers,
  listUsers,
  sanitizeUser,
  touchKnownUser,
  updateUser,
};
