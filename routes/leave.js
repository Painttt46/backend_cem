import express from 'express';
import { LEAVE_TYPE_LABELS } from '../config/leaveLabels.js';
import { TEAMS_WEBHOOKS } from '../config/teams.js';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { postToTeams } from '../utils/teamsWebhook.js';
import { initUserLeaveQuotas, ensureLeaveQuotasForYear, getDefaultQuotaForType } from '../utils/leaveQuota.js';
import { sendLeaveNotificationEmail } from '../services/emailService.js';
import { logAudit } from '../utils/auditHelper.js';
import { requireRole, requirePermission } from '../middleware/auth.js';
import { hasPermissionSafe } from '../utils/permissions.js';
import { PERM_LEAVE_HOLIDAYS, PERM_LEAVE_TYPES, LEAVE_MANAGE_PERMISSIONS, PAGE_LEAVE_MANAGEMENT, PERM_LEAVE_APPROVE } from '../config/permissionKeys.js';
import { removeFilesIfUnreferenced } from '../utils/fileCleanup.js';
import { runOnce } from '../utils/runOnce.js';

const router = express.Router();

// DDL ที่ต้องรับประกันว่ามีก่อนใช้งาน — รันครั้งเดียวต่อโปรเซส (ดู utils/runOnce.js)
const ensureUsedDaysNumeric = runOnce(async () => {
  await pool.query(`ALTER TABLE user_leave_quotas ADD COLUMN IF NOT EXISTS used_days NUMERIC(10,4) DEFAULT 0`);
  await pool.query(`ALTER TABLE user_leave_quotas ALTER COLUMN used_days SET DEFAULT 0`);
  await pool.query(`ALTER TABLE user_leave_quotas ALTER COLUMN used_days TYPE NUMERIC(10,4) USING COALESCE(used_days, 0)::numeric`);
  await pool.query(`ALTER TABLE user_leave_quotas ALTER COLUMN annual_quota TYPE NUMERIC(10,4) USING COALESCE(annual_quota, 0)::numeric`);
});

// total_days เดิมเป็น NUMERIC(3,1) (ทศนิยม 1 ตำแหน่ง) แต่ฟอร์มคำนวณเป็นชั่วโมงจริง เช่น ลาบ่าย 5 ชม. = 0.625 วัน
// → DB ปัดเหลือ 0.6 (4.8 ชม.) แล้วตัดโควตาตามค่าที่ปัดนั้น — ขยายเป็น 4 ตำแหน่งให้ตรงกับ used_days ของโควตา
// (เช็ค scale ก่อน จะได้ไม่ rewrite ตารางทุกครั้งที่สตาร์ท; ข้อมูลเดิมไม่เปลี่ยน)
const ensureTotalDaysPrecision = runOnce(async () => {
  const col = await pool.query(`
    SELECT numeric_scale FROM information_schema.columns
    WHERE table_name = 'leave_requests' AND column_name = 'total_days'
  `);
  const scale = col.rows[0]?.numeric_scale;
  if (scale !== null && scale !== undefined && Number(scale) < 4) {
    await pool.query(`ALTER TABLE leave_requests ALTER COLUMN total_days TYPE NUMERIC(10,4)`);
  }
});

const ensureQuotaDisplayColumns = runOnce(async () => {
  await pool.query(`ALTER TABLE user_leave_quotas ADD COLUMN IF NOT EXISTS color VARCHAR(20)`);
  await pool.query(`ALTER TABLE user_leave_quotas ADD COLUMN IF NOT EXISTS advance_days INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE user_leave_quotas ADD COLUMN IF NOT EXISTS display_name VARCHAR(100)`);
});

const ensureHolidaysTable = runOnce(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS holidays (
      id SERIAL PRIMARY KEY,
      holiday_date DATE NOT NULL UNIQUE,
      description VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

const ensureCancelColumns = runOnce(async () => {
  await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMP`);
  await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancel_reason TEXT`);
});

// ขยายขนาด status column (รองรับสถานะ pending_level2 ฯลฯ)
const ensureStatusWide = runOnce(async () => {
  await pool.query(`ALTER TABLE leave_requests ALTER COLUMN status TYPE VARCHAR(50)`);
});

const ensureApprovalColumns = runOnce(async () => {
  await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approval_level INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approved_by_level1 TEXT`);
  await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approved_by_level2 TEXT`);
  await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approved_by_level1_id INTEGER`);
  await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approved_by_level2_id INTEGER`);
  await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS rejected_by TEXT`);
  await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS rejected_level INTEGER`);
  await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS reject_reason TEXT`);
});

// สิทธิ์ "จัดการวันหยุด / จัดการประเภทการลา" เป็นสิทธิ์รายฟีเจอร์ที่ตั้งได้ในหน้า "จัดการสิทธิ์"
// seed ให้ครั้งแรก: role ที่เข้าหน้า "จัดการการลา" (/management/leave) ได้อยู่แล้วจะได้สิทธิ์ทั้งสองข้อด้วย (คงการใช้งานเดิมไว้ ไม่ล็อกใครออก)
// ON CONFLICT DO NOTHING → ถ้าผู้ดูแลปิดสิทธิ์ไว้ ค่าที่ตั้งเองจะไม่ถูกเขียนทับตอนรีสตาร์ท
const ensureLeaveManagePermissions = runOnce(async () => {
  for (const perm of LEAVE_MANAGE_PERMISSIONS) {
    await pool.query(
      `INSERT INTO role_permissions (role, page_path, page_name, page_icon, has_access)
       SELECT role, $1, $2, $3, true FROM role_permissions
       WHERE page_path = '/management/leave' AND has_access = true
       ON CONFLICT (role, page_path) DO NOTHING`,
      [perm.path, perm.name, perm.icon]
    );
  }
});

const requireHolidayPermission = requirePermission(PERM_LEAVE_HOLIDAYS, { ensure: ensureLeaveManagePermissions });
const requireLeaveTypePermission = requirePermission(PERM_LEAVE_TYPES, { ensure: ensureLeaveManagePermissions });

// เตรียม schema ตั้งแต่สตาร์ท (คำขอแรกจึงไม่ต้องรอ) — ล้มเหลวได้ เพราะแต่ละ handler จะเรียก ensure ซ้ำเมื่อใช้งานจริง
Promise.all([
  ensureUsedDaysNumeric(), ensureTotalDaysPrecision(), ensureQuotaDisplayColumns(), ensureHolidaysTable(),
  ensureCancelColumns(), ensureStatusWide(), ensureApprovalColumns(), ensureLeaveManagePermissions()
]).catch((error) => console.error('[leave] schema setup deferred:', error.message));

// Get approvers by level and send email notification
async function notifyApprovers(level, leaveData, notificationType) {
  try {
    // Check if table exists first
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'leave_approval_settings'
      )
    `);
    
    if (!tableCheck.rows[0].exists) {
      return;
    }

    // Optimized: Get requester info and approvers in one query using JOIN
    const result = await pool.query(`
      SELECT 
        u.email,
        las.department_ids,
        las.position_ids,
        req_user.department as requester_dept,
        req_user.position as requester_pos
      FROM leave_approval_settings las
      JOIN users u ON las.user_id = u.id
      CROSS JOIN users req_user
      WHERE las.approval_level = $1 
        AND las.receive_email = true 
        AND u.email IS NOT NULL
        AND req_user.id = $2
    `, [level, leaveData.user_id]);
    
    if (result.rows.length === 0) {
      return;
    }
    
    const requesterDept = result.rows[0]?.requester_dept || null;
    const requesterPos = result.rows[0]?.requester_pos || null;
    
    // Filter approvers based on department/position match (case insensitive)
    const emails = result.rows
      .filter(r => {
        const deptIds = (r.department_ids || []).map(d => d.toLowerCase());
        const posIds = (r.position_ids || []).map(p => p.toLowerCase());
        
        const reqDeptLower = (requesterDept || '').toLowerCase();
        const reqPosLower = (requesterPos || '').toLowerCase();
        
        // dept ต้องตรง (ถ้าไม่ได้ตั้ง = ทุกแผนก), pos ต้องตรง (ถ้าไม่ได้ตั้ง = ทุกตำแหน่ง)
        const deptMatch = deptIds.length === 0 || deptIds.includes(reqDeptLower);
        const posMatch = posIds.length === 0 || posIds.includes(reqPosLower);
        
        return deptMatch && posMatch;
      })
      .map(r => r.email)
      .filter(e => e);
    
    if (emails.length > 0) {
      await sendLeaveNotificationEmail(emails, leaveData, notificationType);
    } else {
    }
  } catch (error) {
    console.error('Error notifying approvers:', error);
    // Don't throw - notification failure shouldn't block approval
  }
}

