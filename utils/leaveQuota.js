import pool from '../config/database.js';
import { DEFAULT_LEAVE_QUOTAS } from '../config/leaveDefaults.js';
import { runOnce } from './runOnce.js';

// แถวโควตาปีหน้าที่สร้างล่วงหน้าตอนอนุมัติใบลาของปีหน้า — แยกจากแถวปกติ เพื่อให้การเตรียมโควตาปีใหม่ยังทำให้ครบทุกคน
const ensureCreatedEarlyColumn = runOnce(async () => {
  await pool.query(`ALTER TABLE user_leave_quotas ADD COLUMN IF NOT EXISTS created_early BOOLEAN NOT NULL DEFAULT false`);
});

// ประเภทการลาที่ใช้จริงของปีนั้น = แถวใน user_leave_quotas (HR ตั้งเป็นชื่อไทย เช่น 'ลาป่วย' พร้อมสี/วันลาล่วงหน้า)
// ไม่ใช่รหัสใน DEFAULT_LEAVE_QUOTAS (sick/personal/vacation) ซึ่งเป็นค่าตั้งต้นของระบบรุ่นแรก
// โควตาตั้งต้นของแต่ละประเภท = ค่าที่พนักงานส่วนใหญ่ได้ (mode) — ใช้กับพนักงานใหม่
export async function getLeaveTypeTemplate(year) {
  const result = await pool.query(`
    SELECT leave_type,
           mode() WITHIN GROUP (ORDER BY annual_quota) AS annual_quota,
           MAX(color) AS color,
           MAX(advance_days) AS advance_days,
           MAX(display_name) AS display_name
    FROM user_leave_quotas
    WHERE year = $1
    GROUP BY leave_type
  `, [year]);
  return result.rows;
}

// สร้างแถวโควตาของปีนั้นให้พนักงานหนึ่งคน (เฉพาะประเภทที่ยังไม่มี) ตามประเภทการลาที่ใช้อยู่จริง
// เดิมใช้ DEFAULT_LEAVE_QUOTAS → พนักงานใหม่ได้ประเภทเป็นรหัส (ซ้ำกับชื่อไทยใน dropdown) และลาพักร้อน 0 วัน
export async function initUserLeaveQuotas(userId, year = new Date().getFullYear()) {
  let template = await getLeaveTypeTemplate(year);
  if (!template.length) template = await getLeaveTypeTemplate(year - 1);
  if (!template.length) {
    template = DEFAULT_LEAVE_QUOTAS.map(q => ({ leave_type: q.leave_type, annual_quota: q.annual_quota }));
  }
  for (const t of template) {
    await pool.query(`
      INSERT INTO user_leave_quotas (user_id, leave_type, annual_quota, used_days, year, color, advance_days, display_name)
      VALUES ($1, $2, $3, 0, $4, $5, $6, $7)
      ON CONFLICT (user_id, leave_type, year) DO NOTHING
    `, [userId, t.leave_type, t.annual_quota ?? 0, year, t.color ?? null, t.advance_days ?? 0, t.display_name ?? null]);
  }
}

// เตรียมโควตาของปีใหม่ — ทำเฉพาะเมื่อปีนั้นยังไม่มีแถวเลย (รันซ้ำได้ ไม่ทับข้อมูล):
// ยกประเภทการลา + โควตาของแต่ละคนจากปีก่อนมา (used_days เริ่ม 0) แล้วเติมให้พนักงาน active ที่ยังไม่มี
// เดิม: รันเฉพาะนาที 00:01 ของ 1 ม.ค. (server ไม่ได้รันนาทีนั้น = ไม่เกิด) และเขียนทับด้วยรหัส sick/personal/vacation
// + ลาพักร้อน 0 วัน → ปีใหม่ประเภทการลา/โควตาที่ HR ตั้งไว้หายหมด
export async function ensureLeaveQuotasForYear(year = new Date().getFullYear()) {
  await ensureCreatedEarlyColumn();
  const existing = await pool.query('SELECT 1 FROM user_leave_quotas WHERE year = $1 AND NOT created_early LIMIT 1', [year]);
  if (existing.rows.length > 0) return { year, carried: 0, newUsers: 0, skipped: true };

  const carried = await pool.query(`
    INSERT INTO user_leave_quotas (user_id, leave_type, annual_quota, used_days, year, color, advance_days, display_name)
    SELECT q.user_id, q.leave_type, q.annual_quota, 0, $1, q.color, q.advance_days, q.display_name
    FROM user_leave_quotas q
    JOIN users u ON u.id = q.user_id AND u.is_active = true
    WHERE q.year = $1 - 1
    ON CONFLICT (user_id, leave_type, year) DO NOTHING
  `, [year]);

  const missing = await pool.query(`
    SELECT u.id FROM users u
    WHERE u.is_active = true
      AND NOT EXISTS (SELECT 1 FROM user_leave_quotas q WHERE q.user_id = u.id AND q.year = $1)
  `, [year]);
  for (const u of missing.rows) await initUserLeaveQuotas(u.id, year);
  await pool.query('UPDATE user_leave_quotas SET created_early = false WHERE year = $1 AND created_early', [year]);

  return { year, carried: carried.rowCount || 0, newUsers: missing.rows.length, skipped: false };
}

