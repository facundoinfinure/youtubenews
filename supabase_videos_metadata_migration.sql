-- Migration: Add is_posted and thumbnail_url columns to videos table
-- This migration adds the missing columns that are used by the application

-- Add is_posted column to videos table
alter table videos add column if not exists is_posted boolean default false;

-- Add thumbnail_url column to videos table
alter table videos add column if not exists thumbnail_url text;

-- Update existing videos: set is_posted = true for videos that have youtube_id
update videos 
set is_posted = true 
where youtube_id is not null 
  and youtube_id != '';

-- Create index on is_posted for faster filtering
create index if not exists idx_videos_is_posted on videos(is_posted);

-- Create index on thumbnail_url for faster lookups (optional, but useful)
create index if not exists idx_videos_thumbnail_url on videos(thumbnail_url) where thumbnail_url is not null;
