import express from 'express';
import pool from '../config/database.js';
import { logAudit } from '../utils/auditHelper.js';
import { notifyNextStep } from '../services/workflowNotificationService.js';

const router = express.Router();

// Get all steps for a task
router.get('/task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const result = await pool.query(`
      SELECT ts.*, 
        EXISTS(SELECT 1 FROM daily_work_records dwr WHERE dwr.step_id = ts.id) as has_work_logged
      FROM task_steps ts
      WHERE ts.task_id = $1 
      ORDER BY ts.step_order ASC
    `, [taskId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching task steps:', error);
    res.status(500).json({ error: 'Failed to fetch task steps' });
  }
});

// Create new step
router.post('/', async (req, res) => {
  try {
    const { task_id, step_name, step_order, start_date, end_date, assigned_users, status, description } = req.body;
    
    // เช็คว่า start_date เป็นวันนี้หรือก่อนหน้าไหม -> แจ้งเตือนทันที
    const today = new Date().toISOString().split('T')[0];
    const shouldNotifyNow = start_date && start_date <= today;
    
    console.log(`📝 Creating step: ${step_name}, start_date: ${start_date}, today: ${today}, shouldNotify: ${shouldNotifyNow}`);
    
    const result = await pool.query(`
      INSERT INTO task_steps (task_id, step_name, step_order, start_date, end_date, assigned_users, status, description, notified_start)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
      RETURNING *
    `, [task_id, step_name, step_order, start_date, end_date, JSON.stringify(assigned_users || []), status || null, description, shouldNotifyNow]);
    
    // แจ้งเตือนทันทีถ้า start_date <= วันนี้ และมีผู้รับผิดชอบ
    if (shouldNotifyNow && assigned_users && assigned_users.length > 0) {
      console.log(`📧 Sending notification for step: ${step_name}, assignees: ${assigned_users.length}`);
      const { notifyStepAssignees } = await import('../services/workflowNotificationService.js');
      const task = await pool.query('SELECT task_name FROM tasks WHERE id = $1', [task_id]);
      await notifyStepAssignees(result.rows[0], task.rows[0], 'step_started');
    }
    
    await logAudit(req, {
      action: 'CREATE',
      tableName: 'task_steps',
      recordId: result.rows[0].id,
      recordName: step_name,
      newData: { task_id, step_name, status }
    });
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating task step:', error);
    res.status(500).json({ error: 'Failed to create task step' });
  }
});

// Update step
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { step_name, step_order, start_date, end_date, assigned_users, status, description } = req.body;
    
    // ดึงข้อมูลเดิมก่อน update
    const oldStep = await pool.query('SELECT status, task_id, step_order FROM task_steps WHERE id = $1', [id]);
    const wasNotCompleted = oldStep.rows[0]?.status !== 'completed';
    
    const result = await pool.query(`
      UPDATE task_steps 
      SET step_name = $1, step_order = $2, start_date = $3, end_date = $4, 
          assigned_users = $5::jsonb, status = $6, description = $7, updated_at = CURRENT_TIMESTAMP
      WHERE id = $8
      RETURNING *
    `, [step_name, step_order, start_date, end_date, JSON.stringify(assigned_users || []), status, description, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task step not found' });
    }
    
    // ถ้าเปลี่ยนเป็น completed ให้แจ้ง step ถัดไป
    if (wasNotCompleted && status === 'completed' && oldStep.rows[0]) {
      notifyNextStep(oldStep.rows[0].task_id, oldStep.rows[0].step_order);
    }
    
    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'task_steps',
      recordId: parseInt(id),
      recordName: step_name,
      newData: { step_name, status }
    });
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating task step:', error);
    res.status(500).json({ error: 'Failed to update task step' });
  }
});

// Delete step
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get data before delete
    const oldResult = await pool.query('SELECT step_name FROM task_steps WHERE id = $1', [id]);
    
    const result = await pool.query('DELETE FROM task_steps WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task step not found' });
    }
    
    await logAudit(req, {
      action: 'DELETE',
      tableName: 'task_steps',
      recordId: parseInt(id),
      recordName: oldResult.rows[0]?.step_name || 'ขั้นตอน'
    });
    
    res.json({ message: 'Task step deleted successfully' });
  } catch (error) {
    console.error('Error deleting task step:', error);
    res.status(500).json({ error: 'Failed to delete task step' });
  }
});

export default router;
