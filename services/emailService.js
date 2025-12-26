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
      .footer-col{display:block!important;width:100%!important;text-align:center!important;padding:10px 0!important}
      .footer-left{text-align:left!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f2f3f5;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">Your new password</div>
  <center style="width:100%;background:#f2f3f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f5;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;">
            <tr>
              <td align="center" style="padding:10px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:20px;color:#190c86;">
                <p>Gen T Customer Excellency Management</p>
              </td>
            </tr>
            <tr>
              <td class="hero" align="center" style="background:linear-gradient(135deg,#4a90e2,#d73527);padding:44px 18px;">
                <div style="margin:0 auto 14px;width:54px;height:54px;">
                  <svg width="85" height="85" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:0 auto;">
                    <path d="M38 54V42C38 26 50 14 64 14C78 14 90 26 90 42V54" stroke="white" stroke-width="5" stroke-linecap="round"/>
                    <rect x="30" y="54" width="68" height="52" rx="10" stroke="white" stroke-width="5"/>
                    <circle cx="64" cy="78" r="6" stroke="white" stroke-width="4"/>
                    <path d="M64 84V94" stroke="white" stroke-width="4" stroke-linecap="round"/>
                  </svg>
                </div>
                <br/>
                <div class="h1" style="font-family:Arial,Helvetica,sans-serif;font-size:34px;line-height:40px;color:#ffffff;font-weight:400;">New Password</div>
              </td>
            </tr>
            <tr>
              <td class="px" style="padding:28px 42px 12px;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b;">
                <p style="margin:0 0 18px;font-size:16px;line-height:26px;">Hello, <b>${userData.email}</b></p>
                <p style="margin:0 0 18px;font-size:16px;line-height:26px;">เราได้ส่งอีเมลฉบับนี้ถึงคุณเพื่อตอบสนองคำขอของคุณในการรีเซ็ตรหัสผ่านบน <strong>GenT-CEM</strong>.</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:26px;">รหัสผ่านใหม่ของคุณ คือ : <b>${userData.password || 'ไม่พบข้อมูล'}</b></p>
                <p><a style="color:#4a90e2;" href="${process.env.FRONTEND_URL || 'http://172.30.101.52:3000'}/login" target="_blank">Click to login</a></p>
                <p style="margin:0 0 18px;font-size:13px;line-height:20px;color:#8a8a8a;font-style:italic;">โปรดเปลี่ยนรหัสผ่านของคุณอีกครั้งหลังจากเข้าสู่ระบบสำเร็จแล้ว</p>
              </td>
            </tr>
            <tr>
              <td style="background:#14143a;padding:18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td class="footer-col footer-left" valign="top" style="width:50%;padding:6px 8px;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#ffffff;font-weight:700;margin-bottom:8px;">อีเมลนี้ถูกส่งโดยอัตโนมัติ โปรดอย่าตอบกลับอีเมลนี้</div>
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
    d.setHours(d.getHours() + 7); // +7 GMT
    return d.toLocaleDateString('th-TH', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  };

  const formatTime = (date) => {
    const d = new Date(date);
    d.setHours(d.getHours() + 7); // +7 GMT
    return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  };

  // Format ชั่วโมงเป็น HH:MM
  const formatHoursToTime = (hours) => {
    if (!hours || hours <= 0) return '0:00';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}:${String(m).padStart(2, '0')}`;
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
                <div>Gen T Customer Excellency Management</div>
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
                              ${notificationType === 'rejected' ? '✕' : '✓'}
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
                  จำนวนวันลา : <b>${leaveData.total_days} วัน (${formatHoursToTime(leaveData.total_days * 8)})</b><br>
                  เหตุผล : <b>${leaveData.reason || '-'}</b><br>
                  สถานะ : <b>${statusLabels[leaveData.status] || leaveData.status}</b><br>
                  ${approverHtml}
                </p>

                <p style="margin:0 0 18px;font-size:16px;line-height:26px;">
                  <a style="color:#4a90e2;" href="${process.env.FRONTEND_URL || 'http://172.30.101.52:3000'}/login" target="_blank">Click to login</a>
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
