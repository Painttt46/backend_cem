import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pool from '../config/database.js';
import { logAudit } from '../utils/auditHelper.js';
import { sendMailWithFallback } from '../services/emailService.js';

const router = express.Router();

// Upload ไฟล์แนบระดับ vendor → uploads/procurement/
const vendorFileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'procurement');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    // ป้องกันชื่อไฟล์แปลก ๆ — เก็บชื่อจริงไว้ใน DB ส่วนบนดิสก์ใช้ชื่อ unique
    cb(null, unique + path.extname(file.originalname || '').slice(0, 20));
  }
});
const vendorFileUpload = multer({ storage: vendorFileStorage, limits: { fileSize: 20 * 1024 * 1024 } });

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

  -- star: mark รายการที่ต้องแจ้งเตือน PM ทางอีเมลเมื่อสถานะเปลี่ยน
  ALTER TABLE procurement_items ADD COLUMN IF NOT EXISTS notify_pm BOOLEAN DEFAULT false;

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

  -- ไฟล์แนบระดับ vendor (ใบเสนอราคา, PO, ใบส่งของ ฯลฯ)
  CREATE TABLE IF NOT EXISTS procurement_vendor_files (
    id SERIAL PRIMARY KEY,
    step_id INTEGER NOT NULL REFERENCES task_steps(id) ON DELETE CASCADE,
    vendor_name VARCHAR(255) NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(150),
    uploaded_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_procurement_vendor_files_step ON procurement_vendor_files(step_id);
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

// ===== Vendor files (ไฟล์แนบระดับ vendor ต่อ step) =====

// Get all vendor files
router.get('/vendor-files', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pvf.*, u.firstname || ' ' || u.lastname as uploaded_by_name
      FROM procurement_vendor_files pvf
      LEFT JOIN users u ON pvf.uploaded_by = u.id
      ORDER BY pvf.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vendor files:', error);
    res.status(500).json({ error: 'Failed to fetch vendor files' });
  }
});

