import express from 'express';
import pool from '../config/database.js';
import { logAudit } from '../utils/auditHelper.js';
import { notifyNextStep, notifyNewAssignees, sendWorkflowSummaryToTeams } from '../services/workflowNotificationService.js';
import { requirePermission } from '../middleware/auth.js';
import { PERM_PROJECTS_DELETE } from '../config/permissionKeys.js';

const router = express.Router();

// Ensure step_type column exists
pool.query(`ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS step_type VARCHAR(50) DEFAULT 'general'`).catch(() => {});
// เวลาที่ "สถานะโครงการ" ของ step ถูกตั้ง/แก้ล่าสุด — ใช้หาสถานะปัจจุบันของโครงการ
// (เดิมใช้ updated_at ซึ่งถูกเปลี่ยนทุก step ทุกครั้งที่กดบันทึกหน้าแก้ไขโครงการ สถานะที่แก้จึงไม่ขึ้น)
pool.query(`ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS project_status_updated_at TIMESTAMP`).catch(() => {});
// step ที่ระบบปิดให้ตอนเลือกสถานะโครงการ แยกจากที่คนกดเสร็จเอง — เลือกย้อนกลับแล้วเปิดกลับเฉพาะกลุ่มนี้ และคืนสถานะเดิมได้
pool.query(`ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS auto_completed BOOLEAN NOT NULL DEFAULT false`).catch(() => {});
pool.query(`ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS status_before_auto VARCHAR(50)`).catch(() => {});

const sameStatuses = (a, b) => JSON.stringify([...(a || [])].map(String).sort()) === JSON.stringify([...(b || [])].map(String).sort());

// สถานะที่แปลว่าจบโครงการ — ตรงกับ frontend utils/statusHelper.js
const FINISHED_PROJECT_STATUSES = ['completed', 'done', 'finished', 'เสร็จสมบูรณ์'];

// ผู้ใช้เลือก step นี้เป็นสถานะปัจจุบันของโครงการ
// - step ก่อนหน้าที่ยังไม่เสร็จ → ปิดเป็นเสร็จสิ้น (ถ้าเลือกสถานะจบโครงการ ปิด step นี้ด้วย)
// - step หลังจากนี้ที่ระบบเคยปิดให้ → เปิดกลับ (step นี้ด้วยถ้าไม่ใช่สถานะจบโครงการ) ส่วน step ที่คนกดเสร็จเองไม่แตะ
// step หลังจากสถานะจบโครงการไม่ถูกปิด เพราะมีงานต่อเนื่องได้ เช่น CM/PM
// ไม่ส่งแจ้งเตือน "ถึงขั้นตอนถัดไป" เพราะงานไม่ได้เพิ่งส่งต่อจริง
async function applyStatusSelection(step, actorId) {
  const finished = (step.project_statuses || []).some(s => FINISHED_PROJECT_STATUSES.includes(s));
  const order = step.step_order ?? 0;
  const closed = await pool.query(`
    UPDATE task_steps
    SET status_before_auto = status, status = 'completed', completed_by = $1, completed_at = CURRENT_TIMESTAMP,
        auto_completed = true, updated_at = CURRENT_TIMESTAMP
    WHERE task_id = $2 AND COALESCE(status, '') <> 'completed'
      AND (COALESCE(step_order, 0) < $3 OR (id = $4 AND $5::boolean))
    RETURNING id, step_name
  `, [actorId || null, step.task_id, order, step.id, finished]);
  const reopened = await pool.query(`
    UPDATE task_steps
    SET status = status_before_auto, status_before_auto = NULL, completed_by = NULL, completed_at = NULL,
        auto_completed = false, updated_at = CURRENT_TIMESTAMP
    WHERE task_id = $1 AND auto_completed = true AND status = 'completed'
      AND (COALESCE(step_order, 0) > $2 OR (id = $3 AND NOT $4::boolean))
    RETURNING id, step_name
  `, [step.task_id, order, step.id, finished]);
  return { closed: closed.rows, reopened: reopened.rows };
}

