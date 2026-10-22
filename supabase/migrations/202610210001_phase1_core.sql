create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  workspace_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'uploading' check (status in ('uploading', 'processing', 'ready', 'failed')),
  source_type text not null check (source_type in ('recording', 'upload')),
  storage_path text not null,
  audio_retention text not null default 'delete_after_transcription'
    check (audio_retention in ('delete_after_transcription', 'keep')),
  duration_seconds integer check (duration_seconds between 0 and 3600),
  size_bytes bigint check (size_bytes between 0 and 104857600),
  transcription_job_id text unique,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists meetings_owner_created_at_idx
  on public.meetings (owner_id, created_at desc);

create table if not exists public.transcripts (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null unique references public.meetings (id) on delete cascade,
  segments jsonb not null default '[]'::jsonb,
  language text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.minutes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null unique references public.meetings (id) on delete cascade,
  summary text not null,
  key_points jsonb not null default '[]'::jsonb,
  decisions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  task text not null check (char_length(task) between 1 and 500),
  owner text not null default 'Not stated',
  deadline text not null default 'Not stated',
  priority text check (priority in ('low', 'medium', 'high', 'Not stated')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.meetings enable row level security;
alter table public.transcripts enable row level security;
alter table public.minutes enable row level security;
alter table public.action_items enable row level security;

create policy "Profiles are readable by their owner"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "Profiles are editable by their owner"
  on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "Users manage their own meetings"
  on public.meetings for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Users access transcripts for their meetings"
  on public.transcripts for all to authenticated
  using (exists (
    select 1 from public.meetings
    where meetings.id = transcripts.meeting_id and meetings.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.meetings
    where meetings.id = transcripts.meeting_id and meetings.owner_id = (select auth.uid())
  ));

create policy "Users access minutes for their meetings"
  on public.minutes for all to authenticated
  using (exists (
    select 1 from public.meetings
    where meetings.id = minutes.meeting_id and meetings.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.meetings
    where meetings.id = minutes.meeting_id and meetings.owner_id = (select auth.uid())
  ));

create policy "Users access action items for their meetings"
  on public.action_items for all to authenticated
  using (exists (
    select 1 from public.meetings
    where meetings.id = action_items.meeting_id and meetings.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.meetings
    where meetings.id = action_items.meeting_id and meetings.owner_id = (select auth.uid())
  ));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meeting-audio',
  'meeting-audio',
  false,
  104857600,
  array['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'video/mp4', 'audio/webm', 'video/webm', 'audio/x-m4a']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Users upload meeting audio to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Users read their own meeting audio"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Users delete their own meeting audio"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

do $$
begin
  alter publication supabase_realtime add table public.meetings;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;