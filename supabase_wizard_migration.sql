-- Migration to add wizard state and fetched news fields to productions table
-- Run this in your Supabase SQL editor
-- Version 2.4 - Production Wizard Step-by-Step Flow

-- Add wizard state field (JSONB for complex nested structure)
ALTER TABLE productions ADD COLUMN IF NOT EXISTS wizard_state JSONB;

-- Add fetched news cache field (JSONB array of NewsItem)
ALTER TABLE productions ADD COLUMN IF NOT EXISTS fetched_news JSONB;

-- Create index for finding productions by wizard step
CREATE INDEX IF NOT EXISTS idx_productions_wizard_step 
ON productions ((wizard_state->>'currentStep')) 
WHERE wizard_state IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN productions.wizard_state IS 'v2.4: Complete wizard state for step-by-step production flow. Contains currentStep and status for each step.';
COMMENT ON COLUMN productions.fetched_news IS 'v2.4: Cached fetched news items for this production, allowing user to resume without re-fetching.';

-- Example wizard_state structure:
-- {
--   "currentStep": "audio_generate",
--   "newsFetch": { "status": "completed", "completedAt": "2024-01-01T00:00:00Z", "data": {...} },
--   "newsSelect": { "status": "completed", "completedAt": "2024-01-01T00:00:00Z", "data": {...} },
--   "scriptGenerate": { "status": "completed", "completedAt": "2024-01-01T00:00:00Z", "data": {...} },
--   "scriptReview": { "status": "completed", "completedAt": "2024-01-01T00:00:00Z", "data": {...} },
--   "audioGenerate": { "status": "in_progress", "startedAt": "2024-01-01T00:00:00Z", "data": { "completedSegments": 3, "totalSegments": 6 } },
--   "videoGenerate": { "status": "pending" },
--   "renderFinal": { "status": "pending" },
--   "publish": { "status": "pending" }
-- }

