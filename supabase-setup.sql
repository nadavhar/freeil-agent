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
