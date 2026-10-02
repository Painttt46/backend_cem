import pool from '../config/database.js';
import { removeUploadedFiles } from '../routes/files.js';

// ชื่อไฟล์ที่ระบบสร้างตอนอัปโหลด: "<timestamp>-<random>-<ชื่อเดิม>" (ดู routes/files.js)
const STORED_NAME_PATTERN = /^\d{10,}-\d+-.+/;

// record ทุกชนิดที่เก็บชื่อไฟล์จาก /api/files/upload ไว้ (jsonb array ของชื่อไฟล์)
// ถ้าเพิ่มตารางใหม่ที่แนบไฟล์ ต้องเพิ่มที่นี่ด้วย ไม่งั้นไฟล์ของตารางนั้นอาจถูกลบโดยผิดพลาด
const REFERENCE_QUERIES = [
  'SELECT 1 FROM daily_work_records WHERE files::jsonb @> $1::jsonb LIMIT 1',
  'SELECT 1 FROM tasks WHERE files::jsonb @> $1::jsonb LIMIT 1',
  'SELECT 1 FROM leave_requests WHERE attachments::jsonb @> $1::jsonb LIMIT 1'
];

async function isReferenced(name) {
  const param = JSON.stringify([name]);
  for (const sql of REFERENCE_QUERIES) {
    const result = await pool.query(sql, [param]);
    if (result.rows.length > 0) return true;
  }
  return false;
}

// ลบไฟล์แนบออกจากดิสก์ "เฉพาะไฟล์ที่ไม่มี record ใดอ้างถึงแล้ว" — เรียกหลังลบ record เจ้าของไฟล์แล้วเท่านั้น
//
// ทำไมต้องตรวจทุกตาราง ไม่ใช่เชื่อรายชื่อใน record ที่เพิ่งลบ:
// - ลงงานช่วงหลายวัน = อัปโหลดครั้งเดียวแต่แนบชื่อไฟล์เดียวกันให้ทุกวัน ลบวันเดียวแล้วลบไฟล์ทันทีวันอื่นจะเสียไฟล์
// - ชื่อไฟล์ใน record มาจาก client ผู้ใช้อาจใส่ชื่อไฟล์ของคนอื่นลงใน record ตัวเอง แล้วลบ record เพื่อให้ระบบลบไฟล์นั้น
//   การตรวจว่ายังมี record อื่นอ้างถึงอยู่ ทำให้ไฟล์ของคนอื่นไม่ถูกลบ
// ตรวจไม่ได้ (query ล้มเหลว) = ไม่ลบ
export async function removeFilesIfUnreferenced(files) {
  let list = files;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { return 0; }
  }
  if (!Array.isArray(list)) return 0;

  const unreferenced = [];
  for (const name of new Set(list)) {
    if (typeof name !== 'string' || !STORED_NAME_PATTERN.test(name)) continue;
    try {
      if (!(await isReferenced(name))) unreferenced.push(name);
    } catch (error) {
      console.error('Failed to check file references (file kept):', name, error.message);
    }
  }
  return removeUploadedFiles(unreferenced);
}
