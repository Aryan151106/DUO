-- Migration: 0001_initial_schema.sql
-- Duo: The Private Couple OS Schema

-- Enable necessary extensions
create extension if not exists "uuid-ossp";

-- 1. Couples table (Anchors all data; strictly max 2 users)
create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),
  invite_code text unique,
  code_expires_at timestamptz,
  locked boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2. Profiles table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  couple_id uuid references public.couples(id) on delete set null,
  display_name text not null default 'Partner',
  avatar_url text,
  timezone text not null default 'UTC',
  theme text not null default 'midnight',
  quiet_hours_start time default '23:00',
  quiet_hours_end time default '07:00',
  mood_status text default 'Feeling lucky ✨',
  created_at timestamptz not null default now()
);

-- Helper to safely retrieve current user's couple_id (SECURITY DEFINER with strict search_path)
create or replace function public.my_couple_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select couple_id from public.profiles where id = auth.uid() limit 1;
$$;

-- Trigger to strictly block a 3rd member from joining a couple
create or replace function public.lock_couple_trigger()
returns trigger
language plpgsql
security definer
as $$
declare
  member_count int;
begin
  if new.couple_id is not null then
    select count(*) into member_count
    from public.profiles
    where couple_id = new.couple_id and id != new.id;

    if member_count >= 2 then
      raise exception 'Couple is full. Duo strictly allows exactly two members.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists lock_couple on public.profiles;
create trigger lock_couple
  before insert or update of couple_id on public.profiles
  for each row execute function public.lock_couple_trigger();

-- 3. Tasks table (Soft-deleted, optimistic-ready)
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  task_date date not null default current_date,
  assigned_to uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  doodle_url text,
  completed_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  client_id text,
  created_at timestamptz not null default now()
);

-- Trigger for touch_updated
create or replace function public.touch_updated_trigger()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists touch_updated on public.tasks;
create trigger touch_updated
  before update on public.tasks
  for each row execute function public.touch_updated_trigger();

-- 4. Task audit events
create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  couple_id uuid not null references public.couples(id),
  user_id uuid not null,
  action text not null,
  diff jsonb,
  created_at timestamptz not null default now()
);