// ทุก step เสร็จ → โครงการเสร็จสิ้น (เก็บสถานะก่อนหน้า) / มี step ที่ยังไม่เสร็จ → กลับไปสถานะก่อนหน้า
async function syncTaskCompletion(taskId) {
  const allSteps = await pool.query('SELECT status FROM task_steps WHERE task_id = $1', [taskId]);
  const allCompleted = allSteps.rows.length > 0 && allSteps.rows.every(s => s.status === 'completed');
  const taskResult = await pool.query('SELECT status, previous_status FROM tasks WHERE id = $1', [taskId]);
  const currentTaskStatus = taskResult.rows[0]?.status;

  if (allCompleted && currentTaskStatus !== 'completed') {
    await pool.query('UPDATE tasks SET previous_status = status, status = $1 WHERE id = $2', ['completed', taskId]);
  } else if (!allCompleted && currentTaskStatus === 'completed') {
    const prevStatus = taskResult.rows[0]?.previous_status || 'in_progress';
    await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', [prevStatus, taskId]);
  }
}

const auditStatusSelection = async (req, stepId, stepName, cascade) => {
  if (!cascade.closed.length && !cascade.reopened.length) return;
  await logAudit(req, {
    action: 'UPDATE',
    tableName: 'task_steps',
    recordId: stepId,
    recordName: `เลือกสถานะโครงการ: ${stepName}`,
    newData: { auto_closed: cascade.closed.map(s => s.step_name), reopened: cascade.reopened.map(s => s.step_name) }
  });
};

// Get procurement steps (for procurement page)
router.get('/procurement', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ts.*, 
        t.task_name, t.so_number, t.category, t.project_manager, t.sale_owner, t.customer_info,
        EXISTS(SELECT 1 FROM daily_work_records dwr WHERE dwr.step_id = ts.id OR dwr.step_ids @> to_jsonb(ts.id)) as has_work_logged,
        w.latest_work_date, w.latest_work_logged_at,
        uc.firstname || ' ' || uc.lastname as created_by_name,
        ucp.firstname || ' ' || ucp.lastname as completed_by_name
      FROM task_steps ts
      JOIN tasks t ON ts.task_id = t.id
      LEFT JOIN users uc ON ts.created_by = uc.id
      LEFT JOIN users ucp ON ts.completed_by = ucp.id
      LEFT JOIN LATERAL (
        SELECT MAX(dwr.work_date) AS latest_work_date, MAX(dwr.created_at) AS latest_work_logged_at
        FROM daily_work_records dwr
        WHERE (dwr.step_id = ts.id OR dwr.step_ids @> to_jsonb(ts.id)) AND dwr.work_date <= CURRENT_DATE
      ) w ON true
      WHERE ts.step_type = 'procurement'
      ORDER BY ts.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching procurement steps:', error);
    res.status(500).json({ error: 'Failed to fetch procurement steps' });
  }
});

