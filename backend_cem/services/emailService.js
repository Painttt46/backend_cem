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
