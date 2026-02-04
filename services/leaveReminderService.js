import pool from '../db.js';
import { sendPendingLeaveReminder } from './emailService.js';

const LEAVE_TYPE_LABELS = {
  sick: 'ลาป่วย',
  personal: 'ลากิจ',
  vacation: 'ลาพักร้อน',
  maternity: 'ลาคลอด',
  ordination: 'ลาบวช',
  military: 'ลาทหาร',
  other: 'อื่นๆ'
};

// Get pending leaves grouped by approver for each level
export const getPendingLeavesForReminder = async () => {
  // Get leave approval settings
  const settingsResult = await pool.query(`
    SELECT step, approvers FROM leave_approval_settings ORDER BY step
  `);
  const settings = settingsResult.rows;

  // Get all pending leaves
  const pendingResult = await pool.query(`
    SELECT 
      lr.id, lr.leave_type, lr.total_days, lr.status, lr.created_at,
      u.firstname || ' ' || u.lastname as employee_name,
      u.department, u.position
    FROM leave_requests lr
    JOIN users u ON lr.user_id = u.id
    WHERE lr.status IN ('pending', 'pending_level2')
    ORDER BY lr.created_at ASC
  `);

  const pendingLeaves = pendingResult.rows.map(leave => ({
    ...leave,
    leave_type_label: LEAVE_TYPE_LABELS[leave.leave_type] || leave.leave_type
  }));

  // Group by approver
  const approverMap = new Map();

  for (const leave of pendingLeaves) {
    const level = leave.status === 'pending' ? 1 : 2;
    const stepSettings = settings.find(s => s.step === level);
    if (!stepSettings?.approvers) continue;

    // Find matching approvers based on department/position
    for (const approverConfig of stepSettings.approvers) {
      const deptMatch = !approverConfig.departments?.length || approverConfig.departments.includes(leave.department);
      const posMatch = !approverConfig.positions?.length || approverConfig.positions.includes(leave.position);
      
      if (deptMatch && posMatch && approverConfig.user_ids?.length) {
        // Get approver users
        const approversResult = await pool.query(`
          SELECT id, email, firstname, lastname FROM users WHERE id = ANY($1)
        `, [approverConfig.user_ids]);

        for (const approver of approversResult.rows) {
          if (!approverMap.has(approver.id)) {
            approverMap.set(approver.id, { approver, leaves: [] });
          }
          approverMap.get(approver.id).leaves.push(leave);
        }
      }
    }
  }

  return Array.from(approverMap.values());
};

// Send reminders to all approvers with pending leaves
export const sendPendingLeaveReminders = async () => {
  console.log('[LeaveReminder] Starting pending leave reminder job...');
  
  try {
    const approversWithLeaves = await getPendingLeavesForReminder();
    
    if (approversWithLeaves.length === 0) {
      console.log('[LeaveReminder] No pending leaves found');
      return { success: true, sent: 0 };
    }

    let sentCount = 0;
    for (const { approver, leaves } of approversWithLeaves) {
      const result = await sendPendingLeaveReminder(approver, leaves);
      if (result.success) sentCount++;
    }

    console.log(`[LeaveReminder] Sent ${sentCount}/${approversWithLeaves.length} reminders`);
    return { success: true, sent: sentCount, total: approversWithLeaves.length };
  } catch (error) {
    console.error('[LeaveReminder] Error:', error);
    return { success: false, error: error.message };
  }
};
