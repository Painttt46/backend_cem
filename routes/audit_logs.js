import express from 'express';
import pool from '../config/database.js';

const router = express.Router();

// สร้างตาราง audit_logs ถ้ายังไม่มี
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      user_name VARCHAR(100),
      action VARCHAR(50) NOT NULL,
      table_name VARCHAR(50) NOT NULL,
      record_id INTEGER,
      record_name VARCHAR(255),
      old_data JSONB,
      new_data JSONB,
      ip_address VARCHAR(45),
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs(table_name)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id)`);
}

// Helper: บันทึก audit log
export async function logAudit(req, { action, tableName, recordId, recordName, oldData, newData }) {
  try {
    await ensureTable();
    const userId = req.user?.id || null;
    const userName = req.user ? `${req.user.username}` : 'System';
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const userAgent = req.headers['user-agent'] || '';

    await pool.query(`
      INSERT INTO audit_logs (user_id, user_name, action, table_name, record_id, record_name, old_data, new_data, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [userId, userName, action, tableName, recordId, recordName, 
        oldData ? JSON.stringify(oldData) : null, 
        newData ? JSON.stringify(newData) : null, 
        ip, userAgent]);
  } catch (error) {
    console.error('Audit log error:', error);
  }
}

// GET: ดึงประวัติทั้งหมด
router.get('/', async (req, res) => {
  try {
    await ensureTable();
    const { table_name, user_id, action, start_date, end_date, limit = 100, offset = 0 } = req.query;

    let query = `SELECT * FROM audit_logs WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (table_name) {
      query += ` AND table_name = $${paramIndex++}`;
      params.push(table_name);
    }
    if (user_id) {
      query += ` AND user_id = $${paramIndex++}`;
      params.push(user_id);
    }
    if (action) {
      query += ` AND action = $${paramIndex++}`;
      params.push(action);
    }
    if (start_date) {
      query += ` AND created_at >= $${paramIndex++}`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND created_at <= $${paramIndex++}`;
      params.push(end_date + ' 23:59:59');
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // นับจำนวนทั้งหมด
    let countQuery = `SELECT COUNT(*) FROM audit_logs WHERE 1=1`;
    const countParams = params.slice(0, -2);
    let countParamIndex = 1;
    if (table_name) countQuery += ` AND table_name = $${countParamIndex++}`;
    if (user_id) countQuery += ` AND user_id = $${countParamIndex++}`;
    if (action) countQuery += ` AND action = $${countParamIndex++}`;
    if (start_date) countQuery += ` AND created_at >= $${countParamIndex++}`;
    if (end_date) countQuery += ` AND created_at <= $${countParamIndex}`;

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      data: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET: สรุปสถิติ
router.get('/stats', async (req, res) => {
  try {
    await ensureTable();
    const { days = 7 } = req.query;

    // สรุปตาม action
    const actionStats = await pool.query(`
      SELECT action, COUNT(*) as count
      FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY action
      ORDER BY count DESC
    `);

    // สรุปตาม table
    const tableStats = await pool.query(`
      SELECT table_name, COUNT(*) as count
      FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY table_name
      ORDER BY count DESC
    `);

    // สรุปตาม user
    const userStats = await pool.query(`
      SELECT user_name, COUNT(*) as count
      FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY user_name
      ORDER BY count DESC
      LIMIT 10
    `);

    // สรุปรายวัน
    const dailyStats = await pool.query(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    res.json({
      byAction: actionStats.rows,
      byTable: tableStats.rows,
      byUser: userStats.rows,
      byDay: dailyStats.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: ดึง tables ที่มี log
router.get('/tables', async (req, res) => {
  try {
    await ensureTable();
    const result = await pool.query(`
      SELECT DISTINCT table_name FROM audit_logs ORDER BY table_name
    `);
    res.json(result.rows.map(r => r.table_name));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
