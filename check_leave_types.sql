-- ดูประเภทการลาทั้งหมดที่มี
SELECT DISTINCT leave_type, display_name, color, COUNT(*) as row_count
FROM user_leave_quotas 
WHERE year = 2026
GROUP BY leave_type, display_name, color
ORDER BY leave_type;
