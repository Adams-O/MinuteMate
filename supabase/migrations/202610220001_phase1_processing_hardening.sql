alter table public.meetings
  add column if not exists audio_deletion_status text not null default 'not_requested',
  add column if not exists audio_deleted_at timestamptz;

alter table public.meetings
  drop constraint if exists meetings_audio_deletion_status_check;
alter table public.meetings
  add constraint meetings_audio_deletion_status_check
  check (audio_deletion_status in ('not_requested', 'pending', 'deleted', 'failed'));

create table if not exists public.assemblyai_webhook_events (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  transcription_job_id text not null unique,
  event_status text not null check (event_status in ('completed', 'error')),
  state text not null default 'queued' check (state in ('queued', 'processing', 'done', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assemblyai_webhook_events_queue_idx
  on public.assemblyai_webhook_events (state, next_attempt_at, created_at);

alter table public.assemblyai_webhook_events enable row level security;

create or replace function public.complete_meeting_processing(
  p_meeting_id uuid,
  p_segments jsonb,
  p_language text,
  p_summary text,
  p_key_points jsonb,
  p_decisions jsonb,
  p_action_items jsonb,
  p_duration_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.meetings
    where id = p_meeting_id and status = 'processing'
  ) then
    raise exception 'Meeting is not processing';
  end if;

  insert into public.transcripts (meeting_id, segments, language)
  values (p_meeting_id, p_segments, p_language)
  on conflict (meeting_id) do update
    set segments = excluded.segments,
        language = excluded.language,
        updated_at = now();

  insert into public.minutes (meeting_id, summary, key_points, decisions)
  values (p_meeting_id, p_summary, p_key_points, p_decisions)
  on conflict (meeting_id) do update
    set summary = excluded.summary,
        key_points = excluded.key_points,
        decisions = excluded.decisions,
        updated_at = now();

  delete from public.action_items where meeting_id = p_meeting_id;
  insert into public.action_items (meeting_id, task, owner, deadline, priority, status)
  select p_meeting_id, item.task, item.owner, item.deadline, item.priority, item.status
  from jsonb_to_recordset(p_action_items) as item(
    task text,
    owner text,
    deadline text,
    priority text,
    status text
  );

  update public.meetings
  set status = 'ready',
      duration_seconds = p_duration_seconds,
      completed_at = now(),
      failure_code = null
  where id = p_meeting_id and status = 'processing';

  if not found then
    raise exception 'Meeting status changed during processing';
  end if;
end;
$$;

revoke all on function public.complete_meeting_processing(uuid, jsonb, text, text, jsonb, jsonb, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.complete_meeting_processing(uuid, jsonb, text, text, jsonb, jsonb, jsonb, integer)
  to service_role;

drop policy if exists "Users manage their own meetings" on public.meetings;
create policy "Users read their own meetings"
  on public.meetings for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Users create their own meetings"
  on public.meetings for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Users delete their own meetings"
  on public.meetings for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Users upload meeting audio to their own folder" on storage.objects;
create policy "Users upload audio for their own uploading meetings"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'meeting-audio'
    and exists (
      select 1
      from public.meetings
      where meetings.storage_path = name
        and meetings.owner_id = (select auth.uid())
        and meetings.status = 'uploading'
    )
  );

drop policy if exists "Users read their own meeting audio" on storage.objects;
create policy "Users read audio for their own meetings"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'meeting-audio'
    and exists (
      select 1
      from public.meetings
      where meetings.storage_path = name
        and meetings.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Users delete their own meeting audio" on storage.objects;
create policy "Users delete audio for their own meetings"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'meeting-audio'
    and exists (
      select 1
      from public.meetings
      where meetings.storage_path = name
        and meetings.owner_id = (select auth.uid())
    )
  );
