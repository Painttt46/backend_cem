-- ตรวจย้อนหลังใบลา/โควตาของพนักงานที่ HR แจ้งว่าไม่ตรงกับเอกสาร (อ่านอย่างเดียว ไม่แก้ข้อมูล)
-- วิธีใช้ (บน server production):
--   psql : docker exec -i postgres-cem psql -U postgres -d SOCC < scripts/leave_trace_prod.sql
--   pgAdmin : วางทีละบล็อก (1–5) แล้วกด F5 — pgAdmin แสดงผลเฉพาะคำสั่งสุดท้ายที่รัน
-- แก้รายชื่อได้ที่ VALUES ในแต่ละบล็อก (ค้นจากชื่อต้น ตรงตัวหรือขึ้นต้นด้วยคำนี้)

-- 1) พนักงานที่ค้น — ต้องเจอครบ 6 คน (ถ้าแถวไหน id ว่าง = ชื่อไม่ตรงกับในระบบ)
WITH names(n) AS (VALUES ('หทัยชนก'), ('ณัฐธิดา'), ('จันทร์ทิรา'), ('เมืองเอก'), ('สุดารัตน์'), ('นันทนา'))
SELECT n AS ชื่อที่ค้น, u.id, u.firstname || ' ' || u.lastname AS ชื่อในระบบ, u.department, u.role, u.is_active
FROM names LEFT JOIN users u ON u.firstname = n OR u.firstname ILIKE n || '%'
ORDER BY n, u.id;

-- 2) ประวัติใบลาทุกใบจาก audit log (รวมใบที่ถูกลบไปแล้ว) เรียงตามเวลา
WITH names(n) AS (VALUES ('หทัยชนก'), ('ณัฐธิดา'), ('จันทร์ทิรา'), ('เมืองเอก'), ('สุดารัตน์'), ('นันทนา')),
p AS (SELECT DISTINCT u.id, u.firstname || ' ' || u.lastname AS full_name FROM users u JOIN names ON u.firstname = n OR u.firstname ILIKE n || '%'),
a AS (
  SELECT a.*, p.id AS uid, p.full_name
  FROM audit_logs a
  JOIN p ON a.table_name = 'leave_requests'
        AND (a.record_name LIKE p.full_name || ' - %' OR a.old_data->>'user_id' = p.id::text)
)
SELECT a.full_name AS พนักงาน, a.record_id AS ใบลา, to_char(a.created_at, 'YYYY-MM-DD HH24:MI') AS เวลา,
       a.action, a.user_name AS ผู้ทำรายการ,
       COALESCE(a.new_data->>'status', '') AS สถานะใหม่,
       COALESCE(a.new_data->>'leave_type', a.old_data->>'leave_type') AS ประเภท,
       COALESCE(a.new_data->>'start_datetime', a.old_data->>'start_datetime') AS เริ่ม,
       COALESCE(a.new_data->>'end_datetime', a.old_data->>'end_datetime') AS สิ้นสุด,
       COALESCE(a.new_data->>'total_days', a.old_data->>'total_days') AS วัน,
       CASE WHEN l.id IS NULL THEN '*** ถูกลบแล้ว ***' ELSE l.status END AS สถานะตอนนี้
FROM a LEFT JOIN leave_requests l ON l.id = a.record_id
ORDER BY a.full_name, a.record_id, a.created_at;

-- 3) ใบลาที่ "หายไป" (เคยถูกสร้าง แต่ไม่มีในตารางแล้ว) พร้อมสาเหตุที่น่าจะเป็น
WITH names(n) AS (VALUES ('หทัยชนก'), ('ณัฐธิดา'), ('จันทร์ทิรา'), ('เมืองเอก'), ('สุดารัตน์'), ('นันทนา')),
p AS (SELECT DISTINCT u.id, u.firstname || ' ' || u.lastname AS full_name FROM users u JOIN names ON u.firstname = n OR u.firstname ILIKE n || '%'),
a AS (
  SELECT a.*, p.full_name
  FROM audit_logs a
  JOIN p ON a.table_name = 'leave_requests'
        AND (a.record_name LIKE p.full_name || ' - %' OR a.old_data->>'user_id' = p.id::text)
),
gone AS (
  SELECT a.record_id, a.full_name,
         max(a.created_at) FILTER (WHERE a.action = 'CREATE') AS created_at,
         (array_agg(a.new_data ORDER BY a.created_at) FILTER (WHERE a.action = 'CREATE'))[1] AS created_data,
         (array_agg(a.new_data->>'status' ORDER BY a.created_at DESC) FILTER (WHERE a.action = 'UPDATE'))[1] AS last_status,
         (array_agg(a.user_name ORDER BY a.created_at DESC) FILTER (WHERE a.action = 'DELETE'))[1] AS deleted_by,
         (array_agg(a.new_data->>'quotaRefundedDays' ORDER BY a.created_at DESC) FILTER (WHERE a.action = 'DELETE'))[1] AS refunded
  FROM a
  WHERE NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.id = a.record_id)
  GROUP BY a.record_id, a.full_name
)
SELECT full_name AS พนักงาน, record_id AS ใบลา, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS ยื่นเมื่อ,
       created_data->>'leave_type' AS ประเภท, created_data->>'start_datetime' AS เริ่ม, created_data->>'end_datetime' AS สิ้นสุด,
       created_data->>'total_days' AS วัน, COALESCE(last_status, 'pending') AS สถานะล่าสุดที่มี_log,
       CASE
         WHEN deleted_by IS NOT NULL THEN 'HR ลบ (ลบ/คืนโควต้า) โดย ' || deleted_by || ' — คืนโควต้า ' || COALESCE(refunded, '0') || ' วัน'
         WHEN last_status = 'approved' THEN 'อนุมัติแล้ว → ขอยกเลิก → อนุมัติการยกเลิก (ระบบลบใบ + คืนโควต้า, ไม่มี log)'
         WHEN last_status = 'pending_level2' THEN 'อนุมัติขั้น 1 แล้ว → ขอยกเลิก → อนุมัติการยกเลิก (ระบบลบใบ, ยังไม่เคยตัดโควต้า, ไม่มี log)'
         WHEN last_status = 'rejected' THEN 'ถูกปฏิเสธแล้วถูกลบ (ไม่มี log)'
         ELSE 'พนักงานลบเองตอนรออนุมัติ (ไม่ตัดโควต้า, ไม่มี log)'
       END AS สาเหตุที่น่าจะเป็น
