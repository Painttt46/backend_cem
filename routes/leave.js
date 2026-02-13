import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import fetch from 'node-fetch';
import { sendLeaveNotificationEmail } from '../services/emailService.js';
import { logAudit } from '../utils/auditHelper.js';

const router = express.Router();

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
      console.log('leave_approval_settings table does not exist, skipping notification');
      return;
    }

    // Get requester's department and position
    const requesterInfo = await pool.query(`
      SELECT department, position FROM users WHERE id = $1
    `, [leaveData.user_id]);
    
    const requesterDept = requesterInfo.rows[0]?.department || null;
    const requesterPos = requesterInfo.rows[0]?.position || null;

    // Get approvers with their department/position filters
    const result = await pool.query(`
      SELECT u.email, las.department_ids, las.position_ids
      FROM leave_approval_settings las
      JOIN users u ON las.user_id = u.id
      WHERE las.approval_level = $1 AND las.receive_email = true AND u.email IS NOT NULL
    `, [level]);
    
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
      console.log(`Sent ${notificationType} notification to level ${level} approvers:`, emails);
    } else {
      console.log(`No matching approvers for level ${level} (dept: ${requesterDept}, pos: ${requesterPos})`);
    }
  } catch (error) {
    console.error('Error notifying approvers:', error);
    // Don't throw - notification failure shouldn't block approval
  }
}

// Check if user can approve based on department/position settings
async function canUserApprove(approverId, requesterId, level) {
  try {
    console.log('[canUserApprove] Checking permission - Approver:', approverId, 'Requester:', requesterId, 'Level:', level);
    
    // Check if table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'leave_approval_settings'
      )
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('[canUserApprove] Table leave_approval_settings does not exist, allowing approval');
      return true; // If table doesn't exist, allow all approvals
    }

    const approverResult = await pool.query(`
      SELECT can_approve, department_ids, position_ids 
      FROM leave_approval_settings 
      WHERE user_id = $1 AND approval_level = $2
    `, [approverId, level]);

    console.log('[canUserApprove] Approver settings found:', approverResult.rows.length);

    if (approverResult.rows.length === 0) {
      console.log('[canUserApprove] No settings found for approver - allowing approval');
      return true; // If no settings, allow approval
    }
    
    const { can_approve, department_ids, position_ids } = approverResult.rows[0];
    console.log('[canUserApprove] Settings:', { can_approve, department_ids, position_ids });
    
    if (!can_approve) {
      console.log('[canUserApprove] can_approve is false');
      return false;
    }

    const deptIds = (department_ids || []).map(d => d.toLowerCase());
    const posIds = (position_ids || []).map(p => p.toLowerCase());
    
    if (deptIds.length === 0 && posIds.length === 0) {
      console.log('[canUserApprove] No department/position restrictions');
      return true;
    }

    const requesterResult = await pool.query(
      `SELECT department, position FROM users WHERE id = $1`, [requesterId]
    );
    const reqDept = (requesterResult.rows[0]?.department || '').toLowerCase();
    const reqPos = (requesterResult.rows[0]?.position || '').toLowerCase();

    console.log('[canUserApprove] Requester info:', { department: reqDept, position: reqPos });

    const deptMatch = deptIds.length === 0 || deptIds.includes(reqDept);
    const posMatch = posIds.length === 0 || posIds.includes(reqPos);

    console.log('[canUserApprove] Match result:', { deptMatch, posMatch, final: deptMatch && posMatch });

    return deptMatch && posMatch;
  } catch (error) {
    console.error('[canUserApprove] Error checking approval permission:', error);
    console.error('[canUserApprove] Stack:', error.stack);
    return true; // On error, allow approval to prevent blocking
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
  const webhookUrl = 'https://defaultc5fc1b2a2ce84471ab9dbe65d8fe09.06.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/5a51a63928354152a300aa86dd237a77/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=RTyDkT4FoSgIlqjbLVUx7hkJgUl4DODurrfM1f5howw';

  try {
    const message = await createLeaveMessage(type, data);
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      console.error('Teams notification failed:', response.status);
    } else {
      console.log('Teams notification sent successfully');
    }
  } catch (error) {
    console.error('Teams notification error:', error);
  }
}

