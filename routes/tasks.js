import express from 'express';
import pool from '../config/database.js';

const router = express.Router();

// Get all tasks with latest status from daily work
router.get('/', async (req, res) => {
  try {
    // เพิ่ม column files และ status ถ้ายังไม่มี
    await pool.query(`
      ALTER TABLE tasks 
      ADD COLUMN IF NOT EXISTS files JSONB DEFAULT '[]'
    `);
    await pool.query(`
      ALTER TABLE tasks 
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending'
    `);
    
    const result = await pool.query(`
      SELECT 
        t.id, t.task_name, t.so_number, t.contract_number, t.sale_owner, 
        t.description, t.files, t.project_start_date, t.project_end_date, t.created_at, t.category,
        COALESCE(t.status, 'pending') as status
      FROM tasks t
      ORDER BY t.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Create new task
router.post('/', async (req, res) => {
  try {
    const { task_name, so_number, contract_number, sale_owner, project_start_date, project_end_date, description, category, files } = req.body;
    
    console.log('Creating task with files:', files);
    
    const result = await pool.query(`
      INSERT INTO tasks (task_name, so_number, contract_number, sale_owner, project_start_date, project_end_date, description, category, files)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      RETURNING *
    `, [task_name, so_number, contract_number, sale_owner, project_start_date, project_end_date, description, category || 'งานทั่วไป', JSON.stringify(files || [])]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Get task by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// Update task
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { task_name, so_number, contract_number, sale_owner, description, category, status, files } = req.body;
    
    const result = await pool.query(`
      UPDATE tasks 
      SET task_name = $1, so_number = $2, contract_number = $3, 
          sale_owner = $4, description = $5, category = $6, status = $7, files = $8::jsonb, updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING *
    `, [task_name, so_number, contract_number, sale_owner, description, category, status, JSON.stringify(files || []), id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Delete task
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

export default router;
