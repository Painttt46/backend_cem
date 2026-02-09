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
    return;
  }

  const formatDate = (date) => date ? new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '-';
  const thaiDate = new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  const renderSection = (title, emoji, items, bgColor, borderColor, textColor) => {
    if (items.length === 0) return '';
    return `
      <tr>
        <td style="padding:20px 32px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bgColor};border-left:4px solid ${borderColor};border-radius:0 8px 8px 0;">
            <tr>
              <td style="padding:16px 20px;">
                <div style="font-size:15px;font-weight:bold;color:${textColor};margin-bottom:12px;">${emoji} ${title} (${items.length})</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr style="background:rgba(0,0,0,0.05);">
                    <td style="padding:10px 12px;font-weight:bold;font-size:12px;color:#555;width:45%;">โครงการ</td>
                    <td style="padding:10px 12px;font-weight:bold;font-size:12px;color:#555;width:35%;">Step</td>
                    <td style="padding:10px 12px;font-weight:bold;font-size:12px;color:#555;width:20%;text-align:center;">กำหนด</td>
                  </tr>
                  ${items.map(s => `
                  <tr style="border-top:1px solid rgba(0,0,0,0.08);">
                    <td style="padding:10px 12px;font-size:13px;color:#333;">${s.task_name || '-'}</td>
                    <td style="padding:10px 12px;font-size:13px;color:#333;font-weight:600;">${s.step_name}</td>
                    <td style="padding:10px 12px;font-size:13px;color:${textColor};font-weight:bold;text-align:center;">${formatDate(s.end_date)}</td>
                  </tr>`).join('')}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  };

  const totalTasks = overdue.length + dueSoon.length + inProgress.length + newToday.length;

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f2f3f5;">
  <center style="width:100%;background:#f2f3f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f3f5;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
            
            <!-- Logo -->
            <tr>
              <td align="center" style="padding:15px;font-family:Arial,Helvetica,sans-serif;font-size:22px;color:#190c86;border-bottom:1px solid #eee;">
                <div>Gen T Excellency Management</div>
              </td>
            </tr>

            <!-- Header -->
            <tr>
              <td align="center" style="padding:0;background-color:#4A90E2;background:linear-gradient(135deg,#4A90E2,#D73527);">
                <!--[if gte mso 9]>
                <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:140px;">
                  <v:fill type="gradient" color="#4A90E2" color2="#D73527" angle="135"/>
                  <v:textbox inset="0,0,0,0">
                    <div>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" height="140" align="center">
                        <tr>
                          <td align="center" valign="middle">
                            <div style="font-family:Arial,sans-serif;font-size:44px;color:#ffffff;">📋</div>
                            <div style="font-family:Arial,sans-serif;font-size:24px;color:#ffffff;font-weight:bold;">สรุป Workflow ประจำวัน</div>
                            <div style="font-family:Arial,sans-serif;font-size:14px;color:#ffffff;">${thaiDate}</div>
                          </td>
                        </tr>
                      </table>
                    </div>
                  </v:textbox>
                </v:rect>
                <![endif]-->
                <!--[if !mso]><!-->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="padding:30px 18px;">
                      <div style="font-family:Arial,sans-serif;font-size:44px;color:#ffffff;">📋</div>
                      <div style="height:8px;"></div>
                      <div style="font-family:Arial,sans-serif;font-size:24px;color:#ffffff;font-weight:bold;">สรุป Workflow ประจำวัน</div>
                      <div style="font-family:Arial,sans-serif;font-size:14px;color:rgba(255,255,255,0.9);margin-top:6px;">${thaiDate}</div>
                    </td>
                  </tr>
                </table>
                <!--<![endif]-->
              </td>
            </tr>

            <!-- Greeting -->
            <tr>
              <td style="padding:24px 32px 0;font-family:Arial,Helvetica,sans-serif;">
                <div style="font-size:15px;color:#555;">สวัสดีครับ <span style="color:#1a1a2e;font-weight:bold;">คุณ${user.firstname}</span>,</div>
              </td>
            </tr>

            <!-- Summary Stats -->
            <tr>
              <td style="padding:16px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    ${overdue.length > 0 ? `<td align="center" style="padding:8px;"><div style="background:#fee2e2;border-radius:8px;padding:12px 8px;"><div style="font-size:24px;font-weight:bold;color:#dc2626;">${overdue.length}</div><div style="font-size:11px;color:#991b1b;">เกินกำหนด</div></div></td>` : ''}
                    ${dueSoon.length > 0 ? `<td align="center" style="padding:8px;"><div style="background:#ffedd5;border-radius:8px;padding:12px 8px;"><div style="font-size:24px;font-weight:bold;color:#ea580c;">${dueSoon.length}</div><div style="font-size:11px;color:#9a3412;">ใกล้ครบกำหนด</div></div></td>` : ''}
                    ${inProgress.length > 0 ? `<td align="center" style="padding:8px;"><div style="background:#dbeafe;border-radius:8px;padding:12px 8px;"><div style="font-size:24px;font-weight:bold;color:#2563eb;">${inProgress.length}</div><div style="font-size:11px;color:#1e40af;">กำลังดำเนินการ</div></div></td>` : ''}
                    ${newToday.length > 0 ? `<td align="center" style="padding:8px;"><div style="background:#dcfce7;border-radius:8px;padding:12px 8px;"><div style="font-size:24px;font-weight:bold;color:#16a34a;">${newToday.length}</div><div style="font-size:11px;color:#166534;">งานใหม่วันนี้</div></div></td>` : ''}
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Sections -->
            ${renderSection('เกินกำหนดแล้ว', '🔴', overdue, '#fef2f2', '#dc2626', '#dc2626')}
            ${renderSection('ใกล้ครบกำหนด (1-4 วัน)', '🟠', dueSoon, '#fff7ed', '#ea580c', '#ea580c')}
            ${renderSection('กำลังดำเนินการ', '🔵', inProgress, '#eff6ff', '#2563eb', '#2563eb')}
            ${renderSection('งานใหม่วันนี้', '🟢', newToday, '#f0fdf4', '#16a34a', '#16a34a')}

            <!-- Spacer -->
            <tr><td style="height:20px;"></td></tr>

            <!-- Footer -->
            <tr>
              <td style="background:#14143a;padding:20px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td>
                      <div style="font-family:Arial,sans-serif;font-size:14px;color:#ffffff;font-weight:bold;">GenT-CEM • Workflow Management</div>
                      <div style="font-family:Arial,sans-serif;font-size:12px;color:#aaaaaa;margin-top:6px;">อีเมลนี้ถูกส่งโดยอัตโนมัติ โปรดอย่าตอบกลับ</div>
                    </td>
                    <td align="right" style="font-family:Arial,sans-serif;font-size:11px;color:#888888;">
                      รวม ${totalTasks} รายการ
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>
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
      subject: `📋 สรุป Workflow - ${overdue.length > 0 ? `🔴 เกินกำหนด ${overdue.length}` : `${totalTasks} รายการ`}`,
      html
    });
    console.log(`📧 Sent daily summary to ${user.email}`);
  } catch (error) {
    console.error('Email send error:', error);
  }
}

// ส่ง email แจ้งเตือนงานเกินกำหนด
async function sendOverdueEmail(user, overdueSteps) {
  if (overdueSteps.length === 0) return;

  const formatDate = (date) => date ? new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
  const today = new Date();

  const html = `<!DOCTYPE html>
<html lang="th">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f3f5;font-family:Arial,sans-serif;">
  <center style="width:100%;padding:24px 12px;">
    <table width="600" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden;border:2px solid #dc3545;">
      <tr><td style="background:#dc3545;padding:24px;text-align:center;">
        <div style="font-size:40px;">⚠️</div>
        <div style="color:#fff;font-size:22px;font-weight:bold;margin-top:8px;">งานเกินกำหนด!</div>
        <div style="color:rgba(255,255,255,0.9);font-size:14px;margin-top:4px;">${overdueSteps.length} รายการต้องดำเนินการด่วน</div>
      </td></tr>
      
      <tr><td style="padding:20px 24px;">
        <div style="font-size:14px;color:#666;margin-bottom:16px;">สวัสดีครับ คุณ${user.firstname},</div>
        <div style="font-size:14px;color:#dc3545;font-weight:bold;margin-bottom:12px;">งานต่อไปนี้เกินกำหนดแล้ว กรุณาดำเนินการโดยด่วน:</div>
        
        <table style="width:100%;border-collapse:collapse;background:#fff5f5;border-radius:8px;border:1px solid #f5c6cb;">
          <tr style="background:#f8d7da;">
            <td style="padding:10px 12px;font-weight:bold;font-size:12px;color:#721c24;">โครงการ</td>
            <td style="padding:10px 12px;font-weight:bold;font-size:12px;color:#721c24;">Step</td>
            <td style="padding:10px 12px;font-weight:bold;font-size:12px;color:#721c24;">กำหนดเดิม</td>
            <td style="padding:10px 12px;font-weight:bold;font-size:12px;color:#721c24;">เกินมาแล้ว</td>
          </tr>
          ${overdueSteps.map(s => {
            const daysOverdue = Math.ceil((today - new Date(s.end_date)) / (1000 * 60 * 60 * 24));
            return `
            <tr style="border-top:1px solid #f5c6cb;">
              <td style="padding:10px 12px;font-size:13px;">${s.task_name || '-'}<br><span style="color:#888;font-size:11px;">${s.so_number || ''}</span></td>
              <td style="padding:10px 12px;font-size:13px;font-weight:600;">${s.step_name}</td>
              <td style="padding:10px 12px;font-size:13px;">${formatDate(s.end_date)}</td>
              <td style="padding:10px 12px;font-size:13px;color:#dc3545;font-weight:bold;">${daysOverdue} วัน</td>
            </tr>`;
          }).join('')}
        </table>
      </td></tr>
      
      <tr><td style="padding:16px 24px;text-align:center;border-top:1px solid #e9ecef;">
        <div style="color:#888;font-size:12px;">GenT-CEM Workflow - แจ้งเตือนงานเกินกำหนด</div>
      </td></tr>
    </table>
  </center>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: `🔴 ด่วน! งานเกินกำหนด ${overdueSteps.length} รายการ - กรุณาดำเนินการ`,
      html
    });
    console.log(`📧 Sent overdue alert to ${user.email} (${overdueSteps.length} items)`);
  } catch (error) {
    console.error('Overdue email send error:', error);
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
      
      // ส่ง email แจ้งเตือนงานเกินกำหนดแยกต่างหาก
      if (overdue.length > 0) {
        await sendOverdueEmail(user, overdue);
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
      const firstnames = [...new Set(result.rows.map(r => r.firstname).filter(Boolean))];
      
      if (emails.length > 0) {
        const formatDate = (date) => date ? new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';
        const daysLeft = step.end_date ? Math.ceil((new Date(step.end_date) - new Date()) / (1000 * 60 * 60 * 24)) : null;
        const isUrgent = daysLeft !== null && daysLeft <= 3;

        const html = `<!DOCTYPE html>
<html lang="th" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta http-equiv="x-ua-compatible" content="ie=edge" />
  <title>ถึงคิวงานของคุณ</title>
  <!--[if mso]>
  <xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch><o:AllowPNG/></o:OfficeDocumentSettings></xml>
  <![endif]-->
  <style>
    html,body{margin:0!important;padding:0!important;height:100%!important;width:100%!important}
    *{-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%}
    table,td{mso-table-lspace:0pt!important;mso-table-rspace:0pt!important;border-collapse:collapse!important}
    img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}
    a{text-decoration:none}
    @media screen and (max-width:600px){
      .container{width:100%!important}
      .px{padding-left:18px!important;padding-right:18px!important}
      .h1{font-size:22px!important;line-height:28px!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f2f3f5;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    Step ก่อนหน้าเสร็จแล้ว - ${step.step_name}
  </div>
  <center style="width:100%;background:#f2f3f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f3f5;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;">

            <!-- Logo -->
            <tr>
              <td align="center" style="padding:10px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:28px;color:#190c86;">
                <div>Gen T Excellency Management</div>
              </td>
            </tr>

            <!-- Hero -->
            <tr>
              <td align="center" style="padding:0;background-color:#4A90E2;background:linear-gradient(135deg,#4A90E2,#D73527);">
                <!--[if gte mso 9]>
                <v:rect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" fill="true" stroke="false" style="width:600px;height:120px;">
                  <v:fill type="gradient" color="#4A90E2" color2="#D73527" angle="135"/>
                  <v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text:false">
                    <div>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" height="120" align="center">
                        <tr>
                          <td align="center" valign="middle" style="padding:20px 18px;">
                            <div style="font-family:Arial,Helvetica,sans-serif;font-size:40px;line-height:40px;color:#ffffff;text-align:center;">🚀</div>
                            <div style="height:8px;line-height:8px;font-size:8px;">&nbsp;</div>
                            <div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;font-weight:bold;color:#ffffff;">ถึงคิวงานของคุณแล้ว!</div>
                          </td>
                        </tr>
                      </table>
                    </div>
                  </v:textbox>
                </v:rect>
                <![endif]-->
                <!--[if !mso]><!-->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="padding:20px 18px;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:40px;line-height:40px;color:#ffffff;text-align:center;">🚀</div>
                      <div style="height:8px;"></div>
                      <div class="h1" style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;color:#ffffff;font-weight:bold;">ถึงคิวงานของคุณแล้ว!</div>
                    </td>
                  </tr>
                </table>
                <!--<![endif]-->
              </td>
            </tr>

            ${isUrgent ? `
            <!-- Urgent Banner -->
            <tr>
              <td style="padding:15px 32px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fef2f2;border:2px solid #D73527;border-radius:8px;">
                  <tr>
                    <td align="center" style="padding:12px;">
                      <div style="font-family:Arial,sans-serif;font-size:15px;color:#D73527;font-weight:bold;">⚠️ งานนี้ใกล้ครบกำหนด - เหลือเวลาอีก ${daysLeft} วัน!</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>` : ''}

            <!-- Body -->
            <tr>
              <td class="px" style="padding:${isUrgent ? '15px' : '28px'} 42px 12px;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b;">
                <p style="margin:0 0 18px;font-size:16px;line-height:26px;">สวัสดี, <b>${firstnames.join(', ')}</b></p>
                <p style="margin:0 0 18px;font-size:16px;line-height:26px;">งานต่อไปนี้พร้อมให้คุณดำเนินการแล้ว:</p>

                <!-- Project Card -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8faff;border-left:4px solid #4A90E2;margin-bottom:20px;border-radius:0 8px 8px 0;">
                  <tr>
                    <td style="padding:15px;">
                      <div style="font-size:11px;color:#4A90E2;font-weight:bold;text-transform:uppercase;">โครงการ</div>
                      <div style="font-size:18px;color:#1a1a2e;font-weight:bold;margin-top:4px;">${step.task_name}</div>
                    </td>
                  </tr>
                </table>

                <!-- Step Name -->
                <p style="margin:0 0 8px;font-size:12px;color:#888888;">🎯 ขั้นตอนที่ต้องดำเนินการ</p>
                <p style="margin:0 0 18px;font-size:18px;color:#D73527;font-weight:bold;">${step.step_name}</p>

                <!-- Dates -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    ${step.start_date ? `
                    <td width="50%" valign="top" style="padding-right:8px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f0fdf4;border:1px solid #dcfce7;border-radius:8px;">
                        <tr><td style="padding:12px;">
                          <div style="font-size:11px;color:#16a34a;font-weight:bold;">📅 วันที่เริ่ม</div>
                          <div style="font-size:14px;color:#166534;font-weight:bold;margin-top:4px;">${formatDate(step.start_date)}</div>
                        </td></tr>
                      </table>
                    </td>` : ''}
                    ${step.end_date ? `
                    <td width="50%" valign="top" style="padding-left:8px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${isUrgent ? '#fef2f2' : '#fff7ed'};border:1px solid ${isUrgent ? '#fee2e2' : '#ffedd5'};border-radius:8px;">
                        <tr><td style="padding:12px;">
                          <div style="font-size:11px;color:${isUrgent ? '#dc2626' : '#ea580c'};font-weight:bold;">⏰ กำหนดส่ง</div>
                          <div style="font-size:14px;color:${isUrgent ? '#991b1b' : '#9a3412'};font-weight:bold;margin-top:4px;">${formatDate(step.end_date)}</div>
                        </td></tr>
                      </table>
                    </td>` : ''}
                  </tr>
                </table>

                ${step.description ? `
                <div style="margin-top:18px;padding-top:15px;border-top:1px dashed #e2e8f0;">
                  <div style="font-size:11px;color:#94a3b8;font-weight:bold;text-transform:uppercase;">📝 รายละเอียดงาน</div>
                  <div style="font-size:13px;color:#475569;line-height:1.6;margin-top:5px;">${step.description}</div>
                </div>` : ''}

              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background:#14143a;padding:18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:6px 8px;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#ffffff;font-weight:700;">GenT-CEM • Workflow Management Solution</div>
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#aaaaaa;margin-top:4px;">อีเมลนี้ถูกส่งโดยอัตโนมัติ โปรดอย่าตอบกลับ</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </center>
</body>
</html>`;

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

// ส่งสรุป workflow ไป MS Teams
async function sendWorkflowSummaryToTeams(highlightStepId = null, action = null) {
  const webhookUrl = 'https://defaultc5fc1b2a2ce84471ab9dbe65d8fe09.06.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/772efa7dba4846248602bec0f4ec9adf/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=u_vIlVoRaHZOEJ-gEE6SXcdJ-HZPpp3KN6-y1WSoGRI';
  
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // ดึง workflow steps ที่ยังไม่เสร็จ
    const result = await pool.query(`
      SELECT ts.*, t.task_name, t.so_number, t.id as task_id,
        TO_CHAR(ts.start_date, 'DD/MM') as start_fmt,
        TO_CHAR(ts.end_date, 'DD/MM') as end_fmt,
        (SELECT string_agg(u.firstname || ' ' || u.lastname, ', ')
         FROM jsonb_array_elements(ts.assigned_users) AS au
         JOIN users u ON u.id = (au->>'id')::int) as assignee_names,
        (SELECT COUNT(*) FROM daily_work_records dwr 
         WHERE dwr.step_id = ts.id AND dwr.work_date = $1) as work_count
      FROM task_steps ts
      JOIN tasks t ON ts.task_id = t.id
      WHERE (ts.status IS NULL OR ts.status NOT IN ('completed', 'cancelled'))
        AND t.status NOT IN ('completed', 'cancelled', 'closed')
      ORDER BY t.task_name, ts.step_order ASC
    `, [today]);

    if (result.rows.length === 0) {
      console.log('No active workflow steps');
      return;
    }

    // จัดกลุ่มตามโครงการ
    const projects = {};
    const actionText = action === 'create' ? '🆕' : action === 'update' ? '✏️' : '';
    
    // แปลงสถานะ step จาก DB เป็นภาษาไทย
    const stepStatusMap = {
      'completed': 'เสร็จสิ้น',
      'in_progress': 'กำลังดำเนินการ',
      'pending': 'รอดำเนินการ',
      'on_hold': 'พักไว้',
      'cancelled': 'ยกเลิก'
    };
    
    for (const step of result.rows) {
      const isHighlighted = step.id === highlightStepId;
      let daysLeft = null;
      let stepStatus = '⏳ รอดำเนินการ'; // default
      let stepPriority = 'pending';
      
      if (step.end_date) {
        daysLeft = Math.ceil((new Date(step.end_date) - new Date(today)) / (1000 * 60 * 60 * 24));
        if (daysLeft < 0) {
          stepStatus = '🔴 เกินกำหนด';
          stepPriority = 'overdue';
        } else if (daysLeft <= 3) {
          stepStatus = '🟠 ใกล้ครบกำหนด';
          stepPriority = 'urgent';
        } else if (step.work_count > 0) {
          stepStatus = '🔄 กำลังดำเนินการ';
          stepPriority = 'in_progress';
        }
      } else if (step.work_count > 0) {
        stepStatus = '🔄 กำลังดำเนินการ';
        stepPriority = 'in_progress';
      }
      
      if (!projects[step.task_id]) {
        projects[step.task_id] = {
          task_name: step.task_name,
          so_number: step.so_number,
          steps: [],
          maxPriority: 'pending'
        };
      }
      
      // อัพเดท priority สูงสุดของโครงการ
      const priorityOrder = { overdue: 4, urgent: 3, in_progress: 2, pending: 1 };
      if (priorityOrder[stepPriority] > priorityOrder[projects[step.task_id].maxPriority]) {
        projects[step.task_id].maxPriority = stepPriority;
      }
      
      projects[step.task_id].steps.push({
        step_name: step.step_name,
        step_order: step.step_order,
        project_statuses: step.project_statuses || [],
        stepStatus,
        stepPriority,
        start_fmt: step.start_fmt,
        end_fmt: step.end_fmt,
        daysLeft,
        assignee_names: step.assignee_names,
        work_count: step.work_count,
        isHighlighted,
        actionText: isHighlighted ? actionText : ''
      });
    }

    const currentTime = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    
    // กำหนดสีและ emoji ตาม priority
    const getPriorityStyle = (priority) => {
      switch(priority) {
        case 'overdue': return { emoji: '🔴', style: 'attention', label: 'เกินกำหนด' };
        case 'urgent': return { emoji: '🟠', style: 'warning', label: 'ใกล้ครบกำหนด' };
        case 'in_progress': return { emoji: '🔵', style: 'accent', label: 'กำลังดำเนินการ' };
        default: return { emoji: '⚪', style: 'default', label: 'รอดำเนินการ' };
      }
    };
    
    // สร้าง containers สำหรับแต่ละโครงการ - เรียงตาม priority
    const sortedProjects = Object.values(projects).sort((a, b) => {
      const order = { overdue: 1, urgent: 2, in_progress: 3, pending: 4 };
      return order[a.maxPriority] - order[b.maxPriority];
    });
    
    const projectContainers = sortedProjects.map(proj => {
      return {
        type: "Container",
        items: [
          { type: "TextBlock", text: `📋 ${proj.task_name}${proj.so_number ? ` (${proj.so_number})` : ''}`, weight: "Bolder", size: "Medium", wrap: true },
          ...proj.steps.map((s, idx) => {
            const stepNum = s.step_order || (idx + 1);
            const statusText = s.project_statuses && s.project_statuses.length > 0 ? s.project_statuses.join(', ') : '-';
            return {
              type: "Container",
              style: s.isHighlighted ? "accent" : undefined,
              items: [
                { type: "TextBlock", text: `${stepNum}. ⚙️ ${s.step_name}${s.actionText ? ` ${s.actionText}` : ''} | ${s.stepStatus}${s.daysLeft !== null && s.daysLeft >= 0 ? ` (${s.daysLeft} วัน)` : s.daysLeft < 0 ? ` (${Math.abs(s.daysLeft)} วัน)` : ''}`, size: "Small", wrap: true },
                { type: "TextBlock", text: `📅 ${s.start_fmt || '-'} - ${s.end_fmt || '-'} | 👥 ${s.assignee_names || '-'} | 📌 ${statusText}${s.work_count > 0 ? ` | ✅ ลงงาน ${s.work_count} คน` : ''}`, size: "Small", spacing: "None", isSubtle: true, wrap: true }
              ],
              spacing: "Small"
            };
          })
        ],
        spacing: "Medium",
        separator: true
      };
    });

    const message = {
      type: "AdaptiveCard",
      version: "1.5",
      body: [
        { type: "TextBlock", text: "📊 สรุป Workflow ประจำวัน", size: "Large", weight: "Bolder", color: "Accent" },
        { type: "TextBlock", text: `🕐 ${currentTime} | ${Object.keys(projects).length} โครงการ, ${result.rows.length} steps`, size: "Small", isSubtle: true, spacing: "None" },
        ...projectContainers
      ],
      msteams: { width: "Full" }
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      console.error('Teams workflow summary failed:', response.status);
    } else {
      console.log('✅ Workflow summary sent to Teams');
    }
  } catch (error) {
    console.error('Teams workflow summary error:', error);
  }
}

// เริ่ม cron job ทุกวันจันทร์-ศุกร์ 9:00 น.
export function startWorkflowScheduler() {
  // ส่งทันทีเมื่อ server start
  console.log('📢 Sending initial workflow summary to Teams...');
  sendWorkflowSummaryToTeams();
  
  // สรุปรายวัน + แจ้งเตือนก่อน 1 วัน 9:00 น.
  cron.schedule('0 9 * * 1-5', () => {
    console.log('🔔 Running daily workflow summary...');
    checkAndNotifyDaily();
    console.log('⏰ Running due tomorrow reminder...');
    notifyDueTomorrow();
    console.log('📢 Sending workflow summary to Teams...');
    sendWorkflowSummaryToTeams();
  }, { timezone: 'Asia/Bangkok' });
  
  // แจ้ง Teams ทุก 1 ชม. (10:00-17:00)
  cron.schedule('0 10-17 * * 1-5', () => {
    console.log('📢 Hourly workflow summary to Teams...');
    sendWorkflowSummaryToTeams();
  }, { timezone: 'Asia/Bangkok' });
  
  // แจ้ง Teams รอบสุดท้าย 18:00
  cron.schedule('0 18 * * 1-5', () => {
    console.log('📢 Final workflow summary to Teams...');
    sendWorkflowSummaryToTeams();
  }, { timezone: 'Asia/Bangkok' });
  
  console.log('✅ Workflow notification scheduler started (Mon-Fri 9:00-18:00)');
}

// แจ้งเตือนเฉพาะผู้รับผิดชอบใหม่ที่ถูกเพิ่ม
export async function notifyNewAssignees(stepId, taskId, newUserIds, isNewStep = false, createdById = null) {
  if (!newUserIds || newUserIds.length === 0) return;
  
  try {
    // ดึงข้อมูล step
    const stepResult = await pool.query(`
      SELECT ts.*, t.task_name, t.so_number FROM task_steps ts
      JOIN tasks t ON ts.task_id = t.id WHERE ts.id = $1
    `, [stepId]);
    
    if (stepResult.rows.length === 0) return;
    const step = stepResult.rows[0];
    
    // ดึงชื่อคนสร้าง
    let createdByName = null;
    if (createdById) {
      const creatorResult = await pool.query('SELECT firstname, lastname FROM users WHERE id = $1', [createdById]);
      if (creatorResult.rows.length > 0) {
        createdByName = `${creatorResult.rows[0].firstname} ${creatorResult.rows[0].lastname}`;
      }
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // เช็คว่า start_date ถึงแล้วหรือยัง (ถ้ามี)
    const startDate = step.start_date ? new Date(step.start_date) : null;
    const hasStarted = !startDate || startDate <= today;
    
    // คำนวณวันที่เหลือ
    const daysLeft = step.end_date ? Math.ceil((new Date(step.end_date) - today) / (1000 * 60 * 60 * 24)) : null;
    
    // urgent เฉพาะ: step ใหม่ + เริ่มงานแล้ว + เหลือ 1-3 วัน
    const isUrgent = isNewStep && hasStarted && daysLeft !== null && daysLeft >= 1 && daysLeft <= 3;
    
    // ดึงข้อมูล users
    const usersResult = await pool.query(
      'SELECT id, firstname, lastname, email FROM users WHERE id = ANY($1) AND email IS NOT NULL',
      [newUserIds]
    );
    
    for (const user of usersResult.rows) {
      // ส่ง email แจ้งงานใหม่ พร้อมชื่อคนสร้าง
      await sendAssignmentEmail(user, step, false, createdByName);
      
      // ถ้าเป็น step ใหม่และ urgent ส่ง email ด่วนเพิ่ม
      if (isUrgent) {
        await sendAssignmentEmail(user, step, true, createdByName);
      }
    }
  } catch (error) {
    console.error('Notify new assignees error:', error);
  }
}

// ส่ง email แจ้งเตือนเมื่อถูกเพิ่มเป็นผู้รับผิดชอบ
async function sendAssignmentEmail(user, step, isUrgent = false, createdByName = null) {
  const formatDate = (date) => date ? new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';
  const daysLeft = step.end_date ? Math.ceil((new Date(step.end_date) - new Date()) / (1000 * 60 * 60 * 24)) : null;
  
  const headerIcon = isUrgent ? '🚨' : '📋';
  const headerText = isUrgent ? `งานด่วน! เหลือ ${daysLeft} วัน` : 'งานใหม่สำหรับคุณ!';
  const assignedByText = createdByName ? `มอบหมายโดย ${createdByName}` : 'มอบหมายโดยระบบ GenT-CEM';

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f2f3f5;">
  <center style="width:100%;background:#f2f3f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f3f5;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;">
            
            <!-- Logo -->
            <tr>
              <td align="center" style="padding:10px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:28px;color:#190c86;">
                <div>Gen T Excellency Management</div>
              </td>
            </tr>

            <!-- Header with gradient -->
            <tr>
              <td align="center" style="padding:0;background-color:#4A90E2;background:linear-gradient(135deg,#4A90E2,#D73527);">
                <!--[if gte mso 9]>
                <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:120px;">
                  <v:fill type="gradient" color="#4A90E2" color2="#D73527" angle="135"/>
                  <v:textbox inset="0,0,0,0">
                    <div>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" height="120" align="center">
                        <tr>
                          <td align="center" valign="middle">
                            <div style="font-family:Arial,sans-serif;font-size:40px;color:#ffffff;">${headerIcon}</div>
                            <div style="font-family:Arial,sans-serif;font-size:24px;color:#ffffff;font-weight:bold;">${headerText}</div>
                          </td>
                        </tr>
                      </table>
                    </div>
                  </v:textbox>
                </v:rect>
                <![endif]-->
                <!--[if !mso]><!-->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="padding:25px 18px;">
                      <div style="font-family:Arial,sans-serif;font-size:40px;color:#ffffff;">${headerIcon}</div>
                      <div style="height:8px;"></div>
                      <div style="font-family:Arial,sans-serif;font-size:24px;color:#ffffff;font-weight:bold;">${headerText}</div>
                      <div style="font-family:Arial,sans-serif;font-size:14px;color:#ffffff;margin-top:5px;">${assignedByText}</div>
                    </td>
                  </tr>
                </table>
                <!--<![endif]-->
              </td>
            </tr>

            ${isUrgent ? `
            <!-- Urgent Banner -->
            <tr>
              <td style="padding:15px 32px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fef2f2;border:2px solid #D73527;">
                  <tr>
                    <td align="center" style="padding:12px;">
                      <div style="font-family:Arial,sans-serif;font-size:15px;color:#D73527;font-weight:bold;">⚠️ งานนี้ใกล้ครบกำหนด - เหลือเวลาอีก ${daysLeft} วัน!</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>` : ''}

            <!-- Content -->
            <tr>
              <td style="padding:${isUrgent ? '15px' : '28px'} 42px 12px;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b;">
                
                <!-- Project -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8faff;border-left:4px solid #4A90E2;margin-bottom:20px;">
                  <tr>
                    <td style="padding:15px;">
                      <div style="font-size:11px;color:#4A90E2;font-weight:bold;text-transform:uppercase;">โครงการ</div>
                      <div style="font-size:18px;color:#1a1a2e;font-weight:bold;margin-top:4px;">${step.task_name || '-'}</div>
                      ${step.so_number ? `<div style="font-size:13px;color:#666666;margin-top:2px;">SO: ${step.so_number}</div>` : ''}
                    </td>
                  </tr>
                </table>

                <!-- Step Name -->
                <p style="margin:0 0 8px;font-size:12px;color:#888888;">🎯 ขั้นตอนที่ได้รับมอบหมาย</p>
                <p style="margin:0 0 18px;font-size:18px;color:#D73527;font-weight:bold;">${step.step_name}</p>

                <!-- Dates -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    ${step.start_date ? `
                    <td width="50%" valign="top" style="padding-right:8px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f0fdf4;border:1px solid #dcfce7;">
                        <tr><td style="padding:12px;">
                          <div style="font-size:11px;color:#16a34a;font-weight:bold;">📅 วันที่เริ่ม</div>
                          <div style="font-size:14px;color:#166534;font-weight:bold;margin-top:4px;">${formatDate(step.start_date)}</div>
                        </td></tr>
                      </table>
                    </td>` : ''}
                    ${step.end_date ? `
                    <td width="50%" valign="top" style="padding-left:8px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${isUrgent ? '#fef2f2' : '#fff7ed'};border:1px solid ${isUrgent ? '#fee2e2' : '#ffedd5'};">
                        <tr><td style="padding:12px;">
                          <div style="font-size:11px;color:${isUrgent ? '#dc2626' : '#ea580c'};font-weight:bold;">⏰ กำหนดส่ง</div>
                          <div style="font-size:14px;color:${isUrgent ? '#991b1b' : '#9a3412'};font-weight:bold;margin-top:4px;">${formatDate(step.end_date)}</div>
                        </td></tr>
                      </table>
                    </td>` : ''}
                  </tr>
                </table>

                ${step.description ? `
                <div style="margin-top:18px;padding-top:15px;border-top:1px dashed #e2e8f0;">
                  <div style="font-size:11px;color:#94a3b8;font-weight:bold;text-transform:uppercase;">📝 รายละเอียดงาน</div>
                  <div style="font-size:13px;color:#475569;line-height:1.6;margin-top:5px;">${step.description}</div>
                </div>` : ''}

              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background:#14143a;padding:18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:6px 8px;">
                      <div style="font-family:Arial,sans-serif;font-size:14px;color:#ffffff;font-weight:bold;">GenT-CEM • Workflow Management Solution</div>
                      <div style="font-family:Arial,sans-serif;font-size:12px;color:#aaaaaa;margin-top:4px;">อีเมลนี้ถูกส่งโดยอัตโนมัติ โปรดอย่าตอบกลับ</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </center>
</body>
</html>`;

  try {
    const subjectPrefix = isUrgent ? '🚨 ด่วน!' : '📋';
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: `${subjectPrefix} งานใหม่: ${step.step_name} - ${step.task_name}`,
      html
    });
    console.log(`📧 Sent ${isUrgent ? 'URGENT ' : ''}assignment notification to ${user.email}`);
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
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:15px;border:1px solid #eeeeee;">
                  <tr>
                    <td width="5" style="background-color:#D73527;"></td>
                    <td style="padding:15px 20px;">
                      <div style="font-size:11px;color:#4A90E2;font-weight:bold;text-transform:uppercase;">${s.task_name || 'Workflow'}</div>
                      <div style="font-size:17px;color:#1a1a2e;font-weight:bold;margin-top:4px;">${s.step_name}</div>
                      ${s.description ? `<div style="font-size:13px;color:#666666;margin-top:6px;">${s.description}</div>` : ''}
                    </td>
                  </tr>
                </table>`).join('');

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f2f3f5;">
  <center style="width:100%;background:#f2f3f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f3f5;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;">
            
            <!-- Logo -->
            <tr>
              <td align="center" style="padding:10px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:28px;color:#190c86;">
                <div>Gen T Excellency Management</div>
              </td>
            </tr>

            <!-- Header with gradient -->
            <tr>
              <td align="center" style="padding:0;background-color:#4A90E2;background:linear-gradient(135deg,#4A90E2,#D73527);">
                <!--[if gte mso 9]>
                <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:130px;">
                  <v:fill type="gradient" color="#4A90E2" color2="#D73527" angle="135"/>
                  <v:textbox inset="0,0,0,0">
                    <div>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" height="130" align="center">
                        <tr>
                          <td align="center" valign="middle">
                            <div style="font-family:Arial,sans-serif;font-size:44px;color:#ffffff;">⏰</div>
                            <div style="font-family:Arial,sans-serif;font-size:24px;color:#ffffff;font-weight:bold;">งานครบกำหนดพรุ่งนี้!</div>
                            <div style="font-family:Arial,sans-serif;font-size:14px;color:#ffffff;">${formatDate(tomorrow)}</div>
                          </td>
                        </tr>
                      </table>
                    </div>
                  </v:textbox>
                </v:rect>
                <![endif]-->
                <!--[if !mso]><!-->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="padding:30px 18px;">
                      <div style="font-family:Arial,sans-serif;font-size:44px;color:#ffffff;">⏰</div>
                      <div style="height:8px;"></div>
                      <div style="font-family:Arial,sans-serif;font-size:24px;color:#ffffff;font-weight:bold;">งานครบกำหนดพรุ่งนี้!</div>
                      <div style="font-family:Arial,sans-serif;font-size:14px;color:#ffffff;margin-top:5px;">${formatDate(tomorrow)}</div>
                    </td>
                  </tr>
                </table>
                <!--<![endif]-->
              </td>
            </tr>

            <!-- Content -->
            <tr>
              <td style="padding:28px 42px 12px;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b;">
                
                <!-- Count Badge -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:25px;">
                  <tr>
                    <td align="center" style="padding:20px;background-color:#fff5f5;border:2px dashed #D73527;">
                      <span style="font-size:32px;font-weight:bold;color:#D73527;">${steps.length}</span>
                      <span style="font-size:16px;color:#666666;font-weight:bold;margin-left:10px;">รายการที่ต้องทํา</span>
                    </td>
                  </tr>
                </table>

                <!-- Steps List -->
                ${stepsHtml}

              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background:#14143a;padding:18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:6px 8px;">
                      <div style="font-family:Arial,sans-serif;font-size:14px;color:#ffffff;font-weight:bold;">GenT-CEM • Digital Workflow Solution</div>
                      <div style="font-family:Arial,sans-serif;font-size:12px;color:#aaaaaa;margin-top:4px;">อีเมลนี้ถูกส่งโดยอัตโนมัติ โปรดอย่าตอบกลับ</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>
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

export { checkAndNotifyDaily, notifyDueTomorrow, sendWorkflowSummaryToTeams };