FROM gone
ORDER BY full_name, created_at;

-- 4) ใบลาที่มีอยู่ตอนนี้ + ใบที่ซ้อนช่วงเวลากัน (ตัดโควต้าซ้ำ)
WITH names(n) AS (VALUES ('หทัยชนก'), ('ณัฐธิดา'), ('จันทร์ทิรา'), ('เมืองเอก'), ('สุดารัตน์'), ('นันทนา')),
p AS (SELECT DISTINCT u.id, u.firstname || ' ' || u.lastname AS full_name FROM users u JOIN names ON u.firstname = n OR u.firstname ILIKE n || '%')
SELECT p.full_name AS พนักงาน, l.id AS ใบลา, l.leave_type AS ประเภท,
       to_char(l.start_datetime, 'YYYY-MM-DD HH24:MI') AS เริ่ม, to_char(l.end_datetime, 'YYYY-MM-DD HH24:MI') AS สิ้นสุด,
       l.total_days AS วัน, l.status AS สถานะ, to_char(l.created_at, 'YYYY-MM-DD') AS ยื่นเมื่อ,
       (SELECT string_agg('#' || o.id, ', ') FROM leave_requests o
         WHERE o.user_id = l.user_id AND o.id <> l.id
           AND o.status IN ('pending', 'pending_level2', 'approved', 'cancel')
           AND o.start_datetime < l.end_datetime AND l.start_datetime < o.end_datetime) AS ซ้อนกับใบ
FROM p JOIN leave_requests l ON l.user_id = p.id
ORDER BY p.full_name, l.start_datetime;

-- 5) โควต้าปีนี้: ใช้ไปตามระบบ (used_days) เทียบกับผลรวมใบที่อนุมัติจริง
--    ส่วนต่าง ≠ 0 = มีการแก้โควต้าด้วยมือ (ไม่มี log) / ใบที่ถูกตัดโควต้าแล้วถูกลบ / อนุมัติข้ามปี / ปัดทศนิยม
WITH names(n) AS (VALUES ('หทัยชนก'), ('ณัฐธิดา'), ('จันทร์ทิรา'), ('เมืองเอก'), ('สุดารัตน์'), ('นันทนา')),
p AS (SELECT DISTINCT u.id, u.firstname || ' ' || u.lastname AS full_name FROM users u JOIN names ON u.firstname = n OR u.firstname ILIKE n || '%')
SELECT p.full_name AS พนักงาน, q.leave_type AS ประเภท, q.year AS ปี, q.annual_quota AS โควต้า, q.used_days AS ใช้ไป_ในระบบ,
       s.approved_days AS ใช้ไป_ตามใบที่อนุมัติ, q.used_days - s.approved_days AS ส่วนต่าง,
       q.annual_quota - q.used_days AS คงเหลือ_ที่ระบบแสดง
FROM p
JOIN user_leave_quotas q ON q.user_id = p.id AND q.year = EXTRACT(YEAR FROM now())::int
CROSS JOIN LATERAL (
  SELECT COALESCE(sum(l.total_days), 0) AS approved_days
  FROM leave_requests l
  WHERE l.user_id = p.id AND l.leave_type = q.leave_type
    AND (l.status = 'approved' OR (l.status = 'cancel' AND l.approved_by_level2 IS NOT NULL))
    AND EXTRACT(YEAR FROM l.start_datetime) = q.year
) s
ORDER BY p.full_name, q.leave_type;
