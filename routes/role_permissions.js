import express from 'express';
import pool from '../config/database.js';
import { logAudit } from '../utils/auditHelper.js';
import { requirePermission, userHasPermission } from '../middleware/auth.js';
import { PAGE_ROLE_PERMISSIONS } from '../config/permissionKeys.js';

const router = express.Router();

// สิทธิ์ของ "ผู้ใช้ที่ล็อกอินอยู่" — ใช้ role จากฐานข้อมูลผ่าน token เสมอ (ไม่ต้องเชื่อ role ที่ค้างอยู่ใน localStorage)
// ถ้าผู้ดูแลเปลี่ยน role ของผู้ใช้ระหว่างที่เปิดระบบค้างอยู่ หน้าเว็บจะได้สิทธิ์ของ role จริงและอัปเดต role ที่จำไว้ให้ตรงกัน
// (ต้องประกาศก่อน '/:role' ไม่งั้นคำว่า "me" จะถูกมองเป็นชื่อ role)
router.get('/me', async (req, res) => {
  try {
    const role = String(req.user?.role ?? '');
    const result = await pool.query(
      'SELECT * FROM role_permissions WHERE LOWER(role) = LOWER($1) ORDER BY page_name',
      [role]
    );
    res.json({ role, permissions: result.rows });
  } catch (error) {
    console.error('Error fetching own permissions:', error);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

// Get permissions for a specific role
router.get('/:role', async (req, res) => {
  try {
    const { role } = req.params;

    // อ่านได้เฉพาะสิทธิ์ของ role ตัวเอง หรือผู้ที่มีสิทธิ์จัดการสิทธิ์ (admin/superadmin หรือ role ที่ถูกกำหนดให้เข้าหน้า "จัดการสิทธิ์")
    const ownRole = String(req.user?.role ?? '').toLowerCase() === String(role).toLowerCase();
    if (!ownRole && !(await userHasPermission(req.user, PAGE_ROLE_PERMISSIONS))) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }

    const result = await pool.query(
      'SELECT * FROM role_permissions WHERE role = $1 ORDER BY page_name',
      [role]
    );
    
    res.json({ permissions: result.rows });
  } catch (error) {
    console.error('Error fetching role permissions:', error);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

// Save/Update permissions for a role
router.post('/', requirePermission(PAGE_ROLE_PERMISSIONS), async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { permissions } = req.body;
    
    await client.query('BEGIN');
    
    // Use UPSERT (INSERT ... ON CONFLICT) instead of DELETE + INSERT
    for (const perm of permissions) {
      await client.query(
        `INSERT INTO role_permissions (role, page_path, page_name, page_icon, has_access) 
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (role, page_path) 
         DO UPDATE SET page_name = $3, page_icon = $4, has_access = $5`,
        [perm.role, perm.page_path, perm.page_name, perm.page_icon || 'pi pi-circle', perm.has_access]
      );
    }
    
    await client.query('COMMIT');
    
    // Log audit
    const role = permissions[0]?.role;
    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'role_permissions',
      recordId: null,
      recordName: `สิทธิ์ Role: ${role}`,
      newData: { role, permissions_count: permissions.length }
    });
    
    res.json({ message: 'Permissions saved successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving role permissions:', error);
    res.status(500).json({ error: 'Failed to save permissions' });
  } finally {
    client.release();
  }
});

export default router;
