// คีย์สิทธิ์ที่เก็บในตาราง role_permissions (คอลัมน์ page_path) — ตั้งเปิด/ปิดต่อ role ได้ที่หน้าเว็บ "จัดการสิทธิ์"
// (ต้องตรงกับค่าใน frontend: src/views/management/RolePermissions.vue และหน้าที่ใช้เช็คสิทธิ์)
//
// หลักการ: admin / superadmin ผ่านทุกสิทธิ์เสมอ — role อื่นต้องมีแถวของคีย์นั้นที่ has_access = true (ไม่มีแถว = ไม่อนุญาต)
// มี 2 แบบ: คีย์ "หน้า" (path ของหน้า เช่น /management/users) และคีย์ "ความสามารถ" (path#ชื่อ เช่น /projects#delete)

// ---- คีย์หน้า (ตรงกับ route ฝั่งหน้าเว็บ) ----
export const PAGE_USERS = '/management/users';
export const PAGE_TASKS = '/management/tasks';
export const PAGE_LEAVE_MANAGEMENT = '/management/leave';
export const PAGE_LEAVE_APPROVAL_SETTINGS = '/management/settings/leave-approval';
export const PAGE_ROLE_WORK_HOURS = '/management/settings/role-work-hours';
export const PAGE_ROLE_PERMISSIONS = '/management/settings/role-permissions';
export const PERM_LEAVE_APPROVE = '/leave_work/approve';

// ---- คีย์ความสามารถ (ไม่ใช่หน้า) ----
export const PERM_LEAVE_HOLIDAYS = '/management/leave#holidays';     // เพิ่ม/ลบวันหยุดนักขัตฤกษ์
export const PERM_LEAVE_TYPES = '/management/leave#leave-types';     // เพิ่ม/แก้ไข/ลบประเภทการลา
export const PERM_PROJECTS_SYNC_ERP = '/projects#sync-erp';          // ซิงค์ข้อมูลโครงการจาก ERP
export const PERM_PROJECTS_DELETE = '/projects#delete';              // ลบโครงการ / ขั้นตอนงาน
export const PERM_PROCUREMENT_DELETE = '/procurement#delete';        // ลบรายการจัดซื้อ / ไฟล์ผู้ขาย
export const PERM_DAILY_MANAGE_ALL = '/daily_work#manage-all';       // แก้ไข/ลบงานรายวันของผู้อื่น
export const PERM_CAR_MANAGE = '/car_booking#manage';                // จัดการการจองรถของผู้อื่น
export const PERM_SALES_MANAGE_ALL = '/sales-activity#manage-all';   // ดู/จัดการกิจกรรมเข้าพบลูกค้าของทุกคน

export const LEAVE_MANAGE_PERMISSIONS = [
  { path: PERM_LEAVE_HOLIDAYS, name: 'จัดการวันหยุดนักขัตฤกษ์ (ในหน้าจัดการการลา)', icon: 'pi pi-calendar-plus' },
  { path: PERM_LEAVE_TYPES, name: 'จัดการประเภทการลา (ในหน้าจัดการการลา)', icon: 'pi pi-tags' }
];

// ความสามารถที่เดิมผูกกับ role "hr" ตายตัวในโค้ด (แก้ไข/ลบข้อมูลของผู้อื่น) — seed ให้ role hr ครั้งแรกเพื่อไม่ให้ใช้งานเดิมหาย
// หลังจากนั้นผู้ดูแลปรับได้อิสระที่หน้า "จัดการสิทธิ์" (ON CONFLICT DO NOTHING → ไม่เขียนทับค่าที่ตั้งเอง)
export const LEGACY_HR_PERMISSIONS = [
  { path: PERM_DAILY_MANAGE_ALL, name: 'แก้ไข/ลบงานรายวันของผู้อื่น', icon: 'pi pi-calendar' },
  { path: PERM_CAR_MANAGE, name: 'จัดการการจองรถของผู้อื่น', icon: 'pi pi-car' },
  { path: PERM_SALES_MANAGE_ALL, name: 'ดู/จัดการกิจกรรมเข้าพบลูกค้าของทุกคน', icon: 'pi pi-briefcase' }
];
