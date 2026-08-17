-- OneMaker Arduino Studio: 회원 및 개인 프로젝트 저장소
-- Supabase Dashboard > SQL Editor에서 한 번 실행합니다.

create extension if not exists citext;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext not null unique,
  created_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_]{4,20}$')
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  project_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_updated_idx
  on public.projects(user_id, updated_at desc);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;

drop policy if exists "profile owner read" on public.profiles;
create policy "profile owner read" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "project owner read" on public.projects;
create policy "project owner read" on public.projects
  for select using (auth.uid() = user_id);

drop policy if exists "project owner insert" on public.projects;
create policy "project owner insert" on public.projects
  for insert with check (auth.uid() = user_id);

drop policy if exists "project owner update" on public.projects;
create policy "project owner update" on public.projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "project owner delete" on public.projects;
create policy "project owner delete" on public.projects
  for delete using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles(id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
