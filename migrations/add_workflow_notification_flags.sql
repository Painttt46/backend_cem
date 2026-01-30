-- Add notification tracking columns to task_steps
ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS notified_start BOOLEAN DEFAULT FALSE;
ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS notified_due BOOLEAN DEFAULT FALSE;
ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS notified_overdue BOOLEAN DEFAULT FALSE;
