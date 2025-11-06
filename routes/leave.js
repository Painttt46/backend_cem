import express from 'express';
import pool from '../config/database.js';
import fetch from 'node-fetch';

const router = express.Router();

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
          INSERT INTO user_leave_quotas (user_id, leave_type, annual_quota, year)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id, leave_type, year) DO NOTHING
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
  const quota = await getLeaveQuotaFromDB(userId, leaveType);
  
  // Get total used days for this leave type in current year
  const usedResult = await pool.query(`
    SELECT COALESCE(SUM(total_days), 0) as used_days
    FROM leave_requests 
    WHERE user_id = $1 
    AND leave_type = $2 
    AND status = 'approved'
    AND EXTRACT(YEAR FROM start_datetime) = $3
  `, [userId, leaveType, currentYear]);
  
  const usedDays = parseInt(usedResult.rows[0].used_days) || 0;
  const remainingDays = quota - usedDays;
  
  return {
    quota,
    usedDays,
    remainingDays: Math.max(0, remainingDays)
  };
}

// Calculate leave cost based on leave type and days
function calculateLeaveCost(leaveType, totalDays) {
  const costPerDay = {
    'sick': 500,        // ลาป่วย - 500 บาท/วัน
    'personal': 800,    // ลากิจ - 800 บาท/วัน  
    'vacation': 300,    // ลาพักร้อน - 300 บาท/วัน
    'maternity': 0,     // ลาคลอด - ฟรี
    'other': 600        // ลาอื่นๆ - 600 บาท/วัน
  };
  
  const dailyCost = costPerDay[leaveType] || 0;
  const totalCost = dailyCost * totalDays;
  
  return {
    dailyCost,
    totalCost,
    formattedCost: totalCost.toLocaleString('th-TH') + ' บาท'
  };
}

async function createLeaveMessage(type, data) {
  const currentTime = new Date().toLocaleString('th-TH');
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
        ['โควต้าต่อปี', quota + ' วัน'],
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
        ['โควต้าต่อปี', quota + ' วัน'],
        ['เหตุผล', data.reason || '-'],
        ['ผู้อนุมัติ', data.approved_by || 'ไม่ระบุ'],
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
        ['โควต้าต่อปี', quota + ' วัน'],
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
    const { annual_quota } = req.body;
    const currentYear = new Date().getFullYear();
    
    await pool.query(`
      INSERT INTO user_leave_quotas (user_id, leave_type, annual_quota, year)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, leave_type, year) 
      DO UPDATE SET annual_quota = $3, updated_at = CURRENT_TIMESTAMP
    `, [userId, leaveType, annual_quota, currentYear]);
    
    res.json({ message: 'Quota updated successfully' });
  } catch (error) {
    console.error('Error updating quota:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get leave quota for user
router.get('/quota/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const leaveTypes = ['sick', 'personal', 'vacation', 'maternity', 'other'];
    const quotaData = {};
    
    for (const leaveType of leaveTypes) {
      quotaData[leaveType] = await calculateRemainingLeave(userId, leaveType);
    }
    
    res.json(quotaData);
  } catch (error) {
    console.error('Error getting leave quota:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all leave requests
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        l.id, l.leave_type, l.start_datetime, l.end_datetime, l.total_days, l.reason,
        l.has_delegation, l.delegate_name, l.delegate_position, l.delegate_department,
        l.delegate_contact, l.work_details, l.attachments, l.status, l.approved_by, l.created_at, l.updated_at,
        u.firstname || ' ' || u.lastname as employee_name,
        u.position as employee_position
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
    
    // Remove Teams notification for new requests - only notify on approval
    // await sendTeamsNotification('request', leaveData);
    
    res.status(201).json(leaveData);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update leave status
router.put('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, approved_by } = req.body;
  
  try {
    // Get leave request details first
    const leaveRequest = await pool.query(`
      SELECT user_id, leave_type, total_days, status 
      FROM leave_requests 
      WHERE id = $1
    `, [id]);
    
    if (leaveRequest.rows.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }
    
    const { user_id, leave_type, total_days, status: currentStatus } = leaveRequest.rows[0];
    
    // Update leave status
    const result = await pool.query(`
      UPDATE leave_requests 
      SET status = $1, approved_by = $2, updated_at = NOW() 
      WHERE id = $3 
      RETURNING *
    `, [status, approved_by, id]);
    
    // If approving leave, check and update quota
    if (status === 'approved' && currentStatus !== 'approved') {
      const currentYear = new Date().getFullYear();
      
      // Check remaining quota
      const quotaCheck = await calculateRemainingLeave(user_id, leave_type);
      
      if (quotaCheck.remainingDays < total_days) {
        return res.status(400).json({ 
          error: `ไม่สามารถอนุมัติได้ โควต้าคงเหลือ ${quotaCheck.remainingDays} วัน แต่ขอลา ${total_days} วัน`
        });
      }
      
      console.log(`Approved leave: User ${user_id}, Type ${leave_type}, Days ${total_days}`);
    }
    
    // Get updated data with user info for Teams notification
    const updatedResult = await pool.query(`
      SELECT 
        l.id, l.leave_type, l.start_datetime, l.end_datetime, l.total_days, l.reason,
        l.has_delegation, l.delegate_name, l.delegate_position, l.delegate_department,
        l.delegate_contact, l.work_details, l.attachments, l.status, l.approved_by, l.created_at, l.updated_at,
        l.user_id,
        u.firstname || ' ' || u.lastname as employee_name,
        u.position as employee_position
      FROM leave_requests l
      LEFT JOIN users u ON l.user_id = u.id
      WHERE l.id = $1
    `, [id]);
    
    const updatedData = updatedResult.rows[0];
    
    // Send Teams notification based on status
    if (status === 'approved') {
      await sendTeamsNotification('approve', updatedData);
    }
    
    res.json(updatedData);
  } catch (error) {
    console.error('Error updating leave status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete leave request (only if status is pending)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // ดึง user info จาก token
    const token = req.headers.authorization?.replace('Bearer ', '');
    const userId = token?.split('_')[1];
    
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    // ดึงข้อมูล user ที่ login
    const userResult = await pool.query(
      'SELECT firstname, lastname FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    const currentUserName = `${user.firstname} ${user.lastname}`;
    
    // ตรวจสอบคำขอลา
    const checkResult = await pool.query(
      'SELECT employee_name, status FROM leave_requests WHERE id = $1',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }
    
    const leaveRequest = checkResult.rows[0];
    
    // ตรวจสอบว่าเป็นเจ้าของคำขอและยัง pending
    if (leaveRequest.employee_name !== currentUserName) {
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

export default router;
