-- Generated Videos Cache Table Schema
-- Stores individual generated videos for reuse and recovery
-- This allows resuming production without regenerating videos

create table if not exists generated_videos (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  
  -- Ownership
  channel_id uuid references channels(id) on delete cascade not null,
  production_id uuid references productions(id) on delete set null, -- Can be null for intro/outro that are channel-level
  
  -- Video identification
  video_type text not null check (video_type in ('intro', 'outro', 'host_a', 'host_b', 'both_hosts', 'segment')),
  segment_index integer, -- For segment videos, which segment this belongs to
  
  -- Content hash for cache matching
  prompt_hash text not null, -- Hash of the prompt used to generate this video
  dialogue_text text, -- The dialogue text (for lip-sync videos)
  
  -- Video data
  video_url text not null, -- URL to the generated video
  provider text not null check (provider in ('wavespeed', 'veo3', 'other')), -- Which API generated this
  
  -- Metadata
  aspect_ratio text default '16:9',
  duration_seconds integer,
  status text not null default 'completed' check (status in ('pending', 'generating', 'completed', 'failed')),
  error_message text, -- If failed, store error for debugging
  
  -- For matching cached videos
  reference_image_hash text, -- Hash of reference image used (if any)
  
  -- Expiration (optional, for storage management)
  expires_at timestamp with time zone
);

-- Create indexes for fast lookups
create index if not exists idx_generated_videos_channel on generated_videos(channel_id);
create index if not exists idx_generated_videos_production on generated_videos(production_id);
create index if not exists idx_generated_videos_type on generated_videos(video_type);
create index if not exists idx_generated_videos_prompt_hash on generated_videos(prompt_hash);
create index if not exists idx_generated_videos_status on generated_videos(status);
create index if not exists idx_generated_videos_created on generated_videos(created_at desc);

-- Composite index for common cache lookup pattern
create index if not exists idx_generated_videos_cache_lookup 
  on generated_videos(channel_id, video_type, prompt_hash, status);

-- Enable RLS for generated_videos
alter table generated_videos enable row level security;

-- Create policies for generated_videos
create policy "Enable read access for all users" on generated_videos
  for select using (true);

create policy "Enable insert access for all users" on generated_videos
  for insert with check (true);

create policy "Enable update access for all users" on generated_videos
  for update using (true) with check (true);

create policy "Enable delete access for all users" on generated_videos
  for delete using (true);

-- Helper function to clean up expired videos
create or replace function cleanup_expired_videos()
returns void as $$
begin
  delete from generated_videos 
  where expires_at is not null 
    and expires_at < now();
end;
$$ language plpgsql;

-- Comments for documentation
comment on table generated_videos is 'Cache of generated videos for reuse and production recovery';
comment on column generated_videos.prompt_hash is 'MD5 or similar hash of the generation prompt for cache matching';
comment on column generated_videos.video_type is 'Type: intro, outro, host_a, host_b, both_hosts, segment';
comment on column generated_videos.provider is 'Which AI service generated this video: wavespeed, veo3';