function calculateLeaveDays(startDateTime, endDateTime) {
  const start = new Date(startDateTime);
  const end = new Date(endDateTime);

  // Set time to start of day for accurate day calculation
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const diffTime = end - start;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return diffDays;
}

// Reset leave quotas for new year (January 1st)
async function resetLeaveQuotasForNewYear() {
  const currentYear = new Date().getFullYear();

  try {
    console.log(`Resetting leave quotas for year ${currentYear}...`);

    // Get all active users
    const usersResult = await pool.query('SELECT id FROM users WHERE is_active = true');

    const defaultQuotas = [
      { leave_type: 'sick', annual_quota: 30 },
      { leave_type: 'personal', annual_quota: 6 },
      { leave_type: 'vacation', annual_quota: 6 },
      { leave_type: 'maternity', annual_quota: 98 },
      { leave_type: 'other', annual_quota: 3 }
    ];

    for (const user of usersResult.rows) {
      for (const quota of defaultQuotas) {
        await pool.query(`
          INSERT INTO user_leave_quotas (user_id, leave_type, annual_quota, used_days, year)
          VALUES ($1, $2, $3, 0, $4)
          ON CONFLICT (user_id, leave_type, year) 
          DO UPDATE SET annual_quota = $3, used_days = 0
        `, [user.id, quota.leave_type, quota.annual_quota, currentYear]);
      }
    }

    console.log(`Leave quotas reset completed for ${usersResult.rows.length} users`);
  } catch (error) {
    console.error('Error resetting leave quotas:', error);
  }
}

// Check and reset quotas daily
function startQuotaResetScheduler() {
  // Check every day at 00:01 AM
  setInterval(async () => {
    const now = new Date();
    const isJanuary1st = now.getMonth() === 0 && now.getDate() === 1;
    const isNewYearTime = now.getHours() === 0 && now.getMinutes() === 1;

    if (isJanuary1st && isNewYearTime) {
      console.log('New Year detected - resetting leave quotas...');
      await resetLeaveQuotasForNewYear();
    }
  }, 60 * 1000); // Check every minute
}

// Start scheduler when server starts
startQuotaResetScheduler();

// Initialize leave quota for user (call when creating new user)
async function initializeUserLeaveQuota(userId) {
  const defaultQuotas = [
    { leave_type: 'sick', annual_quota: 30 },
    { leave_type: 'personal', annual_quota: 6 },
    { leave_type: 'vacation', annual_quota: 6 },
    { leave_type: 'maternity', annual_quota: 98 },
    { leave_type: 'other', annual_quota: 3 }
  ];

  for (const quota of defaultQuotas) {
    await pool.query(`
      INSERT INTO user_leave_quotas (user_id, leave_type, annual_quota, year)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, leave_type, year) DO NOTHING
    `, [userId, quota.leave_type, quota.annual_quota, new Date().getFullYear()]);
  }
}

// Get leave quota from database
async function getLeaveQuotaFromDB(userId, leaveType) {
  const currentYear = new Date().getFullYear();

  const result = await pool.query(`
    SELECT annual_quota FROM user_leave_quotas 
    WHERE user_id = $1 AND leave_type = $2 AND year = $3
  `, [userId, leaveType, currentYear]);

  if (result.rows.length === 0) {
    // Initialize if not exists
    await initializeUserLeaveQuota(userId);
    return getLeaveQuotaFromDB(userId, leaveType);
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

  const remainingDays = quota - usedDays;
  const hoursPerDay = 8;

  return {
    quota,
    usedDays,
    remainingDays: Math.max(0, remainingDays),
    quotaHours: quota * hoursPerDay,
    usedHours: usedDays * hoursPerDay,
    remainingHours: Math.max(0, remainingDays) * hoursPerDay
  };
}

async function createLeaveMessage(type, data) {
  const currentTime = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  let title, color, tableData;

  // Calculate correct leave days
  const correctDays = calculateLeaveDays(data.start_datetime, data.end_datetime);

  // Get leave type label in Thai
  const leaveTypeLabels = {
    'sick': 'ลาป่วย',
    'personal': 'ลากิจ',
    'vacation': 'ลาพักร้อน',
    'maternity': 'ลาคลอด',
    'other': 'ลาอื่นๆ'
  };
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
        ['จำนวนวัน', correctDays + ' วัน'],

        ['เหตุผล', data.reason || '-'],
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
        ['จำนวนวัน', correctDays + ' วัน'],
        ['เหตุผล', data.reason || '-'],
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
        ['จำนวนวัน', data.total_days + ' วัน'],
        ['เหตุผล', data.reason || '-'],
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
  const types = {
    sick: 'ลาป่วย',
    personal: 'ลากิจ',
    vacation: 'ลาพักร้อน',
    maternity: 'ลาคลอด',
    other: 'ลาอื่นๆ'
  };
  return types[type] || type;
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
router.get('/database-status', async (req, res) => {
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
    res.status(500).json({ error: error.message });
  }
});

// Database setup endpoint
router.get('/setup-database', async (req, res) => {
  try {
    console.log('Setting up leave quota database...');

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
          annual_quota INTEGER NOT NULL DEFAULT 0,
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
      error: error.message,
      message: 'Failed to setup database'
    });
  }
});

