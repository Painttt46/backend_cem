import express from 'express';
import pool from '../config/database.js';
import bcrypt from 'bcrypt';

const router = express.Router();

// Get distinct roles from users
router.get('/roles', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT DISTINCT role FROM users WHERE role IS NOT NULL ORDER BY role'
    );
    const roles = result.rows.map(row => row.role);
    res.json({ roles });
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// Get all users
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, firstname, lastname, role, email, employee_id, position, department, is_active FROM users ORDER BY firstname, lastname'
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new user
router.post('/', async (req, res) => {
  try {
    const { username, password, firstname, lastname, role, email, employee_id, position, department } = req.body;
    
    if (!username || !password || !firstname || !lastname) {
      return res.status(400).json({ error: 'Required fields missing' });
    }
    
    const result = await pool.query(
      'INSERT INTO users (username, password, firstname, lastname, role, email, employee_id, position, department) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, username, firstname, lastname, role, email, employee_id, position, department',
      [username, password, firstname, lastname, role || 'user', email, employee_id, position, department]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating user:', error);
    if (error.code === '23505') {
      res.status(409).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Update user
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, firstname, lastname, role, email, employee_id, position, department, is_active } = req.body;
    
    let query = 'UPDATE users SET username = $1, firstname = $2, lastname = $3, role = $4, email = $5, employee_id = $6, position = $7, department = $8, is_active = $9';
    let values = [username, firstname, lastname, role, email, employee_id, position, department, is_active];
    
    if (password) {
      query += ', password = $10 WHERE id = $11';
      values.push(password, id);
    } else {
      query += ' WHERE id = $10';
      values.push(id);
    }
    
    query += ' RETURNING id, username, firstname, lastname, role, email, employee_id, position, department, is_active';
    
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password
router.put('/:id/password', async (req, res) => {
  try {
    const { id } = req.params;
    const { currentPassword, password } = req.body;
    
    if (!currentPassword || !password) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    
    // Get current user data
    const userResult = await pool.query('SELECT password FROM users WHERE id = $1', [id]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, userResult.rows[0].password);
    
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    
    // Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Update password
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, id]);
    
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user leave quota
router.put('/:id/leave-quota', async (req, res) => {
  try {
    const { id } = req.params;
    const { sick_leave_quota, personal_leave_quota, vacation_leave_quota } = req.body;

    await pool.query(
      `UPDATE users 
       SET sick_leave_quota = $1, personal_leave_quota = $2, vacation_leave_quota = $3
       WHERE id = $4`,
      [sick_leave_quota, personal_leave_quota, vacation_leave_quota, id]
    );

    res.json({ message: 'Leave quota updated successfully' });
  } catch (error) {
    console.error('Error updating leave quota:', error);
    res.status(500).json({ error: 'Failed to update leave quota' });
  }
});

export default router;
