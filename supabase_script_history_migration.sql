-- Migration: Add script_history field to productions table
-- Version 2.5 - Script History for comparison and rollback
-- Run this in your Supabase SQL editor

-- Add script_history field (JSONB array of ScriptHistoryItem)
ALTER TABLE productions ADD COLUMN IF NOT EXISTS script_history JSONB;

-- Create index for querying productions with script history
CREATE INDEX IF NOT EXISTS idx_productions_has_script_history 
ON productions (id) 
WHERE script_history IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN productions.script_history IS 'v2.5: Array of previously generated scripts (ScriptHistoryItem[]) for comparison and rollback. Each item contains generatedAt timestamp, scenes, viralMetadata, and optional analysis.';

-- Example script_history structure:
-- [
--   {
--     "id": "uuid",
--     "generatedAt": "2024-01-01T00:00:00Z",
--     "scenes": { ... ScriptWithScenes ... },
--     "viralMetadata": { "title": "...", "description": "...", "tags": [...] },
--     "analysis": {
--       "overallScore": 85,
--       "hookScore": 90,
--       "retentionScore": 80,
--       "pacingScore": 85,
--       "engagementScore": 88,
--       "suggestions": ["..."],
--       "strengths": ["..."]
--     }
--   }
-- ]

