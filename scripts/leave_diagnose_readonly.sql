-- ตรวจข้อมูลการลาบน production — อ่านอย่างเดียวทั้งไฟล์ (ทุกส่วนอยู่ใน READ ONLY transaction และจบด้วย ROLLBACK)
-- วิธีรันทั้งไฟล์บน server แล้วเก็บผลเป็นไฟล์:
--   docker exec -i postgres-cem psql -U postgres -d SOCC -P pager=off < leave_diagnose_readonly.sql > leave_diagnose_result.txt 2>&1
-- หรือวางรันใน pgAdmin ทีละ SELECT ได้ (ไม่ต้องใช้บรรทัด BEGIN/ROLLBACK)

BEGIN TRANSACTION READ ONLY;

-- ===== A. ภาพรวม =====
SELECT 'A1 ภาพรวมฐานข้อมูล' AS section, now() AS db_now, current_setting('TimeZone') AS tz, pg_postmaster_start_time() AS pg_started,
       (SELECT count(*) FROM leave_requests) AS leaves,
       (SELECT max(id) FROM leave_requests) AS max_leave_id,
       (SELECT last_value FROM leave_requests_id_seq) AS leave_seq,
       (SELECT min(created_at) FROM audit_logs WHERE table_name = 'leave_requests') AS oldest_leave_audit,
       (SELECT min(created_at) FROM audit_logs WHERE table_name = 'user_leave_quotas') AS oldest_quota_audit,
       (SELECT numeric_scale FROM information_schema.columns WHERE table_name = 'leave_requests' AND column_name = 'total_days') AS total_days_scale,
       to_regclass('audit_logs_leave_deleted_20261016') IS NOT NULL AS oct16_backup_exists;

SELECT 'A2 ใบลาตามสถานะ ปีนี้' AS section, status, count(*) AS n, sum(total_days)::float AS days
FROM leave_requests WHERE EXTRACT(YEAR FROM start_datetime) = EXTRACT(YEAR FROM now())
GROUP BY status ORDER BY n DESC;

-- ===== B. วันลาเกิน/ขาด: วันที่ใช้ในโควตา เทียบกับผลรวมใบที่ถูกตัดจริง =====
-- diff > 0 = ระบบนับวันใช้เกินใบลาที่มี (คงเหลือน้อยกว่าจริง) / diff < 0 = นับขาด (คงเหลือมากกว่าจริง)
WITH y AS (SELECT EXTRACT(YEAR FROM now())::int AS yr),
deducted AS (
  SELECT l.user_id, l.leave_type,
         sum(l.total_days) FILTER (WHERE EXTRACT(YEAR FROM l.start_datetime) = y.yr) AS by_leave_year,
         sum(l.total_days) FILTER (WHERE EXTRACT(YEAR FROM l.created_at) = y.yr) AS by_filed_year,
         count(*) FILTER (WHERE EXTRACT(YEAR FROM l.start_datetime) = y.yr) AS n
  FROM leave_requests l, y
  WHERE l.status = 'approved' OR (l.status = 'cancel' AND l.approved_by_level2 IS NOT NULL)
  GROUP BY l.user_id, l.leave_type
),
r AS (
  SELECT u.id AS user_id, u.firstname || ' ' || u.lastname AS employee, u.is_active, q.leave_type,
         q.annual_quota::float AS quota, q.used_days::float AS used_in_system,
         COALESCE(d.by_leave_year, 0)::float AS approved_days, COALESCE(d.by_filed_year, 0)::float AS approved_days_filed_year,
         COALESCE(d.n, 0) AS n_leaves,
         round((q.used_days - COALESCE(d.by_leave_year, 0))::numeric, 4)::float AS diff,
         (q.annual_quota - q.used_days)::float AS remaining_in_system
  FROM user_leave_quotas q JOIN y ON q.year = y.yr
  JOIN users u ON u.id = q.user_id
  LEFT JOIN deducted d ON d.user_id = q.user_id AND d.leave_type = q.leave_type
)
SELECT 'B1 ผลรวมส่วนต่าง' AS section,
       count(*) AS quota_rows,
       count(*) FILTER (WHERE abs(diff) >= 0.001) AS mismatched_rows,
       count(DISTINCT user_id) FILTER (WHERE abs(diff) >= 0.001) AS mismatched_people,
       count(*) FILTER (WHERE diff >= 0.001) AS rows_over, COALESCE(sum(diff) FILTER (WHERE diff >= 0.001), 0)::float AS days_over,
       count(*) FILTER (WHERE diff <= -0.001) AS rows_under, COALESCE(sum(diff) FILTER (WHERE diff <= -0.001), 0)::float AS days_under,
       count(*) FILTER (WHERE remaining_in_system < 0) AS rows_negative_remaining
