-- ══════════════════════════════════════════════════════════════
-- FreeIL — Supabase setup
-- Run this once in: Supabase Dashboard → SQL Editor → Run
-- ══════════════════════════════════════════════════════════════

-- User-submitted events table
create table if not exists user_events (
  id               uuid        default gen_random_uuid() primary key,
  user_id          uuid        references auth.users(id) on delete cascade not null,
  title            text        not null,
  date             date,
  time             text,
  location         text,
  description      text,
  event_type       text,
  city             text,
  thumbnail_url    text,
  emoji            text        default '📅',
  status           text        default 'published',
  registration_enabled  boolean  default true,
  registrations_count   integer  default 0,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- Auto-update updated_at on every row change
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create or replace trigger user_events_updated_at
  before update on user_events
  for each row execute function update_updated_at();

-- Row Level Security — users can only see/edit their own events
alter table user_events enable row level security;

create policy "select_own" on user_events
  for select using (auth.uid() = user_id);

create policy "insert_own" on user_events
  for insert with check (auth.uid() = user_id);

create policy "update_own" on user_events
  for update using (auth.uid() = user_id);

create policy "delete_own" on user_events
  for delete using (auth.uid() = user_id);

-- Event registrations table
create table if not exists event_registrations (
  id         bigserial primary key,
  user_id    uuid references auth.users(id) on delete cascade not null,
  event_id   uuid references user_events(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(user_id, event_id)
);

alter table event_registrations enable row level security;

create policy "insert_own" on event_registrations
  for insert to authenticated with check (auth.uid() = user_id);

create policy "select_own" on event_registrations
  for select to authenticated using (auth.uid() = user_id);

-- Allow anyone to read published events (needed for community feed)
create policy "select_published" on user_events
  for select using (status = 'published');

-- Event comments table
create table if not exists event_comments (
  id         bigserial   primary key,
  event_id   uuid        references user_events(id) on delete cascade not null,
  user_id    uuid        references auth.users(id) on delete set null,
  content    text        not null,
  created_at timestamptz default now()
);

alter table event_comments enable row level security;

create policy "select_all" on event_comments
  for select using (true);

create policy "insert_any" on event_comments
  for insert with check (true);

-- Increment registrations count RPC
create or replace function increment_registrations(event_id uuid)
returns void language plpgsql security definer as $$
begin
  update user_events set registrations_count = registrations_count + 1 where id = event_id;
end;
$$;