-- 5. Nudges table (Escalation ladder 1-4)
create table if not exists public.nudges (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  receiver_id uuid not null references public.profiles(id),
  level int not null default 1 check (level between 1 and 4),
  level4_count int not null default 0,
  next_fire_at timestamptz not null default now(),
  last_sent_at timestamptz,
  paused_until timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Enforce exactly one active nudge per task
create unique index if not exists one_active_nudge on public.nudges(task_id)
  where resolved_at is null;

-- 6. Score events ledger (authoritative, append-only)
create table if not exists public.score_events (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  task_id uuid references public.tasks(id) on delete set null,
  kind text not null, -- 'done' | 'early' | 'nudge_fast' | 'day_bonus' | 'shared'
  points int not null,
  day date not null,
  created_at timestamptz not null default now(),
  unique (task_id, kind)
);

-- 7. Streaks & Daily state
create table if not exists public.streaks (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade unique,
  current_streak int not null default 0,
  best_streak int not null default 0,
  freeze_tokens int not null default 1 check (freeze_tokens between 0 and 2),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_day_state (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  day date not null,
  state text not null check (state in ('complete', 'incomplete', 'neutral')),
  unique (user_id, day)
);

-- 8. Messages & Chat
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  content text,
  message_type text not null default 'text' check (message_type in ('text', 'image', 'voice', 'doodle', 'call_card')),
  media_url text,
  metadata jsonb default '{}'::jsonb,
  client_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_couple_created on public.messages (couple_id, created_at desc);

-- 9. Calls table (Signaling & call logs)
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  caller_id uuid not null references public.profiles(id),
  callee_id uuid not null references public.profiles(id),
  state text not null default 'ringing' check (state in ('ringing', 'active', 'declined', 'missed', 'ended', 'busy')),
  call_type text not null default 'video' check (call_type in ('video', 'audio')),
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz
);

create unique index if not exists one_live_call on public.calls(couple_id)
  where state in ('ringing', 'active');

-- 10. Web Push Subscriptions
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

-- Trigger: On task status change -> resolve open nudges and award authoritative points
create or replace function public.on_status_change_trigger()
returns trigger
language plpgsql
security definer
as $$
declare
  active_nudge_rec record;
begin
  if new.status = 'done' and (old.status is null or old.status != 'done') then
    new.completed_at = now();

    -- Resolve any open nudge for this task
    select * into active_nudge_rec from public.nudges where task_id = new.id and resolved_at is null limit 1;
    if found then
      update public.nudges set resolved_at = now() where id = active_nudge_rec.id;
      -- Fast resolution bonus (+5 points if resolved quickly)
      if (now() - active_nudge_rec.created_at) < interval '10 minutes' then
        insert into public.score_events (couple_id, user_id, task_id, kind, points, day)
        values (new.couple_id, new.assigned_to, new.id, 'nudge_fast', 5, current_date)
        on conflict (task_id, kind) do nothing;
      end if;
    end if;

    -- Award standard done points (+10 points)
    insert into public.score_events (couple_id, user_id, task_id, kind, points, day)
    values (new.couple_id, coalesce(new.assigned_to, auth.uid()), new.id, 'done', 10, current_date)
    on conflict (task_id, kind) do nothing;

  elsif new.status != 'done' and old.status = 'done' then
    new.completed_at = null;
    -- Remove the awarded done points if unchecked
    delete from public.score_events where task_id = new.id and kind = 'done';
  end if;

  return new;
end;
$$;

drop trigger if exists on_status_change on public.tasks;
create trigger on_status_change
  before update of status on public.tasks
  for each row execute function public.on_status_change_trigger();

-- RPC: create_nudge with authoritative quiet hours & daily caps check
create or replace function public.create_nudge(p_task_id uuid, p_override_quiet boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
  v_sender_id uuid := auth.uid();
  v_receiver_id uuid;
  v_receiver_profile record;
  v_current_time time;
  v_nudge_id uuid;
  v_daily_count int;
begin
  -- Fetch task
  select * into v_task from public.tasks where id = p_task_id and deleted_at is null;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Task not found');
  end if;

  if v_task.status = 'done' or v_task.status = 'doing' then
    return jsonb_build_object('success', false, 'error', 'Task is already in progress or completed');
  end if;

  -- Receiver is the other partner or assigned user
  v_receiver_id := coalesce(v_task.assigned_to, (
    select id from public.profiles where couple_id = v_task.couple_id and id != v_sender_id limit 1
  ));

  if v_receiver_id is null or v_receiver_id = v_sender_id then
    return jsonb_build_object('success', false, 'error', 'Cannot nudge yourself');
  end if;

  -- Daily cap check (max 10 nudges per day to prevent spam)
  select count(*) into v_daily_count from public.nudges
  where sender_id = v_sender_id and created_at::date = current_date;

  if v_daily_count >= 10 then
    return jsonb_build_object('success', false, 'error', 'Daily nudge limit reached (10 max per day)');
  end if;

  -- Quiet hours check
  select * into v_receiver_profile from public.profiles where id = v_receiver_id;
  if not p_override_quiet and v_receiver_profile.quiet_hours_start is not null then
    v_current_time := (now() at time zone coalesce(v_receiver_profile.timezone, 'UTC'))::time;
    if v_receiver_profile.quiet_hours_start > v_receiver_profile.quiet_hours_end then
      -- Overnight range e.g. 23:00 to 07:00
      if v_current_time >= v_receiver_profile.quiet_hours_start or v_current_time < v_receiver_profile.quiet_hours_end then
        return jsonb_build_object('success', false, 'error', 'quiet_hours_active', 'message', 'Partner is in quiet hours');
      end if;
    else
      if v_current_time >= v_receiver_profile.quiet_hours_start and v_current_time < v_receiver_profile.quiet_hours_end then
        return jsonb_build_object('success', false, 'error', 'quiet_hours_active', 'message', 'Partner is in quiet hours');
      end if;
    end if;
  end if;

  -- Insert Level 1 Nudge
  insert into public.nudges (couple_id, task_id, sender_id, receiver_id, level, next_fire_at, last_sent_at)
  values (v_task.couple_id, p_task_id, v_sender_id, v_receiver_id, 1, now() + interval '3 minutes', now())
  returning id into v_nudge_id;

  return jsonb_build_object('success', true, 'nudge_id', v_nudge_id, 'level', 1);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'error', 'An active nudge is already ringing for this task');
end;
$$;

-- RLS Policies for secure isolation
alter table public.couples enable row level security;
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.nudges enable row level security;
alter table public.score_events enable row level security;
alter table public.streaks enable row level security;
alter table public.messages enable row level security;
alter table public.calls enable row level security;
alter table public.push_subscriptions enable row level security;

-- Couple RLS Policies
create policy "Couples accessible by members" on public.couples
  for all using (id = public.my_couple_id());

create policy "Profiles accessible by couple members" on public.profiles
  for select using (couple_id = public.my_couple_id() or id = auth.uid());

create policy "Profiles update own profile" on public.profiles
  for update using (id = auth.uid());

create policy "Tasks accessible by couple" on public.tasks
  for all using (couple_id = public.my_couple_id())
  with check (couple_id = public.my_couple_id());

create policy "Messages accessible by couple" on public.messages
  for all using (couple_id = public.my_couple_id())
  with check (couple_id = public.my_couple_id());

create policy "Nudges accessible by couple" on public.nudges
  for all using (couple_id = public.my_couple_id())
  with check (couple_id = public.my_couple_id());

create policy "Score events accessible by couple" on public.score_events
  for select using (couple_id = public.my_couple_id());

create policy "Calls accessible by couple" on public.calls
  for all using (couple_id = public.my_couple_id())
  with check (couple_id = public.my_couple_id());

create policy "Streaks accessible by couple" on public.streaks
  for all using (couple_id = public.my_couple_id());