FROM r;

WITH y AS (SELECT EXTRACT(YEAR FROM now())::int AS yr),
deducted AS (
  SELECT l.user_id, l.leave_type,
         sum(l.total_days) FILTER (WHERE EXTRACT(YEAR FROM l.start_datetime) = y.yr) AS by_leave_year,
         sum(l.total_days) FILTER (WHERE EXTRACT(YEAR FROM l.created_at) = y.yr) AS by_filed_year,
         count(*) FILTER (WHERE EXTRACT(YEAR FROM l.start_datetime) = y.yr) AS n
  FROM leave_requests l, y
  WHERE l.status = 'approved' OR (l.status = 'cancel' AND l.approved_by_level2 IS NOT NULL)
  GROUP BY l.user_id, l.leave_type
)
SELECT 'B2 รายคน (เรียงส่วนต่างมากสุด)' AS section,
       u.firstname || ' ' || u.lastname AS employee, q.leave_type,
       q.annual_quota::float AS quota, q.used_days::float AS used_in_system,
       COALESCE(d.by_leave_year, 0)::float AS approved_days,
       round((q.used_days - COALESCE(d.by_leave_year, 0))::numeric, 4)::float AS diff,
       COALESCE(d.by_filed_year, 0)::float AS approved_filed_year,
       COALESCE(d.n, 0) AS n_leaves,
       (q.annual_quota - q.used_days)::float AS remaining_in_system,
       (SELECT count(*) FROM audit_logs a WHERE a.table_name = 'user_leave_quotas' AND a.record_id = q.user_id
          AND a.record_name LIKE '%' || q.leave_type || '%') AS quota_edits_logged,
       (SELECT to_char(max(a.created_at), 'YYYY-MM-DD HH24:MI') FROM audit_logs a WHERE a.table_name = 'user_leave_quotas' AND a.record_id = q.user_id
          AND a.record_name LIKE '%' || q.leave_type || '%') AS last_quota_edit
FROM user_leave_quotas q JOIN y ON q.year = y.yr
JOIN users u ON u.id = q.user_id
LEFT JOIN deducted d ON d.user_id = q.user_id AND d.leave_type = q.leave_type
WHERE abs(q.used_days - COALESCE(d.by_leave_year, 0)) >= 0.001
ORDER BY abs(q.used_days - COALESCE(d.by_leave_year, 0)) DESC, employee
LIMIT 200;

-- ===== C. ใบลาที่หายไป =====
SELECT 'C1 ใบที่ถูกลบเมื่อ 16 ต.ค. ตอนนี้กู้แล้วหรือยัง' AS section,
       count(*) AS deleted_logged,
       count(*) FILTER (WHERE l.id IS NOT NULL) AS back_in_table,
       count(*) FILTER (WHERE l.id IS NULL) AS still_missing
FROM audit_logs a LEFT JOIN leave_requests l ON l.id = a.record_id
WHERE a.table_name = 'leave_requests' AND a.action = 'DELETE'
  AND a.created_at >= '2026-10-16 10:00' AND a.created_at < '2026-10-16 10:15';

