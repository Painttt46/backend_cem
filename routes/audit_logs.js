import express from 'express';
import pool from '../config/database.js';
export { logAudit } from '../utils/auditHelper.js';

const router = express.Router();

// GET: ดึงประวัติทั้งหมด
router.get('/', async (req, res) => {
  try {
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
    res.json({ data: [], total: 0 });
  }
});

// GET: สรุปสถิติ
router.get('/stats', async (req, res) => {
  try {
    const { days = 7 } = req.query;

    const actionStats = await pool.query(`
      SELECT action, COUNT(*) as count FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY action ORDER BY count DESC
    `);

    const tableStats = await pool.query(`
      SELECT table_name, COUNT(*) as count FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY table_name ORDER BY count DESC
    `);

    res.json({ byAction: actionStats.rows, byTable: tableStats.rows });
  } catch (error) {
    res.json({ byAction: [], byTable: [] });
  }
});

export default router;
