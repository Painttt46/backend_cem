-- Add project_statuses column (array) to task_steps
ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS project_statuses JSONB DEFAULT '[]';

-- Migrate old project_status to project_statuses array
UPDATE task_steps 
SET project_statuses = CASE 
  WHEN project_status IS NOT NULL THEN jsonb_build_array(project_status)
  ELSE '[]'::jsonb
END
WHERE project_statuses IS NULL OR project_statuses = '[]';