// Check if user can approve based on department/position settings
async function canUserApprove(approverId, requesterId, level) {
  try {
    // admin/superadmin อนุมัติได้เสมอ (ไม่ขึ้นกับตารางตั้งค่า)
    const roleCheck = await pool.query(`SELECT role FROM users WHERE id = $1`, [approverId]);
    const approverRole = (roleCheck.rows[0]?.role || '').toLowerCase();
    if (approverRole === 'admin' || approverRole === 'superadmin') return true;

    // Check if table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'leave_approval_settings'
      )
    `);

    if (!tableCheck.rows[0].exists) {
      return false; // ไม่มีระบบตั้งค่าผู้อนุมัติ = ปฏิเสธ (default-deny)
    }

    const approverResult = await pool.query(`
      SELECT can_approve, department_ids, position_ids 
      FROM leave_approval_settings 
      WHERE user_id = $1 AND approval_level = $2
    `, [approverId, level]);


    if (approverResult.rows.length === 0) {
      return false; // ไม่มีสิทธิ์ตั้งค่าผู้อนุมัติ = ไม่ให้อนุมัติ (default-deny)
    }
    
    const { can_approve, department_ids, position_ids } = approverResult.rows[0];
    
    if (!can_approve) {
      return false;
    }

    const deptIds = (department_ids || []).map(d => d.toLowerCase());
    const posIds = (position_ids || []).map(p => p.toLowerCase());
    
    if (deptIds.length === 0 && posIds.length === 0) {
      return true;
    }

    const requesterResult = await pool.query(
      `SELECT department, position FROM users WHERE id = $1`, [requesterId]
    );
    const reqDept = (requesterResult.rows[0]?.department || '').toLowerCase();
    const reqPos = (requesterResult.rows[0]?.position || '').toLowerCase();


    const deptMatch = deptIds.length === 0 || deptIds.includes(reqDept);
    const posMatch = posIds.length === 0 || posIds.includes(reqPos);


    return deptMatch && posMatch;
  } catch (error) {
    console.error('[canUserApprove] Error checking approval permission:', error);
    console.error('[canUserApprove] Stack:', error.stack);
    return false; // default-deny — เกิด error ให้ปฏิเสธ ไม่ใช่อนุมัติ
  }
}

// Check if user is level 2 approver
router.get('/is-level2-approver/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(`
      SELECT 1 FROM leave_approval_settings 
      WHERE user_id = $1 AND approval_level = 2 AND can_approve = true
    `, [userId]);
    res.json({ isLevel2Approver: result.rows.length > 0 });
  } catch (error) {
    res.json({ isLevel2Approver: false });
  }
});

// Teams notification function
async function sendTeamsNotification(type, data) {
  const webhookUrl = TEAMS_WEBHOOKS.leave;

  try {
    const message = await createLeaveMessage(type, data);
    await postToTeams(webhookUrl, message, { label: 'Leave' });
  } catch (error) {
    console.error('Teams notification error:', error);
  }
}

// จำนวนลาสำหรับแสดงผล เช่น "0.625 วัน (5 ชม.)" — ใช้ total_days ที่ตัดโควตาจริง
// (เดิมการ์ดอนุมัติคำนวณใหม่เอง: วันเดียวปัดเป็น 0.5/1 และหลายวันนับเสาร์-อาทิตย์/วันหยุดรวมไปด้วย ตัวเลขจึงไม่ตรงกับที่ตัดโควตา)
// ชั่วโมง = วัน × 8 (เวลาทำงานทุก role ที่ตั้งไว้ตอนนี้ = 8 ชม./วัน — เหมือนอีเมลแจ้งเตือน)
function formatLeaveAmount(totalDays) {
  const days = Number(totalDays) || 0;
  const totalMinutes = Math.round(days * 8 * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const hoursText = m ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
  return `${parseFloat(days.toFixed(4))} วัน (${hoursText})`;
}

// ---------- ตรวจวันที่/จำนวนวันลาที่ client ส่งมา (เดิมเชื่อค่า total_days ทั้งหมด → ส่งเลขน้อย ๆ เพื่อไม่ให้โควตาถูกตัดได้) ----------
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LEAVE_SPAN_DAYS = 1000; // กันลูปนับวันยาวเกินจริง

// แยกค่าจากสตริง YYYY-MM-DDTHH:mm[:ss] (เวลาท้องถิ่นที่ฟอร์มส่งมา) โดยไม่ผ่าน Date ท้องถิ่น → ไม่ขึ้นกับ timezone ของ server
function parseLocalDateTime(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value ?? ''));
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(v => (v === undefined ? 0 : Number(v)));
  const dayMs = Date.UTC(y, mo - 1, d);
  if (new Date(dayMs).getUTCDate() !== d) return null; // วันที่ที่ไม่มีจริง เช่น 31 ก.พ.
  return { dayMs, ts: dayMs + ((h * 60 + mi) * 60 + s) * 1000 };
}

const msToYmd = (ms) => new Date(ms).toISOString().slice(0, 10);
// คืนข้อความ error ภาษาไทย หรือ null ถ้าผ่าน
// ช่วงที่ยอมรับอ้างอิงสูตรเดียวกับหน้าฟอร์ม (ข้ามเสาร์-อาทิตย์/วันหยุดนักขัตฤกษ์ ชั่วโมงตามเวลาทำงาน):
//   - "วันกลาง" (ไม่รวมวันแรก/วันสุดท้าย) ที่เป็นวันทำการจะนับเต็ม 1 วันเสมอ → เป็นขอบล่างที่แน่นอน
//   - วันแรกและวันสุดท้ายนับได้อย่างละไม่เกิน 1 วัน → ขอบบน = วันกลาง + 2 (วันเดียวกัน: ไม่เกิน 1)
async function validateLeaveTiming(startRaw, endRaw, totalDaysRaw) {
  const start = parseLocalDateTime(startRaw);
  const end = parseLocalDateTime(endRaw);
  if (!start || !end) return 'รูปแบบวันที่/เวลาลาไม่ถูกต้อง';
  if (end.ts < start.ts) return 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มลา';

  const days = (totalDaysRaw === '' || totalDaysRaw === null || totalDaysRaw === undefined) ? NaN : Number(totalDaysRaw);
  if (!Number.isFinite(days) || days < 0) return 'จำนวนวันลาไม่ถูกต้อง';
  // 0 วัน = ช่วงที่เลือกไม่มีเวลาทำงานเลย (เวลาเริ่ม = เวลาสิ้นสุด, เลือกวันหยุด/นอกเวลางาน) — เดิมบันทึกและอนุมัติได้
  if (days <= 0) return 'ช่วงเวลาที่เลือกไม่มีเวลาทำงาน (จำนวนวันลาเป็น 0) กรุณาตรวจสอบวันและเวลาเริ่ม-สิ้นสุด';

  const spanDays = (end.dayMs - start.dayMs) / DAY_MS;
  if (spanDays > MAX_LEAVE_SPAN_DAYS) return 'ช่วงวันลายาวเกินไป';

  let min = 0;
  let max = 1;
  if (spanDays > 0) {
    await ensureHolidaysTable();
    const holidayResult = await pool.query(
      `SELECT to_char(holiday_date, 'YYYY-MM-DD') AS d FROM holidays WHERE holiday_date > $1::date AND holiday_date < $2::date`,
      [msToYmd(start.dayMs), msToYmd(end.dayMs)]
    );
    const holidays = new Set(holidayResult.rows.map(r => r.d));
    let middleWorkingDays = 0;
    for (let t = start.dayMs + DAY_MS; t < end.dayMs; t += DAY_MS) {
      const dow = new Date(t).getUTCDay();
      if (dow !== 0 && dow !== 6 && !holidays.has(msToYmd(t))) middleWorkingDays++;
    }
    min = middleWorkingDays;
    max = middleWorkingDays + 2;
  }

  const EPS = 0.01;
  if (days < min - EPS || days > max + EPS) {
    return `จำนวนวันลา (${days}) ไม่สอดคล้องกับช่วงวันที่เลือก (ควรอยู่ระหว่าง ${min}–${max} วัน) กรุณารีเฟรชหน้าแล้วลองใหม่`;
  }
  return null;
}

// เตรียมโควตาปีใหม่ — รันตอนสตาร์ทและทุกชั่วโมง (รันซ้ำได้: ทำเฉพาะเมื่อปีนั้นยังไม่มีแถวเลย ดู utils/leaveQuota.js)
// เดิมรันเฉพาะนาที 00:01 ของ 1 ม.ค. และเขียนทับโควตาด้วยรหัส sick/personal/vacation (ลาพักร้อน 0 วัน)
async function prepareLeaveQuotasForCurrentYear() {
  try {
    const result = await ensureLeaveQuotasForYear();
    if (!result.skipped) {
      console.log(`[leave] เตรียมโควตาปี ${result.year}: ยกมาจากปีก่อน ${result.carried} แถว, พนักงานที่ไม่มีโควตาปีก่อน ${result.newUsers} คน`);
    }
  } catch (error) {
    console.error('[leave] prepare quotas for new year failed:', error.message);
  }
}
setTimeout(prepareLeaveQuotasForCurrentYear, 15000).unref?.();
setInterval(prepareLeaveQuotasForCurrentYear, 60 * 60 * 1000).unref?.();

// Get leave quota from database
async function getLeaveQuotaFromDB(userId, leaveType) {
  const currentYear = new Date().getFullYear();

  const result = await pool.query(`
    SELECT annual_quota FROM user_leave_quotas 
    WHERE user_id = $1 AND leave_type = $2 AND year = $3
  `, [userId, leaveType, currentYear]);

  if (result.rows.length === 0) {
    // สร้างแถวตามประเภทการลาที่ใช้จริง แล้วอ่านซ้ำ "ครั้งเดียว" — เดิมเรียกตัวเองซ้ำไม่รู้จบ
    // เมื่อประเภทของใบลาไม่อยู่ในแม่แบบ (เช่น ใบเก่าที่เก็บเป็นรหัส sick) → request ค้าง
    await initUserLeaveQuotas(userId, currentYear);
    const retry = await pool.query(`
      SELECT annual_quota FROM user_leave_quotas
      WHERE user_id = $1 AND leave_type = $2 AND year = $3
    `, [userId, leaveType, currentYear]);
    return retry.rows[0]?.annual_quota ?? 0;
  }

  return result.rows[0].annual_quota;
}

// Calculate remaining leave days for user (updated to use database)
async function calculateRemainingLeave(userId, leaveType) {
  const currentYear = new Date().getFullYear();

  // Get quota and used_days from database
  const quotaResult = await pool.query(`
    SELECT annual_quota, used_days
    FROM user_leave_quotas
    WHERE user_id = $1 AND leave_type = $2 AND year = $3
  `, [userId, leaveType, currentYear]);

  if (quotaResult.rows.length === 0) {
    return { quota: 0, usedDays: 0, remainingDays: 0, remainingHours: 0, quotaHours: 0, usedHours: 0 };
  }

  const quota = quotaResult.rows[0].annual_quota || 0;
  let usedDays = quotaResult.rows[0].used_days;

  // If used_days is null, calculate from approved leave requests
  if (usedDays === null || usedDays === undefined) {
    const usedResult = await pool.query(`
      SELECT COALESCE(SUM(total_days), 0) as used_days
      FROM leave_requests 
      WHERE user_id = $1 
      AND leave_type = $2 
      AND status = 'approved'
      AND EXTRACT(YEAR FROM start_datetime) = $3
    `, [userId, leaveType, currentYear]);

    usedDays = parseFloat(usedResult.rows[0].used_days) || 0;
  }

  // ค่า numeric จาก DB เป็นสตริง — แปลงก่อน และปัด 4 ตำแหน่งกันเศษทศนิยมลอยตัว (เช่น 9.299999999999999)
  const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
  const quotaNum = r4(quota);
  const usedNum = r4(usedDays);
  const remainingDays = r4(quotaNum - usedNum);
  const hoursPerDay = 8;

  return {
    quota: quotaNum,
    usedDays: usedNum,
    remainingDays: Math.max(0, remainingDays),
    quotaHours: r4(quotaNum * hoursPerDay),
    usedHours: r4(usedNum * hoursPerDay),
    remainingHours: r4(Math.max(0, remainingDays) * hoursPerDay)
  };
}

async function createLeaveMessage(type, data) {
  const currentTime = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  let title, color, tableData;

  const leaveAmount = formatLeaveAmount(data.total_days);

  // Get leave type label in Thai
  const leaveTypeLabels = LEAVE_TYPE_LABELS;
  const leaveTypeLabel = leaveTypeLabels[data.leave_type] || data.leave_type;

  // Get quota from database
  const quota = await getLeaveQuotaFromDB(data.user_id, data.leave_type);

  switch (type) {
    case 'request':
      title = '📝 คำขอลาใหม่';
      color = 'Accent';
      tableData = [
        ['รหัสคำขอ', data.id.toString()],
        ['ผู้ขอลา', data.employee_name || 'ไม่ระบุ'],
        ['ตำแหน่ง', data.employee_position || 'ไม่ระบุ'],
        ['ประเภทการลา', getLeaveTypeLabel(data.leave_type)],
        ['วันเริ่มลา', formatDateTime(data.start_datetime)],
        ['วันสิ้นสุด', formatDateTime(data.end_datetime)],
        ['จำนวนวัน', leaveAmount],
        ['สถานะ', 'รออนุมัติ']
      ];
      break;
    case 'approve':
      title = '✅ อนุมัติการลา';
      color = 'Good';
      tableData = [
        ['รหัสคำขอ', data.id.toString()],
        ['ผู้ขอลา', data.employee_name || 'ไม่ระบุ'],
        ['ตำแหน่ง', data.employee_position || 'ไม่ระบุ'],
        ['ประเภทการลา', getLeaveTypeLabel(data.leave_type)],
        ['วันเริ่มลา', formatDateTime(data.start_datetime)],
        ['วันสิ้นสุด', formatDateTime(data.end_datetime)],
        ['จำนวนวัน', leaveAmount],
        ['ผู้อนุมัติขั้นที่ 1 (HR)', data.approved_by_level1 || '-'],
        ['ผู้อนุมัติขั้นที่ 2 (ผู้บริหาร)', data.approved_by_level2 || '-'],
        ['สถานะ', 'อนุมัติ']
      ];
      break;
    case 'reject':
      title = '❌ ปฏิเสธการลา';
      color = 'Warning';
      tableData = [
        ['รหัสคำขอ', data.id.toString()],
        ['ผู้ขอลา', data.employee_name || 'ไม่ระบุ'],
        ['ตำแหน่ง', data.employee_position || 'ไม่ระบุ'],
        ['ประเภทการลา', getLeaveTypeLabel(data.leave_type)],
        ['วันเริ่มลา', formatDateTime(data.start_datetime)],
        ['วันสิ้นสุด', formatDateTime(data.end_datetime)],
        ['จำนวนวัน', leaveAmount],
        ['ผู้ปฏิเสธ', data.approved_by || 'ไม่ระบุ'],
        ['สถานะ', 'ปฏิเสธ']
      ];
      break;
  }

  // Add delegation info if exists
  if (data.has_delegation) {
    tableData.push(['ผู้รับผิดชอบแทน', data.delegate_name]);
    tableData.push(['ตำแหน่งผู้รับผิดชอบ', data.delegate_position]);
    tableData.push(['ติดต่อ', data.delegate_contact]);
    if (data.work_details) {
      tableData.push(['รายละเอียดงานที่มอบหมาย', data.work_details]);
    }
  }

  const tableRows = tableData.map(row => ({
    type: "TableRow",
    cells: [
      {
        type: "TableCell",
        items: [{ type: "TextBlock", text: row[0], weight: "Bolder", wrap: true }]
      },
      {
        type: "TableCell",
        items: [{ type: "TextBlock", text: row[1], wrap: true }]
      }
    ]
  }));

  return {
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      { type: 'TextBlock', text: title, size: 'Medium', weight: 'Bolder', color: color },
      { type: 'TextBlock', text: `เวลา: ${currentTime}`, size: 'Small', color: 'Default', spacing: 'None' },
      ...(data.approved_by && (type === 'approve' || type === 'reject') ? [
        { type: 'TextBlock', text: `${type === 'approve' ? 'ผู้อนุมัติ' : 'ผู้ปฏิเสธ'}: ${data.approved_by}`, size: 'Small', color: type === 'approve' ? 'Good' : 'Warning', weight: 'Bolder' }
      ] : []),
      { type: 'Table', columns: [{ width: 1 }, { width: 2 }], rows: tableRows }
    ],
    msteams: {
      width: "Full"
    }
  };
}

function getLeaveTypeLabel(type) {
  return LEAVE_TYPE_LABELS[type] || type;
}

function formatDateTime(datetime) {
  if (!datetime) return '-';
  return new Date(datetime).toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Check database status
router.get('/database-status', requireRole('admin', 'superadmin'), async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();

    // Check if table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'user_leave_quotas'
      );
    `);

    let status = {
      tableExists: tableExists.rows[0].exists,
      currentYear: currentYear
    };

    if (status.tableExists) {
      // Count records
      const totalRecords = await pool.query('SELECT COUNT(*) FROM user_leave_quotas');
      const currentYearRecords = await pool.query('SELECT COUNT(*) FROM user_leave_quotas WHERE year = $1', [currentYear]);
      const activeUsers = await pool.query('SELECT COUNT(*) FROM users WHERE is_active = true');

      // Sample data
      const sampleData = await pool.query(`
        SELECT ulq.*, u.firstname, u.lastname 
        FROM user_leave_quotas ulq
        LEFT JOIN users u ON ulq.user_id = u.id
        WHERE ulq.year = $1
        LIMIT 10
      `, [currentYear]);

      status = {
        ...status,
        totalRecords: parseInt(totalRecords.rows[0].count),
        currentYearRecords: parseInt(currentYearRecords.rows[0].count),
        activeUsers: parseInt(activeUsers.rows[0].count),
        expectedRecords: parseInt(activeUsers.rows[0].count) * 5, // 5 leave types per user
        sampleData: sampleData.rows
      };
    }

    res.json(status);

  } catch (error) {
    console.error('Database status error:', error);
    res.status(500).json({ error: 'ไม่สามารถตรวจสอบสถานะฐานข้อมูลได้' });
  }
});

