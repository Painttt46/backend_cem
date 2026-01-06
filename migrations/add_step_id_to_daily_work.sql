-- Add step_id column to daily_work_records table
ALTER TABLE daily_work_records 
ADD COLUMN IF NOT EXISTS step_id INTEGER REFERENCES task_steps(id) ON DELETE SET NULL;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_daily_work_records_step_id ON daily_work_records(step_id);
