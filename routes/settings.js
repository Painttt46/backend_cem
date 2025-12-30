import express from 'express';
import pool from '../config/database.js';

const router = express.Router();

// ========== TASK CATEGORIES ==========

// GET all categories
router.get('/categories', async (req, res) => {
  try {
    // Add color column if not exists
    await pool.query(`
      ALTER TABLE task_categories 
      ADD COLUMN IF NOT EXISTS color VARCHAR(20)
    `);
    
    const result = await pool.query(
      'SELECT * FROM task_categories ORDER BY sort_order, id'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST new category
router.post('/categories', async (req, res) => {
  const { label, value, icon, color } = req.body;
  try {
    // Add color column if not exists
    await pool.query(`
      ALTER TABLE task_categories 
      ADD COLUMN IF NOT EXISTS color VARCHAR(20)
    `);
    
    const maxOrder = await pool.query('SELECT MAX(sort_order) as max FROM task_categories');
    const sortOrder = (maxOrder.rows[0].max || 0) + 1;
    
    const result = await pool.query(
      'INSERT INTO task_categories (label, value, icon, color, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [label, value, icon, color, sortOrder]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE category
router.delete('/categories/:value', async (req, res) => {
  try {
    await pool.query('DELETE FROM task_categories WHERE value = $1', [req.params.value]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update category order
router.put('/categories/reorder', async (req, res) => {
  const { categories } = req.body;
  try {
    for (let i = 0; i < categories.length; i++) {
      await pool.query(
        'UPDATE task_categories SET sort_order = $1 WHERE value = $2',
        [i, categories[i].value]
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update category labels (migration)
router.put('/categories/update-labels', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM task_categories');
    
    for (const category of result.rows) {
      if (category.icon && category.icon.startsWith('emoji:')) {
        const emoji = category.icon.replace('emoji:', '');
        // Check if label already has emoji
        if (!category.label.includes(emoji)) {
          const newLabel = `${emoji} ${category.label}`;
          await pool.query(
            'UPDATE task_categories SET label = $1 WHERE id = $2',
            [newLabel, category.id]
          );
        }
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update category colors (migration)
router.put('/categories/update-colors', async (req, res) => {
  try {
    await pool.query(`
      ALTER TABLE task_categories 
      ADD COLUMN IF NOT EXISTS color VARCHAR(20)
    `);
    
    const colors = ['#6366f1', '#14b8a6', '#f97316', '#a855f7', '#06b6d4', '#84cc16', '#d946ef', '#0ea5e9', '#22c55e', '#eab308'];
    const result = await pool.query('SELECT * FROM task_categories WHERE color IS NULL ORDER BY id');
    
    for (let i = 0; i < result.rows.length; i++) {
      const color = colors[i % colors.length];
      await pool.query(
        'UPDATE task_categories SET color = $1 WHERE id = $2',
        [color, result.rows[i].id]
      );
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== WORK STATUSES ==========

// GET all statuses
router.get('/statuses', async (req, res) => {
  try {
    // Add color column if not exists
    await pool.query(`
      ALTER TABLE work_statuses 
      ADD COLUMN IF NOT EXISTS color VARCHAR(20)
    `);
    
    const result = await pool.query(
      'SELECT * FROM work_statuses ORDER BY sort_order, id'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST new status
router.post('/statuses', async (req, res) => {
  const { label, value, icon, color } = req.body;
  try {
    // Add color column if not exists
    await pool.query(`
      ALTER TABLE work_statuses 
      ADD COLUMN IF NOT EXISTS color VARCHAR(20)
    `);
    
    const maxOrder = await pool.query('SELECT MAX(sort_order) as max FROM work_statuses');
    const sortOrder = (maxOrder.rows[0].max || 0) + 1;
    
    const result = await pool.query(
      'INSERT INTO work_statuses (label, value, icon, color, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [label, value, icon, color, sortOrder]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE status
router.delete('/statuses/:value', async (req, res) => {
  try {
    await pool.query('DELETE FROM work_statuses WHERE value = $1', [req.params.value]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update status order
router.put('/statuses/reorder', async (req, res) => {
  const { statuses } = req.body;
  try {
    for (let i = 0; i < statuses.length; i++) {
      await pool.query(
        'UPDATE work_statuses SET sort_order = $1 WHERE value = $2',
        [i, statuses[i].value]
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update status colors (migration)
router.put('/statuses/update-colors', async (req, res) => {
  try {
    await pool.query(`
      ALTER TABLE work_statuses 
      ADD COLUMN IF NOT EXISTS color VARCHAR(20)
    `);
    
    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];
    const result = await pool.query('SELECT * FROM work_statuses WHERE color IS NULL ORDER BY id');
    
    for (let i = 0; i < result.rows.length; i++) {
      const color = colors[i % colors.length];
      await pool.query(
        'UPDATE work_statuses SET color = $1 WHERE id = $2',
        [color, result.rows[i].id]
      );
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ========== LEAVE APPROVAL SETTINGS ==========

// Create table if not exists
async function ensureLeaveApprovalTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leave_approval_settings (
      id SERIAL PRIMARY KEY,
      approval_level INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      receive_email BOOLEAN DEFAULT true,
      can_approve BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(approval_level, user_id)
    )
  `);
}

// GET leave approval settings
router.get('/leave-approval', async (req, res) => {
  try {
    await ensureLeaveApprovalTable();
    
    const result = await pool.query(`
      SELECT 
        las.*,
        u.firstname || ' ' || u.lastname as user_name,
        u.email,
        u.position
      FROM leave_approval_settings las
      JOIN users u ON las.user_id = u.id
      ORDER BY las.approval_level, u.firstname
    `);
    
    const level1 = result.rows.filter(r => r.approval_level === 1);
    const level2 = result.rows.filter(r => r.approval_level === 2);
    
    res.json({ level1, level2 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST add approver
router.post('/leave-approval', async (req, res) => {
  const { approval_level, user_id, receive_email, can_approve } = req.body;
  
  try {
    await ensureLeaveApprovalTable();
    
    const result = await pool.query(`
      INSERT INTO leave_approval_settings (approval_level, user_id, receive_email, can_approve)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (approval_level, user_id) 
      DO UPDATE SET receive_email = $3, can_approve = $4, updated_at = NOW()
      RETURNING *
    `, [approval_level, user_id, receive_email !== false, can_approve !== false]);
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE remove approver
router.delete('/leave-approval/:level/:userId', async (req, res) => {
  const { level, userId } = req.params;
  
  try {
    await pool.query(
      'DELETE FROM leave_approval_settings WHERE approval_level = $1 AND user_id = $2',
      [level, userId]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update approver settings
router.put('/leave-approval/:level/:userId', async (req, res) => {
  const { level, userId } = req.params;
  const { receive_email, can_approve } = req.body;
  
  try {
    const result = await pool.query(`
      UPDATE leave_approval_settings 
      SET receive_email = $1, can_approve = $2, updated_at = NOW()
      WHERE approval_level = $3 AND user_id = $4
      RETURNING *
    `, [receive_email, can_approve, level, userId]);
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== ROLE WORK HOURS ==========

// Create table if not exists
async function ensureRoleWorkHoursTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_work_hours (
      id SERIAL PRIMARY KEY,
      role VARCHAR(50) UNIQUE NOT NULL,
      start_time TIME NOT NULL DEFAULT '09:00',
      end_time TIME NOT NULL DEFAULT '18:00',
      lunch_start TIME DEFAULT '12:00',
      lunch_end TIME DEFAULT '13:00',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// GET all role work hours
router.get('/role-work-hours', async (req, res) => {
  try {
    await ensureRoleWorkHoursTable();
    const result = await pool.query('SELECT * FROM role_work_hours ORDER BY role');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET work hours by role
router.get('/role-work-hours/:role', async (req, res) => {
  try {
    await ensureRoleWorkHoursTable();
    const result = await pool.query('SELECT * FROM role_work_hours WHERE role = $1', [req.params.role]);
    
    if (result.rows.length === 0) {
      // Return default work hours
      res.json({
        role: req.params.role,
        start_time: '09:00',
        end_time: '18:00',
        lunch_start: '12:00',
        lunch_end: '13:00'
      });
    } else {
      res.json(result.rows[0]);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST/PUT upsert role work hours
router.post('/role-work-hours', async (req, res) => {
  const { role, start_time, end_time, lunch_start, lunch_end } = req.body;
  
  try {
    await ensureRoleWorkHoursTable();
    
    const result = await pool.query(`
      INSERT INTO role_work_hours (role, start_time, end_time, lunch_start, lunch_end)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (role) 
      DO UPDATE SET start_time = $2, end_time = $3, lunch_start = $4, lunch_end = $5, updated_at = NOW()
      RETURNING *
    `, [role, start_time, end_time, lunch_start || '12:00', lunch_end || '13:00']);
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE role work hours
router.delete('/role-work-hours/:role', async (req, res) => {
  try {
    await pool.query('DELETE FROM role_work_hours WHERE role = $1', [req.params.role]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
