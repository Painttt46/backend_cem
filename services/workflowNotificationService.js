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

// ส่ง email สรุปรายวัน
async function sendDailySummaryEmail(user, steps, highlightStepId = null) {
  const { overdue, dueSoon, inProgress, newToday } = steps;
  
  if (overdue.length === 0 && dueSoon.length === 0 && inProgress.length === 0 && newToday.length === 0) {
    return; // ไม่มีงาน ไม่ต้องส่ง
  }

  const formatDate = (date) => date ? new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '-';
  
  const renderSection = (title, emoji, items, color) => {
    if (items.length === 0) return '';
    return `
      <tr><td style="padding:16px 24px 8px;">
        <div style="font-size:16px;font-weight:bold;color:${color};">${emoji} ${title} (${items.length})</div>
      </td></tr>
      <tr><td style="padding:0 24px 16px;">
        <table style="width:100%;border-collapse:collapse;background:#f8f9fa;border-radius:8px;">
          <tr style="background:#e9ecef;">
            <td style="padding:8px 12px;font-weight:bold;font-size:12px;">โครงการ</td>
            <td style="padding:8px 12px;font-weight:bold;font-size:12px;">Step</td>
            <td style="padding:8px 12px;font-weight:bold;font-size:12px;">กำหนด</td>
          </tr>
          ${items.map(s => `
            <tr style="border-top:1px solid #dee2e6;${s.id === highlightStepId ? 'background:#fff3cd;' : ''}">
              <td style="padding:8px 12px;font-size:13px;">${s.task_name || '-'}${s.id === highlightStepId ? ' ⭐' : ''}</td>
              <td style="padding:8px 12px;font-size:13px;font-weight:500;">${s.step_name}</td>
              <td style="padding:8px 12px;font-size:13px;">${formatDate(s.end_date)}</td>
            </tr>
          `).join('')}
        </table>
      </td></tr>`;
  };

  const isUpdate = highlightStepId !== null;
  const headerText = isUpdate ? 'อัปเดต Workflow' : 'สรุป Workflow ประจำวัน';

  const html = `<!DOCTYPE html>
<html lang="th">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f3f5;font-family:Arial,sans-serif;">
  <center style="width:100%;padding:24px 12px;">
    <table width="600" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden;">
      <tr><td style="background:linear-gradient(135deg,${isUpdate ? '#fd7e14,#dc3545' : '#4A90E2,#2563eb'});padding:24px;text-align:center;">
        <div style="font-size:32px;">${isUpdate ? '🔔' : '📋'}</div>
        <div style="color:#fff;font-size:20px;font-weight:bold;margin-top:8px;">${headerText}</div>
        <div style="color:rgba(255,255,255,0.8);font-size:14px;margin-top:4px;">${new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
      </td></tr>
      
      <tr><td style="padding:16px 24px 8px;">
        <div style="font-size:14px;color:#666;">สวัสดีครับ คุณ${user.firstname},${isUpdate ? ' <span style="color:#fd7e14;font-weight:bold;">มีการอัปเดตใหม่ (⭐)</span>' : ''}</div>
      </td></tr>
      
      ${renderSection('เกินกำหนดแล้ว', '🔴', overdue, '#dc3545')}
      ${renderSection('ใกล้ครบกำหนด (1-4 วัน)', '🟠', dueSoon, '#fd7e14')}
      ${renderSection('กำลังดำเนินการ', '🔵', inProgress, '#0d6efd')}
      ${renderSection('งานใหม่วันนี้', '🟢', newToday, '#198754')}
      
      <tr><td style="padding:24px;text-align:center;border-top:1px solid #e9ecef;">
        <div style="color:#888;font-size:12px;">GenT-CEM Workflow Notification</div>
      </td></tr>
    </table>
  </center>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: `${isUpdate ? '🔔 อัปเดต' : '📋 สรุป'} Workflow - ${overdue.length > 0 ? `🔴 เกินกำหนด ${overdue.length}` : `${inProgress.length + dueSoon.length + newToday.length} รายการ`}`,
      html
    });
    console.log(`📧 Sent ${isUpdate ? 'update' : 'daily'} summary to ${user.email}`);
  } catch (error) {
    console.error('Email send error:', error);
  }
}

// ตรวจสอบและส่งสรุปรายวัน
async function checkAndNotifyDaily() {
  const today = new Date().toISOString().split('T')[0];
  
  try {
    // ดึง users ทั้งหมดที่มี email
    const usersResult = await pool.query('SELECT id, firstname, lastname, email FROM users WHERE email IS NOT NULL');
    
    for (const user of usersResult.rows) {
      // ดึง steps ที่ user เป็นผู้รับผิดชอบ
      const stepsResult = await pool.query(`
        SELECT ts.*, t.task_name, t.so_number
        FROM task_steps ts
        JOIN tasks t ON ts.task_id = t.id
        WHERE ts.assigned_users @> $1::jsonb
          AND (ts.status IS NULL OR ts.status != 'completed')
        ORDER BY ts.end_date ASC NULLS LAST
      `, [JSON.stringify([{ id: user.id }])]);
      
      // ถ้าไม่เจอแบบ object ลองแบบ id ตรงๆ
      let steps = stepsResult.rows;
      if (steps.length === 0) {
        const stepsResult2 = await pool.query(`
          SELECT ts.*, t.task_name, t.so_number
          FROM task_steps ts
          JOIN tasks t ON ts.task_id = t.id
          WHERE ts.assigned_users::text LIKE $1
            AND (ts.status IS NULL OR ts.status != 'completed')
          ORDER BY ts.end_date ASC NULLS LAST
        `, [`%"id":${user.id}%`]);
        steps = stepsResult2.rows;
      }
      
      if (steps.length === 0) continue;
      
      // แยกประเภท
      const overdue = [];
      const dueSoon = [];
      const inProgress = [];
      const newToday = [];
      
      for (const step of steps) {
        const startDate = step.start_date ? new Date(step.start_date).toISOString().split('T')[0] : null;
        const endDate = step.end_date ? new Date(step.end_date).toISOString().split('T')[0] : null;
        
        // งานใหม่วันนี้
        if (startDate === today) {
          newToday.push(step);
        }
        
        if (endDate) {
          const daysLeft = Math.ceil((new Date(endDate) - new Date(today)) / (1000 * 60 * 60 * 24));
          
          if (daysLeft < 0) {
            overdue.push(step);
          } else if (daysLeft <= 4) {
            dueSoon.push(step);
          } else {
            inProgress.push(step);
          }
        } else {
          inProgress.push(step);
        }
      }
      
      await sendDailySummaryEmail(user, { overdue, dueSoon, inProgress, newToday });
    }
  } catch (error) {
    console.error('Daily workflow notification error:', error);
  }
}

// แจ้งเตือนเมื่อ step ก่อนหน้าเสร็จ
export async function notifyNextStep(taskId, completedStepOrder) {
  try {
    const result = await pool.query(`
      SELECT ts.*, t.task_name, u.email, u.firstname
      FROM task_steps ts
      JOIN tasks t ON ts.task_id = t.id
      CROSS JOIN LATERAL jsonb_array_elements(ts.assigned_users) AS au
      JOIN users u ON (au->>'id')::int = u.id
      WHERE ts.task_id = $1 AND ts.step_order = $2
    `, [taskId, completedStepOrder + 1]);

    if (result.rows.length > 0) {
      const step = result.rows[0];
      const emails = [...new Set(result.rows.map(r => r.email).filter(Boolean))];
      
      if (emails.length > 0) {
        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f2f3f5;font-family:Arial,sans-serif;">
  <center style="padding:24px;">
    <table width="500" style="background:#fff;border-radius:8px;overflow:hidden;">
      <tr><td style="background:#198754;padding:20px;text-align:center;">
        <div style="font-size:36px;">🚀</div>
        <div style="color:#fff;font-size:18px;font-weight:bold;">ถึงคิวงานของคุณแล้ว!</div>
      </td></tr>
      <tr><td style="padding:24px;">
        <p style="margin:0 0 12px;color:#666;">Step ก่อนหน้าเสร็จแล้ว งานต่อไปนี้พร้อมให้คุณดำเนินการ:</p>
        <table style="width:100%;background:#f8f9fa;border-radius:6px;padding:12px;">
          <tr><td style="padding:8px;color:#888;">โครงการ</td><td style="padding:8px;font-weight:bold;">${step.task_name}</td></tr>
          <tr><td style="padding:8px;color:#888;">Step</td><td style="padding:8px;font-weight:bold;">${step.step_name}</td></tr>
          ${step.end_date ? `<tr><td style="padding:8px;color:#888;">กำหนดเสร็จ</td><td style="padding:8px;">${new Date(step.end_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}</td></tr>` : ''}
        </table>
      </td></tr>
      <tr><td style="padding:16px 24px;text-align:center;border-top:1px solid #e9ecef;color:#888;font-size:12px;">GenT-CEM</td></tr>
    </table>
  </center>
</body></html>`;

        await transporter.sendMail({
          from: process.env.EMAIL_FROM,
          to: emails.join(','),
          subject: `🚀 ถึงคิวงานของคุณ: ${step.step_name} - ${step.task_name}`,
          html
        });
        console.log(`📧 Sent next step notification to ${emails.join(', ')}`);
      }
    }
  } catch (error) {
    console.error('Notify next step error:', error);
  }
}

