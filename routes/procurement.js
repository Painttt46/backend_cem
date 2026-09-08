import express from 'express';
import pool from '../config/database.js';
import { logAudit } from '../utils/auditHelper.js';

const router = express.Router();

// Ensure table exists
pool.query(`
  CREATE TABLE IF NOT EXISTS procurement_items (
    id SERIAL PRIMARY KEY,
    step_id INTEGER NOT NULL REFERENCES task_steps(id) ON DELETE CASCADE,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    vendor_name VARCHAR(255) NOT NULL,
    item_description TEXT,
    amount NUMERIC(12,2),
    po_number VARCHAR(100),
    order_date DATE,
    delivery_date DATE,
    status VARCHAR(50) DEFAULT 'pending',
    notes TEXT,
    assigned_user_id INTEGER REFERENCES users(id),
    assigned_user_name VARCHAR(255),
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_procurement_items_step_id ON procurement_items(step_id);
  CREATE INDEX IF NOT EXISTS idx_procurement_items_task_id ON procurement_items(task_id);
  CREATE INDEX IF NOT EXISTS idx_procurement_items_status ON procurement_items(status);

  -- หมายเหตุระดับ vendor (ใช้ร่วมทุกรายการของ vendor เดียวกันใน step)
  CREATE TABLE IF NOT EXISTS procurement_vendor_notes (
    id SERIAL PRIMARY KEY,
    step_id INTEGER NOT NULL REFERENCES task_steps(id) ON DELETE CASCADE,
    vendor_name VARCHAR(255) NOT NULL,
    comment TEXT,
    updated_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (step_id, vendor_name)
  );
`).catch(() => {});

// Get distinct vendor names for autocomplete
router.get('/vendors', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT vendor_name FROM procurement_items ORDER BY vendor_name
    `);
    res.json(result.rows.map(r => r.vendor_name));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch vendors' });
  }
});

// ===== Vendor-level notes (หมายเหตุระดับ vendor ต่อ step) =====

// Get all vendor notes
router.get('/vendor-notes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pvn.*, u.firstname || ' ' || u.lastname as updated_by_name
      FROM procurement_vendor_notes pvn
      LEFT JOIN users u ON pvn.updated_by = u.id
      ORDER BY pvn.updated_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vendor notes:', error);
    res.status(500).json({ error: 'Failed to fetch vendor notes' });
  }
});

// Upsert vendor note (บันทึก/แก้ไขหมายเหตุของ vendor ใน step)
router.put('/vendor-notes', async (req, res) => {
  try {
    const { step_id, vendor_name, comment } = req.body;
    if (!step_id || !vendor_name) {
      return res.status(400).json({ error: 'step_id and vendor_name are required' });
    }
    const result = await pool.query(`
      INSERT INTO procurement_vendor_notes (step_id, vendor_name, comment, updated_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (step_id, vendor_name)
      DO UPDATE SET comment = $3, updated_by = $4, updated_at = NOW()
      RETURNING *
    `, [step_id, String(vendor_name).trim(), comment || null, req.user?.id || null]);

    await logAudit(req, {
      action: 'UPDATE', tableName: 'procurement_vendor_notes',
      recordId: result.rows[0].id, recordName: `Vendor note: ${vendor_name}`,
      newData: { step_id, vendor_name, comment: comment || null }
    });

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error saving vendor note:', error);
    res.status(500).json({ error: 'Failed to save vendor note' });
  }
});

// Get all procurement items (grouped by step)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pi.*, 
        ts.step_name, ts.status as step_status, ts.start_date as step_start_date, ts.end_date as step_end_date,
        t.task_name, t.so_number, t.project_manager, t.sale_owner, t.category,
        uc.firstname || ' ' || uc.lastname as created_by_name
      FROM procurement_items pi
      JOIN task_steps ts ON pi.step_id = ts.id
      JOIN tasks t ON pi.task_id = t.id
      LEFT JOIN users uc ON pi.created_by = uc.id
      ORDER BY pi.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching procurement items:', error);
    res.status(500).json({ error: 'Failed to fetch procurement items' });
  }
});

// Get procurement items by step_id
router.get('/step/:stepId', async (req, res) => {
  try {
    const { stepId } = req.params;
    const result = await pool.query(`
      SELECT pi.*, 
        uc.firstname || ' ' || uc.lastname as created_by_name
      FROM procurement_items pi
      LEFT JOIN users uc ON pi.created_by = uc.id
      WHERE pi.step_id = $1
      ORDER BY pi.created_at ASC
    `, [stepId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching procurement items by step:', error);
    res.status(500).json({ error: 'Failed to fetch procurement items' });
  }
});

// Create procurement item
router.post('/', async (req, res) => {
  try {
    const { step_id, task_id, vendor_name, item_description, po_number, order_date, delivery_date, status, notes, assigned_user_id, assigned_user_name } = req.body;
    const created_by = req.user?.id || null;

    if (!step_id || !task_id || !vendor_name) {
      return res.status(400).json({ error: 'step_id, task_id, and vendor_name are required' });
    }

    const result = await pool.query(`
      INSERT INTO procurement_items (step_id, task_id, vendor_name, item_description, po_number, order_date, delivery_date, status, notes, assigned_user_id, assigned_user_name, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [step_id, task_id, vendor_name, item_description, po_number, order_date || null, delivery_date || null, status || 'pending', notes, assigned_user_id || null, assigned_user_name, created_by]);

    // Update step status to in_progress when first item is added
    await pool.query(`
      UPDATE task_steps SET status = 'in_progress', updated_at = NOW() 
      WHERE id = $1 AND (status IS NULL OR status = '' OR status = 'pending')
    `, [step_id]);

    await logAudit(req, {
      action: 'CREATE',
      tableName: 'procurement_items',
      recordId: result.rows[0].id,
      recordName: `${vendor_name} - ${item_description || ''}`,
      newData: { step_id, task_id, vendor_name, status: status || 'pending' }
    });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating procurement item:', error);
    res.status(500).json({ error: 'Failed to create procurement item' });
  }
});

