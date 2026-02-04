import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Create transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Send forgot password email
export const sendForgotPasswordEmail = async (email, userData) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'รหัสผ่านใหม่ - GenT-CEM',
      html: `<!DOCTYPE html>
<html lang="th" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta http-equiv="x-ua-compatible" content="ie=edge" />
  <title>New Password</title>
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
      .hero{padding:36px 18px!important}
      .h1{font-size:28px!important;line-height:34px!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f2f3f5;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">Your new password</div>
  <center style="width:100%;background:#f2f3f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f3f5;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;">
            <tr>
              <td align="center" style="padding:10px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:28px;color:#190c86;">
                <div>Gen T Excellency Management</div>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0;background-color:#4A90E2;background:linear-gradient(135deg,#4A90E2,#D73527);">
                <!--[if gte mso 9]>
                <v:rect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" fill="true" stroke="false" style="width:600px;height:150px;">
                  <v:fill type="gradient" color="#4A90E2" color2="#D73527" angle="135"/>
                  <v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text:false">
                    <div>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" height="150" align="center">
                        <tr>
                          <td align="center" valign="middle" style="padding:30px 18px;">
                            <div style="font-family:Arial,Helvetica,sans-serif;font-size:44px;line-height:44px;font-weight:700;color:#ffffff;text-align:center;">🔐</div>
                            <div style="height:12px;line-height:12px;font-size:12px;">&nbsp;</div>
                            <div style="font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:32px;font-weight:400;color:#ffffff;">New Password</div>
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
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:44px;line-height:44px;color:#ffffff;text-align:center;">🔐</div>
                      <div style="height:12px;"></div>
                      <div class="h1" style="font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:32px;color:#ffffff;font-weight:400;">New Password</div>
                    </td>
                  </tr>
                </table>
                <!--<![endif]-->
              </td>
            </tr>
            <tr>
              <td class="px" style="padding:28px 42px 12px;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b;">
                <p style="margin:0 0 18px;font-size:16px;line-height:26px;">Hello, <b>${userData.email}</b></p>
                <p style="margin:0 0 18px;font-size:16px;line-height:26px;">เราได้ส่งอีเมลฉบับนี้ถึงคุณเพื่อตอบสนองคำขอของคุณในการรีเซ็ตรหัสผ่านบน <strong>GenT-CEM</strong>.</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:26px;">รหัสผ่านใหม่ของคุณ คือ : <b>${userData.password || 'ไม่พบข้อมูล'}</b></p>
                <p><a style="color:#4a90e2;" href="${process.env.FRONTEND_URL || 'http://172.30.101.52:3000'}/login" target="_blank">Click to Login Internal</a> | <a style="color:#4a90e2;" href="http://61.91.51.126:3000/login" target="_blank">Click to Login External</a></p>
                <p style="margin:0 0 18px;font-size:13px;line-height:20px;color:#8a8a8a;font-style:italic;">โปรดเปลี่ยนรหัสผ่านของคุณอีกครั้งหลังจากเข้าสู่ระบบสำเร็จแล้ว</p>
              </td>
            </tr>
            <tr>
              <td style="background:#14143a;padding:18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="top" style="padding:6px 8px;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#ffffff;font-weight:700;">อีเมลนี้ถูกส่งโดยอัตโนมัติ โปรดอย่าตอบกลับอีเมลนี้</div>
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
</html>`
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', result.messageId);
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, error: error.message };
  }
};

// Test email configuration
export const testEmailConnection = async () => {
  try {
    await transporter.verify();
    console.log('Email server connection verified');
    return true;
  } catch (error) {
    console.error('Email server connection failed:', error);
    return false;
  }
};

