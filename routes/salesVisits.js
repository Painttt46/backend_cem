import express from 'express';
import { hasPermissionSafe, requirePermission } from '../utils/permissions.js';
import { PERM_SALES_MANAGE_ALL, PAGE_SALES_ACTIVITY } from '../config/permissionKeys.js';
import pool from '../config/database.js';
import { logAudit } from '../utils/auditHelper.js';

const router = express.Router();

// Auto-migrate tables
pool.query(`
  CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    industry VARCHAR(100),
    address TEXT,
    phone VARCHAR(50),
    email VARCHAR(100),
    website VARCHAR(255),
    contact_name VARCHAR(100),
    contact_position VARCHAR(100),
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS sales_visits (
    id SERIAL PRIMARY KEY,
    visit_date TIMESTAMP NOT NULL,
    visit_end_date TIMESTAMP,
    customer_id INTEGER REFERENCES customers(id),
    task_id INTEGER REFERENCES tasks(id),
    visit_type VARCHAR(50) DEFAULT 'on_site',
    location TEXT,
    latitude DECIMAL(10,7),
    longitude DECIMAL(10,7),
    status VARCHAR(30) DEFAULT 'scheduled',
    agenda TEXT,
    summary TEXT,
    action_items JSONB DEFAULT '[]',
    next_visit_date DATE,
    internal_attendees JSONB DEFAULT '[]',
    customer_attendees JSONB DEFAULT '[]',
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_sales_visits_date ON sales_visits(visit_date);
  CREATE INDEX IF NOT EXISTS idx_sales_visits_customer ON sales_visits(customer_id);
  CREATE INDEX IF NOT EXISTS idx_sales_visits_created_by ON sales_visits(created_by);
  CREATE INDEX IF NOT EXISTS idx_sales_visits_status ON sales_visits(status);
  CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(company_name);
`).catch(() => {});

// ทุก endpoint ต้องมีสิทธิ์หน้า "เข้าพบลูกค้า" (/sales-activity) — เดิมไม่ตรวจเลย ใครที่ login ได้ก็เรียก API ได้
router.use(requirePermission(PAGE_SALES_ACTIVITY));

const VISIT_TYPES = ['on_site', 'online', 'phone', 'survey', 'demo'];
const VISIT_STATUSES = ['scheduled', 'done', 'cancelled', 'follow_up'];
const CUSTOMER_LIMITS = {
  company_name: 255, industry: 100, phone: 50, email: 100, website: 255, contact_name: 100, contact_position: 100
};

const isValidDateTime = (v) => !!v && !Number.isNaN(new Date(String(v).replace(' ', 'T')).getTime());

// ตรวจข้อมูล visit ที่ส่งมา — คืนข้อความ error ภาษาไทย หรือ null
function validateVisit(body) {
  const { visit_date, visit_end_date, visit_type, status, next_visit_date } = body;
  if (!visit_date) return 'กรุณาระบุวันเวลาเข้าพบ';
  if (!isValidDateTime(visit_date)) return 'วันเวลาเข้าพบไม่ถูกต้อง';
  if (visit_end_date) {
    if (!isValidDateTime(visit_end_date)) return 'วันเวลาสิ้นสุดไม่ถูกต้อง';
    if (new Date(String(visit_end_date).replace(' ', 'T')) < new Date(String(visit_date).replace(' ', 'T'))) {
      return 'เวลาสิ้นสุดต้องหลังจากเวลาเริ่มต้น';
    }
  }
  if (next_visit_date && !isValidDateTime(next_visit_date)) return 'วันนัดถัดไปไม่ถูกต้อง';
  if (visit_type && !VISIT_TYPES.includes(visit_type)) return 'ประเภทกิจกรรมไม่ถูกต้อง';
  if (status && !VISIT_STATUSES.includes(status)) return 'สถานะไม่ถูกต้อง';
  return null;
}

function validateCustomer(body) {
  const name = String(body.company_name || '').trim();
  if (!name) return 'กรุณาระบุชื่อบริษัท/ลูกค้า';
  for (const [field, max] of Object.entries(CUSTOMER_LIMITS)) {
    if (body[field] && String(body[field]).length > max) return `ข้อมูล ${field} ยาวเกิน ${max} ตัวอักษร`;
  }
  return null;
}