// Database setup endpoint
router.get('/setup-database', requireRole('admin', 'superadmin'), async (req, res) => {
  try {

    // Check if table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'user_leave_quotas'
      );
    `);

    let message = [];

    if (!tableCheck.rows[0].exists) {
      // Create table
      await pool.query(`
        CREATE TABLE user_leave_quotas (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          leave_type VARCHAR(50) NOT NULL,
          annual_quota NUMERIC(10,4) NOT NULL DEFAULT 0,
          year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, leave_type, year)
        );
      `);

      message.push('✅ Created user_leave_quotas table');

      // Create index
      await pool.query(`
        CREATE INDEX idx_user_leave_quotas_user_type_year 
        ON user_leave_quotas(user_id, leave_type, year);
      `);

      message.push('✅ Created database index');
    } else {
      message.push('ℹ️ Table already exists');
    }

    // Get users and initialize quotas
    const users = await pool.query('SELECT id, firstname, lastname FROM users WHERE is_active = true');
    message.push(`👥 Found ${users.rows.length} active users`);

    const defaultQuotas = [
      { leave_type: 'sick', annual_quota: 30 },
      { leave_type: 'personal', annual_quota: 6 },
      { leave_type: 'vacation', annual_quota: 6 },
      { leave_type: 'maternity', annual_quota: 98 },
      { leave_type: 'other', annual_quota: 3 }
    ];

    let insertedCount = 0;
    const currentYear = new Date().getFullYear();

    for (const user of users.rows) {
      for (const quota of defaultQuotas) {
        try {
          await pool.query(`
            INSERT INTO user_leave_quotas (user_id, leave_type, annual_quota, year)
            VALUES ($1, $2, $3, $4)
          `, [user.id, quota.leave_type, quota.annual_quota, currentYear]);
          insertedCount++;
        } catch (error) {
          // Skip if already exists (unique constraint)
          if (!error.message.includes('duplicate key')) {
            throw error;
          }
        }
      }
    }

    message.push(`✅ Inserted ${insertedCount} quota records`);

    // Check final count
    const finalCount = await pool.query('SELECT COUNT(*) FROM user_leave_quotas WHERE year = $1', [currentYear]);
    message.push(`📊 Total quota records for ${currentYear}: ${finalCount.rows[0].count}`);

    res.json({
      success: true,
      message: message,
      year: currentYear,
      usersCount: users.rows.length,
      quotaRecords: finalCount.rows[0].count
    });

  } catch (error) {
    console.error('Database setup error:', error);
    res.status(500).json({
      success: false,
      error: 'ไม่สามารถตั้งค่าฐานข้อมูลได้',
      message: 'Failed to setup database'
    });
  }
});

// Manual reset quotas for new year (admin endpoint)
router.post('/reset-quotas', requirePermission(PAGE_LEAVE_MANAGEMENT), async (req, res) => {
  try {
    // ไม่ทับข้อมูลเดิมแล้ว: สร้างโควตาของปีปัจจุบันเฉพาะเมื่อยังไม่มี (เดิมรีเซ็ต used_days ของทุกคนเป็น 0 กลางปีได้)
    const result = await ensureLeaveQuotasForYear();
    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'user_leave_quotas',
      recordName: `เตรียมโควตาการลาปี ${result.year}`,
      newData: result
    });
    res.json({
      message: result.skipped ? 'โควตาของปีนี้มีอยู่แล้ว ไม่มีการเปลี่ยนแปลง' : 'เตรียมโควตาการลาของปีนี้เรียบร้อย',
      ...result
    });
  } catch (error) {
    console.error('Error resetting quotas:', error);
    res.status(500).json({ error: 'ไม่สามารถรีเซ็ตโควต้าการลาได้' });
  }
});

// Initialize quota for all users (admin endpoint)
router.post('/init-quotas', requirePermission(PAGE_LEAVE_MANAGEMENT), async (req, res) => {
  try {
    const usersResult = await pool.query('SELECT id FROM users WHERE is_active = true');

    for (const user of usersResult.rows) {
      await initUserLeaveQuotas(user.id);
    }

    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'user_leave_quotas',
      recordName: 'เติมโควตาการลาที่ขาดให้พนักงานทุกคน',
      newData: { users: usersResult.rows.length }
    });

    res.json({ message: 'Leave quotas initialized for all users', count: usersResult.rows.length });
  } catch (error) {
    console.error('Error initializing quotas:', error);
    res.status(500).json({ error: 'ไม่สามารถตั้งค่าโควต้าการลาเริ่มต้นได้' });
  }
});

// Update user quota
router.put('/quota/:userId/:leaveType', requirePermission(PAGE_LEAVE_MANAGEMENT), async (req, res) => {
  try {
    const { userId, leaveType } = req.params;
    const { quota, remaining, addQuota } = req.body;
    const currentYear = new Date().getFullYear();

    await ensureUsedDaysNumeric();

    let finalQuota, finalUsedDays;

    if (addQuota !== undefined && addQuota > 0) {
      // กรณีเพิ่มวันลา: เพิ่ม quota, used_days คงเดิม (remaining จะเพิ่มขึ้นตาม)
      const currentData = await pool.query(`
        SELECT annual_quota, COALESCE(used_days, 0) as used_days
        FROM user_leave_quotas
        WHERE user_id = $1 AND leave_type = $2 AND year = $3
      `, [userId, leaveType, currentYear]);

      if (currentData.rows.length > 0) {
        const current = currentData.rows[0];
        finalQuota = parseFloat(current.annual_quota) + parseFloat(addQuota);
        finalUsedDays = parseFloat(current.used_days); // used_days คงเดิม
      } else {
        finalQuota = parseFloat(addQuota);
        finalUsedDays = 0;
      }
    } else {
      // กรณีแก้ไขปกติ: คำนวณ used_days จาก quota - remaining
      finalQuota = parseFloat(quota);
      finalUsedDays = Math.max(0, parseFloat(quota) - parseFloat(remaining));
    }

    const before = await pool.query(`
      SELECT annual_quota, used_days FROM user_leave_quotas
      WHERE user_id = $1 AND leave_type = $2 AND year = $3
    `, [userId, leaveType, currentYear]);

    await pool.query(`
      INSERT INTO user_leave_quotas (user_id, leave_type, annual_quota, used_days, year)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, leave_type, year)
      DO UPDATE SET annual_quota = $3, used_days = $4
    `, [userId, leaveType, finalQuota, finalUsedDays, currentYear]);

    // เดิมไม่มี log — แก้วันคงเหลือด้วยมือแล้วตรวจย้อนหลังไม่ได้ว่าใครแก้อะไรเมื่อไร
    const owner = await pool.query('SELECT firstname, lastname FROM users WHERE id = $1', [userId]);
    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'user_leave_quotas',
      recordId: parseInt(userId),
      recordName: `แก้โควตาการลา ${owner.rows[0] ? `${owner.rows[0].firstname} ${owner.rows[0].lastname}` : `user ${userId}`} - ${leaveType} (${currentYear})`,
      oldData: before.rows[0]
        ? { annual_quota: Number(before.rows[0].annual_quota), used_days: Number(before.rows[0].used_days) }
        : null,
      newData: { annual_quota: finalQuota, used_days: finalUsedDays, remaining: finalQuota - finalUsedDays }
    });

    res.json({ 
      message: 'Quota updated successfully',
      quota: finalQuota,
      used_days: finalUsedDays,
      remaining: finalQuota - finalUsedDays
    });
  } catch (error) {
    console.error('Error updating quota:', error);
    res.status(500).json({ error: 'ไม่สามารถแก้ไขโควต้าการลาได้' });
  }
});

// Get leave quota for user
router.get('/quota/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const currentYear = new Date().getFullYear();

    // Get all leave types for this user from database
    const result = await pool.query(`
      SELECT DISTINCT leave_type 
      FROM user_leave_quotas 
      WHERE user_id = $1 AND year = $2
    `, [userId, currentYear]);

    const quotaData = {};

    for (const row of result.rows) {
      quotaData[row.leave_type] = await calculateRemainingLeave(userId, row.leave_type);
    }

    res.json(quotaData);
  } catch (error) {
    console.error('Error getting leave quota:', error);
    res.status(500).json({ error: 'ไม่สามารถโหลดโควต้าการลาได้' });
  }
});

// Get all leave types
router.get('/leave-types', async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();

    // Add columns if not exists
    await ensureQuotaDisplayColumns();

    const result = await pool.query(`
      SELECT leave_type, 
        MAX(color) as color, 
        MAX(advance_days) as advance_days, 
        MAX(display_name) as display_name,
        MAX(annual_quota) as default_quota
      FROM user_leave_quotas 
      WHERE year = $1
      GROUP BY leave_type
      ORDER BY leave_type
    `, [currentYear]);

    // Map to label format
    const leaveTypeLabels = LEAVE_TYPE_LABELS;

    const leaveTypeColors = {
      'sick': '#ef4444',
      'personal': '#f59e0b',
      'vacation': '#10b981',
      'maternity': '#ec4899',
      'other': '#6366f1'
    };

    const defaultAdvanceDays = {
      'personal': 3,  // ลากิจต้องลาล่วงหน้า 3 วัน
      'vacation': 7   // ลาพักร้อนต้องลาล่วงหน้า 7 วัน
    };

    const leaveTypes = result.rows.map(row => ({
      value: row.leave_type,
      label: row.display_name || leaveTypeLabels[row.leave_type] || row.leave_type,
      color: row.color || leaveTypeColors[row.leave_type] || '#6c757d',
      advance_days: row.advance_days ?? defaultAdvanceDays[row.leave_type] ?? 0,
      default_quota: row.default_quota || 0
    }));

    res.json(leaveTypes);
  } catch (error) {
    console.error('Error getting leave types:', error);
    res.status(500).json({ error: 'ไม่สามารถโหลดประเภทการลาได้' });
  }
});

// Create new leave type
router.post('/leave-types', requireLeaveTypePermission, async (req, res) => {
  try {
    const { name, default_quota, advance_days } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'กรุณาระบุชื่อประเภทการลา' });
    }

    // Use name directly as value (support Thai characters)
    const value = name.trim();

    const currentYear = new Date().getFullYear();
    const quota = default_quota || 0;
    const advDays = advance_days || 0;

    // Generate random color
    const colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    // Add quota for all users
    const usersResult = await pool.query('SELECT id FROM users');

    for (const user of usersResult.rows) {
      await pool.query(`
        INSERT INTO user_leave_quotas (user_id, leave_type, annual_quota, year, color, advance_days, display_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id, leave_type, year) DO UPDATE SET color = $5, advance_days = $6, display_name = $7
      `, [user.id, value, quota, currentYear, color, advDays, value]);
    }

    // Log audit
    await logAudit(req, {
      action: 'CREATE',
      tableName: 'settings',
      recordName: `ประเภทการลา: ${name}`,
      newData: { name, default_quota: quota, advance_days: advDays }
    });

    res.json({
      message: 'เพิ่มประเภทการลาสำเร็จ',
      leave_type: { name, value, default_quota: quota, color, advance_days: advDays },
      users_updated: usersResult.rows.length
    });
  } catch (error) {
    console.error('Error creating leave type:', error);
    res.status(500).json({ error: 'ไม่สามารถเพิ่มประเภทการลาได้' });
  }
});

// Update leave type settings
router.put('/leave-types/:leaveType', requireLeaveTypePermission, async (req, res) => {
  try {
    const leaveType = decodeURIComponent(req.params.leaveType);
    const { display_name, color, default_quota, advance_days, addQuota } = req.body;
    const currentYear = new Date().getFullYear();

    // Update all records for this leave type
    await pool.query(`
      UPDATE user_leave_quotas 
      SET display_name = COALESCE($1, display_name),
          color = COALESCE($2, color),
          advance_days = COALESCE($3, advance_days)
      WHERE leave_type = $4 AND year = $5
    `, [display_name, color, advance_days, leaveType, currentYear]);

    // Update default quota if provided
    if (default_quota !== undefined) {
      await pool.query(`
        UPDATE user_leave_quotas 
        SET annual_quota = $1
        WHERE leave_type = $2 AND year = $3
      `, [default_quota, leaveType, currentYear]);
    }

    // Add quota to all users if addQuota is provided
    if (addQuota && addQuota > 0) {
      await pool.query(`
        UPDATE user_leave_quotas 
        SET annual_quota = annual_quota + $1
        WHERE leave_type = $2 AND year = $3
      `, [addQuota, leaveType, currentYear]);
    }

    res.json({ message: 'อัปเดตประเภทการลาสำเร็จ' });
  } catch (error) {
    console.error('Error updating leave type:', error);
    res.status(500).json({ error: 'ไม่สามารถแก้ไขประเภทการลาได้' });
  }
});

// Delete leave type
router.delete('/leave-types/:leaveType', requireLeaveTypePermission, async (req, res) => {
  try {
    const leaveType = decodeURIComponent(req.params.leaveType);
    const currentYear = new Date().getFullYear();

    // Delete all quota records for this leave type
    const result = await pool.query(`
      DELETE FROM user_leave_quotas 
      WHERE leave_type = $1 AND year = $2
      RETURNING *
    `, [leaveType, currentYear]);

    // Log audit
    await logAudit(req, {
      action: 'DELETE',
      tableName: 'settings',
      recordName: `ประเภทการลา: ${leaveType}`,
      oldData: { leave_type: leaveType, deleted_records: result.rows.length }
    });

    res.json({
      message: 'ลบประเภทการลาสำเร็จ',
      deleted_records: result.rows.length
    });
  } catch (error) {
    console.error('Error deleting leave type:', error);
    res.status(500).json({ error: 'ไม่สามารถลบประเภทการลาได้' });
  }
});

// ==================== HOLIDAYS API ====================

// Get all holidays
router.get('/holidays', async (req, res) => {
  try {
    await ensureHolidaysTable();

    const { year } = req.query;
    let query = 'SELECT * FROM holidays';
    let params = [];

    if (year) {
      query += ' WHERE EXTRACT(YEAR FROM holiday_date) = $1';
      params.push(year);
    }

    query += ' ORDER BY holiday_date';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching holidays:', error);
    res.status(500).json({ error: 'ไม่สามารถโหลดวันหยุดได้' });
  }
});

// Add holidays
router.post('/holidays', requireHolidayPermission, async (req, res) => {
  try {
    const { dates, description } = req.body;

    await ensureHolidaysTable();

    const added = [];
    for (const date of dates) {
      try {
        const result = await pool.query(
          'INSERT INTO holidays (holiday_date, description) VALUES ($1, $2) ON CONFLICT (holiday_date) DO NOTHING RETURNING *',
          [date, description || 'วันหยุด']
        );
        if (result.rows.length > 0) added.push(result.rows[0]);
      } catch (e) {
        // Skip duplicates
      }
    }

    res.json({ message: 'เพิ่มวันหยุดสำเร็จ', added });
  } catch (error) {
    console.error('Error adding holidays:', error);
    res.status(500).json({ error: 'ไม่สามารถเพิ่มวันหยุดได้' });
  }
});

// Delete holiday
router.delete('/holidays/:id', requireHolidayPermission, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM holidays WHERE id = $1', [id]);
    res.json({ message: 'ลบวันหยุดสำเร็จ' });
  } catch (error) {
    console.error('Error deleting holiday:', error);
    res.status(500).json({ error: 'ไม่สามารถลบวันหยุดได้' });
  }
});

// Get all leave requests
router.get('/', async (req, res) => {
  try {
    // columns ของการขอยกเลิกต้องมีก่อน select (รันครั้งเดียวต่อโปรเซส)
    await ensureCancelColumns();

    const result = await pool.query(`
      SELECT 
        l.id, l.user_id, l.leave_type, l.start_datetime, l.end_datetime, l.total_days, l.reason,
        l.has_delegation, l.delegate_name, l.delegate_position, l.delegate_department,
        l.delegate_contact, l.work_details, l.attachments, l.status, l.approved_by, 
        l.approval_level, l.approved_by_level1, l.approved_by_level2,
        l.approved_by_level1_id, l.approved_by_level2_id,
        l.rejected_by, l.rejected_level, l.reject_reason,
        l.cancellation_requested_at,
        l.cancel_reason,
        l.created_at, l.updated_at,
        u.firstname || ' ' || u.lastname as employee_name,
        u.position as employee_position,
        u.department,
        u.role as employee_role
      FROM leave_requests l
      LEFT JOIN users u ON l.user_id = u.id
      ORDER BY l.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching all leave requests:', error);
    res.status(500).json({ error: 'ไม่สามารถโหลดรายการคำขอลาได้' });
  }
});

