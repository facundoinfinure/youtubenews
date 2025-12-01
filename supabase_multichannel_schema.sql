-- Multi-Channel Support Schema

-- Create channels table
create table if not exists channels (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  name text unique not null,
  config jsonb not null,
  active boolean default true
);

-- Enable RLS for channels
alter table channels enable row level security;

-- Create policies for channels
create policy "Enable read access for all users" on channels
  for select using (true);

create policy "Enable insert access for all users" on channels
  for insert with check (true);

create policy "Enable update access for all users" on channels
  for update using (true) with check (true);

-- Migrate existing config from channel_settings to channels table
insert into channels (name, config, active)
select 
  'ChimpNews' as name,
  config,
  true as active
from channel_settings
where id = 1
on conflict (name) do nothing;

-- Add channel_id to news_items
alter table news_items add column if not exists channel_id uuid references channels(id);

-- Create index for faster lookups
create index if not exists idx_news_channel on news_items(channel_id);

-- Add channel_id to videos
alter table videos add column if not exists channel_id uuid references channels(id);

-- Create index for faster lookups
create index if not exists idx_videos_channel on videos(channel_id);

-- Set default channel for existing news and videos
update news_items 
set channel_id = (select id from channels where name = 'ChimpNews' limit 1)
where channel_id is null;

update videos 
set channel_id = (select id from channels where name = 'ChimpNews' limit 1)
where channel_id is null;