// Send leave request notification email
export const sendLeaveNotificationEmail = async (emails, leaveData, notificationType) => {
  if (!emails || emails.length === 0) return { success: false, error: 'No recipients' };

  const leaveTypeLabels = {
    'sick': 'ลาป่วย',
    'personal': 'ลากิจ',
    'vacation': 'ลาพักร้อน',
    'maternity': 'ลาคลอด',
    'other': 'ลาอื่นๆ'
  };

  const formatDate = (date) => {
    const d = new Date(date);
    return d.toLocaleDateString('th-TH', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  };

  const formatTime = (date) => {
    const d = new Date(date);
    return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  };

  // Format จำนวนวันเป็นชั่วโมง:นาที
  const formatDaysToHoursMinutes = (days) => {
    if (!days || days <= 0) return '0 ชั่วโมง';
    const totalMinutes = Math.round(days * 8 * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (m === 0) {
      return `${h} ชั่วโมง`;
    }
    return `${h} ชั่วโมง ${m} นาที`;
  };

  const formatDays = (days) => {
    if (!days || days <= 0) return '0';
    const rounded = Math.round(days * 10) / 10;
    return Number.isInteger(rounded) ? rounded : rounded.toFixed(1);
  };

  const statusLabels = {
    'pending': 'รอหัวหน้างานอนุมัติ',
    'pending_level2': 'รอ HR อนุมัติ',
    'approved': 'อนุมัติแล้ว',
    'rejected': 'ไม่อนุมัติ'
  };

  let subject, headerText, bodyText, footerNote;
  
  switch (notificationType) {
    case 'new_request':
      subject = `[แจ้งเตือน] คำขอลางาน - ${leaveData.employee_name}`;
      headerText = 'มีคำขอลางานใหม่';
      bodyText = 'มีคำขอลางานใหม่รอการพิจารณา';
      footerNote = 'กรุณาเข้าสู่ระบบเพื่อดำเนินการอนุมัติ';
      break;
    case 'pending_level2':
      subject = `[อนุมัติขั้นที่ 1] คำขอลางาน - ${leaveData.employee_name}`;
      headerText = 'หัวหน้างานอนุมัติเรียบร้อย';
      bodyText = 'หัวหน้างานได้พิจารณา และอนุมัติคำขอลาของท่านเป็นที่เรียบร้อยแล้ว';
      footerNote = 'ฝ่ายบุคคล กรุณาเข้าสู่ระบบเพื่อดำเนินการอนุมัติต่อไป';
      break;
    case 'approved':
      subject = `[อนุมัติแล้ว] คำขอลางาน - ${leaveData.employee_name}`;
      headerText = 'หัวหน้างาน และฝ่ายบุคคลอนุมัติลาเรียบร้อย';
      bodyText = 'หัวหน้างาน และฝ่ายบุคคลได้พิจารณา และอนุมัติคำขอลาของท่านเป็นที่เรียบร้อย';
      footerNote = 'อนุมัติคำขอลาของท่านเป็นที่เรียบร้อยแล้ว';
      break;
    case 'rejected':
      const rejectLevel = leaveData.rejected_level === 1 ? 'หัวหน้างาน' : 'HR';
      const rejectorName = leaveData.rejected_by || '';
      subject = `[ไม่อนุมัติ] คำขอลางาน - ${leaveData.employee_name}`;
      headerText = 'ไม่อนุมัติการลา';
      bodyText = `คำขอลางานของท่านไม่ได้รับการอนุมัติจาก${rejectLevel} (${rejectorName})`;
      footerNote = leaveData.reject_reason ? `เหตุผล: ${leaveData.reject_reason}` : '';
      break;
    default:
      subject = `[แจ้งเตือน] คำขอลางาน - ${leaveData.employee_name}`;
      headerText = 'แจ้งเตือนการลา';
      bodyText = '';
      footerNote = '';
  }

  // สร้าง approver text แยกบรรทัด
  let approverHtml = '';
  if (leaveData.approved_by_level1) {
    approverHtml += `ผู้อนุมัติ (หัวหน้างาน) : <b>${leaveData.approved_by_level1}</b><br>`;
  }
  if (leaveData.approved_by_level2) {
    approverHtml += `ผู้อนุมัติ (HR) : <b>${leaveData.approved_by_level2}</b><br>`;
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: emails.join(', '),
    subject: subject,
    html: `<!DOCTYPE html>
<html lang="th" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta http-equiv="x-ua-compatible" content="ie=edge" />
  <title>${headerText}</title>

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
      .heroPad{padding:36px 18px!important}
      .h1{font-size:28px!important;line-height:34px!important}
      .iconBig{font-size:44px!important;line-height:44px!important}
    }
  </style>
</head>

<body style="margin:0;padding:0;background:#f2f3f5;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${headerText}
  </div>

  <center style="width:100%;background:#f2f3f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f3f5;">
      <tr>
        <td align="center" style="padding:24px 12px;">

          <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;">

            <!-- Top logo -->
            <tr>
              <td align="center" style="padding:10px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:28px;color:#190c86;">
                <div>Gen T Excellency Management</div>
              </td>
            </tr>

            <!-- Hero -->
            <tr>
              <td align="center" style="padding:0;background-color:#4A90E2;background:linear-gradient(135deg,#4A90E2,#D73527);">

                <!--[if gte mso 9]>
                <v:rect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" fill="true" stroke="false"
                  style="width:600px;height:220px;">
                  <v:fill type="gradient" color="#4A90E2" color2="#D73527" angle="135"/>
                  <v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text:false">
                    <div>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" height="220" align="center">
                        <tr>
                          <td align="center" valign="middle" style="padding:44px 18px;">

                            <!-- BIG ICON (Outlook) -->
                            <div class="iconBig" style="font-family:Arial,Helvetica,sans-serif;font-size:56px;line-height:56px;font-weight:700;color:#ffffff;mso-line-height-rule:exactly;text-align:center;">
                              ${notificationType === 'rejected' ? '✕' : notificationType === 'new_request' ? '📋' : '✓'}
                            </div>

                            <div style="height:16px;line-height:16px;font-size:16px;">&nbsp;</div>

                            <!-- Header -->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                              <tr>
                                <td align="center" style="text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:34px;line-height:40px;font-weight:400;color:#ffffff;mso-line-height-rule:exactly;">
                                  ${headerText}
                                </td>
                              </tr>
                            </table>

                          </td>
                        </tr>
                      </table>
                    </div>
                  </v:textbox>
                </v:rect>

                

              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td class="px" style="padding:28px 42px 12px;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b;">
                <p style="margin:0 0 18px;font-size:16px;line-height:26px;">สวัสดี,</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:26px;">${bodyText}</p>

                <p style="margin:0 0 18px;font-size:16px;line-height:26px;">
                  ผู้ขอลา : <b>${leaveData.employee_name || '-'}</b><br>
                  ตำแหน่ง : <b>${leaveData.employee_position || '-'}</b><br>
                  ประเภทการลา : <b>${leaveTypeLabels[leaveData.leave_type] || leaveData.leave_type}</b><br>
                  วันเริ่มลา : <b>${formatDate(leaveData.start_datetime)} เวลา ${formatTime(leaveData.start_datetime)} น.</b><br>
                  วันสิ้นสุด : <b>${formatDate(leaveData.end_datetime)} เวลา ${formatTime(leaveData.end_datetime)} น.</b><br>
                  จำนวนวันลา : <b>${formatDays(leaveData.total_days)} วัน (${formatDaysToHoursMinutes(leaveData.total_days)})</b><br>
                  เหตุผล : <b>${leaveData.reason || '-'}</b><br>
                  สถานะ : <b>${statusLabels[leaveData.status] || leaveData.status}</b><br>
                  ${approverHtml}
                </p>

                <p style="margin:0 0 18px;font-size:16px;line-height:26px;">
                  <a style="color:#4a90e2;" href="${process.env.FRONTEND_URL || 'http://172.30.101.52:3000'}/login" target="_blank">Click to Login Internal</a> | <a style="color:#4a90e2;" href="http://61.91.51.126:3000/login" target="_blank">Click to Login External</a>
                </p>

                ${footerNote ? `<p style="margin:0 0 18px;font-size:13px;line-height:20px;color:#8a8a8a;font-style:italic;">${footerNote}</p>` : ''}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background:#14143a;padding:18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="top" style="padding:6px 8px;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#ffffff;font-weight:700;">
                        อีเมลนี้ถูกส่งโดยอัตโนมัติ โปรดอย่าตอบกลับอีเมลนี้
                      </div>
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
</html>`
};

  try {
    const result = await transporter.sendMail(mailOptions);
    console.log('Leave notification email sent:', result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Error sending leave notification:', error);
    return { success: false, error: error.message };
  }
};


// Send pending leave approval reminder to approver
export const sendPendingLeaveReminder = async (approver, pendingLeaves) => {
  const leaveRows = pendingLeaves.map(leave => {
    const waitingDays = Math.floor((Date.now() - new Date(leave.created_at)) / (1000 * 60 * 60 * 24));
    const urgencyBg = waitingDays >= 3 ? '#fef2f2' : waitingDays >= 2 ? '#fff7ed' : '#fefce8';
    const urgencyBorder = waitingDays >= 3 ? '#fecaca' : waitingDays >= 2 ? '#fed7aa' : '#fef08a';
    const urgencyColor = waitingDays >= 3 ? '#dc2626' : waitingDays >= 2 ? '#ea580c' : '#ca8a04';
    const urgencyIcon = waitingDays >= 3 ? '🔴' : waitingDays >= 2 ? '🟠' : '🟡';
    
    return `
      <tr>
        <td style="padding:0 0 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${urgencyBg};border:1px solid ${urgencyBorder};border-radius:8px;">
            <tr>
              <td style="padding:14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="60%">
                      <div style="font-size:15px;color:#1a1a2e;font-weight:bold;">${leave.employee_name}</div>
                      <div style="font-size:13px;color:#666;margin-top:4px;">${leave.leave_type_label} • ${leave.total_days} วัน</div>
                    </td>
                    <td width="40%" align="right">
                      <div style="display:inline-block;background:${urgencyColor};color:#fff;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:bold;">
                        ${urgencyIcon} รอ ${waitingDays} วัน
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join('');

  const hasUrgent = pendingLeaves.some(l => {
    const days = Math.floor((Date.now() - new Date(l.created_at)) / (1000 * 60 * 60 * 24));
    return days >= 3;
  });

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: approver.email,
    subject: `${hasUrgent ? '🚨' : '🔔'} มีใบลารออนุมัติ ${pendingLeaves.length} รายการ - GenT-CEM`,
    html: `<!DOCTYPE html>
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
              <td align="center" style="padding:0;background-color:#f093fb;background:linear-gradient(135deg,#f093fb,#f5576c);">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="padding:25px 18px;">
                      <div style="font-family:Arial,sans-serif;font-size:40px;color:#ffffff;">📋</div>
                      <div style="height:8px;"></div>
                      <div style="font-family:Arial,sans-serif;font-size:24px;color:#ffffff;font-weight:bold;">ใบลารออนุมัติ</div>
                      <div style="font-family:Arial,sans-serif;font-size:14px;color:#ffffff;margin-top:5px;">แจ้งเตือนจากระบบ GenT-CEM</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${hasUrgent ? `
            <!-- Urgent Banner -->
            <tr>
              <td style="padding:15px 32px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fef2f2;border:2px solid #dc2626;border-radius:8px;">
                  <tr>
                    <td align="center" style="padding:12px;">
                      <div style="font-family:Arial,sans-serif;font-size:15px;color:#dc2626;font-weight:bold;">⚠️ มีใบลาที่รอนานเกิน 3 วัน กรุณาตรวจสอบ!</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>` : ''}

            <!-- Content -->
            <tr>
              <td style="padding:${hasUrgent ? '15px' : '28px'} 32px 12px;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b;">
                
                <!-- Summary Card -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8faff;border-left:4px solid #f5576c;margin-bottom:20px;border-radius:0 8px 8px 0;">
                  <tr>
                    <td style="padding:15px;">
                      <div style="font-size:11px;color:#f5576c;font-weight:bold;text-transform:uppercase;">สรุป</div>
                      <div style="font-size:18px;color:#1a1a2e;font-weight:bold;margin-top:4px;">คุณมีใบลารออนุมัติ ${pendingLeaves.length} รายการ</div>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 8px;font-size:12px;color:#888888;">📝 รายการใบลาที่รออนุมัติ</p>
                
                <!-- Leave Items -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
                  ${leaveRows}
                </table>

              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:20px 32px;background-color:#f8f9fa;border-top:1px solid #e9ecef;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center">
                      <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#6c757d;">อีเมลนี้ถูกส่งโดยอัตโนมัติจากระบบ GenT-CEM</p>
                      <p style="margin:4px 0 0;font-family:Arial,sans-serif;font-size:11px;color:#adb5bd;">โปรดอย่าตอบกลับอีเมลนี้</p>
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
</html>`
  };

  try {
    const result = await transporter.sendMail(mailOptions);
    console.log(`Pending leave reminder sent to ${approver.email}:`, result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error(`Error sending pending leave reminder to ${approver.email}:`, error);
    return { success: false, error: error.message };
  }
};
