import pool from '../config/database.js';
import { isFullAccessRole } from './permissions.js';

// ===== กติกาเวลาลงงาน (ลงงานรายวัน / กิจกรรม Sale แยกกัน) =====
// 1) ห้ามลงงานย้อนหลัง — วันที่ของรายการต้องเป็นวันนี้หรืออนาคต (เวลาไทย)
// 2) เฉพาะลงงานรายวัน: รายการแรกของวันต้องลงก่อน 10:00 น. — ถ้ามีรายการของวันนี้ที่สร้างก่อน 10:00 แล้ว (รวมที่ลงล่วงหน้าไว้) ลงต่อได้ทั้งวัน
// 3) ถ้าไม่มี: ลงงานของวันนี้ไม่ได้แล้ว แต่ลงล่วงหน้าวันถัดไปเป็นต้นไปได้ทันที (เดิมปิดหมดถึง 18:00)
//    ลงล่วงหน้าของพรุ่งนี้ไว้ = มีรายการของพรุ่งนี้ที่สร้างก่อน 10:00 → พรุ่งนี้ลงต่อได้ทั้งวันตามข้อ 2
//    กิจกรรม Sale ไม่มีข้อ 2–3 (ไปพบลูกค้าโดยไม่ได้นัดไว้ ลงทีหลังในวันเดียวกันได้) — ไม่มี firstEntrySql = ไม่มีกฎ 10:00
// 4) admin / superadmin ไม่ติดกฎนี้ (ไว้แก้ไขข้อมูล)
// 5) แก้ไขรายการเดิมโดยไม่เปลี่ยนวันที่ทำได้เสมอ (รวมรายการวันที่ผ่านมาแล้ว) — ถ้าเปลี่ยนวันที่ ใช้กติกาเดียวกับการลงใหม่
export const ENTRY_CUTOFF_HOUR = 10;

// created_at เป็น timestamp (ไม่มี timezone) ที่บันทึกตามเวลาไทย (timezone ของฐานข้อมูล = Asia/Bangkok)
const SOURCES = {
  daily_work: {
    label: 'ลงงาน',
    firstEntrySql: `SELECT 1 FROM daily_work_records
      WHERE user_id = $1 AND work_date = $2::date AND created_at < $2::date + make_interval(hours => $3) LIMIT 1`
  },
  sales_visit: {
    label: 'ลงกิจกรรมเข้าพบลูกค้า'
  }
};

// แยกไว้ให้ test กำหนดเวลาได้
export const clock = { now: () => new Date() };

const pad = (n) => String(n).padStart(2, '0');

// วันที่ (YYYY-MM-DD) และนาทีของวันตามเวลาไทย
export function bangkokNow(date = clock.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const thaiDate = (ymd) => {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${Number(y) + 543}`;
};

// วันที่ส่วนหน้าของค่าวันที่/วันเวลา ('2026-10-30', '2026-10-30 14:00:00', '2026-10-30T14:00') — ไม่ใช่รูปแบบนี้ = null
export const dateOnly = (v) => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? '').trim());
  return m ? m[1] : null;
};

// สถานะการลงงานตอนนี้ของผู้ใช้ — ใช้ทั้งตรวจฝั่ง backend และให้หน้าเว็บแสดง/จำกัดวันที่เลือกได้
// phase: open = ลงได้ (ตั้งแต่ minDate), future_only = ลงได้เฉพาะวันถัดไปเป็นต้นไป
export async function getEntryWindow(source, user, ownerId = user?.id) {
  const { date: today, minutes } = bangkokNow();
  const base = { today, cutoff: `${pad(ENTRY_CUTOFF_HOUR)}:00` };
  if (isFullAccessRole(user?.role)) return { ...base, exempt: true, phase: 'open', minDate: null, message: null };
  if (!SOURCES[source].firstEntrySql) return { today, cutoff: null, exempt: false, phase: 'open', minDate: today, message: null };

  if (minutes < ENTRY_CUTOFF_HOUR * 60) return { ...base, exempt: false, phase: 'open', minDate: today, message: null };

  const { rows } = await pool.query(SOURCES[source].firstEntrySql, [ownerId, today, ENTRY_CUTOFF_HOUR]);
  if (rows.length) return { ...base, exempt: false, phase: 'open', minDate: today, message: null };

  const label = SOURCES[source].label;
  const tomorrow = addDays(today, 1);
  return {
    ...base, exempt: false, phase: 'future_only', minDate: tomorrow,
    message: `วันนี้ไม่ได้${label}รายการแรกก่อน ${base.cutoff} น. จึง${label}ของวันนี้ไม่ได้แล้ว — ${label}ล่วงหน้าได้ตั้งแต่วันที่ ${thaiDate(tomorrow)} เป็นต้นไป`
  };
}

// ตรวจวันที่ของรายการที่จะสร้าง/แก้ไข — คืนข้อความ error ภาษาไทย หรือ null (ผ่าน)
// oldDate: วันที่เดิมของรายการ (ตอนแก้ไข) — ไม่เปลี่ยนวันที่ = ผ่านเสมอ
// ownerId: เจ้าของรายการ (ใช้ดูว่าลงรายการแรกของวันนี้ก่อน 10:00 แล้วหรือยัง)
export async function checkEntryDate(source, user, entryDate, { oldDate = null, ownerId = user?.id } = {}) {
  const day = dateOnly(entryDate);
  if (!day) return 'วันที่ไม่ถูกต้อง';
  if (isFullAccessRole(user?.role)) return null;
  if (oldDate && dateOnly(oldDate) === day) return null;

  const { date: today } = bangkokNow();
  const label = SOURCES[source].label;
  if (day < today) {
    return oldDate
      ? `ห้ามเปลี่ยนวันที่เป็นวันที่ผ่านมาแล้ว (${label}ได้ตั้งแต่วันนี้ ${thaiDate(today)} เป็นต้นไป)`
      : `ห้าม${label}ย้อนหลัง — ${label}ได้ตั้งแต่วันนี้ (${thaiDate(today)}) เป็นต้นไป`;
  }

  const win = await getEntryWindow(source, user, ownerId);
  if (win.phase === 'future_only' && day <= today) return win.message;
  return null;
}
