import express from 'express';
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST create customer
router.post('/customers', async (req, res) => {
  try {
    const { company_name, industry, address, phone, email, website, contact_name, contact_position, notes } = req.body;
    if (!company_name) return res.status(400).json({ error: 'company_name is required' });
    const result = await pool.query(`
      INSERT INTO customers (company_name, industry, address, phone, email, website, contact_name, contact_position, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
    `, [company_name, industry, address, phone, email, website, contact_name, contact_position, notes, req.user?.id]);
    res.status(201).json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update customer
router.put('/customers/:id', async (req, res) => {
  try {
    const { company_name, industry, address, phone, email, website, contact_name, contact_position, notes } = req.body;
    const result = await pool.query(`
      UPDATE customers SET company_name=$1, industry=$2, address=$3, phone=$4, email=$5, website=$6,
        contact_name=$7, contact_position=$8, notes=$9, updated_at=NOW()
      WHERE id=$10 RETURNING *
    `, [company_name, industry, address, phone, email, website, contact_name, contact_position, notes, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== SALES VISITS ==========

// GET all visits (with filters)
router.get('/', async (req, res) => {
  try {
    const { status, customer_id, from_date, to_date, created_by } = req.query;
    const role = req.user?.role;
    const userId = req.user?.id;

    let where = [];
    let params = [];
    let pi = 1;

    // Non-admin sees only their own visits
    if (!['superadmin', 'admin', 'hr'].includes(role)) {
      where.push(`sv.created_by = $${pi++}`);
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET single visit
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
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST create visit
router.post('/', async (req, res) => {
  try {
    const {
      visit_date, visit_end_date, customer_id, task_id, visit_type,
      location, latitude, longitude, status, agenda, summary,
      action_items, next_visit_date, internal_attendees, customer_attendees
    } = req.body;

    if (!visit_date) return res.status(400).json({ error: 'visit_date is required' });

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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update visit
router.put('/:id', async (req, res) => {
  try {
    const {
      visit_date, visit_end_date, customer_id, task_id, visit_type,
      location, latitude, longitude, status, agenda, summary,
      action_items, next_visit_date, internal_attendees, customer_attendees
    } = req.body;

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
      visit_type, location, latitude || null, longitude || null,
      status, agenda, summary,
      JSON.stringify(action_items || []), next_visit_date || null,
      JSON.stringify(internal_attendees || []), JSON.stringify(customer_attendees || []),
      req.params.id
    ]);

    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });

    await logAudit(req, {
      action: 'UPDATE', tableName: 'sales_visits',
      recordId: parseInt(req.params.id), recordName: `Visit ${visit_date}`,
      newData: { status }
    });

    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE visit
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM sales_visits WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted successfully' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
