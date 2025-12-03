-- Audio Cache Table Schema
-- Dedicated table for fast audio segment lookup and reuse
-- This improves performance compared to searching through all productions

create table if not exists audio_cache (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  
  -- Ownership
  channel_id uuid references channels(id) on delete cascade not null,
  
  -- Cache key (hash of text + voice for fast lookup)
  text_hash text not null, -- Hash of the text content
  voice_name text not null, -- Voice name used for TTS
  
  -- Audio data
  audio_url text not null, -- URL to audio file in storage
  duration_seconds numeric, -- Duration in seconds
  
  -- Usage tracking
  last_used_at timestamp with time zone default timezone('utc'::text, now()),
  use_count integer default 1, -- How many times this audio has been reused
  
  -- Metadata
  text_preview text, -- First 100 chars of text for debugging
  production_id uuid references productions(id) on delete set null -- Original production that created this
  
);

-- Create indexes for fast lookups
create index if not exists idx_audio_cache_channel on audio_cache(channel_id);
create index if not exists idx_audio_cache_lookup on audio_cache(channel_id, text_hash, voice_name);
create index if not exists idx_audio_cache_last_used on audio_cache(last_used_at desc);
create index if not exists idx_audio_cache_production on audio_cache(production_id);

-- Composite index for most common lookup pattern
create index if not exists idx_audio_cache_primary_lookup 
  on audio_cache(channel_id, text_hash, voice_name, last_used_at desc);

-- Enable RLS for audio_cache
alter table audio_cache enable row level security;

-- Create policies for audio_cache
create policy "Enable read access for all users" on audio_cache
  for select using (true);

create policy "Enable insert access for all users" on audio_cache
  for insert with check (true);

create policy "Enable update access for all users" on audio_cache
  for update using (true) with check (true);

create policy "Enable delete access for all users" on audio_cache
  for delete using (true);

-- Function to automatically update updated_at and last_used_at
create or replace function update_audio_cache_timestamps()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  -- Update last_used_at when audio is accessed
  if tg_op = 'UPDATE' and old.use_count < new.use_count then
    new.last_used_at = timezone('utc'::text, now());
  end if;
  return new;
end;
$$ language plpgsql;

-- Trigger to update timestamps
create trigger update_audio_cache_timestamps
  before update on audio_cache
  for each row
  execute function update_audio_cache_timestamps();

-- Helper function to clean up old unused audio cache entries
create or replace function cleanup_old_audio_cache(days_old integer default 90)
returns integer as $$
declare
  deleted_count integer;
begin
  delete from audio_cache
  where last_used_at < now() - (days_old || ' days')::interval
    and use_count = 1; -- Only delete entries that were never reused
  
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$ language plpgsql;

-- Comments for documentation
comment on table audio_cache is 'Dedicated cache table for audio segments to improve lookup performance';
comment on column audio_cache.text_hash is 'Hash of the text content for fast matching';
comment on column audio_cache.use_count is 'Number of times this audio has been reused (for cache effectiveness tracking)';