// Get all steps (for dashboard)
router.get('/all', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ts.*, 
        EXISTS(SELECT 1 FROM daily_work_records dwr WHERE dwr.step_id = ts.id OR dwr.step_ids @> to_jsonb(ts.id)) as has_work_logged,
        w.latest_work_date, w.latest_work_logged_at,
        uc.firstname || ' ' || uc.lastname as created_by_name,
        ucp.firstname || ' ' || ucp.lastname as completed_by_name
      FROM task_steps ts
      LEFT JOIN users uc ON ts.created_by = uc.id
      LEFT JOIN users ucp ON ts.completed_by = ucp.id
      LEFT JOIN LATERAL (
        SELECT MAX(dwr.work_date) AS latest_work_date, MAX(dwr.created_at) AS latest_work_logged_at
        FROM daily_work_records dwr
        WHERE (dwr.step_id = ts.id OR dwr.step_ids @> to_jsonb(ts.id)) AND dwr.work_date <= CURRENT_DATE
      ) w ON true
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
        w.latest_work_date, w.latest_work_logged_at,
        uc.firstname || ' ' || uc.lastname as created_by_name,
        ucp.firstname || ' ' || ucp.lastname as completed_by_name
      FROM task_steps ts
      LEFT JOIN users uc ON ts.created_by = uc.id
      LEFT JOIN users ucp ON ts.completed_by = ucp.id
      LEFT JOIN LATERAL (
        SELECT MAX(dwr.work_date) AS latest_work_date, MAX(dwr.created_at) AS latest_work_logged_at
        FROM daily_work_records dwr
        WHERE (dwr.step_id = ts.id OR dwr.step_ids @> to_jsonb(ts.id)) AND dwr.work_date <= CURRENT_DATE
      ) w ON true
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
    const { task_id, step_name, step_order, start_date, end_date, assigned_users, status, description, project_statuses, step_type } = req.body;
    const created_by = req.user?.id || null;
    
    const result = await pool.query(`
      INSERT INTO task_steps (task_id, step_name, step_order, start_date, end_date, assigned_users, status, description, project_statuses, created_by, step_type, project_status_updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10, $11, CASE WHEN $12::boolean THEN CURRENT_TIMESTAMP END)
      RETURNING *
    `, [task_id, step_name, step_order, start_date, end_date, JSON.stringify(assigned_users || []), status || null, description, JSON.stringify(project_statuses || []), created_by, step_type || 'general', req.body.mark_current_status === true && Array.isArray(project_statuses) && project_statuses.length > 0]);
    
    // ถ้า task เป็น completed และเพิ่ม step ใหม่ที่ยังไม่เสร็จ -> เปลี่ยนกลับเป็นสถานะก่อนหน้า
    if (status !== 'completed') {
      const taskResult = await pool.query('SELECT status, previous_status FROM tasks WHERE id = $1', [task_id]);
      if (taskResult.rows[0]?.status === 'completed') {
        const prevStatus = taskResult.rows[0]?.previous_status || 'in_progress';
        await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', [prevStatus, task_id]);
      }
    }
    
    // แจ้งเตือนผู้รับผิดชอบใหม่ พร้อมส่งชื่อคนสร้าง
    if (assigned_users && assigned_users.length > 0) {
      const newUserIds = assigned_users.map(u => typeof u === 'object' ? u.id : u).filter(Boolean);
      notifyNewAssignees(result.rows[0].id, task_id, newUserIds, true, created_by);
    }
    
    // สร้างพร้อมเลือกเป็นสถานะปัจจุบัน (project_status_updated_at ถูกตั้งเฉพาะกรณีนี้)
    let statusCascade = null;
    if (result.rows[0].project_status_updated_at) {
      statusCascade = await applyStatusSelection(result.rows[0], created_by);
      await syncTaskCompletion(task_id);
      await auditStatusSelection(req, result.rows[0].id, step_name, statusCascade);
    }

    // แจ้ง MS Teams พร้อม mark ว่าเพิ่มใหม่
    sendWorkflowSummaryToTeams(result.rows[0].id, 'create');
    
    await logAudit(req, {
      action: 'CREATE',
      tableName: 'task_steps',
      recordId: result.rows[0].id,
      recordName: step_name,
      newData: { task_id, step_name, status }
    });
    
    // Return พร้อม created_by_name
    const stepWithName = { 
      ...result.rows[0], 
      created_by_name: req.user ? `${req.user.firstname} ${req.user.lastname}` : null 
    };
    res.status(201).json(statusCascade ? { ...stepWithName, status_cascade: statusCascade } : stepWithName);
  } catch (error) {
    console.error('Error creating task step:', error);
    res.status(500).json({ error: 'Failed to create task step' });
  }
});

