// โควตาลาตั้งต้นของพนักงาน (วัน/ปี) — ใช้ตอนสร้างผู้ใช้ใหม่, ตอนตั้งค่าเริ่มต้น และตอนรีเซ็ตโควตาต้นปี
// เดิมเขียนซ้ำ 3 ที่ (users.js, leave.js x2)
export const DEFAULT_LEAVE_QUOTAS = [
  { leave_type: 'sick', annual_quota: 30 },
  { leave_type: 'personal', annual_quota: 3 },
  { leave_type: 'vacation', annual_quota: 0 }
];
