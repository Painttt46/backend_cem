import express from 'express';
import pool from '../config/database.js';
import { logAudit } from '../utils/auditHelper.js';

const router = express.Router();

// Get all tasks with latest status from daily work
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        t.id, t.task_name, t.so_number, t.contract_number, t.sale_owner, t.project_manager, t.customer_info,
        t.description, t.files, 
        TO_CHAR(t.project_start_date, 'YYYY-MM-DD') as project_start_date,
        TO_CHAR(t.project_end_date, 'YYYY-MM-DD') as project_end_date,
        t.created_at, t.category,
        t.status
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
    const { task_name, so_number, contract_number, sale_owner, project_manager, customer_info, project_start_date, project_end_date, description, category, files } = req.body;

    // Get first category as default if not provided
    let finalCategory = category;
    if (!finalCategory) {
      const categoryResult = await pool.query(`
        SELECT value FROM task_categories 
        ORDER BY sort_order ASC 
        LIMIT 1
      `);
      finalCategory = categoryResult.rows[0]?.value || 'งานทั่วไป';
    }
    
    const result = await pool.query(`
      INSERT INTO tasks (task_name, so_number, contract_number, sale_owner, project_manager, customer_info, project_start_date, project_end_date, description, category, files, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NULL)
      RETURNING *
    `, [task_name, so_number, contract_number, sale_owner, project_manager, customer_info, project_start_date, project_end_date, description, finalCategory, JSON.stringify(files || [])]);
    
    await logAudit(req, {
      action: 'CREATE',
      tableName: 'tasks',
      recordId: result.rows[0].id,
      recordName: task_name,
      newData: { task_name, so_number, customer_info, category: finalCategory }
    });
    
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
    const result = await pool.query(`
      SELECT 
        t.*,
        CASE
          WHEN (SELECT MAX(dwr.created_at) FROM daily_work_records dwr WHERE dwr.task_id = t.id) > t.updated_at
          THEN (SELECT dwr.work_status FROM daily_work_records dwr WHERE dwr.task_id = t.id ORDER BY dwr.work_date DESC, dwr.created_at DESC LIMIT 1)
          ELSE t.status
        END as status
      FROM tasks t 
      WHERE t.id = $1
    `, [id]);
    
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
    const { task_name, so_number, contract_number, sale_owner, project_manager, customer_info, description, category, status, files, project_start_date, project_end_date } = req.body;
    
    const oldResult = await pool.query('SELECT task_name, so_number, status, category FROM tasks WHERE id = $1', [id]);
    const oldData = oldResult.rows[0];
    
    const result = await pool.query(`
      UPDATE tasks 
      SET task_name = $1, so_number = $2, contract_number = $3, 
          sale_owner = $4, project_manager = $5, customer_info = $6, description = $7, category = $8, status = $9, files = $10::jsonb, 
          project_start_date = $11, project_end_date = $12, updated_at = CURRENT_TIMESTAMP
      WHERE id = $13
      RETURNING *
    `, [task_name, so_number, contract_number, sale_owner, project_manager, customer_info, description, category, status, JSON.stringify(files || []), project_start_date, project_end_date, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Log audit
    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'tasks',
      recordId: parseInt(id),
      recordName: task_name,
      oldData,
      newData: { task_name, so_number, status, category }
    });
    
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
    
    const oldResult = await pool.query('SELECT task_name, so_number FROM tasks WHERE id = $1', [id]);
    const oldData = oldResult.rows[0];
    
    await pool.query('DELETE FROM daily_work_records WHERE task_id = $1', [id]);
    await pool.query('DELETE FROM task_steps WHERE task_id = $1', [id]);
    await pool.query('DELETE FROM car_bookings WHERE task_id = $1', [id]);
    
    const result = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    if (oldData) {
      await logAudit(req, {
        action: 'DELETE',
        tableName: 'tasks',
        recordId: parseInt(id),
        recordName: oldData.task_name,
        oldData
      });
    }
    
    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

export default router;
