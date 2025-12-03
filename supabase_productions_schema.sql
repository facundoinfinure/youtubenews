-- Productions Table Schema
-- Stores complete production state for recovery and history

create table if not exists productions (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  completed_at timestamp with time zone,
  channel_id uuid references channels(id) on delete cascade not null,
  news_date date not null,
  status text not null default 'draft' check (status in ('draft', 'in_progress', 'completed', 'failed')),
  selected_news_ids uuid[] default array[]::uuid[],
  script jsonb,
  viral_hook text,
  viral_metadata jsonb,
  segments jsonb, -- BroadcastSegment[] metadata (without audio base64)
  video_assets jsonb, -- VideoAssets with URLs
  thumbnail_urls jsonb, -- Array of thumbnail URLs
  progress_step integer default 0,
  user_id text -- Store user email for filtering
);

-- Create indexes for faster lookups
create index if not exists idx_productions_channel on productions(channel_id);
create index if not exists idx_productions_status on productions(status);
create index if not exists idx_productions_news_date on productions(news_date);
create index if not exists idx_productions_user on productions(user_id);
create index if not exists idx_productions_updated on productions(updated_at desc);

-- Enable RLS for productions
alter table productions enable row level security;

-- Create policies for productions
create policy "Enable read access for all users" on productions
  for select using (true);

create policy "Enable insert access for all users" on productions
  for insert with check (true);

create policy "Enable update access for all users" on productions
  for update using (true) with check (true);

create policy "Enable delete access for all users" on productions
  for delete using (true);

-- Function to automatically update updated_at timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

-- Trigger to update updated_at on row update
create trigger update_productions_updated_at
  before update on productions
  for each row
  execute function update_updated_at_column();