SELECT 'C2 การลบ/ยกเลิกใบลาทั้งหมดใน log แยกตามวันและคนกด' AS section,
       to_char(a.created_at, 'YYYY-MM-DD') AS day, a.user_name, a.ip_address,
       CASE WHEN a.action = 'DELETE' THEN 'ลบถาวร' ELSE 'ยกเลิก (ใบยังอยู่)' END AS kind,
       count(*) AS n,
       count(*) FILTER (WHERE l.id IS NULL) AS rows_missing_now,
       COALESCE(sum((a.new_data->>'quotaRefundedDays')::numeric), 0)::float AS refunded_days,
       string_agg('#' || a.record_id, ' ' ORDER BY a.record_id) AS leave_ids
FROM audit_logs a LEFT JOIN leave_requests l ON l.id = a.record_id
WHERE a.table_name = 'leave_requests' AND (a.action = 'DELETE' OR a.new_data->>'status' = 'cancelled')
GROUP BY 2, 3, 4, 5 ORDER BY 2 DESC, n DESC;

-- เลขใบลาที่ไม่มีในตาราง = เคยมีแล้วถูกลบ (เลขที่ไม่มี log = ถูกลบตอนที่ระบบยังไม่บันทึก หรือ log หมดอายุ)
WITH gaps AS (
  SELECT g AS id FROM generate_series(1, (SELECT max(id) FROM leave_requests)) g
  WHERE NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.id = g)
)
SELECT 'C3 เลขใบลาที่หายไปทั้งหมด' AS section, count(*) AS missing_ids,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM audit_logs a WHERE a.table_name = 'leave_requests' AND a.record_id = gaps.id)) AS with_log,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.table_name = 'leave_requests' AND a.record_id = gaps.id)) AS without_log,
       string_agg('#' || gaps.id, ' ' ORDER BY gaps.id DESC) FILTER (WHERE gaps.id > (SELECT max(id) - 150 FROM leave_requests)) AS recent_missing_ids
FROM gaps;

SELECT 'C4 ใบที่หายและมี log (ล่าสุดก่อน)' AS section, a.record_id AS leave_id,
       to_char(a.created_at, 'YYYY-MM-DD HH24:MI') AS at, a.action, a.user_name AS by_user, a.ip_address,
       left(a.record_name, 70) AS what,
       COALESCE(a.old_data->>'total_days', a.new_data->>'total_days') AS days,
       COALESCE(a.old_data->>'status', a.new_data->>'status') AS status_at_event
FROM audit_logs a
WHERE a.table_name = 'leave_requests' AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.id = a.record_id)
ORDER BY a.record_id DESC, a.created_at DESC LIMIT 150;

SELECT 'C5 คนที่ถูกลบบัญชี (ใบลาถูกลบตาม ON DELETE CASCADE)' AS section, to_char(a.created_at, 'YYYY-MM-DD HH24:MI') AS at, a.user_name AS by_user, a.record_id, a.record_name
FROM audit_logs a WHERE a.table_name = 'users' AND a.action = 'DELETE' ORDER BY a.created_at DESC LIMIT 30;

-- ===== D. กลไกที่ทำให้โควตาเพี้ยน =====
-- D1: ทุกคนในประเภทเดียวกันมีโควตาเท่ากันหมด/กระจุกที่ค่าสูงสุด = สัญญาณว่าถูกทับจากหน้า "แก้ไขประเภทการลา" (การแก้นี้ไม่มี log)
SELECT 'D1 การกระจายโควตาแต่ละประเภท' AS section, q.leave_type, max(q.display_name) AS display_name,
       count(*) AS people, count(DISTINCT q.annual_quota) AS distinct_quotas,
       min(q.annual_quota)::float AS min_quota, max(q.annual_quota)::float AS max_quota,
       (mode() WITHIN GROUP (ORDER BY q.annual_quota))::float AS common_quota,
       count(*) FILTER (WHERE q.annual_quota = (SELECT max(x.annual_quota) FROM user_leave_quotas x WHERE x.leave_type = q.leave_type AND x.year = q.year)) AS people_at_max,
       sum(q.used_days)::float AS total_used
