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

export default router;