// เริ่ม cron job ทุกวันจันทร์-ศุกร์ 9:00 น.
export function startWorkflowScheduler() {
  // สรุปรายวัน + แจ้งเตือนก่อน 1 วัน 9:00 น.
  cron.schedule('0 9 * * 1-5', () => {
    console.log('🔔 Running daily workflow summary...');
    checkAndNotifyDaily();
    console.log('⏰ Running due tomorrow reminder...');
    notifyDueTomorrow();
  }, { timezone: 'Asia/Bangkok' });
  
  console.log('✅ Workflow notification scheduler started (Mon-Fri at 9:00 AM)');
}

// ส่งแจ้งเตือนทันทีเมื่อมีการสร้าง/เปลี่ยนแปลง step (เรียกจาก API)
export async function notifyStepUpdate(stepId, taskId) {
  const today = new Date().toISOString().split('T')[0];
  
  try {
    console.log(`🔍 notifyStepUpdate: stepId=${stepId}, taskId=${taskId}`);
    
    // ดึงข้อมูล step ที่เปลี่ยน
    const stepResult = await pool.query(`
      SELECT ts.*, t.task_name FROM task_steps ts
      JOIN tasks t ON ts.task_id = t.id WHERE ts.id = $1
    `, [stepId]);
    
    if (stepResult.rows.length === 0) {
      console.log('❌ Step not found');
      return;
    }
    const changedStep = stepResult.rows[0];
    console.log(`📋 Step: ${changedStep.step_name}, assigned_users:`, changedStep.assigned_users);
    
    // หา users ที่เป็นผู้รับผิดชอบ step นี้
    const assignedUsers = changedStep.assigned_users || [];
    if (assignedUsers.length === 0) {
      console.log('❌ No assigned users');
      return;
    }
    
    const userIds = assignedUsers.map(u => typeof u === 'object' ? u.id : u).filter(Boolean);
    console.log(`👥 User IDs:`, userIds);
    if (userIds.length === 0) {
      console.log('❌ No valid user IDs');
      return;
    }
    
    const usersResult = await pool.query(
      'SELECT id, firstname, lastname, email FROM users WHERE id = ANY($1) AND email IS NOT NULL',
      [userIds]
    );
    console.log(`📧 Found ${usersResult.rows.length} users with email`);
    
    for (const user of usersResult.rows) {
      // ดึง steps ทั้งหมดของ user
      const stepsResult = await pool.query(`
        SELECT ts.*, t.task_name, t.so_number
        FROM task_steps ts
        JOIN tasks t ON ts.task_id = t.id
        WHERE ts.assigned_users::text LIKE $1
          AND (ts.status IS NULL OR ts.status != 'completed')
        ORDER BY ts.end_date ASC NULLS LAST
      `, [`%"id":${user.id}%`]);
      
      const steps = stepsResult.rows;
      console.log(`📊 User ${user.firstname}: ${steps.length} steps`);
      if (steps.length === 0) continue;
      
      // แยกประเภท
      const overdue = [], dueSoon = [], inProgress = [], newToday = [];
      
      for (const step of steps) {
        const startDate = step.start_date ? new Date(step.start_date).toISOString().split('T')[0] : null;
        const endDate = step.end_date ? new Date(step.end_date).toISOString().split('T')[0] : null;
        
        if (startDate === today) newToday.push(step);
        
        if (endDate) {
          const daysLeft = Math.ceil((new Date(endDate) - new Date(today)) / (1000 * 60 * 60 * 24));
          if (daysLeft < 0) overdue.push(step);
          else if (daysLeft <= 4) dueSoon.push(step);
          else inProgress.push(step);
        } else {
          inProgress.push(step);
        }
      }
      
      await sendDailySummaryEmail(user, { overdue, dueSoon, inProgress, newToday }, stepId);
    }
  } catch (error) {
    console.error('Notify step update error:', error);
  }
}

