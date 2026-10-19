-- แก้ข้อมูลการลาบน production หลังเหตุการณ์ 16 ต.ค. 2569 (รันใน pgAdmin ทีละขั้น — อ่านคำอธิบายก่อนรันแต่ละขั้น)
-- ขั้นที่ 0, 1, 3, 5 อ่านอย่างเดียว / ขั้นที่ 2, 4 แก้ข้อมูล (อยู่ใน BEGIN ... COMMIT และรันซ้ำได้โดยไม่เกิดผลซ้ำ)
-- แนะนำ backup ก่อน: docker exec postgres-cem pg_dump -U postgres -Fc SOCC > /root/backup_SOCC_$(date +%F_%H%M).dump

-- =====================================================================================
-- 0) สำรอง log การลบ 20 ใบไว้ในตารางแยก (audit log ถูกลบอัตโนมัติเมื่อเก่าเกินกำหนด) — ควรได้ 20 แถว
-- =====================================================================================
CREATE TABLE IF NOT EXISTS audit_logs_leave_deleted_20261016 AS
SELECT * FROM audit_logs
WHERE table_name = 'leave_requests' AND action = 'DELETE'
  AND created_at >= '2026-10-16 10:00' AND created_at < '2026-10-16 10:15';
SELECT count(*) AS backed_up FROM audit_logs_leave_deleted_20261016;

-- =====================================================================================
-- 1) ดูก่อน: ใบลาที่ถูกลบด้วยปุ่ม "ลบ/คืนโควต้า" และยังไม่มีในตาราง (ควรได้ 20 ใบ) — ให้ HR ยืนยันว่ากู้ทั้งหมด
-- =====================================================================================
SELECT d.record_id AS id,
       u.firstname || ' ' || u.lastname AS employee,
       d.old_data->>'leave_type' AS leave_type,
       to_char((d.old_data->>'start_datetime')::timestamptz AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') AS start_at,
       to_char((d.old_data->>'end_datetime')::timestamptz AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') AS end_at,
       d.old_data->>'total_days' AS days,
       d.old_data->>'status' AS status_before,
       d.new_data->>'quotaRefundedDays' AS refunded_days
FROM audit_logs_leave_deleted_20261016 d
LEFT JOIN users u ON u.id = (d.old_data->>'user_id')::int
WHERE NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.id = d.record_id)
ORDER BY employee, start_at;

-- =====================================================================================
-- 2) กู้ใบลากลับ (เลขใบเดิม สถานะเดิม) — ไม่แตะโควตา เพราะ HR ปรับวันคงเหลือด้วยมือไปแล้วบางคน (ดูขั้นที่ 3)
--    ข้อมูลที่กู้ไม่ได้: ผู้รับผิดชอบงานแทน (ไม่ได้อยู่ใน log), ไฟล์แนบของ #429 และ #433 ถูกลบจาก server แล้ว
-- =====================================================================================
BEGIN;
WITH restored AS (
  INSERT INTO leave_requests (
    id, user_id, leave_type, start_datetime, end_datetime, total_days, reason, attachments, status,
    approved_by, approved_by_level1, approved_by_level2, approval_level,
    cancellation_requested_at, cancel_reason, created_at, updated_at
  )
  SELECT d.record_id,
         (d.old_data->>'user_id')::int,
         d.old_data->>'leave_type',
         (d.old_data->>'start_datetime')::timestamptz AT TIME ZONE 'Asia/Bangkok',
         (d.old_data->>'end_datetime')::timestamptz AT TIME ZONE 'Asia/Bangkok',
         (d.old_data->>'total_days')::numeric,
         d.old_data->>'reason',
         COALESCE(d.old_data->'attachments', '[]'::jsonb),
         d.old_data->>'status',
         d.old_data->>'approved_by',
         d.old_data->>'approved_by_level1',
         d.old_data->>'approved_by_level2',
         CASE WHEN d.old_data->>'status' = 'approved' THEN 2
              WHEN d.old_data->>'status' = 'pending_level2' THEN 1 END,
         NULLIF(d.old_data->>'cancellation_requested_at', '')::timestamptz AT TIME ZONE 'Asia/Bangkok',
         d.old_data->>'cancel_reason',
         COALESCE((SELECT min(c.created_at) FROM audit_logs c
                   WHERE c.table_name = 'leave_requests' AND c.action = 'CREATE' AND c.record_id = d.record_id), d.created_at),
         now()
  FROM audit_logs_leave_deleted_20261016 d
  WHERE NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.id = d.record_id)
  ON CONFLICT (id) DO NOTHING
  RETURNING id, user_id, leave_type, total_days
)
INSERT INTO audit_logs (user_name, action, table_name, record_id, record_name, new_data)
SELECT 'ผู้ดูแลระบบ (กู้ข้อมูลผ่าน pgAdmin)', 'CREATE', 'leave_requests', r.id,
       'กู้ใบลาที่ถูกลบเมื่อ 16 ต.ค. 2569 (ปุ่มลบ/คืนโควต้า) — ไม่ปรับโควตา',
       jsonb_build_object('user_id', r.user_id, 'leave_type', r.leave_type, 'total_days', r.total_days)
