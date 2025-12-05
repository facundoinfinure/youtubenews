-- Migration: Add segment_status field to productions table
-- This migration adds per-segment resource status tracking for resumable productions

-- Add segment_status field for tracking individual segment progress
-- Structure: { [segmentIndex: number]: { audio: status, video: status, audioUrl?: string, videoUrl?: string } }
alter table productions 
  add column if not exists segment_status jsonb;

-- Create index for segment status queries (for finding incomplete segments)
create index if not exists idx_productions_segment_status 
  on productions(channel_id, status) 
  where segment_status is not null;

-- Comments for documentation
comment on column productions.segment_status is 'Per-segment resource status tracking: { segmentIndex: { audio: pending|generating|done|failed, video: pending|generating|done|failed, audioUrl?, videoUrl?, error?, lastUpdated } }';
