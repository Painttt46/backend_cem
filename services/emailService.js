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
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  };

  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  };

  let subject, headerBg, headerIcon, headerText, actionText;
  
  switch (notificationType) {
    case 'new_request':
      subject = `[แจ้งเตือน] คำขอลางาน - ${leaveData.employee_name}`;
      headerBg = 'linear-gradient(135deg, #1e40af, #3b82f6)';
      headerIcon = '📋';
      headerText = 'คำขอลางานใหม่';
      actionText = 'กรุณาพิจารณาอนุมัติคำขอลางาน';
      break;
    case 'pending_level2':
      subject = `[รอดำเนินการ] คำขอลางานรอการอนุมัติขั้นสุดท้าย - ${leaveData.employee_name}`;
      headerBg = 'linear-gradient(135deg, #b45309, #f59e0b)';
      headerIcon = '⏳';
      headerText = 'รอการอนุมัติขั้นสุดท้าย';
      actionText = 'คำขอนี้ผ่านการอนุมัติจาก HR แล้ว กรุณาพิจารณาอนุมัติขั้นสุดท้าย';
      break;
    case 'approved':
      subject = `[อนุมัติแล้ว] คำขอลางาน - ${leaveData.employee_name}`;
      headerBg = 'linear-gradient(135deg, #047857, #10b981)';
      headerIcon = '✅';
      headerText = 'อนุมัติการลาเรียบร้อยแล้ว';
      actionText = 'คำขอลางานได้รับการอนุมัติเรียบร้อยแล้ว';
      break;
    case 'rejected':
      subject = `[ไม่อนุมัติ] คำขอลางาน - ${leaveData.employee_name}`;
      headerBg = 'linear-gradient(135deg, #b91c1c, #ef4444)';
      headerIcon = '❌';
      headerText = 'ไม่อนุมัติการลา';
      actionText = 'คำขอลางานไม่ได้รับการอนุมัติ';
      break;
    default:
      subject = `[แจ้งเตือน] คำขอลางาน - ${leaveData.employee_name}`;
      headerBg = '#4b5563';
      headerIcon = '📌';
      headerText = 'แจ้งเตือนการลา';
      actionText = '';
  }

  const currentDate = new Date().toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: emails.join(', '),
    subject: subject,
    html: `
      <!DOCTYPE html>
      <html lang="th">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Sarabun', 'Segoe UI', Arial, sans-serif; background: #f8fafc; line-height: 1.6;">
        <table width="100%" cellpadding="0" cellspacing="0" style="padding: 30px 15px;">
          <tr>
            <td align="center">
              <table width="650" cellpadding="0" cellspacing="0" style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.1);">
                
                <!-- Header -->
                <tr>
                  <td style="background: ${headerBg}; padding: 35px 40px; text-align: center;">
                    <div style="font-size: 48px; margin-bottom: 15px;">${headerIcon}</div>
                    <h1 style="margin: 0; font-size: 26px; color: white; font-weight: 600; letter-spacing: 0.5px;">${headerText}</h1>
                    <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">${currentDate}</p>
                  </td>
                </tr>
                
                <!-- Action Text -->
                <tr>
                  <td style="padding: 25px 40px 15px 40px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                    <p style="margin: 0; color: #475569; font-size: 15px; text-align: center;">${actionText}</p>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 30px 40px;">
                    
                    <!-- Employee Info Card -->
                    <div style="background: #f1f5f9; border-radius: 12px; padding: 20px; margin-bottom: 25px;">
                      <h3 style="margin: 0 0 15px 0; color: #1e293b; font-size: 16px; font-weight: 600; border-bottom: 2px solid #cbd5e1; padding-bottom: 10px;">
                        👤 ข้อมูลผู้ขอลา
                      </h3>
                      <table width="100%" cellpadding="8" cellspacing="0">
                        <tr>
                          <td style="color: #64748b; width: 35%; font-size: 14px;">ชื่อ-นามสกุล</td>
                          <td style="color: #1e293b; font-weight: 600; font-size: 14px;">${leaveData.employee_name || '-'}</td>
                        </tr>
                        <tr>
                          <td style="color: #64748b; font-size: 14px;">ตำแหน่ง</td>
                          <td style="color: #1e293b; font-size: 14px;">${leaveData.employee_position || '-'}</td>
                        </tr>
                      </table>
                    </div>
                    
                    <!-- Leave Details Card -->
                    <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 20px; margin-bottom: 25px;">
                      <h3 style="margin: 0 0 15px 0; color: #92400e; font-size: 16px; font-weight: 600; border-bottom: 2px solid #fde68a; padding-bottom: 10px;">
                        📅 รายละเอียดการลา
                      </h3>
                      <table width="100%" cellpadding="10" cellspacing="0">
                        <tr>
                          <td style="color: #78716c; width: 35%; font-size: 14px; vertical-align: top;">ประเภทการลา</td>
                          <td style="font-size: 14px;">
                            <span style="background: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 20px; font-weight: 600;">
                              ${leaveTypeLabels[leaveData.leave_type] || leaveData.leave_type}
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td style="color: #78716c; font-size: 14px; vertical-align: top;">วันที่เริ่มลา</td>
                          <td style="color: #1c1917; font-size: 14px;">${formatDate(leaveData.start_datetime)}<br><span style="color: #78716c; font-size: 13px;">เวลา ${formatTime(leaveData.start_datetime)} น.</span></td>
                        </tr>
                        <tr>
                          <td style="color: #78716c; font-size: 14px; vertical-align: top;">วันที่สิ้นสุด</td>
                          <td style="color: #1c1917; font-size: 14px;">${formatDate(leaveData.end_datetime)}<br><span style="color: #78716c; font-size: 13px;">เวลา ${formatTime(leaveData.end_datetime)} น.</span></td>
                        </tr>
                        <tr>
                          <td style="color: #78716c; font-size: 14px;">จำนวนวันลา</td>
                          <td style="font-size: 14px;">
                            <span style="background: #dc2626; color: white; padding: 4px 12px; border-radius: 20px; font-weight: 700;">
                              ${leaveData.total_days} วัน
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td style="color: #78716c; font-size: 14px; vertical-align: top;">เหตุผลการลา</td>
                          <td style="color: #1c1917; font-size: 14px;">${leaveData.reason || '-'}</td>
                        </tr>
                      </table>
                    </div>
                    
                    ${leaveData.approved_by_level1 || leaveData.approved_by_level2 ? `
                    <!-- Approver Info -->
                    <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px; padding: 20px;">
                      <h3 style="margin: 0 0 15px 0; color: #065f46; font-size: 16px; font-weight: 600; border-bottom: 2px solid #a7f3d0; padding-bottom: 10px;">
                        ✍️ ผู้ดำเนินการอนุมัติ
                      </h3>
                      <table width="100%" cellpadding="8" cellspacing="0">
                        ${leaveData.approved_by_level1 ? `
                        <tr>
                          <td style="color: #047857; width: 40%; font-size: 14px;">ขั้นที่ 1 (HR)</td>
                          <td style="color: #065f46; font-weight: 600; font-size: 14px;">${leaveData.approved_by_level1}</td>
                        </tr>
                        ` : ''}
                        ${leaveData.approved_by_level2 ? `
                        <tr>
                          <td style="color: #047857; font-size: 14px;">ขั้นที่ 2 (ผู้บริหาร)</td>
                          <td style="color: #065f46; font-weight: 600; font-size: 14px;">${leaveData.approved_by_level2}</td>
                        </tr>
                        ` : ''}
                      </table>
                    </div>
                    ` : ''}
                    
                    ${notificationType === 'new_request' || notificationType === 'pending_level2' ? `
                    <!-- Action Button -->
                    <div style="text-align: center; margin-top: 30px;">
                      <p style="color: #64748b; font-size: 14px; margin-bottom: 15px;">กรุณาเข้าสู่ระบบเพื่อดำเนินการ</p>
                    </div>
                    ` : ''}
                    
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="background: #1e293b; color: white; padding: 25px 40px; text-align: center;">
                    <p style="margin: 0 0 5px 0; font-size: 15px; font-weight: 600;">Gent-CEM System</p>
                    <p style="margin: 0; font-size: 12px; color: #94a3b8;">Customer Excellence Management</p>
                    <p style="margin: 15px 0 0 0; font-size: 11px; color: #64748b;">อีเมลนี้ถูกส่งโดยอัตโนมัติจากระบบ กรุณาอย่าตอบกลับ</p>
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

  try {
    const result = await transporter.sendMail(mailOptions);
    console.log('Leave notification email sent:', result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Error sending leave notification:', error);
    return { success: false, error: error.message };
  }
};