// Update procurement item
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { vendor_name, item_description, po_number, order_date, delivery_date, status, notes, assigned_user_id, assigned_user_name, status_remark } = req.body;

    const oldResult = await pool.query('SELECT * FROM procurement_items WHERE id = $1', [id]);
    if (oldResult.rows.length === 0) {
      return res.status(404).json({ error: 'Procurement item not found' });
    }

    const old = oldResult.rows[0];

    // บันทึกประวัติการเปลี่ยนสถานะ
    let statusHistory = old.status_history || [];
    if (status && status !== old.status) {
      statusHistory.push({
        from: old.status,
        to: status,
        remark: status_remark || '',
        changed_by: req.user ? `${req.user.firstname} ${req.user.lastname}` : '',
        changed_at: new Date().toISOString()
      });
    }

    const result = await pool.query(`
      UPDATE procurement_items 
      SET vendor_name = COALESCE($1, vendor_name),
          item_description = COALESCE($2, item_description),
          po_number = COALESCE($3, po_number),
          order_date = $4,
          delivery_date = $5,
          status = COALESCE($6, status),
          notes = COALESCE($7, notes),
          assigned_user_id = $8,
          assigned_user_name = COALESCE($9, assigned_user_name),
          status_history = $10::jsonb,
          updated_at = NOW()
      WHERE id = $11
      RETURNING *
    `, [vendor_name, item_description, po_number, order_date !== undefined ? order_date : old.order_date, delivery_date !== undefined ? delivery_date : old.delivery_date, status, notes, assigned_user_id !== undefined ? assigned_user_id : old.assigned_user_id, assigned_user_name, JSON.stringify(statusHistory), id]);

    // Update parent step status based on items
    await updateStepStatus(old.step_id);

    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'procurement_items',
      recordId: parseInt(id),
      recordName: `${vendor_name || old.vendor_name}`,
      oldData: { status: old.status },
      newData: { status: status || old.status }
    });

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating procurement item:', error);
    res.status(500).json({ error: 'Failed to update procurement item' });
  }
});

// Delete procurement item
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const oldResult = await pool.query('SELECT * FROM procurement_items WHERE id = $1', [id]);
    if (oldResult.rows.length === 0) {
      return res.status(404).json({ error: 'Procurement item not found' });
    }

    const old = oldResult.rows[0];
    await pool.query('DELETE FROM procurement_items WHERE id = $1', [id]);

    // Update parent step status
    await updateStepStatus(old.step_id);

    await logAudit(req, {
      action: 'DELETE',
      tableName: 'procurement_items',
      recordId: parseInt(id),
      recordName: old.vendor_name
    });

    res.json({ message: 'Procurement item deleted successfully' });
  } catch (error) {
    console.error('Error deleting procurement item:', error);
    res.status(500).json({ error: 'Failed to delete procurement item' });
  }
});

// Helper: Update step status based on procurement items
async function updateStepStatus(stepId) {
  const itemsResult = await pool.query('SELECT status FROM procurement_items WHERE step_id = $1', [stepId]);
  const items = itemsResult.rows;

  if (items.length === 0) return;

  const allCompleted = items.every(i => i.status === 'completed');
  const hasInProgress = items.some(i => i.status !== 'pending' && i.status !== 'completed');
  const hasAnyStarted = items.some(i => i.status !== 'pending');

  let newStatus = null;
  if (allCompleted) {
    newStatus = 'completed';
  } else if (hasInProgress || hasAnyStarted) {
    newStatus = 'in_progress';
  }

  if (newStatus) {
    if (newStatus === 'completed') {
      await pool.query(`
        UPDATE task_steps SET status = $1, completed_at = NOW(), updated_at = NOW() WHERE id = $2
      `, [newStatus, stepId]);
    } else {
      await pool.query(`
        UPDATE task_steps SET status = $1, updated_at = NOW() WHERE id = $2
      `, [newStatus, stepId]);
    }
  }
}

export default router;
