import express from 'express';
import pool from '../config/database.js';
import { logAudit } from '../utils/auditHelper.js';
import { notifyNextStep, notifyStepUpdate } from '../services/workflowNotificationService.js';

const router = express.Router();

// Get all steps (for dashboard)
router.get('/all', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ts.*, 
        EXISTS(SELECT 1 FROM daily_work_records dwr WHERE dwr.step_id = ts.id OR dwr.step_ids @> to_jsonb(ts.id)) as has_work_logged,
        (SELECT MAX(work_date) FROM daily_work_records dwr WHERE (dwr.step_id = ts.id OR dwr.step_ids @> to_jsonb(ts.id)) AND work_date <= CURRENT_DATE) as latest_work_date
      FROM task_steps ts
      ORDER BY ts.task_id, ts.step_order ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching all steps:', error);
    res.status(500).json({ error: 'Failed to fetch steps' });
  }
});

// Get all steps for a task
router.get('/task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const result = await pool.query(`
      SELECT ts.*, 
        EXISTS(SELECT 1 FROM daily_work_records dwr WHERE dwr.step_id = ts.id OR dwr.step_ids @> to_jsonb(ts.id)) as has_work_logged,
        (SELECT MAX(work_date) FROM daily_work_records dwr WHERE dwr.step_id = ts.id OR dwr.step_ids @> to_jsonb(ts.id)) as latest_work_date
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
    const { task_id, step_name, step_order, start_date, end_date, assigned_users, status, description, project_statuses } = req.body;
    
    const result = await pool.query(`
      INSERT INTO task_steps (task_id, step_name, step_order, start_date, end_date, assigned_users, status, description, project_statuses)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb)
      RETURNING *
    `, [task_id, step_name, step_order, start_date, end_date, JSON.stringify(assigned_users || []), status || null, description, JSON.stringify(project_statuses || [])]);
    
    // ถ้า task เป็น completed และเพิ่ม step ใหม่ที่ยังไม่เสร็จ -> เปลี่ยนกลับเป็นสถานะก่อนหน้า
    if (status !== 'completed') {
      const taskResult = await pool.query('SELECT status, previous_status FROM tasks WHERE id = $1', [task_id]);
      if (taskResult.rows[0]?.status === 'completed') {
        const prevStatus = taskResult.rows[0]?.previous_status || 'in_progress';
        await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', [prevStatus, task_id]);
      }
    }
    
    // แจ้งเตือนทันทีถ้ามีผู้รับผิดชอบ
    if (assigned_users && assigned_users.length > 0) {
      console.log(`📧 Sending notification for new step: ${step_name}`);
      notifyStepUpdate(result.rows[0].id, task_id);
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
    const { step_name, step_order, start_date, end_date, assigned_users, status, description, project_statuses } = req.body;
    
    // ดึงข้อมูลเดิมก่อน update
    const oldStep = await pool.query('SELECT * FROM task_steps WHERE id = $1', [id]);
    if (oldStep.rows.length === 0) {
      return res.status(404).json({ error: 'Task step not found' });
    }
    
    const existing = oldStep.rows[0];
    const wasNotCompleted = existing.status !== 'completed';
    
    // รักษาค่าเดิมถ้าไม่ได้ส่งมา
    const finalStatus = status !== undefined ? status : existing.status;
    const finalProjectStatuses = project_statuses !== undefined ? project_statuses : existing.project_statuses;
    
    const result = await pool.query(`
      UPDATE task_steps 
      SET step_name = $1, step_order = $2, start_date = $3, end_date = $4, 
          assigned_users = $5::jsonb, status = $6, description = $7, project_statuses = $8::jsonb, updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING *
    `, [step_name, step_order, start_date, end_date, JSON.stringify(assigned_users || existing.assigned_users || []), finalStatus, description, JSON.stringify(finalProjectStatuses || []), id]);
    
    // เช็คว่า steps ทั้งหมดเสร็จหรือยัง
    const allSteps = await pool.query('SELECT status FROM task_steps WHERE task_id = $1', [existing.task_id]);
    const allCompleted = allSteps.rows.length > 0 && allSteps.rows.every(s => s.status === 'completed');
    
    // ดึงสถานะปัจจุบันของ task
    const taskResult = await pool.query('SELECT status, previous_status FROM tasks WHERE id = $1', [existing.task_id]);
    const currentTaskStatus = taskResult.rows[0]?.status;
    
    if (allCompleted && currentTaskStatus !== 'completed') {
      // ทุก step เสร็จ -> เปลี่ยน task เป็น completed และเก็บสถานะก่อนหน้า
      await pool.query('UPDATE tasks SET previous_status = status, status = $1 WHERE id = $2', ['completed', existing.task_id]);
    } else if (!allCompleted && currentTaskStatus === 'completed') {
      // มี step ที่ยังไม่เสร็จ -> เปลี่ยนกลับเป็นสถานะก่อนหน้า
      const prevStatus = taskResult.rows[0]?.previous_status || 'in_progress';
      await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', [prevStatus, existing.task_id]);
    }
    
    // ถ้าเปลี่ยนเป็น completed ให้แจ้ง step ถัดไป
    if (wasNotCompleted && finalStatus === 'completed') {
      notifyNextStep(existing.task_id, existing.step_order);
    } 
    // ถ้าไม่ใช่ completed แต่มีการเปลี่ยนแปลง ให้แจ้งผู้รับผิดชอบ
    else if (finalStatus !== 'completed' && assigned_users && assigned_users.length > 0) {
      notifyStepUpdate(parseInt(id), existing.task_id);
    }
    
    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'task_steps',
      recordId: parseInt(id),
      recordName: step_name,
      newData: { step_name, status: finalStatus }
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