// Update step
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { step_name, step_order, start_date, end_date, assigned_users, status, description, project_statuses, late_reason, step_type } = req.body;
    
    // ดึงข้อมูลเดิมก่อน update
    const oldStep = await pool.query('SELECT * FROM task_steps WHERE id = $1', [id]);
    if (oldStep.rows.length === 0) {
      return res.status(404).json({ error: 'Task step not found' });
    }
    
    const existing = oldStep.rows[0];
    const wasNotCompleted = existing.status !== 'completed';
    
    // รักษาค่าเดิมถ้าไม่ได้ส่งมา
    const finalStepName = step_name !== undefined ? step_name : existing.step_name;
    const finalStepOrder = step_order !== undefined ? step_order : existing.step_order;
    const finalStartDate = start_date !== undefined ? start_date : existing.start_date;
    const finalEndDate = end_date !== undefined ? end_date : existing.end_date;
    const finalStatus = status !== undefined ? status : existing.status;
    const finalDescription = description !== undefined ? description : existing.description;
    const finalProjectStatuses = project_statuses !== undefined ? project_statuses : existing.project_statuses;
    const finalStepType = step_type !== undefined ? step_type : existing.step_type;
    const projectStatusChanged = project_statuses !== undefined && !sameStatuses(project_statuses, existing.project_statuses);
    // ผู้ใช้เลือก "สถานะปัจจุบันของโครงการ" เป็น step นี้ในหน้าแก้ไขโครงการ → นับเป็นการตั้งสถานะ ณ ตอนนี้
    const markCurrent = req.body.mark_current_status === true && Array.isArray(finalProjectStatuses) && finalProjectStatuses.length > 0;
    
    // บันทึก completed_by และ completed_at เมื่อเปลี่ยนเป็น completed
    const completed_by = (wasNotCompleted && finalStatus === 'completed') ? (req.user?.id || null) : existing.completed_by;
    const completed_at = (wasNotCompleted && finalStatus === 'completed') ? new Date() : existing.completed_at;
    
    const result = await pool.query(`
      UPDATE task_steps 
      SET step_name = $1, step_order = $2, start_date = $3, end_date = $4, 
          assigned_users = $5::jsonb, status = $6, description = $7, project_statuses = $8::jsonb, 
          completed_by = $9, completed_at = $10, updated_at = CURRENT_TIMESTAMP,
          late_reason = CASE WHEN $11::text IS NOT NULL THEN $11::text ELSE late_reason END,
          step_type = $13,
          project_status_updated_at = CASE WHEN $14::boolean THEN CURRENT_TIMESTAMP ELSE project_status_updated_at END,
          auto_completed = CASE WHEN $15::boolean THEN false ELSE auto_completed END
      WHERE id = $12
      RETURNING *
    `, [finalStepName, finalStepOrder, finalStartDate, finalEndDate, JSON.stringify(assigned_users || existing.assigned_users || []), finalStatus, finalDescription, JSON.stringify(finalProjectStatuses || []), completed_by, completed_at, late_reason || null, id, finalStepType, projectStatusChanged || markCurrent, wasNotCompleted || finalStatus !== 'completed']);
    
    let statusCascade = null;
    if (markCurrent) {
      statusCascade = await applyStatusSelection(result.rows[0], req.user?.id);
      // step ที่เลือกอาจถูกปิด/เปิดด้วย — ตอบค่าล่าสุดกลับไป
      const fresh = await pool.query('SELECT * FROM task_steps WHERE id = $1', [id]);
      if (fresh.rows[0]) Object.assign(result.rows[0], fresh.rows[0]);
    }

    await syncTaskCompletion(existing.task_id);

    // ถ้าเปลี่ยนเป็น completed ให้แจ้ง step ถัดไป
    if (wasNotCompleted && finalStatus === 'completed') {
      try {
        await notifyNextStep(existing.task_id, existing.step_order, existing.step_name, completed_at);
      } catch (error) {
        console.error('Error notifying next step:', error);
      }
    } 
    // แจ้งเฉพาะผู้รับผิดชอบใหม่ที่ถูกเพิ่ม
    else if (assigned_users && assigned_users.length > 0) {
      const oldUserIds = (existing.assigned_users || []).map(u => typeof u === 'object' ? u.id : u);
      const newUserIds = assigned_users.map(u => typeof u === 'object' ? u.id : u).filter(Boolean);
      const addedUserIds = newUserIds.filter(id => !oldUserIds.includes(id));
      if (addedUserIds.length > 0) {
        notifyNewAssignees(parseInt(id), existing.task_id, addedUserIds);
      }
    }
    
    // แจ้ง MS Teams พร้อม mark ว่าแก้ไขล่าสุด
    sendWorkflowSummaryToTeams(parseInt(id), 'update');
    
    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'task_steps',
      recordId: parseInt(id),
      recordName: step_name,
      newData: { step_name, status: finalStatus }
    });
    if (statusCascade) await auditStatusSelection(req, parseInt(id), finalStepName, statusCascade);
    
    // Return พร้อม completed_by_name และ completed_at
    const stepWithName = { 
      ...result.rows[0],
      completed_by_name: (wasNotCompleted && finalStatus === 'completed' && req.user) 
        ? `${req.user.firstname} ${req.user.lastname}` 
        : existing.completed_by_name || null,
      completed_at: (wasNotCompleted && finalStatus === 'completed') 
        ? completed_at 
        : existing.completed_at
    };
    if (statusCascade) {
      stepWithName.status_cascade = statusCascade;
      stepWithName.completed_at = result.rows[0].completed_at;
    }
    res.json(stepWithName);
  } catch (error) {
    console.error('Error updating task step:', error);
    res.status(500).json({ error: 'Failed to update task step' });
  }
});

// Delete step
router.delete('/:id', requirePermission(PERM_PROJECTS_DELETE), async (req, res) => {
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
