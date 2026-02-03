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
async function sendDailySummaryEmail(user, steps) {
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
            <tr style="border-top:1px solid #dee2e6;">
              <td style="padding:8px 12px;font-size:13px;">${s.task_name || '-'}</td>
              <td style="padding:8px 12px;font-size:13px;font-weight:500;">${s.step_name}</td>
              <td style="padding:8px 12px;font-size:13px;">${formatDate(s.end_date)}</td>
            </tr>
          `).join('')}
        </table>
      </td></tr>`;
  };

  const html = `<!DOCTYPE html>
<html lang="th">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f3f5;font-family:Arial,sans-serif;">
  <center style="width:100%;padding:24px 12px;">
    <table width="600" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden;">
      <tr><td style="background:linear-gradient(135deg,#4A90E2,#2563eb);padding:24px;text-align:center;">
        <div style="font-size:32px;">📋</div>
        <div style="color:#fff;font-size:20px;font-weight:bold;margin-top:8px;">สรุป Workflow ประจำวัน</div>
        <div style="color:rgba(255,255,255,0.8);font-size:14px;margin-top:4px;">${new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
      </td></tr>
      
      <tr><td style="padding:16px 24px 8px;">
        <div style="font-size:14px;color:#666;">สวัสดีครับ คุณ${user.firstname},</div>
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
      subject: `📋 สรุป Workflow - ${overdue.length > 0 ? `🔴 เกินกำหนด ${overdue.length}` : `${inProgress.length + dueSoon.length + newToday.length} รายการ`}`,
      html
    });
    console.log(`📧 Sent daily summary to ${user.email}`);
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
  const urgentBg = daysLeft <= 3 ? '#fef2f2' : '#fff7ed';
  const urgentBorder = daysLeft <= 3 ? '#fee2e2' : '#ffedd5';
  const urgentColor = daysLeft <= 3 ? '#dc2626' : '#ea580c';
  const urgentTextColor = daysLeft <= 3 ? '#991b1b' : '#9a3412';

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f4f7f9;font-family:Tahoma,Arial,sans-serif;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#f4f7f9;">
    <tr>
      <td align="center" style="padding:40px 10px;">
        <table role="presentation" width="550" border="0" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-collapse:collapse;">
          
          <!-- Header -->
          <tr>
            <td align="center" style="background-color:#4A90E2;padding:40px 20px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr><td align="center" style="font-size:45px;line-height:1;">📋</td></tr>
                <tr><td align="center" style="color:#ffffff;font-size:24px;font-weight:bold;padding-top:10px;">งานใหม่สำหรับคุณ!</td></tr>
                <tr><td align="center" style="color:#ffffff;font-size:14px;padding-top:5px;">มอบหมายโดยระบบ GenT-CEM</td></tr>
              </table>
            </td>
          </tr>

          <!-- Project Info -->
          <tr>
            <td style="padding:30px 32px 10px;">
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#f8faff;border-left:4px solid #4A90E2;">
                <tr>
                  <td style="padding:20px;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                      <tr><td style="font-size:11px;color:#4A90E2;font-weight:bold;text-transform:uppercase;">โครงการ</td></tr>
                      <tr><td style="font-size:18px;color:#1a1a2e;font-weight:bold;padding-top:4px;">${step.task_name || '-'}</td></tr>
                      ${step.so_number ? `<tr><td style="font-size:13px;color:#666666;padding-top:2px;">SO: ${step.so_number}</td></tr>` : ''}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Step Details -->
          <tr>
            <td style="padding:10px 32px;">
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border:1px solid #eef0f2;">
                <tr>
                  <td style="padding:20px;">
                    <!-- Step Name -->
                    <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="40" valign="top" style="font-size:24px;">🎯</td>
                        <td valign="top">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                            <tr><td style="font-size:12px;color:#888888;">ขั้นตอนที่ได้รับมอบหมาย</td></tr>
                            <tr><td style="font-size:17px;color:#D73527;font-weight:bold;">${step.step_name}</td></tr>
                          </table>
                        </td>
                      </tr>
                    </table>

                    <!-- Dates -->
                    <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top:20px;">
                      <tr>
                        ${step.start_date ? `
                        <td width="50%" valign="top" style="padding-right:8px;">
                          <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #dcfce7;">
                            <tr><td style="padding:12px;">
                              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                                <tr><td style="font-size:11px;color:#16a34a;font-weight:bold;">📅 วันที่เริ่ม</td></tr>
                                <tr><td style="font-size:14px;color:#166534;font-weight:bold;padding-top:4px;">${formatDate(step.start_date)}</td></tr>
                              </table>
                            </td></tr>
                          </table>
                        </td>` : ''}
                        ${step.end_date ? `
                        <td width="50%" valign="top" style="padding-left:8px;">
                          <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:${urgentBg};border:1px solid ${urgentBorder};">
                            <tr><td style="padding:12px;">
                              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                                <tr><td style="font-size:11px;color:${urgentColor};font-weight:bold;">⏰ กำหนดส่ง</td></tr>
                                <tr><td style="font-size:14px;color:${urgentTextColor};font-weight:bold;padding-top:4px;">${formatDate(step.end_date)}</td></tr>
                              </table>
                            </td></tr>
                          </table>
                        </td>` : ''}
                      </tr>
                    </table>

                    ${step.description ? `
                    <!-- Description -->
                    <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top:15px;border-top:1px dashed #e2e8f0;">
                      <tr><td style="padding-top:15px;">
                        <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                          <tr><td style="font-size:11px;color:#94a3b8;font-weight:bold;text-transform:uppercase;">📝 รายละเอียดงาน</td></tr>
                          <tr><td style="font-size:13px;color:#475569;line-height:1.6;padding-top:5px;">${step.description}</td></tr>
                        </table>
                      </td></tr>
                    </table>` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:20px 32px 40px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr><td style="color:#888888;font-size:12px;padding-bottom:20px;">กรุณาเข้าสู่ระบบเพื่อดำเนินการหรืออัปเดตสถานะงาน</td></tr>
                <tr>
                  <td align="center" style="background-color:#4A90E2;padding:12px 30px;">
                    <a href="#" style="color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;">เข้าสู่ระบบ GenT-CEM</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:20px;background-color:#f9fafb;border-top:1px solid #edf2f7;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr><td align="center" style="color:#999999;font-size:11px;">GenT-CEM • Workflow Management Solution</td></tr>
                <tr><td align="center" style="color:#999999;font-size:11px;">Automated Notification - Please do not reply</td></tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
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
  
  const stepsHtml = steps.map(s => `
          <tr>
            <td style="padding:0 0 15px 0;">
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border:1px solid #eeeeee;">
                <tr>
                  <td width="5" style="background-color:#4A90E2;"></td>
                  <td style="padding:15px 20px;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                      <tr><td style="font-size:11px;color:#4A90E2;font-weight:bold;text-transform:uppercase;">${s.task_name || 'Workflow'}</td></tr>
                      <tr><td style="font-size:17px;color:#1a1a2e;font-weight:bold;padding-top:4px;">${s.step_name}</td></tr>
                      ${s.description ? `<tr><td style="font-size:13px;color:#666666;padding-top:6px;">${s.description}</td></tr>` : ''}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:Tahoma,Arial,sans-serif;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;">
    <tr>
      <td align="center" style="padding:40px 10px;">
        <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-collapse:collapse;">
          
          <!-- Header -->
          <tr>
            <td align="center" style="background-color:#D73527;padding:45px 40px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr><td align="center" style="font-size:50px;line-height:1;">⏰</td></tr>
                <tr><td align="center" style="color:#ffffff;font-size:26px;font-weight:bold;padding-top:15px;">งานครบกำหนดพรุ่งนี้!</td></tr>
                <tr><td align="center" style="color:#ffffff;font-size:16px;padding-top:10px;">${formatDate(tomorrow)}</td></tr>
              </table>
            </td>
          </tr>

          <!-- Count Badge -->
          <tr>
            <td style="padding:30px 35px;">
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:20px;background-color:#fff5f5;border:2px dashed #D73527;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:32px;font-weight:bold;color:#D73527;">${steps.length}</td>
                        <td style="font-size:16px;color:#666666;font-weight:bold;padding-left:10px;">รายการที่ต้องส่ง</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Steps List -->
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top:25px;">
                ${stepsHtml}
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:0 35px 40px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="background-color:#4A90E2;padding:15px 30px;">
                    <a href="#" style="color:#ffffff;font-size:17px;font-weight:bold;text-decoration:none;">💪 ตรวจสอบงานในระบบ</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:25px;background-color:#f9f9f9;border-top:1px solid #f0f0f0;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr><td align="center" style="color:#a0a0a0;font-size:12px;font-weight:bold;">GenT-CEM</td></tr>
                <tr><td align="center" style="color:#a0a0a0;font-size:12px;">Digital Workflow Solution</td></tr>
                <tr><td align="center" style="color:#a0a0a0;font-size:11px;padding-top:5px;">อีเมลฉบับนี้เป็นการแจ้งเตือนอัตโนมัติ กรุณาอย่าตอบกลับ</td></tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
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
