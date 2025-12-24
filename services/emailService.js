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
      subject: 'ข้อมูลการเข้าสู่ระบบ - Gent-CEM',
      html: `
        <!DOCTYPE html>
        <html lang="th">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>ข้อมูลการเข้าสู่ระบบ - Gent-CEM</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Sarabun', 'Kanit', 'Noto Sans Thai', Arial, sans-serif; background: #f8f9fa; line-height: 1.8;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background: #f8f9fa; padding: 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.1); max-width: 600px;">
                  
                  <!-- Header -->
                  <tr>
                    <td style="background: white; padding: 30px 20px; text-align: center; color: #2c3e50; border-bottom: 2px solid #e9ecef;">
                      <h1 style="margin: 0; font-size: 26px; font-weight: 600; margin-bottom: 8px; color: #2c3e50;">Gent-CEM System</h1>
                      <p style="margin: 0; opacity: 0.7; font-size: 16px; color: #7f8c8d;">Customer Excellence Management</p>
                    </td>
                  </tr>
                  
                  <!-- Content -->
                  <tr>
                    <td style="padding: 30px;">
                      
                      <!-- Title -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="text-align: center; margin-bottom: 25px;">
                        <tr>
                          <td>
                            <h2 style="margin: 0; color: #2c3e50; font-size: 22px; margin-bottom: 10px; font-weight: 600;">🔐 ข้อมูลการเข้าสู่ระบบ</h2>
                            <p style="margin: 0; color: #7f8c8d; font-size: 16px;">กรุณาใช้ข้อมูลด้านล่างในการเข้าสู่ระบบ</p>
                          </td>
                        </tr>
                      </table>
                      
                      <!-- Login Card -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="background: #f8f9fa; border: 2px solid #e9ecef; border-radius: 10px; margin: 20px 0;">
                        <tr>
                          <td style="padding: 25px;">
                            <div style="text-align: center; color: #2c3e50; font-size: 18px; font-weight: 600; margin-bottom: 20px;">ข้อมูลผู้ใช้งาน</div>
                            
                            <!-- Name -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="background: white; border-radius: 8px; margin: 15px 0; border-left: 4px solid #4A90E2;">
                              <tr>
                                <td style="padding: 18px;">
                                  <div style="font-size: 14px; color: #7f8c8d; font-weight: 500; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">👤 ชื่อ-นามสกุล</div>
                                  <div style="font-size: 18px; color: #2c3e50; font-weight: 600;">${userData.firstname} ${userData.lastname}</div>
                                </td>
                              </tr>
                            </table>
                            
                            <!-- Email -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="background: white; border-radius: 8px; margin: 15px 0; border-left: 4px solid #4A90E2;">
                              <tr>
                                <td style="padding: 18px;">
                                  <div style="font-size: 14px; color: #7f8c8d; font-weight: 500; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">📧 อีเมล</div>
                                  <div style="font-size: 18px; color: #2c3e50; font-weight: 600;">${userData.email}</div>
                                </td>
                              </tr>
                            </table>
                            
                            <!-- Username -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="background: white; border-radius: 8px; margin: 15px 0; border-left: 4px solid #27ae60;">
                              <tr>
                                <td style="padding: 18px;">
                                  <div style="font-size: 14px; color: #7f8c8d; font-weight: 500; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">🆔 ชื่อผู้ใช้ (Username)</div>
                                  <div style="background: #f0fff4; padding: 15px; border-radius: 6px; font-family: 'Courier New', 'Consolas', monospace; font-size: 18px; color: #27ae60; font-weight: 700; text-align: center; letter-spacing: 1px;">${userData.username || 'ไม่พบข้อมูล'}</div>
                                </td>
                              </tr>
                            </table>
                            
                            <!-- Password -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="background: white; border-radius: 8px; margin: 15px 0; border-left: 4px solid #e74c3c;">
                              <tr>
                                <td style="padding: 18px;">
                                  <div style="font-size: 14px; color: #7f8c8d; font-weight: 500; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">🔑 รหัสผ่าน (Password)</div>
                                  <div style="background: #fff5f5; padding: 15px; border-radius: 6px; font-family: 'Courier New', 'Consolas', monospace; font-size: 20px; color: #e74c3c; font-weight: 700; text-align: center; letter-spacing: 2px;">${userData.password || 'ไม่พบข้อมูล'}</div>
                                </td>
                              </tr>
                            </table>
                            
                          </td>
                        </tr>
                      </table>
                      
                      <!-- Warning -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; margin: 20px 0;">
                        <tr>
                          <td style="padding: 18px;">
                            <p style="margin: 0; color: #856404; font-size: 15px; font-weight: 500;"><span style="margin-right: 8px;">⚠️</span><strong>สำคัญ:</strong> เพื่อความปลอดภัย กรุณาเปลี่ยนรหัสผ่านทันทีหลังจากเข้าสู่ระบบครั้งแรก</p>
                          </td>
                        </tr>
                      </table>
                      
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="background: #2c3e50; color: white; padding: 20px; text-align: center;">
                      <p style="margin: 5px 0; font-size: 13px; opacity: 0.8;"><strong>© 2024 Gent-CEM System</strong></p>
                      <p style="margin: 5px 0; font-size: 13px; opacity: 0.8;">Customer Excellence Management Platform</p>
                      <p style="margin: 5px 0; font-size: 13px; opacity: 0.8;">อีเมลนี้ถูกส่งโดยอัตโนมัติ กรุณาอย่าตอบกลับ</p>
                    </td>
                  </tr>
                  
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
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
    return new Date(date).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  };

  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  };

  const statusLabels = {
    'pending': 'รอหัวหน้างานอนุมัติ',
    'pending_level2': 'รอ HR อนุมัติ',
    'approved': 'อนุมัติแล้ว',
    'rejected': 'ไม่อนุมัติ'
  };

  let subject, headerText, headerBg, bodyText, footerNote;
  
  switch (notificationType) {
    case 'new_request':
      subject = `[แจ้งเตือน] คำขอลางาน - ${leaveData.employee_name}`;
      headerText = 'มีคำขอลางานใหม่';
      headerBg = 'linear-gradient(135deg, #4a90e2, #1e40af)';
      bodyText = 'มีคำขอลางานใหม่รอการพิจารณา';
      footerNote = 'กรุณาเข้าสู่ระบบเพื่อดำเนินการอนุมัติ';
      break;
    case 'pending_level2':
      subject = `[อนุมัติขั้นที่ 1] คำขอลางาน - ${leaveData.employee_name}`;
      headerText = 'หัวหน้างานอนุมัติเรียบร้อย';
      headerBg = 'linear-gradient(135deg, #4a90e2, #d73527)';
      bodyText = 'หัวหน้างานได้พิจารณา และอนุมัติคำขอลาของท่านเป็นที่เรียบร้อยแล้ว';
      footerNote = 'ฝ่ายบุคคล กรุณาเข้าสู่ระบบเพื่อดำเนินการอนุมัติต่อไป';
      break;
    case 'approved':
      subject = `[อนุมัติแล้ว] คำขอลางาน - ${leaveData.employee_name}`;
      headerText = 'หัวหน้างาน และฝ่ายบุคคลอนุมัติลาเรียบร้อย';
      headerBg = 'linear-gradient(135deg, #4a90e2, #d73527)';
      bodyText = 'หัวหน้างาน และฝ่ายบุคคลได้พิจารณา และอนุมัติคำขอลาของท่านเป็นที่เรียบร้อย';
      footerNote = 'อนุมัติคำขอลาของท่านเป็นที่เรียบร้อยแล้ว';
      break;
    case 'rejected':
      subject = `[ไม่อนุมัติ] คำขอลางาน - ${leaveData.employee_name}`;
      headerText = 'ไม่อนุมัติการลา';
      headerBg = 'linear-gradient(135deg, #ef4444, #b91c1c)';
      bodyText = 'คำขอลางานของท่านไม่ได้รับการอนุมัติ';
      footerNote = '';
      break;
    default:
      subject = `[แจ้งเตือน] คำขอลางาน - ${leaveData.employee_name}`;
      headerText = 'แจ้งเตือนการลา';
      headerBg = 'linear-gradient(135deg, #4a90e2, #1e40af)';
      bodyText = '';
      footerNote = '';
  }

  // สร้าง approver text
  let approverText = '';
  if (leaveData.approved_by_level1) {
    approverText = `หัวหน้างาน: ${leaveData.approved_by_level1}`;
    if (leaveData.approved_by_level2) {
      approverText += ` / HR: ${leaveData.approved_by_level2}`;
    }
  } else if (leaveData.approved_by_level2) {
    approverText = `HR: ${leaveData.approved_by_level2}`;
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
      .hero{padding:36px 18px!important}
      .h1{font-size:28px!important;line-height:34px!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f2f3f5">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden">${headerText}</div>
  <center style="width:100%;background:#f2f3f5">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f5">
      <tr>
        <td align="center" style="padding:24px 12px">
          <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff">
            
            <!-- Top logo -->
            <tr>
              <td align="center" style="padding:10px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:20px;color:#190c86">
                <p>Gen T Customer Excellency Management</p>
              </td>
            </tr>

            <!-- Hero -->
            <tr>
              <td class="hero" align="center" style="background:${headerBg};padding:44px 18px">
                <div style="margin:0 auto 14px;width:54px;height:54px">
                  ${notificationType === 'approved' || notificationType === 'pending_level2' ? 
                    `<svg width="60" height="60" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#22C55E"/><path d="M7.5 12.5L10.5 15.5L16.8 9.2" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>` :
                    notificationType === 'rejected' ?
                    `<svg width="60" height="60" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#EF4444"/><path d="M8 8L16 16M16 8L8 16" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/></svg>` :
                    `<svg width="60" height="60" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#3B82F6"/><path d="M12 7V13M12 16V17" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/></svg>`
                  }
                </div>
                <br/>
                <div class="h1" style="font-family:Arial,Helvetica,sans-serif;font-size:34px;line-height:40px;color:#ffffff;font-weight:400">
                  ${headerText}
                </div>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td class="px" style="padding:28px 42px 12px;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b">
                <p style="margin:0 0 18px;font-size:16px;line-height:26px">สวัสดี,</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:26px">${bodyText}</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:26px">
                  ผู้ขอลา : <b>${leaveData.employee_name || '-'}</b><br>
                  ตำแหน่ง : <b>${leaveData.employee_position || '-'}</b><br>
                  ประเภทการลา : <b>${leaveTypeLabels[leaveData.leave_type] || leaveData.leave_type}</b><br>
                  วันเริ่มลา : <b>${formatDate(leaveData.start_datetime)} เวลา ${formatTime(leaveData.start_datetime)} น.</b><br>
                  วันสิ้นสุด : <b>${formatDate(leaveData.end_datetime)} เวลา ${formatTime(leaveData.end_datetime)} น.</b><br>
                  จำนวนวันลา : <b>${leaveData.total_days} วัน (${(leaveData.total_days * 8).toFixed(1)} ชม.)</b><br>
                  เหตุผล : <b>${leaveData.reason || '-'}</b><br>
                  สถานะ : <b>${statusLabels[leaveData.status] || leaveData.status}</b><br>
                  ${approverText ? `ผู้ดำเนินการ : <b>${approverText}</b><br>` : ''}
                </p>
                <p>
                  <a style="color:#4a90e2" href="${process.env.FRONTEND_URL || 'http://172.30.101.52:3000'}/login" target="_blank">Click to login</a>
                </p>
                ${footerNote ? `<p style="margin:0 0 18px;font-size:13px;line-height:20px;color:#8a8a8a;font-style:italic">${footerNote}</p>` : ''}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background:#14143a;padding:18px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td valign="top" style="padding:6px 8px">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#ffffff;font-weight:700">
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
