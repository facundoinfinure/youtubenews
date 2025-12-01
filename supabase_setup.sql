-- Create channel_settings table
create table if not exists channel_settings (
  id bigint primary key,
  config jsonb not null
);

-- Insert default config if not exists
insert into channel_settings (id, config)
values (1, '{
  "channelName": "ChimpNews",
  "tagline": "Investing is Bananas",
  "country": "USA",
  "language": "English",
  "format": "16:9",
  "tone": "Sarcastic, Witty, Informative",
  "logoColor1": "#FACC15",
  "logoColor2": "#DC2626",
  "captionsEnabled": false,
  "characters": {
    "hostA": {
      "id": "hostA",
      "name": "Rusty",
      "bio": "Male, Republican-leaning, loves free markets, sarcastic, grumpy, wears a red tie",
      "visualPrompt": "Male chimpanzee news anchor wearing a suit and red tie",
      "voiceName": "Kore"
    },
    "hostB": {
      "id": "hostB",
      "name": "Dani",
      "bio": "Female, Democrat-leaning, loves social safety nets, witty, optimistic, wears a blue suit",
      "visualPrompt": "Female chimpanzee news anchor wearing a blue suit and glasses",
      "voiceName": "Fenrir"
    }
  }
}'::jsonb)
on conflict (id) do nothing;

-- Enable RLS for channel_settings
alter table channel_settings enable row level security;

-- Create policy to allow read access to everyone
create policy "Enable read access for all users" on channel_settings
  for select using (true);

-- Create policy to allow update access to everyone (for demo purposes, restrict in prod)
create policy "Enable update access for all users" on channel_settings
  for update using (true) with check (true);
  
-- Create policy to allow insert access for all users
create policy "Enable insert access for all users" on channel_settings
  for insert with check (true);


-- Create videos table
create table if not exists videos (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  title text not null,
  description text,
  tags text[],
  youtube_id text,
  viral_score numeric,
  views numeric default 0,
  ctr numeric default 0,
  avg_view_duration text,
  retention_data numeric[]
);

-- Enable RLS for videos
alter table videos enable row level security;

-- Create policy to allow read access to everyone
create policy "Enable read access for all users" on videos
  for select using (true);

-- Create policy to allow insert access for all users
create policy "Enable insert access for all users" on videos
  for insert with check (true);
