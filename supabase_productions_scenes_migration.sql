-- Migration: Add narrative_used and scenes fields to productions table
-- This migration adds support for the v2.0 Narrative Engine with scene-based scripts

-- Add narrative_used field to store which narrative structure was used
alter table productions 
  add column if not exists narrative_used text;

-- Add scenes field to store complete scene structure with metadata
alter table productions 
  add column if not exists scenes jsonb;

-- Create index for narrative queries (optional, for analytics)
create index if not exists idx_productions_narrative 
  on productions(channel_id, narrative_used) 
  where narrative_used is not null;

-- Comments for documentation
comment on column productions.narrative_used is 'Narrative structure used: classic, double_conflict, hot_take, or perspective_clash';
comment on column productions.scenes is 'Complete scene structure with metadata (video_mode, model, shot) in ScriptWithScenes format';
