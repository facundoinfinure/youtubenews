-- Create news_items table to store daily news
create table if not exists news_items (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  news_date date not null,
  headline text not null,
  source text not null,
  url text not null,
  summary text not null,
  viral_score numeric not null,
  image_keyword text not null,
  image_url text,
  selected boolean default false,
  video_id uuid references videos(id)
);

-- Create index for faster date lookups
create index if not exists idx_news_date on news_items(news_date);

-- Enable RLS for news_items
alter table news_items enable row level security;

-- Create policy to allow read access to everyone
create policy "Enable read access for all users" on news_items
  for select using (true);

-- Create policy to allow insert access for all users
create policy "Enable insert access for all users" on news_items
  for insert with check (true);

-- Create policy to allow update access for all users
create policy "Enable update access for all users" on news_items
  for update using (true) with check (true);