FROM user_leave_quotas q WHERE q.year = EXTRACT(YEAR FROM now())::int
GROUP BY q.leave_type, q.year ORDER BY people DESC, q.leave_type;

SELECT 'D2 HR แก้โควตาด้วยมือ (ค่าเดิม→ใหม่)' AS section, to_char(a.created_at, 'YYYY-MM-DD HH24:MI') AS at, a.user_name AS by_user, a.ip_address,
       left(a.record_name, 80) AS what,
       (a.old_data->>'annual_quota')::float AS quota_before, (a.new_data->>'annual_quota')::float AS quota_after,
       (a.old_data->>'used_days')::float AS used_before, (a.new_data->>'used_days')::float AS used_after,
       round(((a.new_data->>'used_days')::numeric - (a.old_data->>'used_days')::numeric), 4)::float AS used_delta
FROM audit_logs a WHERE a.table_name = 'user_leave_quotas' AND a.record_id IS NOT NULL
ORDER BY a.created_at DESC LIMIT 200;

SELECT 'D3 คำสั่งระดับระบบกับโควตา/ประเภทการลา' AS section, to_char(a.created_at, 'YYYY-MM-DD HH24:MI') AS at, a.user_name AS by_user, a.ip_address, a.action, a.table_name,
       left(a.record_name, 70) AS what, a.old_data::text AS old_data, a.new_data::text AS new_data
FROM audit_logs a
WHERE (a.table_name = 'user_leave_quotas' AND a.record_id IS NULL)
   OR (a.table_name = 'settings' AND a.record_name LIKE 'ประเภทการลา%')
ORDER BY a.created_at DESC LIMIT 50;

-- D4: กด "ไม่อนุมัติ" ใบที่อนุมัติแล้ว: โควตาถูกคืนแต่สถานะยังอนุมัติ (ทำได้เฉพาะบัญชี admin/superadmin)
SELECT 'D4 reject ใบที่อนุมัติแล้ว' AS section, a.record_id AS leave_id, to_char(a.created_at, 'YYYY-MM-DD HH24:MI') AS at, a.user_name AS by_user,
       left(a.record_name, 60) AS what, l.status AS status_now, l.total_days::float AS days
FROM audit_logs a LEFT JOIN leave_requests l ON l.id = a.record_id
WHERE a.table_name = 'leave_requests' AND a.old_data->>'status' = 'approved' AND a.new_data->>'status' = 'rejected'
ORDER BY a.created_at DESC;

-- D5: คืนโควตาซ้ำกับใบเดียวกัน
SELECT 'D5 คืนโควตามากกว่า 1 ครั้งต่อใบ' AS section, a.record_id AS leave_id, count(*) AS refunds,
       sum((a.new_data->>'quotaRefundedDays')::numeric)::float AS refunded_days,
       to_char(min(a.created_at), 'YYYY-MM-DD HH24:MI:SS') AS first_at, to_char(max(a.created_at), 'YYYY-MM-DD HH24:MI:SS') AS last_at,
       string_agg(DISTINCT a.user_name, ', ') AS by_users
FROM audit_logs a
WHERE a.table_name = 'leave_requests' AND (a.new_data->>'quotaRefundedDays')::numeric > 0
GROUP BY a.record_id HAVING count(*) > 1 ORDER BY max(a.created_at) DESC;

-- D6: ใบลาที่ประเภทไม่ตรงแถวโควตา และแถวโควตาประเภทรหัสเก่า (ตัด/คืนคนละแถวกับที่ HR ดู)
SELECT 'D6 ใบลาประเภทที่ไม่มีแถวโควตาของเจ้าของใบในปีนี้' AS section, l.leave_type, l.status, count(*) AS n, sum(l.total_days)::float AS days, string_agg('#' || l.id, ' ' ORDER BY l.id DESC) AS ids
FROM leave_requests l
WHERE EXTRACT(YEAR FROM l.start_datetime) = EXTRACT(YEAR FROM now())
  AND NOT EXISTS (SELECT 1 FROM user_leave_quotas q WHERE q.user_id = l.user_id AND q.leave_type = l.leave_type AND q.year = EXTRACT(YEAR FROM now())::int)
