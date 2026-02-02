-- ดูข้อมูลที่ซ้ำก่อน
SELECT leave_type, COUNT(DISTINCT color) as color_count, COUNT(DISTINCT display_name) as name_count
FROM user_leave_quotas 
WHERE year = 2026
GROUP BY leave_type
HAVING COUNT(DISTINCT color) > 1 OR COUNT(DISTINCT display_name) > 1;

-- Sync ให้ทุก row ของ leave_type เดียวกันมีค่า color, advance_days, display_name เหมือนกัน
UPDATE user_leave_quotas uq
SET 
  color = sub.color,
  advance_days = sub.advance_days,
  display_name = sub.display_name
FROM (
  SELECT leave_type, 
    MAX(color) as color, 
    MAX(advance_days) as advance_days, 
    MAX(display_name) as display_name
  FROM user_leave_quotas 
  WHERE year = 2026
  GROUP BY leave_type
) sub
WHERE uq.leave_type = sub.leave_type AND uq.year = 2026;
