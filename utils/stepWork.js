// สรุปการลงงานต่อ step คำนวณครั้งเดียวจาก daily_work_records — CTE ร่วมของ /api/daily-work และ /api/task-steps
// เดิมแต่ละ step สแกนตารางลงงานเอง เวลาจึงโตตามจำนวน step × จำนวนรายการลงงาน (production 4–5 วินาทีต่อคำขอ)
// - มีแถวของ step = เคยมีการลงงาน / latest_* นับเฉพาะงานที่ไม่เกินวันนี้ (งานล่วงหน้ายังไม่นับว่าทำแล้ว)
// - รายการเดียวอาจอ้าง step ซ้ำทั้งใน step_id และ step_ids ได้ ไม่กระทบผล เพราะใช้แค่ MAX
// - MATERIALIZED: ให้คำนวณรอบเดียว ไม่ถูกคำนวณซ้ำต่อแถวเมื่ออยู่ใน subquery
export const STEP_WORK_CTE = `
  step_work AS MATERIALIZED (
    SELECT w.step_id,
      MAX(w.work_date) FILTER (WHERE w.work_date <= CURRENT_DATE) AS latest_work_date,
      MAX(w.created_at) FILTER (WHERE w.work_date <= CURRENT_DATE) AS latest_work_logged_at
    FROM (
      SELECT d.step_id, d.work_date, d.created_at
      FROM daily_work_records d
      WHERE d.step_id IS NOT NULL
      UNION ALL
      SELECT e.id::int, d.work_date, d.created_at
      FROM daily_work_records d
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(d.step_ids) = 'array' THEN d.step_ids ELSE '[]'::jsonb END
      ) AS e(id)
      WHERE e.id ~ '^[0-9]+$'
    ) w
    GROUP BY w.step_id
  )`;