// Create leave request
router.post('/', async (req, res) => {
  const {
    leave_type, start_datetime, end_datetime, total_days, reason,
    has_delegation, delegate_name, delegate_position, delegate_department,
    delegate_contact, work_details, attachments, user_id: targetUserId
  } = req.body;

  try {
    // ตัวตนมาจาก token ที่ยืนยันแล้วเท่านั้น (กัน IDOR)
    let userId = req.user?.id;

    if (!userId || !/^\d+$/.test(String(userId))) {
      return res.status(401).json({ error: 'Invalid user ID' });
    }

    // วันที่ต้องไม่ผิดลำดับ และ total_days ต้องสอดคล้องกับช่วงวันที่ (กัน client ส่งเลขน้อยเพื่อเลี่ยงการตัดโควตา)
    const timingError = await validateLeaveTiming(start_datetime, end_datetime, total_days);
    if (timingError) {
      return res.status(400).json({ error: timingError });
    }

    // ยื่นใบลาแทนพนักงาน (ลาย้อนหลัง) — อนุญาตเฉพาะผู้อนุมัติชั้น 2 ของพนักงานคนนั้น (หรือ admin/superadmin)
    // เดิมใช้ id จาก token อย่างเดียวทำให้ใบลาที่ HR ยื่นแทนถูกบันทึกเป็นของ HR เอง
    let filedByName = null;
    if (targetUserId && String(targetUserId) !== String(userId)) {
      if (!/^\d+$/.test(String(targetUserId))) {
        return res.status(400).json({ error: 'Invalid target user ID' });
      }
      const allowed = await canUserApprove(userId, targetUserId, 2);
      if (!allowed) {
        return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ยื่นใบลาแทนพนักงานคนนี้' });
      }
      filedByName = `${req.user.firstname || ''} ${req.user.lastname || ''}`.trim();
      userId = Number(targetUserId);
    }

    // ใบลาทับช่วงเวลากับใบลาเดิมของคนเดียวกัน (ที่ยังไม่ถูกปฏิเสธ/ยกเลิก) → ไม่รับ
    // เดิมยื่นซ้ำได้ (กดส่งซ้ำ / HR ยื่นย้อนหลังทับใบที่มีอยู่) แล้วอนุมัติทั้งคู่ = ตัดโควตาซ้ำ
    await ensureTotalDaysPrecision();
    const overlapResult = await pool.query(`
      SELECT id, status,
        to_char(start_datetime, 'DD/MM/') || (EXTRACT(YEAR FROM start_datetime)::int + 543) || to_char(start_datetime, ' HH24:MI') AS s,
        to_char(end_datetime, 'DD/MM/') || (EXTRACT(YEAR FROM end_datetime)::int + 543) || to_char(end_datetime, ' HH24:MI') AS e
      FROM leave_requests
      WHERE user_id = $1 AND status IN ('pending', 'pending_level2', 'approved', 'cancel')
        AND start_datetime < $3::timestamp AND $2::timestamp < end_datetime
      ORDER BY start_datetime
      LIMIT 1
    `, [userId, start_datetime, end_datetime]);
    if (overlapResult.rows.length > 0) {
      const o = overlapResult.rows[0];
      const statusText = { pending: 'รออนุมัติ', pending_level2: 'รออนุมัติขั้นที่ 2', approved: 'อนุมัติแล้ว', cancel: 'รออนุมัติยกเลิก' }[o.status] || o.status;
      return res.status(409).json({
        error: `ช่วงเวลานี้ทับกับใบลาที่มีอยู่แล้ว (#${o.id} ${o.s} – ${o.e}, ${statusText})`,
        conflictLeaveId: o.id
      });
    }

    // ดึงข้อมูล user จาก database
    const userResult = await pool.query(
      'SELECT firstname, lastname, position, department FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const employee_name = `${user.firstname} ${user.lastname}`;
    const employee_position = user.position || 'ไม่ระบุตำแหน่ง';

    const result = await pool.query(`
      INSERT INTO leave_requests (
        leave_type, start_datetime, end_datetime, total_days, reason,
        has_delegation, delegate_name, delegate_position, delegate_department,
        delegate_contact, work_details, attachments, user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
      RETURNING *
    `, [
      leave_type, start_datetime, end_datetime, total_days, reason,
      has_delegation || false, delegate_name, delegate_position, delegate_department,
      delegate_contact, work_details, JSON.stringify(attachments || []), userId
    ]);

    // Get created data with user info for Teams notification
    const createdResult = await pool.query(`
      SELECT 
        l.id, l.user_id, l.leave_type, l.start_datetime, l.end_datetime, l.total_days, l.reason,
        l.has_delegation, l.delegate_name, l.delegate_position, l.delegate_department,
        l.delegate_contact, l.work_details, l.attachments, l.status, l.created_at, l.updated_at,
        u.firstname || ' ' || u.lastname as employee_name,
        u.position as employee_position
      FROM leave_requests l
      LEFT JOIN users u ON l.user_id = u.id
      WHERE l.id = $1
    `, [result.rows[0].id]);

    const leaveData = createdResult.rows[0];

    // Log audit
    await logAudit(req, {
      action: 'CREATE',
      tableName: 'leave_requests',
      recordId: leaveData.id,
      recordName: `${leaveData.employee_name} - ${getLeaveTypeLabel(leave_type)}${filedByName ? ` (ยื่นแทนโดย ${filedByName})` : ''}`,
      newData: { leave_type, start_datetime, end_datetime, total_days, reason, filed_by: filedByName }
    });

    // Send email notification to level 1 approvers (HR)
    await notifyApprovers(1, leaveData, 'new_request');

    res.status(201).json(leaveData);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'ไม่สามารถบันทึกคำขอลาได้' });
  }
});