FROM restored r
RETURNING record_id;
-- ควรได้ 20 แถว (เลขใบที่กู้) — ถ้าตรงตามที่ HR ยืนยันให้รัน COMMIT; ถ้าไม่ใช่ให้รัน ROLLBACK;
COMMIT;

-- =====================================================================================
-- 3) ตรวจโควตาหลังกู้: "ใช้ไปในระบบ" เทียบกับ "ผลรวมใบที่อนุมัติ" ของพนักงานที่ได้รับผลกระทบ
--    ส่วนต่าง < 0 = วันที่ใช้ไปในระบบน้อยกว่าใบลาที่อนุมัติ (ระบบคืนโควตาตอนลบแล้ว HR ยังไม่ได้ปรับกลับ)
--    ให้ HR ปรับในหน้าจัดการการลา (ตอนนี้ทุกการแก้มี log แล้ว)
-- =====================================================================================
SELECT u.firstname || ' ' || u.lastname AS employee, q.leave_type, q.year,
       q.annual_quota::float AS quota, q.used_days::float AS used_in_system,
       s.approved_days::float AS approved_leave_days,
       (q.used_days - s.approved_days)::float AS diff,
       (q.annual_quota - q.used_days)::float AS remaining_shown
FROM (SELECT DISTINCT (old_data->>'user_id')::int AS uid, old_data->>'leave_type' AS lt FROM audit_logs_leave_deleted_20261016) a
JOIN user_leave_quotas q ON q.user_id = a.uid AND q.leave_type = a.lt AND q.year = 2026
JOIN users u ON u.id = q.user_id
CROSS JOIN LATERAL (
  SELECT COALESCE(sum(l.total_days), 0) AS approved_days
  FROM leave_requests l
  WHERE l.user_id = q.user_id AND l.leave_type = q.leave_type
    AND (l.status = 'approved' OR (l.status = 'cancel' AND l.approved_by_level2 IS NOT NULL))
    AND EXTRACT(YEAR FROM l.created_at) = q.year
) s
ORDER BY employee, q.leave_type;

-- =====================================================================================
-- 4) แก้ใบ #434 (ธิดารัตน์ ลาพักร้อน 8–11 ธ.ค. 2569): 2.9 → 3 วัน — แก้เฉพาะเมื่อยังรออนุมัติและค่ายังเป็น 2.9
--    (ถ้าได้ 0 แถว = ใบถูกอนุมัติ/แก้ไปแล้ว ให้แจ้งผู้ดูแล เพราะต้องปรับโควตาเพิ่ม 0.1 วันด้วย)
-- =====================================================================================
BEGIN;
WITH u AS (
  UPDATE leave_requests
  SET total_days = 3, updated_at = now()
  WHERE id = 434 AND total_days = 2.9 AND status IN ('pending', 'pending_level2')
  RETURNING id, total_days
)
INSERT INTO audit_logs (user_name, action, table_name, record_id, record_name, old_data, new_data)
SELECT 'ผู้ดูแลระบบ (แก้ผ่าน pgAdmin)', 'UPDATE', 'leave_requests', u.id,
       'แก้จำนวนวันลา #434 2.9 เป็น 3 วัน (บั๊กตัดเวลาวันแรก/ปัดทศนิยม)',
       jsonb_build_object('total_days', 2.9), jsonb_build_object('total_days', u.total_days)
FROM u
RETURNING record_id, new_data::text;
COMMIT;

-- =====================================================================================
-- 5) ใบลาที่วันลาคนละปีกับวันที่ยื่น (น่าจะเลือกปีผิดเพราะปฏิทินเปิดที่ปีที่แล้ว — แก้ในโค้ดแล้ว)
--    ให้ HR ยืนยันวันที่ที่ถูกก่อน แล้วค่อยแก้ทีละใบ (ตัวอย่างคำสั่งด้านล่าง ปิดไว้ — ลบ -- ออกเมื่อยืนยันแล้ว)
-- =====================================================================================
SELECT l.id, u.firstname || ' ' || u.lastname AS employee, l.leave_type,
       to_char(l.start_datetime, 'YYYY-MM-DD HH24:MI') AS start_at, to_char(l.end_datetime, 'YYYY-MM-DD HH24:MI') AS end_at,
       l.total_days, l.status, to_char(l.created_at, 'YYYY-MM-DD') AS submitted
FROM leave_requests l JOIN users u ON u.id = l.user_id
WHERE EXTRACT(YEAR FROM l.start_datetime) < EXTRACT(YEAR FROM l.created_at)
ORDER BY l.id;
-- ตัวอย่าง: เลื่อนใบ #286 ไปปีถัดไป 1 ปี (ไม่ต้องแตะโควตา — ตอนอนุมัติระบบตัดโควตาของปีที่อนุมัติอยู่แล้ว)
-- UPDATE leave_requests SET start_datetime = start_datetime + interval '1 year', end_datetime = end_datetime + interval '1 year', updated_at = now()
-- WHERE id = 286 AND EXTRACT(YEAR FROM start_datetime) = 2025;
