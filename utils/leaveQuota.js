import pool from '../config/database.js';
import { DEFAULT_LEAVE_QUOTAS } from '../config/leaveDefaults.js';

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
  const existing = await pool.query('SELECT 1 FROM user_leave_quotas WHERE year = $1 LIMIT 1', [year]);
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

  return { year, carried: carried.rowCount || 0, newUsers: missing.rows.length, skipped: false };
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
