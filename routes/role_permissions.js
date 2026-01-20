import express from 'express';
import pool from '../config/database.js';
import { logAudit } from '../utils/auditHelper.js';

const router = express.Router();

// Get permissions for a specific role
router.get('/:role', async (req, res) => {
  try {
    const { role } = req.params;
    
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
router.post('/', async (req, res) => {
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