GROUP BY 2, 3 ORDER BY n DESC;

SELECT 'D7 แถวโควตาประเภทรหัสเก่า' AS section, q.leave_type, q.year, count(*) AS people, sum(q.used_days)::float AS used, max(q.annual_quota)::float AS max_quota
FROM user_leave_quotas q WHERE q.leave_type IN ('sick', 'personal', 'vacation', 'maternity', 'other')
GROUP BY 2, 3 ORDER BY q.year DESC, q.leave_type;

-- ===== E. จำนวนวันในใบลาเองผิด: เทียบ total_days กับที่คำนวณใหม่จากเวลาทำงานและวันหยุดปัจจุบัน =====
WITH wh AS (
  SELECT u.id AS user_id,
         COALESCE(uw.start_time, rw.start_time, '09:00'::time) AS ws, COALESCE(uw.end_time, rw.end_time, '18:00'::time) AS we,
         COALESCE(uw.lunch_start, rw.lunch_start, '12:00'::time) AS ls, COALESCE(uw.lunch_end, rw.lunch_end, '13:00'::time) AS le
  FROM users u
  LEFT JOIN user_work_hours uw ON uw.user_id = u.id
  LEFT JOIN role_work_hours rw ON rw.role = u.role
),
per_day AS (
  SELECT l.id, d::date AS day,
         GREATEST(CASE WHEN d::date = l.start_datetime::date THEN l.start_datetime::time ELSE w.ws END, w.ws) AS s1,
         LEAST(CASE WHEN d::date = l.end_datetime::date THEN l.end_datetime::time ELSE w.we END, w.we) AS e1,
         w.ws, w.we, w.ls, w.le
  FROM leave_requests l JOIN wh w ON w.user_id = l.user_id
  CROSS JOIN LATERAL generate_series(l.start_datetime::date, l.end_datetime::date, interval '1 day') d
  WHERE EXTRACT(ISODOW FROM d) < 6 AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.holiday_date = d::date)
),
calc AS (
  SELECT id,
         sum(
           GREATEST(EXTRACT(EPOCH FROM (LEAST(e1, ls) - GREATEST(s1, ws))), 0)
         + GREATEST(EXTRACT(EPOCH FROM (LEAST(e1, we) - GREATEST(s1, le))), 0)
         ) / 60.0 AS minutes,
         max(EXTRACT(EPOCH FROM (ls - ws)) + EXTRACT(EPOCH FROM (we - le))) / 60.0 AS minutes_per_day
  FROM per_day GROUP BY id
),
r AS (
  SELECT l.id, u.firstname || ' ' || u.lastname AS employee, l.leave_type, l.status,
         to_char(l.start_datetime, 'YYYY-MM-DD HH24:MI') AS start_at, to_char(l.end_datetime, 'YYYY-MM-DD HH24:MI') AS end_at,
         to_char(l.created_at, 'YYYY-MM-DD') AS filed,
         l.total_days::float AS stored_days,
         round((COALESCE(c.minutes, 0) / NULLIF(c.minutes_per_day, 0))::numeric, 4)::float AS expected_days
  FROM leave_requests l JOIN users u ON u.id = l.user_id LEFT JOIN calc c ON c.id = l.id
  WHERE l.status IN ('approved', 'cancel', 'pending', 'pending_level2')
    AND EXTRACT(YEAR FROM l.start_datetime) >= EXTRACT(YEAR FROM now())::int - 1
)
SELECT 'E1 total_days ไม่ตรงกับที่คำนวณได้' AS section, r.*, round((stored_days - COALESCE(expected_days, 0))::numeric, 4)::float AS diff
FROM r WHERE abs(stored_days - COALESCE(expected_days, 0)) >= 0.01
ORDER BY abs(stored_days - COALESCE(expected_days, 0)) DESC, id DESC LIMIT 200;

