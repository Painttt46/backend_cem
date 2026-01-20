import pool from '../config/database.js';

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
}

// Helper: บันทึก audit log
export async function logAudit(req, { action, tableName, recordId, recordName, oldData, newData, userName: customUserName }) {
  try {
    await ensureTable();
    const userId = req.user?.id || recordId || null;
    
    // ใช้ชื่อที่ส่งมา หรือดึงจาก database
    let userName = customUserName || null;
    if (!userName && userId) {
      const userResult = await pool.query('SELECT firstname, lastname FROM users WHERE id = $1', [userId]);
      if (userResult.rows.length > 0) {
        userName = `${userResult.rows[0].firstname} ${userResult.rows[0].lastname}`;
      }
    }
    if (!userName) userName = 'system';
    
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
    // แปลง IPv6-mapped IPv4 เป็น IPv4 ปกติ
    const cleanIp = ip.replace(/^::ffff:/, '');
    const userAgent = req.headers['user-agent'] || '';

    await pool.query(`
      INSERT INTO audit_logs (user_id, user_name, action, table_name, record_id, record_name, old_data, new_data, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [userId, userName, action, tableName, recordId || null, recordName || null, 
        oldData ? JSON.stringify(oldData) : null, 
        newData ? JSON.stringify(newData) : null, 
        cleanIp, userAgent]);
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
}