// Manual reset quotas for new year (admin endpoint)
router.post('/reset-quotas', async (req, res) => {
  try {
    await resetLeaveQuotasForNewYear();
    res.json({
      message: 'Leave quotas reset successfully for new year',
      year: new Date().getFullYear()
    });
  } catch (error) {
    console.error('Error resetting quotas:', error);
    res.status(500).json({ error: error.message });
  }
});

// Initialize quota for all users (admin endpoint)
router.post('/init-quotas', async (req, res) => {
  try {
    const usersResult = await pool.query('SELECT id FROM users WHERE is_active = true');

    for (const user of usersResult.rows) {
      await initializeUserLeaveQuota(user.id);
    }

    res.json({ message: 'Leave quotas initialized for all users', count: usersResult.rows.length });
  } catch (error) {
    console.error('Error initializing quotas:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update user quota
router.put('/quota/:userId/:leaveType', async (req, res) => {
  try {
    const { userId, leaveType } = req.params;
    const { quota, remaining, addQuota } = req.body;
    const currentYear = new Date().getFullYear();

    // Add used_days column if not exists
    await pool.query(`
      ALTER TABLE user_leave_quotas 
      ADD COLUMN IF NOT EXISTS used_days INTEGER DEFAULT 0
    `);

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
      finalUsedDays = parseFloat(quota) - parseFloat(remaining);
    }

    await pool.query(`
      INSERT INTO user_leave_quotas (user_id, leave_type, annual_quota, used_days, year)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, leave_type, year) 
      DO UPDATE SET annual_quota = $3, used_days = $4
    `, [userId, leaveType, finalQuota, finalUsedDays, currentYear]);

    res.json({ 
      message: 'Quota updated successfully',
      quota: finalQuota,
      used_days: finalUsedDays,
      remaining: finalQuota - finalUsedDays
    });
  } catch (error) {
    console.error('Error updating quota:', error);
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

// Get all leave types
router.get('/leave-types', async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();

    // Add columns if not exists
    await pool.query(`ALTER TABLE user_leave_quotas ADD COLUMN IF NOT EXISTS color VARCHAR(20)`);
    await pool.query(`ALTER TABLE user_leave_quotas ADD COLUMN IF NOT EXISTS advance_days INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE user_leave_quotas ADD COLUMN IF NOT EXISTS display_name VARCHAR(100)`);

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
    const leaveTypeLabels = {
      'sick': 'ลาป่วย',
      'personal': 'ลากิจ',
      'vacation': 'ลาพักร้อน',
      'maternity': 'ลาคลอด',
      'other': 'ลาอื่นๆ'
    };

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
    res.status(500).json({ error: error.message });
  }
});

// Create new leave type
router.post('/leave-types', async (req, res) => {
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
    res.status(500).json({ error: error.message });
  }
});

// Update leave type settings
router.put('/leave-types/:leaveType', async (req, res) => {
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
    res.status(500).json({ error: error.message });
  }
});

// Delete leave type
router.delete('/leave-types/:leaveType', async (req, res) => {
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
    res.status(500).json({ error: error.message });
  }
});

// ==================== HOLIDAYS API ====================

// Get all holidays
router.get('/holidays', async (req, res) => {
  try {
    // Create table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS holidays (
        id SERIAL PRIMARY KEY,
        holiday_date DATE NOT NULL UNIQUE,
        description VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

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
    res.status(500).json({ error: error.message });
  }
});

// Add holidays
router.post('/holidays', async (req, res) => {
  try {
    const { dates, description } = req.body;

    // Create table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS holidays (
        id SERIAL PRIMARY KEY,
        holiday_date DATE NOT NULL UNIQUE,
        description VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

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
    res.status(500).json({ error: error.message });
  }
});

// Delete holiday
router.delete('/holidays/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM holidays WHERE id = $1', [id]);
    res.json({ message: 'ลบวันหยุดสำเร็จ' });
  } catch (error) {
    console.error('Error deleting holiday:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all leave requests
router.get('/', async (req, res) => {
  try {
    // Ensure new cancellation columns exist before selecting
    await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMP`);
    await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancel_reason TEXT`);

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
        u.department
      FROM leave_requests l
      LEFT JOIN users u ON l.user_id = u.id
      ORDER BY l.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create leave request
router.post('/', async (req, res) => {
  const {
    leave_type, start_datetime, end_datetime, total_days, reason,
    has_delegation, delegate_name, delegate_position, delegate_department,
    delegate_contact, work_details, attachments
  } = req.body;

  try {
    // ดึง user_id จาก request body หรือ token
    let userId = req.body.user_id;

    if (!userId) {
      // ลองดึงจาก token
      const token = req.headers.authorization?.replace('Bearer ', '');
      console.log('Received token:', token);

      if (token && token.startsWith('token_')) {
        userId = token.split('_')[1];
      }
    }

    console.log('Extracted userId:', userId);

    if (!userId || isNaN(parseInt(userId))) {
      return res.status(401).json({ error: 'Invalid user ID' });
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
        l.id, l.leave_type, l.start_datetime, l.end_datetime, l.total_days, l.reason,
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
      recordName: `${leaveData.employee_name} - ${getLeaveTypeLabel(leave_type)}`,
      newData: { leave_type, start_datetime, end_datetime, total_days, reason }
    });

    // Send email notification to level 1 approvers (HR)
    await notifyApprovers(1, leaveData, 'new_request');

    res.status(201).json(leaveData);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update leave status
router.put('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, approved_by, approved_by_id, reject_reason } = req.body;

  try {
    // Ensure columns exist first
    await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approval_level INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approved_by_level1 TEXT`);
    await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approved_by_level2 TEXT`);
    await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approved_by_level1_id INTEGER`);
    await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approved_by_level2_id INTEGER`);
    await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS rejected_by TEXT`);
    await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS rejected_level INTEGER`);
    await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS reject_reason TEXT`);

    // Get leave request details
    const leaveRequest = await pool.query(`
      SELECT user_id, leave_type, total_days, status, COALESCE(approval_level, 0) as current_level
      FROM leave_requests 
      WHERE id = $1
    `, [id]);

    if (leaveRequest.rows.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    const { user_id, leave_type, total_days, status: currentStatus, current_level } = leaveRequest.rows[0];

    // Check approval permission
    if (status === 'approved' && approved_by_id) {
      const approvalLevel = currentStatus === 'pending' ? 1 : (currentStatus === 'pending_level2' ? 2 : 0);
      const hasPermission = await canUserApprove(approved_by_id, user_id, approvalLevel);
      if (!hasPermission) {
        return res.status(403).json({ 
          error: 'คุณไม่มีสิทธิ์อนุมัติใบลานี้ (ไม่ตรงกับแผนก/ตำแหน่งที่ดูแล)' 
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
      // Level 1 approved
      updateQuery = `
        UPDATE leave_requests 
        SET status = $1, approved_by_level1 = $2, approved_by_level1_id = $3, approval_level = $4, updated_at = NOW() 
        WHERE id = $5 
        RETURNING *
      `;
      updateParams = [newStatus, approved_by, approved_by_id, newApprovalLevel, id];
    } else if (newApprovalLevel === 2 && newStatus === 'approved') {
      // Level 2 approved
      updateQuery = `
        UPDATE leave_requests 
        SET status = $1, approved_by_level2 = $2, approved_by_level2_id = $3, approved_by = $4, approval_level = $5, updated_at = NOW() 
        WHERE id = $6 
        RETURNING *
      `;
      updateParams = [newStatus, approved_by, approved_by_id, approved_by, newApprovalLevel, id];
    } else {
      // Rejected or other
      const rejectedLevel = currentStatus === 'pending' ? 1 : (currentStatus === 'pending_level2' ? 2 : 0);
      updateQuery = `
        UPDATE leave_requests 
        SET status = $1, approved_by = $2, approval_level = $3, rejected_by = $4, rejected_level = $5, reject_reason = $6, updated_at = NOW() 
        WHERE id = $7 
        RETURNING *
      `;
      updateParams = [newStatus, approved_by, rejectedLevel, approved_by, rejectedLevel, reject_reason || null, id];
    }

    const result = await pool.query(updateQuery, updateParams);

    // If fully approved, update quota
    if (newStatus === 'approved' && currentStatus !== 'approved') {
      const currentYear = new Date().getFullYear();
      const days = parseFloat(total_days) || 0;

      await pool.query(`
        UPDATE user_leave_quotas
        SET used_days = COALESCE(used_days, 0) + $1
        WHERE user_id = $2 AND leave_type = $3 AND year = $4
      `, [days, user_id, leave_type, currentYear]);
    }

    // If rejecting previously approved leave
    if (status === 'rejected' && currentStatus === 'approved') {
      const currentYear = new Date().getFullYear();
      const days = parseFloat(total_days) || 0;

      await pool.query(`
        UPDATE user_leave_quotas
        SET used_days = GREATEST(COALESCE(used_days, 0) - $1, 0)
        WHERE user_id = $2 AND leave_type = $3 AND year = $4
      `, [days, user_id, leave_type, currentYear]);
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
      newData: { status: newStatus, approved_by }
    });

    res.json(updatedData);
  } catch (error) {
    console.error('Error updating leave status:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: error.message, details: error.stack });
  }
});

// Delete leave request (only if status is pending)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // ดึง user info จาก token
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // ตรวจสอบคำขอลา
    const checkResult = await pool.query(
      'SELECT user_id, status FROM leave_requests WHERE id = $1',
      [id]
    );

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

    res.json({ message: 'Leave request deleted successfully', deleted: result.rows[0] });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Request cancellation (for approved leaves)
router.post('/:id/request-cancel', async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
    if (!token) return res.status(401).json({ error: 'No token provided' });

    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // ตรวจสอบคำขอลา
    const checkResult = await pool.query(
      'SELECT * FROM leave_requests WHERE id = $1',
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

    // ตรวจสอบว่ายังไม่ถึงวันลา
    const startDate = new Date(leaveRequest.start_datetime);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    startDate.setHours(0, 0, 0, 0);

    if (startDate <= today) {
      return res.status(400).json({ error: 'Cannot cancel leave that has already started' });
    }

    // เพิ่มคอลัมน์ถ้ายังไม่มี
    await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMP`);
    await pool.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancel_reason TEXT`);
    
    // ขยายขนาด status column
    await pool.query(`ALTER TABLE leave_requests ALTER COLUMN status TYPE VARCHAR(50)`);

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

    await notifyApprovers(2, updatedResult.rows[0], 'cancellation_request');

    res.json({ message: 'Cancellation request submitted successfully' });
  } catch (error) {
    console.error('Request cancel error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Approve/Reject cancellation (Level 2 only)
router.put('/:id/cancel-status', async (req, res) => {
  const { id } = req.params;
  const { action, approved_by } = req.body; // action: 'approve' or 'reject'

  try {
    const checkResult = await pool.query(
      'SELECT * FROM leave_requests WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    const leaveRequest = checkResult.rows[0];

    if (leaveRequest.status !== 'cancel') {
      return res.status(400).json({ error: 'No cancellation request found' });
    }

    if (action === 'approve') {
      // คืนโควต้า
      const currentYear = new Date().getFullYear();
      const days = parseFloat(leaveRequest.total_days) || 0;

      await pool.query(`
        UPDATE user_leave_quotas
        SET used_days = GREATEST(COALESCE(used_days, 0) - $1, 0)
        WHERE user_id = $2 AND leave_type = $3 AND year = $4
      `, [days, leaveRequest.user_id, leaveRequest.leave_type, currentYear]);

      // อัปเดตสถานะเป็น cancelled
      await pool.query(
        `UPDATE leave_requests SET status = 'cancelled', approved_by = $1 WHERE id = $2`,
        [approved_by, id]
      );

      res.json({ message: 'Leave cancelled successfully' });
    } else {
      // ปฏิเสธการยกเลิก - คืนสถานะตามที่อนุมัติไว้
      // ถ้ามี approved_by_level2 แสดงว่าอนุมัติครบแล้ว → approved
      // ถ้ามีแค่ approved_by_level1 แสดงว่าอนุมัติแค่ step 1 → pending_level2
      const originalStatus = leaveRequest.approved_by_level2 ? 'approved' : 'pending_level2';
      
      await pool.query(
        `UPDATE leave_requests SET status = $1 WHERE id = $2`,
        [originalStatus, id]
      );

      res.json({ message: 'Cancellation request rejected', status: originalStatus });
    }
  } catch (error) {
    console.error('Cancel status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin/HR: Delete leave request and return quota (for level 2 approvers)
router.delete('/:id/admin-reset', async (req, res) => {
  const { id } = req.params;

  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
    if (!token) {
      console.log('[admin-reset] No token provided');
      return res.status(401).json({ error: 'No token provided' });
    }

    let approverId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      approverId = decoded.userId;
      console.log('[admin-reset] Approver ID:', approverId);
    } catch (e) {
      console.log('[admin-reset] Invalid token:', e.message);
      return res.status(401).json({ error: 'Invalid token' });
    }

    const leaveResult = await pool.query(
      'SELECT * FROM leave_requests WHERE id = $1',
      [id]
    );

    if (leaveResult.rows.length === 0) {
      console.log('[admin-reset] Leave request not found:', id);
      return res.status(404).json({ error: 'ไม่พบคำขอลานี้' });
    }

    const leaveRequest = leaveResult.rows[0];
    console.log('[admin-reset] Leave request:', { id: leaveRequest.id, user_id: leaveRequest.user_id, status: leaveRequest.status });

    // ตรวจสอบสิทธิ์ว่าเป็นผู้มีสิทธิ์อนุมัติระดับ 2 (HR) สำหรับผู้ขอลาคนนี้
    const hasPermission = await canUserApprove(approverId, leaveRequest.user_id, 2);
    console.log('[admin-reset] Has permission:', hasPermission);
    
    if (!hasPermission) {
      console.log('[admin-reset] Permission denied for approver:', approverId, 'requester:', leaveRequest.user_id);
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์จัดการคำขอนี้' });
    }

    const currentYear = new Date().getFullYear();
    const days = parseFloat(leaveRequest.total_days) || 0;

    // หากเคยตัดโควต้าจากการอนุมัติแล้ว ให้คืนโควต้า
    if (days > 0 && (leaveRequest.status === 'approved' || leaveRequest.status === 'cancel' || leaveRequest.status === 'pending_level2')) {
      console.log('[admin-reset] Returning quota:', days, 'days for user:', leaveRequest.user_id);
      const updateResult = await pool.query(`
        UPDATE user_leave_quotas
        SET used_days = GREATEST(COALESCE(used_days, 0) - $1, 0)
        WHERE user_id = $2 AND leave_type = $3 AND year = $4
        RETURNING *
      `, [days, leaveRequest.user_id, leaveRequest.leave_type, currentYear]);
      console.log('[admin-reset] Quota update result:', updateResult.rowCount, 'rows affected');
    }

    // ลบคำขอออกจากระบบ
    console.log('[admin-reset] Deleting leave request:', id);
    await pool.query('DELETE FROM leave_requests WHERE id = $1', [id]);

    // Log audit
    await logAudit(req, {
      action: 'DELETE',
      tableName: 'leave_requests',
      recordId: parseInt(id),
      recordName: `HR reset - user ${leaveRequest.user_id} - ${getLeaveTypeLabel(leaveRequest.leave_type)}`,
      oldData: {
        ...leaveRequest
      },
      newData: { deleted: true, quotaRefundedDays: days }
    });

    console.log('[admin-reset] Success - deleted leave request:', id);
    res.json({ message: 'ลบคำขอและคืนโควต้าการลาเรียบร้อยแล้ว' });
  } catch (error) {
    console.error('[admin-reset] Error:', error);
    console.error('[admin-reset] Stack:', error.stack);
    res.status(500).json({ error: error.message || 'เกิดข้อผิดพลาดในการดำเนินการ' });
  }
});

export default router;
