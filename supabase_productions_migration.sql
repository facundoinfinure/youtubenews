-- Migration: Add checkpoint and cost tracking fields to productions table
-- This migration adds new fields for granular checkpoint tracking and cost management

-- Add checkpoint_data field for storing intermediate state
alter table productions 
  add column if not exists checkpoint_data jsonb;

-- Add last_checkpoint_at for tracking when last checkpoint was saved
alter table productions 
  add column if not exists last_checkpoint_at timestamp with time zone;

-- Add failed_steps for tracking partial failures
alter table productions 
  add column if not exists failed_steps jsonb default '[]'::jsonb;

-- Add cost tracking fields
alter table productions 
  add column if not exists estimated_cost numeric default 0;

alter table productions 
  add column if not exists actual_cost numeric default 0;

alter table productions 
  add column if not exists cost_breakdown jsonb default '{}'::jsonb;

-- Create index for checkpoint queries
create index if not exists idx_productions_checkpoint 
  on productions(channel_id, last_checkpoint_at desc) 
  where last_checkpoint_at is not null;

-- Create index for failed productions
create index if not exists idx_productions_failed_steps 
  on productions(channel_id, status) 
  where failed_steps is not null and jsonb_array_length(failed_steps) > 0;

-- Comments for documentation
comment on column productions.checkpoint_data is 'Stores intermediate state for granular recovery (script progress, audio segments, video URLs, etc.)';
comment on column productions.last_checkpoint_at is 'Timestamp of last checkpoint save for recovery tracking';
comment on column productions.failed_steps is 'Array of failed step identifiers for partial failure tracking';
comment on column productions.estimated_cost is 'Estimated cost before generation starts';
comment on column productions.actual_cost is 'Actual cost after generation completes';
comment on column productions.cost_breakdown is 'Detailed cost breakdown by task type (script, audio, video, thumbnails, etc.)';
