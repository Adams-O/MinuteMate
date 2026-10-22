create table public.analytics_daily_events (
  event_date date not null default (now() at time zone 'utc')::date,
  event_name text not null check (event_name in ('meeting_created', 'meeting_ready')),
  event_count bigint not null default 0 check (event_count >= 0),
  primary key (event_date, event_name)
);

alter table public.analytics_daily_events enable row level security;
revoke all on public.analytics_daily_events from public, anon, authenticated;
grant select, insert, update on public.analytics_daily_events to service_role;

alter table public.profiles add column account_deletion_started_at timestamptz;

create or replace function public.prevent_meeting_create_during_account_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deletion_started_at timestamptz;
begin
  select account_deletion_started_at into v_deletion_started_at
  from public.profiles where id = new.owner_id
  for update;
  if v_deletion_started_at is not null then
    raise exception 'Account deletion is in progress';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_meeting_create_during_account_deletion() from public, anon, authenticated;

create trigger meetings_block_account_deletion
  before insert on public.meetings
  for each row execute function public.prevent_meeting_create_during_account_deletion();

create or replace function public.record_meeting_analytics_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_name text;
begin
  if tg_op = 'INSERT' then
    v_event_name := 'meeting_created';
  elsif old.status is distinct from new.status and new.status = 'ready' then
    v_event_name := 'meeting_ready';
  else
    return new;
  end if;

  insert into public.analytics_daily_events (event_date, event_name, event_count)
  values ((now() at time zone 'utc')::date, v_event_name, 1)
  on conflict (event_date, event_name)
  do update set event_count = public.analytics_daily_events.event_count + 1;
  return new;
end;
$$;

revoke all on function public.record_meeting_analytics_event() from public, anon, authenticated;

create trigger meetings_record_analytics
  after insert or update of status on public.meetings
  for each row execute function public.record_meeting_analytics_event();

create or replace function public.prepare_account_deletion(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace record;
  v_successor uuid;
begin
  for v_workspace in
    select id from public.workspaces
    where created_by = p_user_id
    order by id
    for update
  loop
    select member.user_id into v_successor
    from public.workspace_members member
    where member.workspace_id = v_workspace.id
      and member.user_id <> p_user_id
    order by case member.role when 'owner' then 0 when 'admin' then 1 else 2 end, member.created_at, member.user_id
    limit 1;

    if v_successor is not null then
      update public.workspaces set created_by = v_successor where id = v_workspace.id;
      update public.workspace_members set role = 'admin'
      where workspace_id = v_workspace.id and role = 'owner' and user_id <> p_user_id;
      update public.workspace_members set role = 'owner'
      where workspace_id = v_workspace.id and user_id = v_successor;
    end if;
    v_successor := null;
  end loop;
end;
$$;

revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;