// แจ้งเตือนเฉพาะผู้รับผิดชอบใหม่ที่ถูกเพิ่ม
export async function notifyNewAssignees(stepId, taskId, newUserIds) {
  if (!newUserIds || newUserIds.length === 0) return;
  
  try {
    // ดึงข้อมูล step
    const stepResult = await pool.query(`
      SELECT ts.*, t.task_name, t.so_number FROM task_steps ts
      JOIN tasks t ON ts.task_id = t.id WHERE ts.id = $1
    `, [stepId]);
    
    if (stepResult.rows.length === 0) return;
    const step = stepResult.rows[0];
    
    // ดึงข้อมูล users
    const usersResult = await pool.query(
      'SELECT id, firstname, lastname, email FROM users WHERE id = ANY($1) AND email IS NOT NULL',
      [newUserIds]
    );
    
    for (const user of usersResult.rows) {
      await sendAssignmentEmail(user, step);
    }
  } catch (error) {
    console.error('Notify new assignees error:', error);
  }
}

// ส่ง email แจ้งเตือนเมื่อถูกเพิ่มเป็นผู้รับผิดชอบ
async function sendAssignmentEmail(user, step) {
  const formatDate = (date) => date ? new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';
  const daysLeft = step.end_date ? Math.ceil((new Date(step.end_date) - new Date()) / (1000 * 60 * 60 * 24)) : null;

  const html = `<!DOCTYPE html>
<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
    body, table, td, div, p, a { font-family: 'Sarabun', 'Segoe UI', Tahoma, sans-serif !important; }
    .gradient-bg {
      background: #4A90E2; 
      background: linear-gradient(135deg, #4A90E2 0%, #D73527 100%);
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f9;">
  <center style="width:100%;background-color:#f4f7f9;padding:40px 0;">
    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:550px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.1);">
      
      <tr>
        <td valign="top" class="gradient-bg" style="padding:0;text-align:center;">
          <div style="padding:40px 20px;">
            <div style="font-size:45px;margin-bottom:10px;">📋</div>
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">งานใหม่สำหรับคุณ!</h1>
            <p style="margin:5px 0 0;color:#ffffff;font-size:14px;opacity:0.9;">มอบหมายโดยระบบ GenT-CEM</p>
          </div>
          </td>
      </tr>

      <tr>
        <td style="padding:30px 32px 10px;">
          <div style="background-color:#f8faff;border-left:4px solid #4A90E2;border-radius:4px;padding:20px;">
            <div style="font-size:11px;color:#4A90E2;font-weight:700;text-transform:uppercase;letter-spacing:1px;">โครงการ</div>
            <div style="font-size:18px;color:#1a1a2e;font-weight:700;margin-top:4px;">${step.task_name || '-'}</div>
            ${step.so_number ? `<div style="font-size:13px;color:#666;margin-top:2px;">SO: ${step.so_number}</div>` : ''}
          </div>
        </td>
      </tr>

      <tr>
        <td style="padding:10px 32px;">
          <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border:1px solid #eef0f2;border-radius:12px;padding:20px;">
            <tr>
              <td>
                <table width="100%" border="0" cellspacing="0" cellpadding="0">
                  <tr>
                    <td width="40" valign="top"><span style="font-size:24px;">🎯</span></td>
                    <td>
                      <div style="font-size:12px;color:#888;">ขั้นตอนที่ได้รับมอบหมาย</div>
                      <div style="font-size:17px;color:#D73527;font-weight:700;">${step.step_name}</div>
                    </td>
                  </tr>
                </table>

                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top:20px;">
                  <tr>
                    ${step.start_date ? `
                    <td width="50%" style="padding-right:8px;">
                      <div style="background-color:#f0fdf4;border-radius:8px;padding:12px;border:1px solid #dcfce7;">
                        <div style="font-size:11px;color:#16a34a;font-weight:700;">📅 วันที่เริ่ม</div>
                        <div style="font-size:14px;color:#166534;font-weight:700;margin-top:4px;">${formatDate(step.start_date)}</div>
                      </div>
                    </td>` : ''}
                    ${step.end_date ? `
                    <td width="50%" style="padding-left:8px;">
                      <div style="background-color:${daysLeft <= 3 ? '#fef2f2' : '#fff7ed'};border-radius:8px;padding:12px;border:1px solid ${daysLeft <= 3 ? '#fee2e2' : '#ffedd5'};">
                        <div style="font-size:11px;color:${daysLeft <= 3 ? '#dc2626' : '#ea580c'};font-weight:700;">⏰ กำหนดส่ง</div>
                        <div style="font-size:14px;color:${daysLeft <= 3 ? '#991b1b' : '#9a3412'};font-weight:700;margin-top:4px;">${formatDate(step.end_date)}</div>
                      </div>
                    </td>` : ''}
                  </tr>
                </table>

                ${step.description ? `
                <div style="margin-top:15px;padding-top:15px;border-top:1px dashed #e2e8f0;">
                  <div style="font-size:11px;color:#94a3b8;font-weight:700;text-transform:uppercase;">📝 รายละเอียดงาน</div>
                  <div style="font-size:13px;color:#475569;line-height:1.6;margin-top:5px;">${step.description}</div>
                </div>` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:20px 32px 40px;text-align:center;">
          <div style="color:#888888;font-size:12px;margin-bottom:20px;">
            กรุณาเข้าสู่ระบบเพื่อดำเนินการหรืออัปเดตสถานะงาน
          </div>
          <a class="gradient-bg" href="#" style="display:inline-block;padding:0 30px;border-radius:8px;color:#ffffff;font-size:15px;font-weight:bold;line-height:45px;text-align:center;text-decoration:none;mso-hide:all;">เข้าสู่ระบบ GenT-CEM</a>
        </td>
      </tr>

      <tr>
        <td align="center" style="padding:20px;background-color:#f9fafb;border-top:1px solid #edf2f7;">
          <div style="color:#cbd5e1;font-size:11px;">
            GenT-CEM • Workflow Management Solution<br>
            Automated Notification - Please do not reply
          </div>
        </td>
      </tr>
    </table>
    </center>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: `📋 งานใหม่: ${step.step_name} - ${step.task_name}`,
      html
    });
    console.log(`📧 Sent assignment notification to ${user.email}`);
  } catch (error) {
    console.error('Email send error:', error);
  }
}

// แจ้งเตือนก่อน 1 วันเมื่อจะถึงวันกำหนดใน workflow step
async function notifyDueTomorrow() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  
  try {
    // ดึง steps ที่จะครบกำหนดพรุ่งนี้
    const stepsResult = await pool.query(`
      SELECT ts.*, t.task_name, t.so_number
      FROM task_steps ts
      JOIN tasks t ON ts.task_id = t.id
      WHERE DATE(ts.end_date) = $1
        AND (ts.status IS NULL OR ts.status != 'completed')
    `, [tomorrowStr]);
    
    if (stepsResult.rows.length === 0) {
      console.log('📅 No steps due tomorrow');
      return;
    }
    
    console.log(`📅 Found ${stepsResult.rows.length} steps due tomorrow`);
    
    // จัดกลุ่มตาม user
    const userSteps = {};
    
    for (const step of stepsResult.rows) {
      const assignedUsers = step.assigned_users || [];
      for (const au of assignedUsers) {
        const userId = au.id || au;
        if (!userSteps[userId]) userSteps[userId] = [];
        userSteps[userId].push(step);
      }
    }
    
    // ดึงข้อมูล users และส่ง email
    const userIds = Object.keys(userSteps).map(Number);
    if (userIds.length === 0) return;
    
    const usersResult = await pool.query(
      'SELECT id, firstname, lastname, email FROM users WHERE id = ANY($1) AND email IS NOT NULL',
      [userIds]
    );
    
    for (const user of usersResult.rows) {
      const steps = userSteps[user.id];
      if (!steps || steps.length === 0) continue;
      
      await sendDueTomorrowEmail(user, steps);
    }
  } catch (error) {
    console.error('Notify due tomorrow error:', error);
  }
}

// ส่ง email แจ้งเตือนก่อน 1 วัน
async function sendDueTomorrowEmail(user, steps) {
  const formatDate = (date) => date ? new Date(date).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '-';
  const tomorrow = new Date(Date.now() + 86400000);
  
  const html = `<!DOCTYPE html>
<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
    body, table, td, div, p, a { font-family: 'Sarabun', 'Segoe UI', sans-serif !important; }
    .gradient-bg {
      background: #4A90E2; /* Fallback */
      background: linear-gradient(135deg, #4A90E2 0%, #D73527 100%);
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;">
  <center style="width:100%;background-color:#f0f2f5;padding:40px 0;">
    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.15);">
      
      <tr>
        <td valign="top" class="gradient-bg" style="padding:0;">
          <div style="padding:45px 40px; text-align:center;">
            <div style="font-size:50px;margin-bottom:15px;line-height:1;">⏰</div>
            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;text-shadow: 0 2px 4px rgba(0,0,0,0.2);">งานครบกำหนดพรุ่งนี้!</h1>
            <p style="margin:10px 0 0;color:#ffffff;font-size:16px;opacity:0.9;">${formatDate(tomorrow)}</p>
          </div>
          </td>
      </tr>

      <tr>
        <td style="padding:30px 35px;">
          <div style="text-align:center;margin-bottom:25px;padding:20px;background-color:#fff5f5;border:2px dashed #D73527;border-radius:12px;">
            <span style="font-size:32px;font-weight:800;color:#D73527;">${steps.length}</span>
            <span style="font-size:16px;color:#666666;margin-left:10px;font-weight:700;">รายการที่ต้องส่ง</span>
          </div>

          ${steps.map((s, i) => `
          <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom:15px;border:1px solid #eeeeee;border-radius:10px;">
            <tr>
              <td width="5" class="gradient-bg" style="border-radius:10px 0 0 10px;">
                </td>
              <td style="padding:15px 20px;">
                <div style="font-size:11px;color:#4A90E2;font-weight:bold;text-transform:uppercase;margin-bottom:4px;letter-spacing:1px;">${s.task_name || 'Workflow'}</div>
                <div style="font-size:17px;color:#1a1a2e;font-weight:700;">${s.step_name}</div>
                ${s.description ? `<div style="font-size:13px;color:#666666;margin-top:6px;">${s.description}</div>` : ''}
              </td>
            </tr>
          </table>
          `).join('')}
        </td>
      </tr>

      <tr>
        <td style="padding:0 35px 40px;">
          <a class="gradient-bg" href="#" style="display:block;border-radius:10px;color:#ffffff;font-size:17px;font-weight:bold;line-height:55px;text-align:center;text-decoration:none;mso-hide:all;">💪 ตรวจสอบงานในระบบ</a>
        </td>
      </tr>

      <tr>
        <td align="center" style="padding:25px;background-color:#f9f9f9;border-top:1px solid #f0f0f0;">
          <div style="color:#a0a0a0;font-size:12px;line-height:1.6;">
            <strong>GenT-CEM</strong> • Digital Workflow Solution<br>
            อีเมลฉบับนี้เป็นการแจ้งเตือนอัตโนมัติ กรุณาอย่าตอบกลับ
          </div>
        </td>
      </tr>
    </table>
    </center>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: `⏰ ด่วน! ${steps.length} งานครบกำหนดพรุ่งนี้`,
      html
    });
    console.log(`📧 Sent due tomorrow reminder to ${user.email} (${steps.length} steps)`);
  } catch (error) {
    console.error('Email send error:', error);
  }
}

export { checkAndNotifyDaily, notifyDueTomorrow };