// Update leave status
router.put('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, reject_reason } = req.body;
  // ใช้ตัวตนผู้อนุมัติ/ปฏิเสธจาก token ที่ยืนยันแล้วเท่านั้น ห้ามเชื่อค่าที่ client ส่งมาใน body
  const approverId = req.user.id;
  const approverName = `${req.user.firstname || ''} ${req.user.lastname || ''}`.trim();

  try {
    await ensureUsedDaysNumeric();
    // Ensure columns exist first (รันครั้งเดียวต่อโปรเซส)
    await ensureApprovalColumns();

    // Get leave request details
    const leaveRequest = await pool.query(`
      SELECT user_id, leave_type, total_days, status, start_datetime, COALESCE(approval_level, 0) as current_level
      FROM leave_requests 
      WHERE id = $1
    `, [id]);

    if (leaveRequest.rows.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    const { user_id, leave_type, total_days, status: currentStatus, current_level } = leaveRequest.rows[0];

    // อนุญาตเฉพาะสถานะ approved/rejected — ค่าอื่น ๆ เขียนไม่ได้ (กันเขียนทับสถานะโดยไม่ผ่านการตรวจสิทธิ์)
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'สถานะไม่ถูกต้อง (อนุญาตเฉพาะ approved หรือ rejected)' });
    }

    // ระดับการอนุมัติ/ปฏิเสธ อิงจากสถานะปัจจุบันของคำขอ (ใช้ร่วมกันทั้ง approve และ reject)
    const actionLevel = currentStatus === 'pending' ? 1 : (currentStatus === 'pending_level2' ? 2 : 0);

    // ตรวจสิทธิ์ทุกครั้งที่มีการอนุมัติหรือปฏิเสธ โดยใช้ตัวตนจาก token เท่านั้น
    // (ห้าม bypass ได้ด้วยการไม่ส่ง approved_by_id มา เหมือนโค้ดเดิม)
    if (status === 'approved' || status === 'rejected') {
      const hasPermission = await canUserApprove(approverId, user_id, actionLevel);
      if (!hasPermission) {
        return res.status(403).json({
          error: status === 'approved'
            ? 'คุณไม่มีสิทธิ์อนุมัติใบลานี้ (ไม่ตรงกับแผนก/ตำแหน่งที่ดูแล)'
            : 'คุณไม่มีสิทธิ์ปฏิเสธใบลานี้ (ไม่ตรงกับแผนก/ตำแหน่งที่ดูแล)'
        });
      }
    }

    let newStatus = status;
    let newApprovalLevel = current_level || 0;

    // 2-Step Approval Logic - ตรวจสอบจาก currentStatus ใน DB
    if (status === 'approved') {
      if (currentStatus === 'pending') {
        // Level 1 (หัวหน้างาน) approved -> move to pending level 2
        newStatus = 'pending_level2';
        newApprovalLevel = 1;
      } else if (currentStatus === 'pending_level2') {
        // Level 2 (HR) approved -> fully approved
        // เช็คโควต้าก่อน approve
        const days = parseFloat(total_days) || 0;
        
        try {
          const quotaCheck = await calculateRemainingLeave(user_id, leave_type);
          
          if (quotaCheck.remainingDays < days) {
            return res.status(400).json({
              error: `ไม่สามารถอนุมัติได้ โควต้าคงเหลือ ${quotaCheck.remainingDays} วัน แต่ขอลา ${days} วัน`
            });
          }
        } catch (quotaError) {
          console.error('Quota check error:', quotaError);
          // ถ้าเช็คโควต้าไม่ได้ ให้ approve ต่อไป
        }
        
        newStatus = 'approved';
        newApprovalLevel = 2;
      }
    }

    let updateQuery, updateParams;
    
    if (newApprovalLevel === 1 && newStatus === 'pending_level2') {
      // Level 1 approved — guard สถานะใน SQL กันอนุมัติซ้ำจาก 2 request พร้อมกัน
      updateQuery = `
        UPDATE leave_requests 
        SET status = $1, approved_by_level1 = $2, approved_by_level1_id = $3, approval_level = $4, updated_at = NOW() 
        WHERE id = $5 AND status = 'pending'
        RETURNING *
      `;
      updateParams = [newStatus, approverName, approverId, newApprovalLevel, id];
    } else if (newApprovalLevel === 2 && newStatus === 'approved') {
      // Level 2 approved — guard สถานะกันตัดโควตาซ้ำ
      updateQuery = `
        UPDATE leave_requests
        SET status = $1, approved_by_level2 = $2, approved_by_level2_id = $3, approved_by = $4, approval_level = $5, updated_at = NOW()
        WHERE id = $6 AND status = 'pending_level2'
        RETURNING *
      `;
      updateParams = [newStatus, approverName, approverId, approverName, newApprovalLevel, id];
    } else {
      // Rejected — guard ให้สถานะยังอยู่ระดับที่อนุญาตปฏิเสธ
      const rejectedLevel = actionLevel;
      const guardStatus = currentStatus === 'pending' ? 'pending' : 'pending_level2';
      updateQuery = `
        UPDATE leave_requests
        SET status = $1, approved_by = $2, approval_level = $3, rejected_by = $4, rejected_level = $5, reject_reason = $6, updated_at = NOW()
        WHERE id = $7 AND status = $8
        RETURNING *
      `;
      updateParams = [newStatus, approverName, rejectedLevel, approverName, rejectedLevel, reject_reason || null, id, guardStatus];
    }

    const result = await pool.query(updateQuery, updateParams);

    if (result.rows.length === 0 && currentStatus !== 'approved') {
      // ไม่มีแถวอัปเดต = ใบลาถูกดำเนินการไปแล้วจาก request อื่น (race) — ไม่ตัดโควตาซ้ำ
      return res.status(409).json({ error: 'คำขอนี้ถูกดำเนินการไปแล้ว (อนุมัติ/ปฏิเสธไปก่อนหน้า)' });
    }

    // If fully approved, update quota
    if (newStatus === 'approved' && currentStatus !== 'approved' && result.rows.length > 0) {
      // ตัดโควตา "ปีปัจจุบัน" (ปีที่อนุมัติ) — ให้ตรงกับการเช็คโควตาก่อนอนุมัติ (calculateRemainingLeave), การแสดงผล
      // และการคืนโควตาตอนยกเลิก/ลบ ซึ่งใช้ปีปัจจุบันทั้งหมด
      // (เดิมโค้ดตรงนี้อ้าง leaveRequest.start_datetime แต่ leaveRequest คือผล query ไม่ใช่แถว → เป็น undefined เสมอ
      //  จึงได้ปีปัจจุบันอยู่แล้ว; ถ้าจะเปลี่ยนเป็น "ปีของวันที่เริ่มลา" ต้องแก้ทุกจุดนั้นพร้อมกัน รวมถึงการรีเซ็ตโควตา 1 ม.ค.)
      const quotaYear = new Date().getFullYear();
      const days = parseFloat(total_days) || 0;


      const quotaUpdateResult = await pool.query(`
        UPDATE user_leave_quotas
        SET used_days = COALESCE(used_days, 0) + $1
        WHERE user_id = $2 AND leave_type = $3 AND year = $4
        RETURNING *
      `, [days, user_id, leave_type, quotaYear]);


      if (quotaUpdateResult.rows.length === 0) {
        console.error('[QUOTA UPDATE] ERROR: No quota record found for user:', user_id, 'leave_type:', leave_type, 'year:', quotaYear);
        console.error('[QUOTA UPDATE] Attempting to create quota record...');

        try {
          // คอลัมน์จริงคือ annual_quota (ไม่มี total_days) — โควตาตั้งต้นตามประเภทการลา (เดิมใส่ 10 วันตายตัว)
          const defaultQuota = await getDefaultQuotaForType(leave_type, quotaYear);
          await pool.query(`
            INSERT INTO user_leave_quotas (user_id, leave_type, year, annual_quota, used_days)
            VALUES ($1, $2, $3, $5, $4)
            ON CONFLICT (user_id, leave_type, year)
            DO UPDATE SET used_days = user_leave_quotas.used_days + $4
          `, [user_id, leave_type, quotaYear, days, defaultQuota]);
          
        } catch (insertError) {
          console.error('[QUOTA UPDATE] Failed to create quota record:', insertError);
        }
      }
    }

    // If rejecting previously approved leave
    if (status === 'rejected' && currentStatus === 'approved') {
      const days = parseFloat(total_days) || 0;

      await pool.query(`
        UPDATE user_leave_quotas
        SET used_days = GREATEST(COALESCE(used_days, 0) - $1, 0)
        WHERE user_id = $2 AND leave_type = $3 AND year = $4
      `, [days, user_id, leave_type, new Date().getFullYear()]);
    }

    // Get updated data
    const updatedResult = await pool.query(`
      SELECT 
        l.id, l.leave_type, l.start_datetime, l.end_datetime, l.total_days, l.reason,
        l.has_delegation, l.delegate_name, l.delegate_position, l.delegate_department,
        l.delegate_contact, l.work_details, l.attachments, l.status, l.approved_by, 
        l.approval_level, l.approved_by_level1, l.approved_by_level2,
        l.rejected_by, l.rejected_level, l.reject_reason,
        l.created_at, l.updated_at, l.user_id,
        u.firstname || ' ' || u.lastname as employee_name,
        u.position as employee_position
      FROM leave_requests l
      LEFT JOIN users u ON l.user_id = u.id
      WHERE l.id = $1
    `, [id]);

    const updatedData = updatedResult.rows[0];

    // Get requester email
    const requesterResult = await pool.query(
      'SELECT email FROM users WHERE id = $1',
      [user_id]
    );
    const requesterEmail = requesterResult.rows[0]?.email;

    // Send notifications (don't let notification errors block the response)
    try {
      if (newStatus === 'pending_level2') {
        // Notify level 2 approvers (HR)
        await notifyApprovers(2, updatedData, 'pending_level2');
        // Notify requester about step 1 approval
        if (requesterEmail) {
          await sendLeaveNotificationEmail([requesterEmail], updatedData, 'pending_level2');
        }
      } else if (newStatus === 'approved') {
        await sendTeamsNotification('approve', updatedData);
        // Notify requester about final approval
        if (requesterEmail) {
          await sendLeaveNotificationEmail([requesterEmail], updatedData, 'approved');
        }
      } else if (newStatus === 'rejected') {
        await sendTeamsNotification('reject', updatedData);
        // Notify requester about rejection
        if (requesterEmail) {
          await sendLeaveNotificationEmail([requesterEmail], updatedData, 'rejected');
        }
      }
    } catch (notifyError) {
      console.error('Notification error (non-blocking):', notifyError);
    }

    // Log audit
    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'leave_requests',
      recordId: parseInt(id),
      recordName: `${updatedData.employee_name} - ${getLeaveTypeLabel(updatedData.leave_type)}`,
      oldData: { status: currentStatus },
      newData: { status: newStatus, approved_by: approverName }
    });

    res.json(updatedData);
  } catch (error) {
    console.error('Error updating leave status:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'ไม่สามารถอัปเดตสถานะการลาได้' });
  }
});


