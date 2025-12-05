-- =====================================================
-- ChimpNews: Video Task ID & Thumbnail Cache Migration
-- =====================================================
-- This migration adds:
-- 1. task_id column to generated_videos for tracking pending WaveSpeed tasks
-- 2. thumbnail_cache table for caching generated thumbnails
--
-- Run this in Supabase SQL Editor
-- =====================================================

-- =====================================================
-- PART 1: Add task_id to generated_videos
-- =====================================================
-- This allows us to resume polling for pending video generation tasks
-- instead of creating duplicate requests to WaveSpeed

-- Add task_id column (stores WaveSpeed task ID for pending/generating videos)
ALTER TABLE generated_videos 
ADD COLUMN IF NOT EXISTS task_id VARCHAR(255);

-- Add index for fast lookup of pending tasks
CREATE INDEX IF NOT EXISTS idx_generated_videos_task_id 
ON generated_videos(task_id) 
WHERE task_id IS NOT NULL;

-- Add index for finding pending videos by dialogue (for lip-sync video recovery)
CREATE INDEX IF NOT EXISTS idx_generated_videos_pending_dialogue 
ON generated_videos(channel_id, dialogue_text, status) 
WHERE status IN ('pending', 'generating');

-- Add created timestamp for tracking task age (for cleanup of stale tasks)
ALTER TABLE generated_videos 
ADD COLUMN IF NOT EXISTS task_created_at TIMESTAMP;

-- =====================================================
-- PART 2: Create thumbnail_cache table
-- =====================================================
-- Caches generated thumbnails to avoid regenerating for same context

CREATE TABLE IF NOT EXISTS thumbnail_cache (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Channel and production context
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  production_id UUID REFERENCES productions(id) ON DELETE SET NULL,
  
  -- Cache key (hash of news context + viral title)
  context_hash VARCHAR(64) NOT NULL,
  
  -- Thumbnail data
  thumbnail_url TEXT NOT NULL,
  variant_url TEXT,  -- Second variant for A/B testing
  
  -- Metadata
  style VARCHAR(50),  -- e.g., "Shocked Face + Bold Text"
  provider VARCHAR(50) DEFAULT 'wavespeed',  -- wavespeed, dalle, etc.
  
  -- Analytics
  use_count INTEGER DEFAULT 1,
  last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_thumbnail_context UNIQUE (channel_id, context_hash)
);

-- Index for fast cache lookups
CREATE INDEX IF NOT EXISTS idx_thumbnail_cache_lookup 
ON thumbnail_cache(channel_id, context_hash);

-- Index for cleanup of old/unused thumbnails
CREATE INDEX IF NOT EXISTS idx_thumbnail_cache_last_used 
ON thumbnail_cache(last_used_at);

-- =====================================================
-- PART 3: Add helper function for video task cleanup
-- =====================================================
-- Marks very old pending tasks as failed (stale tasks cleanup)

CREATE OR REPLACE FUNCTION cleanup_stale_video_tasks(max_age_hours INTEGER DEFAULT 24)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE generated_videos
  SET 
    status = 'failed',
    error_message = 'Task timed out (stale task cleanup)'
  WHERE 
    status IN ('pending', 'generating')
    AND task_created_at IS NOT NULL
    AND task_created_at < NOW() - (max_age_hours || ' hours')::INTERVAL;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  
  RETURN updated_count;
END;
$$;

-- =====================================================
-- PART 4: Add helper function for thumbnail cache cleanup
-- =====================================================
-- Removes thumbnails not used in the last N days

CREATE OR REPLACE FUNCTION cleanup_old_thumbnails(max_age_days INTEGER DEFAULT 30)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM thumbnail_cache
  WHERE 
    last_used_at < NOW() - (max_age_days || ' days')::INTERVAL
    AND use_count < 3;  -- Keep frequently used thumbnails
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$;

-- =====================================================
-- VERIFICATION
-- =====================================================
-- Run these queries to verify the migration:

-- Check generated_videos has task_id column:
-- SELECT column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'generated_videos' AND column_name = 'task_id';

-- Check thumbnail_cache table exists:
-- SELECT * FROM thumbnail_cache LIMIT 1;

-- Test cleanup functions:
-- SELECT cleanup_stale_video_tasks(24);
-- SELECT cleanup_old_thumbnails(30);

COMMENT ON COLUMN generated_videos.task_id IS 'WaveSpeed task ID for pending/generating videos - allows resume polling';
COMMENT ON COLUMN generated_videos.task_created_at IS 'When the task was created - for stale task cleanup';
COMMENT ON TABLE thumbnail_cache IS 'Cache for generated thumbnails - avoids regenerating for same news context';
