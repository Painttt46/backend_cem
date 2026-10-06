import pool from '../config/database.js';
import { runOnce } from './runOnce.js';
import { LEGACY_HR_PERMISSIONS } from '../config/permissionKeys.js';

// ===== ระบบสิทธิ์กลาง =====
// 1) admin / superadmin มีสิทธิ์ทุกอย่างเสมอ (ไม่ต้องมีแถวใน role_permissions)
// 2) role อื่นต้องมีแถวของคีย์นั้นที่ has_access = true — ตั้งค่าที่หน้าเว็บ "จัดการสิทธิ์" (/management/settings/role-permissions)
// 3) ไม่มีแถว = ไม่อนุญาต (default-deny) และถ้าตรวจสิทธิ์ไม่ได้ (DB ล้ม) ก็ไม่อนุญาต
const FULL_ACCESS_ROLES = ['admin', 'superadmin'];

export const isFullAccessRole = (role) => FULL_ACCESS_ROLES.includes(String(role ?? '').trim().toLowerCase());

// role hr เดิมถูกฮาร์ดโค้ดให้แก้/ลบข้อมูลของผู้อื่นได้ → seed สิทธิ์เป็นเปิดให้ครั้งแรก (เฉพาะถ้า role hr มีการตั้งค่าสิทธิ์ไว้แล้ว)
export const ensureLegacyPermissions = runOnce(async () => {
  for (const perm of LEGACY_HR_PERMISSIONS) {
    await pool.query(
      `INSERT INTO role_permissions (role, page_path, page_name, page_icon, has_access)
       SELECT DISTINCT role, $1, $2, $3, true FROM role_permissions
       WHERE LOWER(role) = 'hr'
       ON CONFLICT (role, page_path) DO NOTHING`,
      [perm.path, perm.name, perm.icon]
    );
  }
});

// เช็คสิทธิ์ของผู้ใช้ (req.user) กับคีย์ตั้งแต่ 1 ตัว (มีอย่างน้อย 1 ตัวที่ได้ = ผ่าน) — โยน error ถ้าอ่านฐานข้อมูลไม่ได้
export async function userHasPermission(user, keys) {
  if (!user) return false;
  if (isFullAccessRole(user.role)) return true;
  await ensureLegacyPermissions().catch(() => { /* seed ล้มไม่ควรบล็อกการตรวจ (ตารางอาจยังไม่พร้อม) */ });
  const list = Array.isArray(keys) ? keys : [keys];
  const result = await pool.query(
    `SELECT 1 FROM role_permissions
     WHERE LOWER(role) = LOWER($1) AND page_path = ANY($2::text[]) AND has_access = true
     LIMIT 1`,
    [String(user.role ?? ''), list]
  );
  return result.rows.length > 0;
}

// เหมือน userHasPermission แต่ถ้าอ่านฐานข้อมูลไม่ได้ให้ถือว่า "ไม่มีสิทธิ์" (fail-closed) — ใช้ในจุดที่เป็นแค่ตัวเลือกยกเว้นเจ้าของข้อมูล เช่น แก้/ลบของผู้อื่น
export async function hasPermissionSafe(user, keys) {
  try {
    return await userHasPermission(user, keys);
  } catch (error) {
    console.error('Permission check error:', error.message);
    return false;
  }
}

// Middleware: ต้องมีสิทธิ์คีย์ใดคีย์หนึ่งใน keys — options.ensure = ฟังก์ชัน async (เช่น seed แบบ runOnce) ที่เรียกก่อนเช็คทุกครั้ง
export const requirePermission = (keys, options = {}) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      if (!isFullAccessRole(req.user.role) && options.ensure) await options.ensure();
      if (await userHasPermission(req.user, keys)) {
        return next();
      }
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
};
