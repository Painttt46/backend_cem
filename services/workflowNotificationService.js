import nodemailer from 'nodemailer';
import pool from '../config/database.js';
import cron from 'node-cron';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ดึง email ของผู้รับผิดชอบจาก assigned_users
async function getAssignedEmails(assignedUsers) {
  if (!assignedUsers || assignedUsers.length === 0) return [];
  
  const userIds = assignedUsers.map(u => typeof u === 'object' ? u.id : u).filter(Boolean);
  if (userIds.length === 0) return [];
  
  const result = await pool.query(
    'SELECT id, firstname, lastname, email FROM users WHERE id = ANY($1) AND email IS NOT NULL',
    [userIds]
  );
  return result.rows;
}

// ส่ง email แจ้งเตือน
async function sendStepNotification(users, step, task, type) {
  if (!users || users.length === 0) return;
  
  const emails = users.map(u => u.email).filter(Boolean);
  if (emails.length === 0) return;

  const typeConfig = {
    'step_started': {
      subject: `🚀 Step "${step.step_name}" เริ่มต้นแล้ว - ${task.task_name}`,
      emoji: '🚀',
      title: 'Step เริ่มต้นแล้ว',
      message: 'Step นี้พร้อมให้คุณดำเนินการแล้ว',
      color: '#4A90E2'
    },
    'step_due_today': {
      subject: `⏰ Step "${step.step_name}" ครบกำหนดวันนี้ - ${task.task_name}`,
      emoji: '⏰',
      title: 'ครบกำหนดวันนี้',
      message: 'Step นี้ครบกำหนดวันนี้ กรุณาตรวจสอบความคืบหน้า',
      color: '#F5A623'
    },
    'step_overdue': {
      subject: `🔴 Step "${step.step_name}" เกินกำหนด - ${task.task_name}`,
      emoji: '🔴',
      title: 'เกินกำหนดแล้ว',
      message: 'Step นี้เกินกำหนดแล้ว กรุณาดำเนินการโดยด่วน',
      color: '#D73527'
    }
  };

  const config = typeConfig[type];
  const assigneeNames = users.map(u => `${u.firstname} ${u.lastname}`).join(', ');

  const html = `<!DOCTYPE html>
<html lang="th">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f3f5;font-family:Arial,sans-serif;">
  <center style="width:100%;padding:24px 12px;">
    <table width="600" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden;">
      <tr><td style="background:${config.color};padding:24px;text-align:center;">
        <div style="font-size:48px;">${config.emoji}</div>
        <div style="color:#fff;font-size:24px;font-weight:bold;margin-top:12px;">${config.title}</div>
      </td></tr>
      <tr><td style="padding:24px;">
        <p style="color:#666;margin:0 0 16px;">${config.message}</p>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;">โครงการ</td>
              <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold;">${task.task_name}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;">Step</td>
              <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold;">${step.step_name}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#888;">ผู้รับผิดชอบ</td>
              <td style="padding:8px 0;border-bottom:1px solid #eee;">${assigneeNames}</td></tr>
          ${step.end_date ? `<tr><td style="padding:8px 0;color:#888;">กำหนดเสร็จ</td>
              <td style="padding:8px 0;font-weight:bold;color:${type === 'step_overdue' ? '#D73527' : '#333'};">${new Date(step.end_date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</td></tr>` : ''}
        </table>
        <div style="margin-top:24px;text-align:center;">
          <a href="${process.env.FRONTEND_URL || 'http://172.30.101.52:3000'}/daily-work" 
             style="background:${config.color};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
            ดูรายละเอียด
          </a>
        </div>
      </td></tr>
      <tr><td style="background:#f8f9fa;padding:16px;text-align:center;color:#888;font-size:12px;">
        GenT-CEM Workflow Notification
      </td></tr>
    </table>
  </center>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: emails.join(','),
      subject: config.subject,
      html
    });
    console.log(`📧 Sent ${type} notification for step "${step.step_name}" to ${emails.join(', ')}`);
  } catch (error) {
    console.error('Email send error:', error);
  }
}

// ตรวจสอบและส่งแจ้งเตือน
async function checkAndNotify() {
  const today = new Date().toISOString().split('T')[0];
  
  try {
    // ดึง steps ที่มีผู้รับผิดชอบและยังไม่เสร็จ
    const result = await pool.query(`
      SELECT ts.*, t.task_name, t.so_number
      FROM task_steps ts
      JOIN tasks t ON ts.task_id = t.id
      WHERE ts.assigned_users IS NOT NULL 
        AND jsonb_array_length(ts.assigned_users) > 0
        AND (ts.status IS NULL OR ts.status != 'completed')
    `);

    for (const step of result.rows) {
      const users = await getAssignedEmails(step.assigned_users);
      if (users.length === 0) continue;

      const task = { task_name: step.task_name, so_number: step.so_number };
      
      // เช็ค start_date = วันนี้ (แจ้งเริ่มงาน)
      if (step.start_date) {
        const startDate = new Date(step.start_date).toISOString().split('T')[0];
        if (startDate === today && !step.notified_start) {
          await sendStepNotification(users, step, task, 'step_started');
          await pool.query('UPDATE task_steps SET notified_start = true WHERE id = $1', [step.id]);
        }
      }

      // เช็ค end_date = วันนี้ (แจ้งครบกำหนด)
      if (step.end_date) {
        const endDate = new Date(step.end_date).toISOString().split('T')[0];
        if (endDate === today && !step.notified_due) {
          await sendStepNotification(users, step, task, 'step_due_today');
          await pool.query('UPDATE task_steps SET notified_due = true WHERE id = $1', [step.id]);
        }
        // เช็ค overdue (เกินกำหนด)
        else if (endDate < today && !step.notified_overdue) {
          await sendStepNotification(users, step, task, 'step_overdue');
          await pool.query('UPDATE task_steps SET notified_overdue = true WHERE id = $1', [step.id]);
        }
      }
    }
  } catch (error) {
    console.error('Workflow notification check error:', error);
  }
}

// แจ้งเตือนเมื่อ step ก่อนหน้าเสร็จ (เรียกจาก API)
export async function notifyNextStep(taskId, completedStepOrder) {
  try {
    const result = await pool.query(`
      SELECT ts.*, t.task_name, t.so_number
      FROM task_steps ts
      JOIN tasks t ON ts.task_id = t.id
      WHERE ts.task_id = $1 AND ts.step_order = $2
    `, [taskId, completedStepOrder + 1]);

    if (result.rows.length > 0) {
      const nextStep = result.rows[0];
      const users = await getAssignedEmails(nextStep.assigned_users);
      if (users.length > 0) {
        await sendStepNotification(users, nextStep, { task_name: nextStep.task_name }, 'step_started');
      }
    }
  } catch (error) {
    console.error('Notify next step error:', error);
  }
}

// เริ่ม cron job ตรวจสอบทุกวัน 8:00 น.
export function startWorkflowScheduler() {
  cron.schedule('0 8 * * *', () => {
    console.log('🔔 Running workflow notification check...');
    checkAndNotify();
  }, { timezone: 'Asia/Bangkok' });
  
  console.log('✅ Workflow notification scheduler started (daily at 8:00 AM)');
}

export { checkAndNotify };