// ลูกค้าชื่อซ้ำ (ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย) — กันรายชื่อลูกค้าซ้ำกันจนเลือกผิดและสรุปยอดแยกกัน
async function findDuplicateCustomer(companyName, excludeId = null) {
  const result = await pool.query(`
    SELECT id, company_name FROM customers
    WHERE is_active = true AND lower(trim(company_name)) = lower(trim($1)) AND ($2::int IS NULL OR id <> $2::int)
    LIMIT 1
  `, [companyName, excludeId]);
  return result.rows[0] || null;
}

// error จาก FK (ลูกค้า/โครงการที่เลือกถูกลบไปแล้ว) → 400 ที่บอกเหตุผล แทน 500
function fkErrorResponse(res, e) {
  if (e.code === '23503') {
    const detail = String(e.detail || e.constraint || '');
    const what = detail.includes('customer') ? 'ลูกค้า' : detail.includes('task') ? 'โครงการ' : 'ข้อมูลที่อ้างถึง';
    res.status(400).json({ error: `ไม่พบ${what}ที่เลือก (อาจถูกลบไปแล้ว) กรุณารีเฟรชหน้าแล้วเลือกใหม่` });
    return true;
  }
  return false;
}

// ========== CUSTOMERS ==========

// GET all customers
router.get('/customers', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, u.firstname || ' ' || u.lastname as created_by_name
      FROM customers c
      LEFT JOIN users u ON c.created_by = u.id
      WHERE c.is_active = true
      ORDER BY c.company_name ASC
    `);
    res.json(result.rows);
  } catch (e) {
    console.error('Error fetching customers:', e);
    res.status(500).json({ error: 'ไม่สามารถโหลดรายชื่อลูกค้าได้' });
  }
});

// POST create customer
router.post('/customers', async (req, res) => {
  try {
    const { industry, address, phone, email, website, contact_name, contact_position, notes } = req.body;
    const invalid = validateCustomer(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    const company_name = String(req.body.company_name).trim();

    const dup = await findDuplicateCustomer(company_name);
    if (dup) {
      return res.status(409).json({ error: `มีลูกค้าชื่อ "${dup.company_name}" อยู่แล้ว`, existing: dup });
    }

    const result = await pool.query(`
      INSERT INTO customers (company_name, industry, address, phone, email, website, contact_name, contact_position, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
    `, [company_name, industry, address, phone, email, website, contact_name, contact_position, notes, req.user?.id]);

    await logAudit(req, {
      action: 'CREATE', tableName: 'customers',
      recordId: result.rows[0].id, recordName: company_name,
      newData: { company_name, industry, phone, email, contact_name }
    });

    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error('Error creating customer:', e);
    res.status(500).json({ error: 'ไม่สามารถสร้างลูกค้าได้' });
  }
});

// PUT update customer (ข้อมูลลูกค้าใช้ร่วมกันทั้งทีม — แก้ได้ทุกคนที่มีสิทธิ์หน้า แต่มี log ค่าเดิม/ใหม่)
router.put('/customers/:id', async (req, res) => {
  try {
    const { industry, address, phone, email, website, contact_name, contact_position, notes } = req.body;
    const invalid = validateCustomer(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    const company_name = String(req.body.company_name).trim();

    const before = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (!before.rows.length) return res.status(404).json({ error: 'ไม่พบลูกค้า' });

    const dup = await findDuplicateCustomer(company_name, Number(req.params.id));
    if (dup) {
      return res.status(409).json({ error: `มีลูกค้าชื่อ "${dup.company_name}" อยู่แล้ว`, existing: dup });
    }

    const result = await pool.query(`
      UPDATE customers SET company_name=$1, industry=$2, address=$3, phone=$4, email=$5, website=$6,
        contact_name=$7, contact_position=$8, notes=$9, updated_at=NOW()
      WHERE id=$10 RETURNING *
    `, [company_name, industry, address, phone, email, website, contact_name, contact_position, notes, req.params.id]);

    const old = before.rows[0];
    await logAudit(req, {
      action: 'UPDATE', tableName: 'customers',
      recordId: Number(req.params.id), recordName: company_name,
      oldData: { company_name: old.company_name, phone: old.phone, email: old.email, contact_name: old.contact_name, address: old.address },
      newData: { company_name, phone, email, contact_name, address }
    });

    res.json(result.rows[0]);
  } catch (e) {
    console.error('Error updating customer:', e);
    res.status(500).json({ error: 'ไม่สามารถแก้ไขข้อมูลลูกค้าได้' });
  }
});

// ========== SALES VISITS ==========

// เงื่อนไข "เห็นรายการนี้ได้": เจ้าของ หรือถูกใส่เป็นทีมที่ไปเข้าพบ (internal_attendees) — ส่วนสิทธิ์ดูของทุกคนเช็คแยก
const VISIBLE_TO_USER_SQL = (param) =>
  `(sv.created_by = ${param} OR sv.internal_attendees @> jsonb_build_array(jsonb_build_object('id', ${param}::int)))`;

// GET all visits (with filters)
router.get('/', async (req, res) => {
  try {
    const { status, customer_id, from_date, to_date, created_by } = req.query;
    const userId = req.user?.id;

    let where = [];
    let params = [];
    let pi = 1;

    // เห็นรายการของตัวเอง + รายการที่ตัวเองอยู่ในทีมที่ไปเข้าพบ ยกเว้น admin/superadmin หรือ role ที่ถูกกำหนดสิทธิ์ "ดู/จัดการกิจกรรมเข้าพบลูกค้าของทุกคน"
    if (!(await hasPermissionSafe(req.user, PERM_SALES_MANAGE_ALL))) {
      where.push(VISIBLE_TO_USER_SQL(`$${pi++}`));
      params.push(userId);
    } else if (created_by) {
      where.push(`sv.created_by = $${pi++}`);
      params.push(created_by);
    }

    if (status) { where.push(`sv.status = $${pi++}`); params.push(status); }
    if (customer_id) { where.push(`sv.customer_id = $${pi++}`); params.push(customer_id); }
    if (from_date) { where.push(`sv.visit_date >= $${pi++}`); params.push(from_date); }
    if (to_date) { where.push(`sv.visit_date <= $${pi++}`); params.push(to_date + ' 23:59:59'); }

    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const result = await pool.query(`
      SELECT sv.*,
        c.company_name, c.phone as customer_phone,
        t.task_name, t.so_number,
        u.firstname || ' ' || u.lastname as created_by_name,
        u.position as created_by_position
      FROM sales_visits sv
      LEFT JOIN customers c ON sv.customer_id = c.id
      LEFT JOIN tasks t ON sv.task_id = t.id
      LEFT JOIN users u ON sv.created_by = u.id
      ${whereStr}
      ORDER BY sv.visit_date DESC
    `, params);
    res.json(result.rows);
  } catch (e) {
    console.error('Error fetching sales visits:', e);
    res.status(500).json({ error: 'ไม่สามารถโหลดรายการเข้าพบลูกค้าได้' });
  }
});

// GET single visit — เดิมไม่ตรวจว่าเป็นของใคร (เปิดเลข id ของคนอื่นดูรายละเอียด/สรุปการประชุมได้)
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sv.*,
        c.company_name, c.industry, c.address as customer_address, c.phone as customer_phone, c.email as customer_email,
        t.task_name, t.so_number, t.project_manager,
        u.firstname || ' ' || u.lastname as created_by_name
      FROM sales_visits sv
      LEFT JOIN customers c ON sv.customer_id = c.id
      LEFT JOIN tasks t ON sv.task_id = t.id
      LEFT JOIN users u ON sv.created_by = u.id
      WHERE sv.id = $1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });

    const visit = result.rows[0];
    const isOwner = String(visit.created_by) === String(req.user?.id);
    const isAttendee = (visit.internal_attendees || []).some(a => a && String(a.id) === String(req.user?.id));
    if (!isOwner && !isAttendee && !(await hasPermissionSafe(req.user, PERM_SALES_MANAGE_ALL))) {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ดูรายการนี้' });
    }
    res.json(visit);
  } catch (e) {
    console.error('Error fetching sales visit:', e);
    res.status(500).json({ error: 'ไม่สามารถโหลดข้อมูลการเข้าพบลูกค้าได้' });
  }
});

// เช็คสิทธิ์แก้ไข/ลบ visit: เจ้าของ record หรือ role ที่มีสิทธิ์บริหารเท่านั้น (ทีมที่ร่วมไปดูได้อย่างเดียว)
async function canManageVisit(req, id) {
  const result = await pool.query('SELECT * FROM sales_visits WHERE id = $1', [id]);
  if (!result.rows.length) return { found: false, allowed: false };
  const isPrivileged = await hasPermissionSafe(req.user, PERM_SALES_MANAGE_ALL);
  const isOwner = String(result.rows[0].created_by) === String(req.user?.id);
  return { found: true, allowed: isPrivileged || isOwner, visit: result.rows[0] };
}

// POST create visit
router.post('/', async (req, res) => {
  try {
    const {
      visit_date, visit_end_date, customer_id, task_id, visit_type,
      location, latitude, longitude, status, agenda, summary,
      action_items, next_visit_date, internal_attendees, customer_attendees
    } = req.body;

    const invalid = validateVisit(req.body);
    if (invalid) return res.status(400).json({ error: invalid });

    const result = await pool.query(`
      INSERT INTO sales_visits (
        visit_date, visit_end_date, customer_id, task_id, visit_type,
        location, latitude, longitude, status, agenda, summary,
        action_items, next_visit_date, internal_attendees, customer_attendees, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb,$15::jsonb,$16)
      RETURNING *
    `, [
      visit_date, visit_end_date || null, customer_id || null, task_id || null,
      visit_type || 'on_site', location, latitude || null, longitude || null,
      status || 'scheduled', agenda, summary,
      JSON.stringify(action_items || []), next_visit_date || null,
      JSON.stringify(internal_attendees || []), JSON.stringify(customer_attendees || []),
      req.user?.id
    ]);

    await logAudit(req, {
      action: 'CREATE', tableName: 'sales_visits',
      recordId: result.rows[0].id,
      recordName: `Visit ${visit_date}`,
      newData: { visit_type, status, customer_id }
    });

    res.status(201).json(result.rows[0]);
  } catch (e) {
    if (fkErrorResponse(res, e)) return;
    console.error('Error creating sales visit:', e);
    res.status(500).json({ error: 'ไม่สามารถบันทึกการเข้าพบลูกค้าได้' });
  }
});

// PUT update visit
router.put('/:id', async (req, res) => {
  try {
    const {
      visit_date, visit_end_date, customer_id, task_id, visit_type,
      location, latitude, longitude, status, agenda, summary,
      action_items, next_visit_date, internal_attendees, customer_attendees
    } = req.body;

    const invalid = validateVisit(req.body);
    if (invalid) return res.status(400).json({ error: invalid });

    const { found, allowed, visit: before } = await canManageVisit(req, req.params.id);
    if (!found) return res.status(404).json({ error: 'Not found' });
    if (!allowed) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์แก้ไขรายการนี้' });

    const result = await pool.query(`
      UPDATE sales_visits SET
        visit_date=$1, visit_end_date=$2, customer_id=$3, task_id=$4, visit_type=$5,
        location=$6, latitude=$7, longitude=$8, status=$9, agenda=$10, summary=$11,
        action_items=$12::jsonb, next_visit_date=$13,
        internal_attendees=$14::jsonb, customer_attendees=$15::jsonb,
        updated_at=NOW()
      WHERE id=$16 RETURNING *
    `, [
      visit_date, visit_end_date || null, customer_id || null, task_id || null,
      visit_type || before.visit_type || 'on_site', location, latitude || null, longitude || null,
      status || before.status || 'scheduled', agenda, summary,
      JSON.stringify(action_items || []), next_visit_date || null,
      JSON.stringify(internal_attendees || []), JSON.stringify(customer_attendees || []),
      req.params.id
    ]);

    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });

    await logAudit(req, {
      action: 'UPDATE', tableName: 'sales_visits',
      recordId: parseInt(req.params.id), recordName: `Visit ${visit_date}`,
      oldData: { status: before.status, visit_date: before.visit_date, customer_id: before.customer_id },
      newData: { status: result.rows[0].status, visit_date, customer_id }
    });

    res.json(result.rows[0]);
  } catch (e) {
    if (fkErrorResponse(res, e)) return;
    console.error('Error updating sales visit:', e);
    res.status(500).json({ error: 'ไม่สามารถแก้ไขข้อมูลการเข้าพบลูกค้าได้' });
  }
});

// DELETE visit
router.delete('/:id', async (req, res) => {
  try {
    const { found, allowed, visit } = await canManageVisit(req, req.params.id);
    if (!found) return res.status(404).json({ error: 'Not found' });
    if (!allowed) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ลบรายการนี้' });

    const result = await pool.query('DELETE FROM sales_visits WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });

    // เก็บข้อมูลเต็มไว้ใน log (เดิมลบโดยไม่มีร่องรอย)
    await logAudit(req, {
      action: 'DELETE', tableName: 'sales_visits',
      recordId: parseInt(req.params.id), recordName: `Visit ${visit.visit_date}`,
      oldData: visit
    });

    res.json({ message: 'Deleted successfully' });
  } catch (e) {
    console.error('Error deleting sales visit:', e);
    res.status(500).json({ error: 'ไม่สามารถลบข้อมูลการเข้าพบลูกค้าได้' });
  }
});

export default router;
