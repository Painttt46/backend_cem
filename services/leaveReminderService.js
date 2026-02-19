import pool from '../config/database.js';
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
  // Get all pending leaves > 24 hours
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

  if (pendingLeaves.length === 0) return [];

  // Get all approver settings
  const settingsResult = await pool.query(`
    SELECT las.user_id, las.approval_level, las.department_ids, las.position_ids,
           u.id, u.email, u.firstname, u.lastname
    FROM leave_approval_settings las
    JOIN users u ON las.user_id = u.id
    WHERE las.can_approve = true AND las.receive_email = true AND u.email IS NOT NULL
  `);
  const approverSettings = settingsResult.rows;

  // Group by approver
  const approverMap = new Map();

  for (const leave of pendingLeaves) {
    const level = leave.status === 'pending' ? 1 : 2;

    for (const setting of approverSettings) {
      if (setting.approval_level !== level) continue;

      const deptIds = (setting.department_ids || []).map(d => d.toLowerCase());
      const posIds = (setting.position_ids || []).map(p => p.toLowerCase());
      const deptMatch = deptIds.length === 0 || deptIds.includes((leave.department || '').toLowerCase());
      const posMatch = posIds.length === 0 || posIds.includes((leave.position || '').toLowerCase());

      if (deptMatch && posMatch) {
        const approver = { id: setting.user_id, email: setting.email, firstname: setting.firstname, lastname: setting.lastname };
        if (!approverMap.has(approver.id)) {
          approverMap.set(approver.id, { approver, leaves: [] });
        }
        approverMap.get(approver.id).leaves.push(leave);
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