// Upload vendor file
router.post('/vendor-files', vendorFileUpload.single('file'), async (req, res) => {
  try {
    const { step_id, vendor_name } = req.body;
    if (!step_id || !vendor_name || !req.file) {
      return res.status(400).json({ error: 'step_id, vendor_name and file are required' });
    }
    const result = await pool.query(`
      INSERT INTO procurement_vendor_files
        (step_id, vendor_name, file_name, file_path, file_size, mime_type, uploaded_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [step_id, String(vendor_name).trim(), req.file.originalname,
        '/uploads/procurement/' + req.file.filename,
        req.file.size || null, req.file.mimetype || null, req.user?.id || null]);

    await logAudit(req, {
      action: 'CREATE', tableName: 'procurement_vendor_files',
      recordId: result.rows[0].id, recordName: `Vendor file: ${req.file.originalname}`,
      newData: { step_id, vendor_name, file_name: req.file.originalname }
    });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    // ลบไฟล์ที่เพิ่ง upload ถ้าบันทึก DB ไม่สำเร็จ
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch { /* ignore */ } }
    console.error('Error uploading vendor file:', error);
    res.status(500).json({ error: 'Failed to upload vendor file' });
  }
});

// Delete vendor file
router.delete('/vendor-files/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM procurement_vendor_files WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    const row = result.rows[0];
    // ลบไฟล์ออกจากดิสก์ (path ที่เก็บเป็น URL → แปลงกลับเป็น path จริง)
    const diskPath = path.join(process.cwd(), 'uploads', 'procurement', path.basename(row.file_path));
    try { fs.unlinkSync(diskPath); } catch { /* ignore */ }
    await pool.query('DELETE FROM procurement_vendor_files WHERE id = $1', [req.params.id]);
    await logAudit(req, {
      action: 'DELETE', tableName: 'procurement_vendor_files',
      recordId: row.id, recordName: `Vendor file: ${row.file_name}`,
      oldData: { step_id: row.step_id, vendor_name: row.vendor_name, file_name: row.file_name }
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting vendor file:', error);
    res.status(500).json({ error: 'Failed to delete vendor file' });
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
    const { vendor_name, item_description, po_number, order_date, delivery_date, status, notes, assigned_user_id, assigned_user_name, status_remark, notify_pm } = req.body;

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
          notify_pm = COALESCE($11::boolean, notify_pm),
          updated_at = NOW()
      WHERE id = $12
      RETURNING *
    `, [vendor_name, item_description, po_number, order_date !== undefined ? order_date : old.order_date, delivery_date !== undefined ? delivery_date : old.delivery_date, status, notes, assigned_user_id !== undefined ? assigned_user_id : old.assigned_user_id, assigned_user_name, JSON.stringify(statusHistory), typeof notify_pm === 'boolean' ? notify_pm : null, id]);

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

    // แจ้งเตือน Project Manager ทางอีเมลเมื่อสถานะเปลี่ยน — เฉพาะรายการที่ถูก mark (star) ไว้
    if (status && status !== old.status && result.rows[0].notify_pm === true) {
      notifyProcurementStatusChange({
        item: result.rows[0],
        oldStatus: old.status,
        newStatus: status,
        changedBy: req.user ? `${req.user.firstname} ${req.user.lastname}` : '',
        remark: status_remark || ''
      }).catch(err => console.error('Procurement notify error:', err));
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating procurement item:', error);
    res.status(500).json({ error: 'Failed to update procurement item' });
  }
});

// Toggle star: เปิด/ปิดการแจ้งเตือน PM ของรายการ
router.put('/:id/notify', async (req, res) => {
  try {
    const oldResult = await pool.query('SELECT notify_pm FROM procurement_items WHERE id = $1', [req.params.id]);
    if (oldResult.rows.length === 0) {
      return res.status(404).json({ error: 'Procurement item not found' });
    }
    const newVal = !oldResult.rows[0].notify_pm;
    await pool.query('UPDATE procurement_items SET notify_pm = $1, updated_at = NOW() WHERE id = $2', [newVal, req.params.id]);
    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'procurement_items',
      recordId: parseInt(req.params.id),
      recordName: 'toggle notify_pm',
      newData: { notify_pm: newVal }
    });
    res.json({ notify_pm: newVal });
  } catch (error) {
    console.error('Error toggling notify flag:', error);
    res.status(500).json({ error: 'Failed to toggle notify flag' });
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

// ===== แจ้งเตือน Project Manager เมื่อสถานะสินค้าเปลี่ยน =====
const PROC_STATUS_LABELS = {
  pending: 'รอใบเสนอราคา',
  negotiating: 'ต่อรอง',
  approved: 'อนุมัติแล้ว',
  ordered: 'สั่งซื้อแล้ว',
  awaiting_payment: 'รอชำระเงิน',
  waiting: 'รอของ',
  ready_to_ship: 'ของพร้อมส่ง',
  received: 'ของมาแล้ว',
  completed: 'เสร็จสิ้น'
};

async function notifyProcurementStatusChange({ item, oldStatus, newStatus, changedBy, remark }) {
  try {
    // ดึงข้อมูลโครงการ (project_manager เป็นชื่อ "ชื่อ นามสกุล")
    const taskResult = await pool.query(
      'SELECT task_name, so_number, project_manager FROM tasks WHERE id = $1',
      [item.task_id]
    );
    const task = taskResult.rows[0];
    if (!task || !task.project_manager) return;

    // หา user ของ PM จากชื่อเต็ม (ต้องมี email)
    const pmResult = await pool.query(`
      SELECT id, firstname, lastname, email
      FROM users
      WHERE (firstname || ' ' || lastname) = $1 AND email IS NOT NULL
      LIMIT 1
    `, [task.project_manager]);
    const pm = pmResult.rows[0];
    if (!pm || !pm.email) return;

    const fmtDate = (d) => d ? new Date(d).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    const statusChip = (s) => {
      const colors = { pending: '#64748b|#f1f5f9', negotiating: '#a21caf|#fdf4ff', approved: '#b45309|#fef3c7', ordered: '#1d4ed8|#dbeafe', awaiting_payment: '#c2410c|#ffedd5', waiting: '#6d28d9|#ede9fe', ready_to_ship: '#0e7490|#cffafe', received: '#065f46|#d1fae5', completed: '#16a34a|#dcfce7' };
      const [c, bg] = (colors[s] || '#64748b|#f1f5f9').split('|');
      return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;color:${c};background:${bg};">${PROC_STATUS_LABELS[s] || s}</span>`;
    };

    const infoRow = (label, value) => value ? `
      <tr>
        <td style="padding:6px 14px;font-size:13px;color:#64748b;width:110px;white-space:nowrap;">${label}</td>
        <td style="padding:6px 14px;font-size:13px;color:#0f172a;font-weight:600;">${value}</td>
      </tr>` : '';

    const html = `
    <body style="margin:0;padding:0;background:#f1f5f9;">
    <center>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
        <tr><td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">
            <tr>
              <td style="background:linear-gradient(135deg,#4A90E2,#7c3aed);padding:20px 28px;">
                <div style="color:#ffffff;font-size:17px;font-weight:800;">🛒 แจ้งเตือน: สถานะรายการจัดซื้อเปลี่ยน</div>
                <div style="color:rgba(255,255,255,0.85);font-size:12px;margin-top:4px;">ระบบจัดซื้อ — Gent-CEM</div>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 28px;">
                <div style="font-size:14px;color:#334155;line-height:1.7;">
                  เรียน ${task.project_manager}<br/>
                  สถานะรายการจัดซื้อของโครงการที่ท่านดูแลได้รับการเปลี่ยนแปลง โปรดตรวจสอบ
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;margin:14px 0;border:1px solid #eef2f6;">
                  ${infoRow('Vendor', item.vendor_name)}
                  ${infoRow('รายละเอียด', item.item_description)}
                  ${infoRow('เลข PO', item.po_number)}
                  ${infoRow('ยอดเงิน', item.amount !== null && item.amount !== undefined ? '฿' + Number(item.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '')}
                  ${infoRow('สถานะเดิม', statusChip(oldStatus))}
                  <tr>
                    <td style="padding:6px 14px;font-size:13px;color:#64748b;white-space:nowrap;">สถานะใหม่</td>
                    <td style="padding:6px 14px;">${statusChip(newStatus)}</td>
                  </tr>
                  ${infoRow('แก้ไขโดย', changedBy)}
                  ${infoRow('เวลา', fmtDate(new Date()))}
                  ${remark ? `<tr><td colspan="2" style="padding:6px 14px;"><div style="font-size:12px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 12px;">💬 ${remark}</div></td></tr>` : ''}
                </table>
                <div style="font-size:11px;color:#94a3b8;">โครงการ: ${task.so_number ? '[' + task.so_number + '] ' : ''}${task.task_name || '-'}</div>
              </td>
            </tr>
            <tr>
              <td style="background:#f8fafc;padding:14px 28px;border-top:1px solid #f1f5f9;">
                <div style="font-size:11px;color:#94a3b8;">อีเมลนี้ถูกส่งโดยอัตโนมัติจากระบบจัดซื้อ Gent-CEM โปรดอย่าตอบกลับ</div>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </center>
    </body>`;

    await sendMailWithFallback({
      from: process.env.EMAIL_FROM,
      to: pm.email,
      subject: `[Gent-CEM] ${PROC_STATUS_LABELS[newStatus] || newStatus} — ${item.vendor_name}${item.po_number ? ' (' + item.po_number + ')' : ''}`,
      html
    });
    console.log(`Procurement status notification sent to PM (${pm.email}) for item #${item.id}`);
  } catch (error) {
    console.error('Error sending procurement status notification:', error);
  }
}

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