-- สูตรคิดวันเปลี่ยนหลายครั้ง: ดูจำนวนใบที่ไม่ตรงแยกตามเดือนที่ยื่น (ถ้ากระจุกช่วงก่อน 16 ต.ค. = ใบเก่าที่คิดด้วยสูตรเดิม)
WITH wh AS (
  SELECT u.id AS user_id,
         COALESCE(uw.start_time, rw.start_time, '09:00'::time) AS ws, COALESCE(uw.end_time, rw.end_time, '18:00'::time) AS we,
         COALESCE(uw.lunch_start, rw.lunch_start, '12:00'::time) AS ls, COALESCE(uw.lunch_end, rw.lunch_end, '13:00'::time) AS le
  FROM users u
  LEFT JOIN user_work_hours uw ON uw.user_id = u.id
  LEFT JOIN role_work_hours rw ON rw.role = u.role
),
per_day AS (
  SELECT l.id,
         GREATEST(CASE WHEN d::date = l.start_datetime::date THEN l.start_datetime::time ELSE w.ws END, w.ws) AS s1,
         LEAST(CASE WHEN d::date = l.end_datetime::date THEN l.end_datetime::time ELSE w.we END, w.we) AS e1,
         w.ws, w.we, w.ls, w.le
  FROM leave_requests l JOIN wh w ON w.user_id = l.user_id
  CROSS JOIN LATERAL generate_series(l.start_datetime::date, l.end_datetime::date, interval '1 day') d
  WHERE EXTRACT(ISODOW FROM d) < 6 AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.holiday_date = d::date)
),
calc AS (
  SELECT id,
         sum(GREATEST(EXTRACT(EPOCH FROM (LEAST(e1, ls) - GREATEST(s1, ws))), 0) + GREATEST(EXTRACT(EPOCH FROM (LEAST(e1, we) - GREATEST(s1, le))), 0)) / 60.0 AS minutes,
         max(EXTRACT(EPOCH FROM (ls - ws)) + EXTRACT(EPOCH FROM (we - le))) / 60.0 AS minutes_per_day
  FROM per_day GROUP BY id
)
SELECT 'E1b ใบที่ไม่ตรงแยกตามเดือนที่ยื่น' AS section, to_char(l.created_at, 'YYYY-MM') AS filed_month, count(*) AS leaves,
       count(*) FILTER (WHERE abs(l.total_days - COALESCE(c.minutes / NULLIF(c.minutes_per_day, 0), 0)) >= 0.01) AS mismatched,
       round(COALESCE(sum(l.total_days - COALESCE(c.minutes / NULLIF(c.minutes_per_day, 0), 0)) FILTER (WHERE l.status = 'approved'), 0)::numeric, 4)::float AS approved_days_diff,
       count(*) FILTER (WHERE l.start_datetime::time < '06:00') AS start_before_6am
FROM leave_requests l LEFT JOIN calc c ON c.id = l.id
GROUP BY 2 ORDER BY 2 DESC;

SELECT 'E2 ใบอนุมัติที่ช่วงเวลาซ้อนกัน (ตัดโควตาซ้ำ)' AS section, a.id AS leave_a, b.id AS leave_b, u.firstname || ' ' || u.lastname AS employee,
       a.leave_type AS type_a, b.leave_type AS type_b, to_char(a.start_datetime, 'YYYY-MM-DD HH24:MI') AS a_start, to_char(b.start_datetime, 'YYYY-MM-DD HH24:MI') AS b_start,
       a.total_days::float AS a_days, b.total_days::float AS b_days
FROM leave_requests a JOIN leave_requests b ON a.user_id = b.user_id AND a.id < b.id
  AND a.start_datetime < b.end_datetime AND b.start_datetime < a.end_datetime
JOIN users u ON u.id = a.user_id
WHERE a.status = 'approved' AND b.status = 'approved' ORDER BY b.id DESC LIMIT 50;

