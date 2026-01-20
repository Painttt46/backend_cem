import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { sendForgotPasswordEmail } from '../services/emailService.js';
import { verifyToken } from '../middleware/auth.js';
import { logAudit } from '../utils/auditHelper.js';

const router = express.Router();

// Login with bcrypt password verification
router.post('/login', async (req, res) => {
  const client = await pool.connect();
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    // Find user by username
    const result = await client.query(
      'SELECT id, username, firstname, lastname, role, email, employee_id, position, department, password, is_active FROM users WHERE username = $1',
      [username]
    );
    
    if (result.rows.length === 0) {
      console.log(`Login failed: User not found - ${username}`);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    const user = result.rows[0];
    
    // Check if user is active
    if (!user.is_active) {
      console.log(`Login failed: User inactive - ${username}`);
      return res.status(401).json({ error: 'Account is disabled' });
    }
    
    // Check password with bcrypt
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      console.log(`Login failed: Invalid password - ${username}`);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id,
        username: user.username,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );
    
    // Set HttpOnly Cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000
    });
    
    // Remove password from response
    delete user.password;
    
    console.log(`Login successful: ${username} (${user.role})`);
    
    // Log audit
    await logAudit(req, {
      action: 'LOGIN',
      tableName: 'users',
      recordId: user.id,
      recordName: null,
      userName: `${user.firstname} ${user.lastname}`
    });
    
    res.json({
      success: true,
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
  } finally {
    client.release();
  }
});

// Get current user info
router.get('/me', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, firstname, lastname, role, email, employee_id, position, department FROM users WHERE id = $1 AND is_active = true',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
    
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Refresh token endpoint
router.post('/refresh', verifyToken, async (req, res) => {
  try {
    const newToken = jwt.sign(
      { 
        userId: req.user.id,
        username: req.user.username,
        role: req.user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );
    
    res.cookie('token', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000
    });
    
    res.json({
      success: true,
      access_token: newToken
    });
    
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout endpoint
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully' });
});

// Hash password utility
export const hashPassword = async (password) => {
  return await bcrypt.hash(password, 10);
};

// Forgot password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const result = await pool.query('SELECT id, username, firstname, lastname, email FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบอีเมลในระบบ' });
    }
    
    const user = result.rows[0];
    const newPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();
    
    // ส่ง email ก่อน ถ้าสำเร็จค่อยเปลี่ยน password
    try {
      const emailResult = await sendForgotPasswordEmail(email, {
        ...user,
        password: newPassword
      });
      
      if (emailResult.success) {
        // ส่ง email สำเร็จ ค่อยเปลี่ยน password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, user.id]);
        
        return res.json({ 
          message: 'ส่งข้อมูลการเข้าสู่ระบบไปยังอีเมลของคุณเรียบร้อยแล้ว',
          success: true
        });
      } else {
        throw new Error(emailResult.error);
      }
    } catch (emailError) {
      // ส่ง email ไม่ได้ ไม่เปลี่ยน password
      return res.status(500).json({
        error: 'ไม่สามารถส่งอีเมลได้ กรุณาติดต่อผู้ดูแลระบบ',
        success: false
      });
    }
    
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