// Update attachments (owner or Level2 approver, within time window)
router.put('/:id/attachments', async (req, res) => {
  try {
    const { id } = req.params;
    const { attachments } = req.body;
    const currentUserId = req.user.id;

    const result = await pool.query('SELECT id, user_id, status, leave_type, start_datetime, end_datetime, reason, approved_by, approved_by_level1, approved_by_level2, created_at FROM leave_requests WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'ไม่พบคำขอลา' });

    const leave = result.rows[0];
    const isOwner = leave.user_id == currentUserId;

    // Check if Level2 approver
    const level2Check = await pool.query(
      `SELECT 1 FROM leave_approval_settings WHERE user_id = $1 AND approval_level = 2 AND can_approve = true`,
      [currentUserId]
    );
    const isLevel2Approver = level2Check.rows.length > 0;

    if (!isOwner && !isLevel2Approver) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขเอกสาร' });
    }

    const now = new Date();
    const createdAt = new Date(leave.created_at);
    createdAt.setHours(0, 0, 0, 0);
    const deadline = new Date(leave.end_datetime);
    deadline.setDate(deadline.getDate() + 15);
    deadline.setHours(23, 59, 59, 999);

    if (now < createdAt || now > deadline) {
      return res.status(403).json({ error: 'ไม่อยู่ในช่วงเวลาที่อนุญาต (วันยื่นคำขอ - วันสิ้นสุดลา + 15 วัน)' });
    }

    await pool.query(
      'UPDATE leave_requests SET attachments = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(attachments || []), id]
    );

    res.json({ success: true, attachments: attachments || [] });
  } catch (error) {
    console.error('Error updating attachments:', error);
    res.status(500).json({ error: 'ไม่สามารถแก้ไขไฟล์แนบได้' });
  }
});