SELECT 'E3 ใบลาที่วันลาคนละปีกับวันยื่น' AS section, l.id, u.firstname || ' ' || u.lastname AS employee, l.leave_type, l.status,
       to_char(l.start_datetime, 'YYYY-MM-DD') AS start_on, to_char(l.created_at, 'YYYY-MM-DD') AS filed_on, l.total_days::float AS days
FROM leave_requests l JOIN users u ON u.id = l.user_id
WHERE EXTRACT(YEAR FROM l.start_datetime) <> EXTRACT(YEAR FROM l.created_at) ORDER BY l.id DESC LIMIT 50;

-- ===== F. ใบลา/การกระทำมาจากไหน: แยกหน้าเว็บจริงออกจาก dev server บนเครื่องนักพัฒนา (vue.config.js ชี้ /api ไป production) =====
SELECT 'F1 การเขียนข้อมูลลาแยกตาม IP' AS section, a.ip_address, a.user_name, a.table_name, count(*) AS n,
       to_char(min(a.created_at), 'YYYY-MM-DD HH24:MI') AS first_at, to_char(max(a.created_at), 'YYYY-MM-DD HH24:MI') AS last_at,
       count(DISTINCT left(a.user_agent, 40)) AS user_agents
FROM audit_logs a WHERE a.table_name IN ('leave_requests', 'user_leave_quotas')
GROUP BY 2, 3, 4 ORDER BY max(a.created_at) DESC LIMIT 120;

SELECT 'F2 ใบลาที่ดูเหมือนใบทดสอบ' AS section, l.id, u.firstname || ' ' || u.lastname AS employee, l.leave_type, l.status,
       to_char(l.start_datetime, 'YYYY-MM-DD') AS start_on, to_char(l.created_at, 'YYYY-MM-DD HH24:MI') AS filed_at, l.total_days::float AS days, left(l.reason, 40) AS reason
FROM leave_requests l JOIN users u ON u.id = l.user_id
WHERE l.reason ~* '(test|ทดสอบ|ลองระบบ|asdf|qwer|^[a-z]{1,4}$|^[0-9]+$)' ORDER BY l.id DESC LIMIT 50;

-- ใบที่ยื่นช่วง 1–2 ต.ค. 2569 ที่ backend ใช้ id จาก token อย่างเดียว: ใบที่ HR ยื่นแทนถูกบันทึกเป็นของ HR เอง
SELECT 'F3 ใบของผู้อนุมัติชั้น 2 ที่ยื่นช่วง 1-2 ต.ค.' AS section, l.id, u.firstname || ' ' || u.lastname AS owner_in_system, l.leave_type, l.status,
       to_char(l.start_datetime, 'YYYY-MM-DD') AS start_on, to_char(l.created_at, 'YYYY-MM-DD HH24:MI') AS filed_at, l.total_days::float AS days
FROM leave_requests l JOIN users u ON u.id = l.user_id
WHERE l.created_at >= '2026-09-30' AND l.created_at < '2026-10-04'
  AND EXISTS (SELECT 1 FROM leave_approval_settings s WHERE s.user_id = l.user_id AND s.approval_level = 2 AND s.can_approve)
ORDER BY l.id;

SELECT 'F4 กิจกรรมระบบลารายวัน' AS section, to_char(a.created_at, 'YYYY-MM-DD') AS day,
       count(*) FILTER (WHERE a.table_name = 'leave_requests' AND a.action = 'CREATE') AS filed,
       count(*) FILTER (WHERE a.table_name = 'leave_requests' AND a.new_data->>'status' = 'approved') AS approved,
       count(*) FILTER (WHERE a.table_name = 'leave_requests' AND a.new_data->>'status' = 'cancelled') AS cancelled,
       count(*) FILTER (WHERE a.table_name = 'leave_requests' AND a.action = 'DELETE') AS deleted,
       count(*) FILTER (WHERE a.table_name = 'user_leave_quotas') AS quota_edits
FROM audit_logs a WHERE a.table_name IN ('leave_requests', 'user_leave_quotas') AND a.created_at > now() - interval '60 days'
GROUP BY 2 ORDER BY 2 DESC;

ROLLBACK;
