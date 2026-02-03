-- Add previous_status column to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS previous_status VARCHAR(50);