// สร้างแถวโควตาปีหน้าให้พนักงานหนึ่งคน เมื่ออนุมัติใบลาของปีหน้าก่อนถึงปีนั้น — ยกโควตาจากปีล่าสุดของคนนั้นมา (ถ้าไม่เคยมีประเภทนี้จะไม่สร้าง)
export async function ensureFutureQuotaRow(userId, leaveType, year) {
  await ensureCreatedEarlyColumn();
  await pool.query(`
    INSERT INTO user_leave_quotas (user_id, leave_type, annual_quota, used_days, year, color, advance_days, display_name, created_early)
    SELECT q.user_id, q.leave_type, q.annual_quota, 0, $3::int, q.color, q.advance_days, q.display_name, true
    FROM user_leave_quotas q
    WHERE q.user_id = $1 AND q.leave_type = $2 AND q.year < $3::int
    ORDER BY q.year DESC
    LIMIT 1
    ON CONFLICT (user_id, leave_type, year) DO NOTHING
  `, [userId, leaveType, year]);
}

const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

// จำนวนวันของใบลาแยกตามปีของวันลา เช่น { "2026": 1, "2027": 2 } — ใช้ตัดโควตาให้ตรงปี
// ใบที่อยู่ปีเดียวใช้ total_days ตรง ๆ / ใบคร่อมปีแบ่งตามเวลาทำงานจริงของแต่ละปี (ข้ามเสาร์-อาทิตย์และวันหยุด) โดยผลรวมเท่า total_days เสมอ
export async function getLeaveDeductionsByYear(leaveId) {
  const head = await pool.query(`
    SELECT EXTRACT(YEAR FROM start_datetime)::int AS start_year, EXTRACT(YEAR FROM end_datetime)::int AS end_year, total_days
    FROM leave_requests WHERE id = $1
  `, [leaveId]);
  const { start_year: startYear, end_year: endYear, total_days: totalDays } = head.rows[0];
  const total = round4(totalDays);
  if (startYear === endYear) return { [startYear]: total };

  let perYear = [];
  try {
    const result = await pool.query(`
      SELECT EXTRACT(YEAR FROM d)::int AS year,
             SUM(
               GREATEST(EXTRACT(EPOCH FROM (LEAST(b.e1, h.ls) - GREATEST(b.s1, h.ws))), 0)
             + GREATEST(EXTRACT(EPOCH FROM (LEAST(b.e1, h.we) - GREATEST(b.s1, h.le))), 0)
             )::float AS seconds
      FROM leave_requests l
      JOIN users u ON u.id = l.user_id
      LEFT JOIN user_work_hours uw ON uw.user_id = u.id
      LEFT JOIN role_work_hours rw ON rw.role = u.role
      CROSS JOIN LATERAL (
        SELECT COALESCE(uw.start_time, rw.start_time, '09:00'::time) AS ws, COALESCE(uw.end_time, rw.end_time, '18:00'::time) AS we,
               COALESCE(uw.lunch_start, rw.lunch_start, '12:00'::time) AS ls, COALESCE(uw.lunch_end, rw.lunch_end, '13:00'::time) AS le
      ) h
      CROSS JOIN LATERAL generate_series(l.start_datetime::date, l.end_datetime::date, interval '1 day') AS d
      CROSS JOIN LATERAL (
        SELECT GREATEST(CASE WHEN d::date = l.start_datetime::date THEN l.start_datetime::time ELSE h.ws END, h.ws) AS s1,
               LEAST(CASE WHEN d::date = l.end_datetime::date THEN l.end_datetime::time ELSE h.we END, h.we) AS e1
      ) b
      WHERE l.id = $1 AND EXTRACT(ISODOW FROM d) < 6
        AND NOT EXISTS (SELECT 1 FROM holidays x WHERE x.holiday_date = d::date)
      GROUP BY 1 ORDER BY 1
    `, [leaveId]);
    perYear = result.rows.filter(r => r.seconds > 0);
  } catch (error) {
    console.error('[leave] แบ่งวันลาตามปีไม่สำเร็จ:', error.message);
  }

  const totalSeconds = perYear.reduce((sum, r) => sum + r.seconds, 0);
  if (totalSeconds <= 0) return { [startYear]: total };
  const deductions = {};
  let assigned = 0;
  perYear.forEach((r, i) => {
    const days = i === perYear.length - 1 ? round4(total - assigned) : round4(total * r.seconds / totalSeconds);
    deductions[r.year] = days;
    assigned = round4(assigned + days);
  });
  return deductions;
}

// โควตาตั้งต้นของประเภทหนึ่ง (ใช้ตอนต้องสร้างแถวให้คนที่ยังไม่มีแถวของประเภทนั้น) — เดิมเขียนตายไว้ 10 วัน
export async function getDefaultQuotaForType(leaveType, year = new Date().getFullYear()) {
  const result = await pool.query(`
    SELECT mode() WITHIN GROUP (ORDER BY annual_quota) AS q
    FROM user_leave_quotas WHERE leave_type = $1 AND year = $2
  `, [leaveType, year]);
  if (result.rows[0]?.q != null) return Number(result.rows[0].q);
  const fallback = DEFAULT_LEAVE_QUOTAS.find(d => d.leave_type === leaveType);
  return fallback ? fallback.annual_quota : 0;
}
