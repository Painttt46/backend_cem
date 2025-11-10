import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { sendForgotPasswordEmail } from '../services/emailService.js';
import { verifyToken } from '../middleware/auth.js';

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
    const passwordToSend = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();
    const hashedPassword = await bcrypt.hash(passwordToSend, 10);
    
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, user.id]);
    
    try {
      const emailResult = await sendForgotPasswordEmail(email, {
        ...user,
        password: passwordToSend
      });
      
      if (emailResult.success) {
        return res.json({ 
          message: 'ส่งข้อมูลการเข้าสู่ระบบไปยังอีเมลของคุณเรียบร้อยแล้ว',
          success: true
        });
      } else {
        throw new Error(emailResult.error);
      }
    } catch (emailError) {
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
