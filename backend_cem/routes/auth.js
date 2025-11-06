import express from 'express';
import bcrypt from 'bcrypt';
import pool from '../config/database.js';
import { sendForgotPasswordEmail } from '../services/emailService.js';

const router = express.Router();

// Login with bcrypt password verification
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    // Find user by username
    const result = await pool.query(
      'SELECT id, username, firstname, lastname, role, email, employee_id, position, department, password FROM users WHERE username = $1 AND is_active = true',
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    const user = result.rows[0];
    
    // Check password with bcrypt
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Generate simple token
    const token = `token_${user.id}_${Date.now()}`;
    
    // Remove password from response
    delete user.password;
    
    res.json({
      access_token: token,
      user: user.id,
      username: user.username,
      firstname: user.firstname,
      lastname: user.lastname,
      role: user.role,
      position: user.position,
      email: user.email,
      employee_id: user.employee_id,
      department: user.department
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user info
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    // Extract user ID from token
    const userId = token.split('_')[1];
    
    const result = await pool.query(
      'SELECT id, username, firstname, lastname, role, email, employee_id, position, department FROM users WHERE id = $1 AND is_active = true',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    res.json(result.rows[0]);
    
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Hash password utility for creating new users
export const hashPassword = async (password) => {
  return await bcrypt.hash(password, 10);
};

// Forgot password - send credentials via email
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    console.log('Forgot password request for email:', email);
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Find user by email
    const result = await pool.query('SELECT id, username, firstname, lastname, email FROM users WHERE email = $1', [email]);
    
    console.log('Query result for email', email, ':', result.rows);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบอีเมลในระบบ' });
    }
    
    const user = result.rows[0];
    
    // Generate new temporary password
    const passwordToSend = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();
    
    // Hash and update password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(passwordToSend, saltRounds);
    
    // Update password in database
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, user.id]);
    
    console.log(`Generated new password for user ${user.username}: ${passwordToSend}`);
    
    // Try to send email
    try {
      const emailResult = await sendForgotPasswordEmail(email, {
        ...user,
        password: passwordToSend
      });
      
      if (emailResult.success) {
        console.log(`Email sent successfully to ${email} with message ID: ${emailResult.messageId}`);
        return res.json({ 
          message: 'ส่งข้อมูลการเข้าสู่ระบบไปยังอีเมลของคุณเรียบร้อยแล้ว',
          success: true
        });
      } else {
        throw new Error(emailResult.error);
      }
    } catch (emailError) {
      console.error('Email sending failed:', emailError.message);
      
      // Fallback: Return user info directly
      return res.json({
        message: 'ไม่สามารถส่งอีเมลได้ แต่พบข้อมูลผู้ใช้',
        success: true,
        fallback: true,
        userData: {
          username: user.username,
          email: user.email,
          name: `${user.firstname} ${user.lastname}`,
          password: passwordToSend
        }
      });
    }
    
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