// Delete leave request (only if status is pending)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const userId = req.user.id;

    // ตรวจสอบคำขอลา
    const checkResult = await pool.query(`
      SELECT l.user_id, l.status, l.leave_type, l.start_datetime, l.end_datetime, l.total_days, l.reason, l.attachments,
        l.has_delegation, l.delegate_name, l.delegate_position, l.delegate_department, l.delegate_contact, l.work_details,
        u.firstname || ' ' || u.lastname as employee_name, u.position as employee_position
      FROM leave_requests l
      LEFT JOIN users u ON l.user_id = u.id
      WHERE l.id = $1
    `, [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    const leaveRequest = checkResult.rows[0];

    // ตรวจสอบว่าเป็นเจ้าของคำขอ
    if (leaveRequest.user_id != userId) {
      return res.status(403).json({ error: 'Not authorized to delete this request' });
    }

    if (leaveRequest.status !== 'pending') {
      return res.status(400).json({ error: 'Cannot delete request that has been processed' });
    }

    // ลบคำขอ
    const result = await pool.query(
      'DELETE FROM leave_requests WHERE id = $1 RETURNING *',
      [id]
    );
    await removeFilesIfUnreferenced(leaveRequest.attachments);

    // เดิมไม่มี log — ใบที่พนักงานลบเองหายไปโดยไม่มีร่องรอย
    await logAudit(req, {
      action: 'DELETE',
      tableName: 'leave_requests',
      recordId: parseInt(id),
      recordName: `${leaveRequest.employee_name} - ${getLeaveTypeLabel(leaveRequest.leave_type)} (ลบคำขอที่รออนุมัติเอง)`,
      oldData: { ...leaveRequest, id: parseInt(id) }
    });

    // แจ้ง Level 1 approvers ว่ามีการยกเลิกคำขอ
    try {
      await notifyApprovers(1, { ...leaveRequest, id: parseInt(id), user_id: userId }, 'cancellation_request');
    } catch (e) { /* non-blocking */ }

    res.json({ message: 'Leave request deleted successfully', deleted: result.rows[0] });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'ไม่สามารถลบคำขอลาได้' });
  }
});

// Request cancellation (for approved leaves)
router.post('/:id/request-cancel', async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  try {
    const userId = req.user.id;

    // ตรวจสอบคำขอลา
    const checkResult = await pool.query(
      'SELECT id, user_id, status, leave_type, start_datetime, end_datetime, reason, approved_by, approved_by_level1, approved_by_level2, cancellation_requested_at, cancel_reason FROM leave_requests WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    const leaveRequest = checkResult.rows[0];

    if (leaveRequest.user_id != userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (leaveRequest.status !== 'approved' && leaveRequest.status !== 'pending_level2') {
      return res.status(400).json({ error: 'Can only cancel approved or pending level 2 leaves' });
    }

    if (leaveRequest.cancellation_requested_at) {
      return res.status(400).json({ error: 'Cancellation already requested' });
    }

    // เพิ่มคอลัมน์ + ขยาย status column ถ้ายังไม่มี (รันครั้งเดียวต่อโปรเซส)
    await ensureCancelColumns();
    await ensureStatusWide();

    // อัปเดตสถานะเป็น cancel พร้อมเหตุผล
    await pool.query(
      `UPDATE leave_requests 
       SET status = 'cancel', 
           cancellation_requested_at = NOW(),
           cancel_reason = $2
       WHERE id = $1`,
      [id, reason || null]
    );

    // ส่งการแจ้งเตือนไปยัง Level 2 approvers
    const updatedResult = await pool.query(`
      SELECT l.*, u.firstname || ' ' || u.lastname as employee_name, u.position as employee_position
      FROM leave_requests l
      LEFT JOIN users u ON l.user_id = u.id
      WHERE l.id = $1
    `, [id]);

    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'leave_requests',
      recordId: parseInt(id),
      recordName: `${updatedResult.rows[0]?.employee_name} - ${getLeaveTypeLabel(leaveRequest.leave_type)} (ขอยกเลิกใบลา)`,
      oldData: { status: leaveRequest.status },
      newData: { status: 'cancel', cancel_reason: reason || null }
    });

    await notifyApprovers(2, updatedResult.rows[0], 'cancellation_request');

    res.json({ message: 'Cancellation request submitted successfully' });
  } catch (error) {
    console.error('Request cancel error:', error);
    res.status(500).json({ error: 'ไม่สามารถส่งคำขอยกเลิกการลาได้' });
  }
});

// Approve/Reject cancellation (Level 2 only)
router.put('/:id/cancel-status', async (req, res) => {
  const { id } = req.params;
  const { action, approved_by } = req.body; // action: 'approve' or 'reject'

  try {
    const approverId = req.user.id;
    // ผู้จัดการใบลาทุกใบ: admin/superadmin หรือ role ที่ถูกกำหนดสิทธิ์ "อนุมัติลางาน" ในหน้าจัดการสิทธิ์
    const isPrivileged = await hasPermissionSafe(req.user, PERM_LEAVE_APPROVE);

    await ensureUsedDaysNumeric();
    const checkResult = await pool.query(
      'SELECT id, user_id, status, leave_type, total_days, start_datetime, end_datetime, reason, attachments, approved_by, approved_by_level1, approved_by_level2, approved_by_level2_id, cancellation_requested_at, cancel_reason FROM leave_requests WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    const leaveRequest = checkResult.rows[0];

    // สิทธิ์จริง: admin/hr/superadmin, ผู้ที่อนุมัติชั้น 2 ของใบนี้ไว้, หรือผู้อนุมัติชั้น 2 ที่ตั้งค่าไว้สำหรับพนักงานคนนี้
    // (เดิมเอา approved_by_level2 ซึ่งเก็บ "ชื่อ" ไปเทียบกับ id ผู้ใช้ → ไม่มีทางตรง ผู้อนุมัติชั้น 2 ทั่วไปจึงถูกปฏิเสธเสมอ
    //  และใบที่ขอยกเลิกตอนยัง pending_level2 ก็ยังไม่มีชื่อผู้อนุมัติชั้น 2 เลย)
    let canHandleCancel = isPrivileged || (
      leaveRequest.approved_by_level2_id != null && String(leaveRequest.approved_by_level2_id) === String(approverId)
    );
    if (!canHandleCancel) {
      canHandleCancel = await canUserApprove(approverId, leaveRequest.user_id, 2);
    }
    if (!canHandleCancel) {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์อนุมัติการยกเลิกใบลานี้' });
    }

    if (leaveRequest.status !== 'cancel') {
      return res.status(400).json({ error: 'No cancellation request found' });
    }

    if (action === 'approve') {
      // คืนโควต้า — เฉพาะใบที่เคยอนุมัติครบแล้ว (มี approved_by_level2 = เคยถูกตัดโควตาตอนอนุมัติชั้น 2)
      // ใบที่ขอยกเลิกตอนยัง pending_level2 ยังไม่เคยตัดโควตา จึงไม่ต้องคืน
      const days = parseFloat(leaveRequest.total_days) || 0;

      if (days > 0 && leaveRequest.approved_by_level2) {
        await pool.query(`
          UPDATE user_leave_quotas
          SET used_days = GREATEST(COALESCE(used_days, 0) - $1, 0)
          WHERE user_id = $2 AND leave_type = $3 AND year = $4
        `, [days, leaveRequest.user_id, leaveRequest.leave_type, new Date().getFullYear()]);
      }

      // เก็บใบไว้เป็นประวัติ (สถานะ cancelled) — เดิมลบทิ้งพร้อมไฟล์แนบ ใบลาจึง "หายไป" จากระบบโดยไม่มีร่องรอย
      await pool.query(
        `UPDATE leave_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status = 'cancel'`,
        [id]
      );
      await logAudit(req, {
        action: 'UPDATE',
        tableName: 'leave_requests',
        recordId: parseInt(id),
        recordName: `user ${leaveRequest.user_id} - ${getLeaveTypeLabel(leaveRequest.leave_type)} (อนุมัติการยกเลิก)`,
        oldData: { ...leaveRequest },
        newData: { status: 'cancelled', quotaRefundedDays: days > 0 && leaveRequest.approved_by_level2 ? days : 0 }
      });

      res.json({ message: 'Leave cancelled successfully', status: 'cancelled' });
    } else {
      // ปฏิเสธการยกเลิก - คืนสถานะตามที่อนุมัติไว้
      // ถ้ามี approved_by_level2 แสดงว่าอนุมัติครบแล้ว → approved
      // ถ้ามีแค่ approved_by_level1 แสดงว่าอนุมัติแค่ step 1 → pending_level2
      const originalStatus = leaveRequest.approved_by_level2 ? 'approved' : 'pending_level2';
      
      await pool.query(
        `UPDATE leave_requests SET status = $1 WHERE id = $2`,
        [originalStatus, id]
      );
      await logAudit(req, {
        action: 'UPDATE',
        tableName: 'leave_requests',
        recordId: parseInt(id),
        recordName: `user ${leaveRequest.user_id} - ${getLeaveTypeLabel(leaveRequest.leave_type)} (ปฏิเสธการขอยกเลิก)`,
        oldData: { status: 'cancel' },
        newData: { status: originalStatus }
      });

      res.json({ message: 'Cancellation request rejected', status: originalStatus });
    }
  } catch (error) {
    console.error('Cancel status error:', error);
    res.status(500).json({ error: 'ไม่สามารถอัปเดตสถานะการยกเลิกได้' });
  }
});

// Admin/HR: Delete leave request and return quota (for level 2 approvers)
router.delete('/:id/admin-reset', async (req, res) => {
  const { id } = req.params;

  try {
    await ensureUsedDaysNumeric();
    const approverId = req.user.id;

    const leaveResult = await pool.query(
      'SELECT id, user_id, status, leave_type, total_days, start_datetime, end_datetime, reason, attachments, approved_by, approved_by_level1, approved_by_level2, cancellation_requested_at, cancel_reason FROM leave_requests WHERE id = $1',
      [id]
    );

    if (leaveResult.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบคำขอลานี้' });
    }

    const leaveRequest = leaveResult.rows[0];
    const resetReason = String(req.body?.reason || '').trim().slice(0, 500);

    if (leaveRequest.status === 'cancelled') {
      return res.status(409).json({ error: 'ใบลานี้ถูกยกเลิกไปแล้ว' });
    }

    // ตรวจสอบสิทธิ์ว่าเป็นผู้มีสิทธิ์อนุมัติระดับ 2 (HR) สำหรับผู้ขอลาคนนี้
    const hasPermission = await canUserApprove(approverId, leaveRequest.user_id, 2);
    
    if (!hasPermission) {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์จัดการคำขอนี้' });
    }

    const currentYear = new Date().getFullYear();
    const days = parseFloat(leaveRequest.total_days) || 0;

    // คืนโควต้าเฉพาะใบที่เคยถูกตัดโควต้าแล้วจริง = อนุมัติครบ 2 ชั้น (status approved)
    // หรือขอยกเลิกจากใบที่อนุมัติครบแล้ว (status cancel + มี approved_by_level2)
    // ใบที่ยัง pending/pending_level2 ยังไม่เคยตัดโควต้า — เดิมคืนให้ด้วยทำให้ used_days ของใบอื่นลดผิด
    // (และเดิม query ไม่ได้ดึง total_days มา ทำให้ days เป็น 0 ไม่เคยคืนจริง)
    const wasDeducted = leaveRequest.status === 'approved' ||
      (leaveRequest.status === 'cancel' && !!leaveRequest.approved_by_level2);
    let refundedDays = 0;
    if (days > 0 && wasDeducted) {
      await pool.query(`
        UPDATE user_leave_quotas
        SET used_days = GREATEST(COALESCE(used_days, 0) - $1, 0)
        WHERE user_id = $2 AND leave_type = $3 AND year = $4
      `, [days, leaveRequest.user_id, leaveRequest.leave_type, currentYear]);
      refundedDays = days;
    }

    // ไม่ลบใบทิ้งแล้ว: เปลี่ยนเป็นสถานะ "ยกเลิก" (เก็บประวัติ + ไฟล์แนบไว้) — เดิม DELETE + ลบไฟล์
    // 16 ต.ค. 2569 มีการกดปุ่มนี้ไล่ลงมา 20 ใบในตาราง ใบลาจึงหายไปจากประวัติ ต้องกู้จาก audit log
    await ensureCancelColumns();
    await pool.query(`
      UPDATE leave_requests
      SET status = 'cancelled', cancel_reason = COALESCE($2, cancel_reason), updated_at = NOW()
      WHERE id = $1
    `, [id, resetReason ? `HR ยกเลิก/คืนโควต้า: ${resetReason}` : 'HR ยกเลิก/คืนโควต้า']);

    // Log audit
    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'leave_requests',
      recordId: parseInt(id),
      recordName: `HR ยกเลิก/คืนโควต้า - user ${leaveRequest.user_id} - ${getLeaveTypeLabel(leaveRequest.leave_type)}`,
      oldData: {
        ...leaveRequest
      },
      newData: { status: 'cancelled', reason: resetReason || null, quotaRefundedDays: refundedDays }
    });

    res.json({ message: refundedDays > 0 ? 'ยกเลิกใบลาและคืนโควต้าเรียบร้อยแล้ว' : 'ยกเลิกใบลาเรียบร้อยแล้ว (ใบนี้ยังไม่เคยถูกตัดโควต้า จึงไม่มีโควต้าที่ต้องคืน)', status: 'cancelled', quotaRefundedDays: refundedDays });
  } catch (error) {
    console.error('[admin-reset] Error:', error);
    console.error('[admin-reset] Stack:', error.stack);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดำเนินการ' });
  }
});

export default router;
