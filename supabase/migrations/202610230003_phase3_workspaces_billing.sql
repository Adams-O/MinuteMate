create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id, workspace_id);

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (length(email) between 3 and 254),
  role text not null check (role in ('admin', 'member')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index workspace_invitations_pending_email_idx
  on public.workspace_invitations (workspace_id, lower(email))
  where accepted_at is null and revoked_at is null;

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces (id) on delete cascade,
  provider text not null default 'paystack' check (provider in ('paystack')),
  provider_customer_id text,
  provider_subscription_id text unique,
  provider_reference text unique,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  status text not null default 'active' check (status in ('active', 'pending', 'cancelled', 'past_due')),
  currency text,
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  meeting_id uuid references public.meetings (id) on delete set null,
  event_type text not null check (event_type in ('meeting_created', 'audio_minutes_reserved')),
  quantity bigint not null check (quantity >= 0),
  unit text not null check (unit in ('meetings', 'seconds')),
  idempotency_key text not null unique,
  period_start date not null,
  created_at timestamptz not null default now()
);

create index usage_events_period_idx on public.usage_events (workspace_id, period_start, event_type);

create table public.billing_transactions (
  reference text primary key check (length(reference) between 1 and 200),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  created_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

insert into public.workspaces (id, name, created_by)
select gen_random_uuid(), 'Personal workspace', p.id
from public.profiles p
where not exists (
  select 1 from public.workspace_members m where m.user_id = p.id
);

insert into public.workspace_members (workspace_id, user_id, role)
select w.id, w.created_by, 'owner'
from public.workspaces w
where not exists (
  select 1 from public.workspace_members m where m.workspace_id = w.id and m.user_id = w.created_by
);

insert into public.subscriptions (workspace_id)
select w.id from public.workspaces w
on conflict (workspace_id) do nothing;

update public.meetings as meeting
set workspace_id = member.workspace_id
from public.workspace_members as member
where member.user_id = meeting.owner_id
  and member.role = 'owner'
  and meeting.workspace_id is null;

alter table public.meetings
  alter column workspace_id set not null;
alter table public.meetings
  add constraint meetings_workspace_fk
  foreign key (workspace_id) references public.workspaces (id) on delete cascade;
create index meetings_workspace_created_at_idx
  on public.meetings (workspace_id, created_at desc);

insert into public.usage_events (workspace_id, meeting_id, event_type, quantity, unit, idempotency_key, period_start)
select m.workspace_id, m.id, 'meeting_created', 1, 'meetings',
       'meeting:' || m.id::text, date_trunc('month', m.created_at at time zone 'UTC')::date
from public.meetings m
on conflict (idempotency_key) do nothing;

insert into public.usage_events (workspace_id, meeting_id, event_type, quantity, unit, idempotency_key, period_start)
select m.workspace_id, m.id, 'audio_minutes_reserved', greatest(coalesce(m.duration_seconds, 0), 0), 'seconds',
       'audio:' || m.id::text, date_trunc('month', m.created_at at time zone 'UTC')::date
from public.meetings m
where m.duration_seconds is not null and m.duration_seconds > 0
on conflict (idempotency_key) do nothing;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_events enable row level security;
alter table public.billing_transactions enable row level security;
revoke update on public.workspaces from authenticated;
grant update (name) on public.workspaces to authenticated;

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members member
    where member.workspace_id = p_workspace_id and member.user_id = (select auth.uid())
  );
$$;

create or replace function public.workspace_role(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select member.role from public.workspace_members member
  where member.workspace_id = p_workspace_id and member.user_id = (select auth.uid())
  limit 1;
$$;

revoke all on function public.is_workspace_member(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
revoke all on function public.workspace_role(uuid) from public, anon;
grant execute on function public.workspace_role(uuid) to authenticated;

create policy "Members can read their workspaces"
  on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));
create policy "Workspace owners can update their workspace"
  on public.workspaces for update to authenticated
  using (public.workspace_role(id) in ('owner', 'admin'))
  with check (public.workspace_role(id) in ('owner', 'admin'));

create policy "Members can read workspace membership"
  on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Workspace managers can read invitations"
  on public.workspace_invitations for select to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'));

create policy "Members can read workspace subscriptions"
  on public.subscriptions for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "Members can read workspace usage"
  on public.usage_events for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "Users read their own meetings" on public.meetings;
drop policy if exists "Users create their own meetings" on public.meetings;
drop policy if exists "Users delete their own meetings" on public.meetings;
drop policy if exists "Users manage their own meetings" on public.meetings;
create policy "Workspace members read meetings"
  on public.meetings for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "Workspace members create meetings"
  on public.meetings for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and public.is_workspace_member(workspace_id)
  );

create or replace function public.search_meetings(p_query text)
returns table (
  id uuid,
  title text,
  status text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select meeting.id, meeting.title, meeting.status, meeting.created_at
  from public.meetings as meeting
  where public.is_workspace_member(meeting.workspace_id)
    and length(trim(p_query)) between 2 and 100
    and (
      position(lower(trim(p_query)) in lower(meeting.title)) > 0
      or exists (
        select 1 from public.minutes as minutes
        where minutes.meeting_id = meeting.id
          and (
            position(lower(trim(p_query)) in lower(minutes.summary)) > 0
            or position(lower(trim(p_query)) in lower(minutes.key_points::text)) > 0
            or position(lower(trim(p_query)) in lower(minutes.decisions::text)) > 0
          )
      )
      or exists (
        select 1 from public.transcripts as transcripts
        where transcripts.meeting_id = meeting.id
          and position(lower(trim(p_query)) in lower(transcripts.segments::text)) > 0
      )
      or exists (
        select 1 from public.action_items as items
        where items.meeting_id = meeting.id
          and (
            position(lower(trim(p_query)) in lower(items.task)) > 0
            or position(lower(trim(p_query)) in lower(items.owner)) > 0
          )
      )
    )
  order by meeting.created_at desc
  limit 50;
$$;

revoke all on function public.search_meetings(text) from public, anon;
grant execute on function public.search_meetings(text) to authenticated;
create policy "Meeting owners or workspace admins delete meetings"
  on public.meetings for delete to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (
      owner_id = (select auth.uid())
      or public.workspace_role(workspace_id) in ('owner', 'admin')
    )
  );

drop policy if exists "Users access transcripts for their meetings" on public.transcripts;
create policy "Workspace members access transcripts"
  on public.transcripts for all to authenticated
  using (exists (
    select 1 from public.meetings meeting
    where meeting.id = transcripts.meeting_id
      and public.is_workspace_member(meeting.workspace_id)
  ))
  with check (exists (
    select 1 from public.meetings meeting
    where meeting.id = transcripts.meeting_id
      and public.is_workspace_member(meeting.workspace_id)
  ));

drop policy if exists "Users access minutes for their meetings" on public.minutes;
create policy "Workspace members access minutes"
  on public.minutes for all to authenticated
  using (exists (
    select 1 from public.meetings meeting
    where meeting.id = minutes.meeting_id
      and public.is_workspace_member(meeting.workspace_id)
  ))
  with check (exists (
    select 1 from public.meetings meeting
    where meeting.id = minutes.meeting_id
      and public.is_workspace_member(meeting.workspace_id)
  ));

drop policy if exists "Users access action items for their meetings" on public.action_items;
create policy "Workspace members access action items"
  on public.action_items for all to authenticated
  using (exists (
    select 1 from public.meetings meeting
    where meeting.id = action_items.meeting_id
      and public.is_workspace_member(meeting.workspace_id)
  ))
  with check (exists (
    select 1 from public.meetings meeting
    where meeting.id = action_items.meeting_id
      and public.is_workspace_member(meeting.workspace_id)
  ));

drop policy if exists "Users upload meeting audio to their own folder" on storage.objects;
drop policy if exists "Users read their own meeting audio" on storage.objects;
drop policy if exists "Users delete their own meeting audio" on storage.objects;
drop policy if exists "Users upload audio for their own uploading meetings" on storage.objects;
drop policy if exists "Users read audio for their own meetings" on storage.objects;
drop policy if exists "Users delete audio for their own meetings" on storage.objects;
create policy "Workspace members upload meeting audio"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'meeting-audio'
    and exists (
      select 1 from public.meetings meeting
      where meeting.storage_path = name
        and meeting.owner_id = (select auth.uid())
        and meeting.status = 'uploading'
        and public.is_workspace_member(meeting.workspace_id)
    )
  );
create policy "Workspace members read meeting audio"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'meeting-audio'
    and exists (
      select 1 from public.meetings meeting
      where meeting.storage_path = name
        and public.is_workspace_member(meeting.workspace_id)
    )
  );
create policy "Workspace members delete meeting audio"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'meeting-audio'
    and exists (
      select 1 from public.meetings meeting
      where meeting.storage_path = name
        and public.is_workspace_member(meeting.workspace_id)
        and (
          meeting.owner_id = (select auth.uid())
          or public.workspace_role(meeting.workspace_id) in ('owner', 'admin')
        )
    )
  );

create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_workspace_count bigint;
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null or char_length(trim(p_name)) not between 1 and 120 then
    raise exception 'Invalid workspace request';
  end if;
  select count(*) into v_workspace_count
  from public.workspace_members where user_id = v_user_id and role = 'owner';
  if v_workspace_count >= 10 then raise exception 'Workspace limit reached'; end if;
  insert into public.workspaces(name, created_by)
  values (trim(p_name), v_user_id)
  returning id into v_workspace_id;
  insert into public.workspace_members(workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'owner');
  insert into public.subscriptions(workspace_id) values (v_workspace_id);
  return v_workspace_id;
end;
$$;

revoke all on function public.create_workspace(text) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  insert into public.workspaces (name, created_by)
  values ('Personal workspace', new.id)
  returning id into v_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, new.id, 'owner');
  insert into public.subscriptions (workspace_id) values (v_workspace_id);
  return new;
end;
$$;

create or replace function public.create_meeting_with_usage(
  p_user_id uuid,
  p_workspace_id uuid,
  p_meeting_id uuid,
  p_title text,
  p_source_type text,
  p_storage_path text,
  p_audio_retention text,
  p_size_bytes bigint,
  p_duration_seconds integer,
  p_max_meetings integer,
  p_max_audio_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := p_user_id;
  v_plan text;
  v_status text;
  v_period_start date := date_trunc('month', now() at time zone 'UTC')::date;
  v_meeting_count bigint;
  v_audio_seconds bigint;
begin
  if v_user_id is null
    or p_title is null or char_length(trim(p_title)) not between 1 and 200
    or p_source_type not in ('recording', 'upload')
    or (p_source_type = 'upload' and p_duration_seconds is not null)
    or (p_source_type = 'recording' and p_duration_seconds is null)
    or p_audio_retention not in ('delete_after_transcription', 'keep')
    or p_size_bytes not between 1 and 104857600
    or (p_duration_seconds is not null and p_duration_seconds not between 1 and 3600)
    or p_max_meetings not between 1 and 1000
    or p_max_audio_seconds not between 1 and 2678400
    or p_storage_path !~ ('^' || v_user_id::text || '/' || p_meeting_id::text || '/[^/]+$')
  then
    raise exception 'Invalid meeting request';
  end if;

  perform 1 from public.workspaces where id = p_workspace_id for update;
  if not found or not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = v_user_id
  ) then
    raise exception 'Workspace access denied';
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = v_user_id and role in ('owner', 'admin', 'member')
  ) then
    raise exception 'Workspace access denied';
  end if;

  select plan, status into v_plan, v_status
  from public.subscriptions where workspace_id = p_workspace_id;
  if v_plan is null then
    raise exception 'Workspace subscription unavailable';
  end if;
  if v_plan <> 'pro' or v_status <> 'active'
    or not exists (
      select 1 from public.subscriptions
      where workspace_id = p_workspace_id and current_period_end > now()
    )
  then
    select count(*) into v_meeting_count
    from public.usage_events
    where workspace_id = p_workspace_id and period_start = v_period_start
      and event_type = 'meeting_created';
    select coalesce(sum(quantity), 0) into v_audio_seconds
    from public.usage_events
    where workspace_id = p_workspace_id and period_start = v_period_start
      and event_type = 'audio_minutes_reserved';
    if v_meeting_count >= p_max_meetings or v_audio_seconds >= p_max_audio_seconds then
      raise exception 'Free plan monthly limit reached';
    end if;
  end if;

  insert into public.meetings(
    id, owner_id, workspace_id, title, status, source_type,
    storage_path, audio_retention, audio_deletion_status, size_bytes, duration_seconds
  ) values (
    p_meeting_id, v_user_id, p_workspace_id, trim(p_title), 'uploading', p_source_type,
    p_storage_path, p_audio_retention, 'not_requested', p_size_bytes, p_duration_seconds
  );
  insert into public.usage_events(workspace_id, meeting_id, event_type, quantity, unit, idempotency_key, period_start)
  values (p_workspace_id, p_meeting_id, 'meeting_created', 1, 'meetings', 'meeting:' || p_meeting_id::text, v_period_start);
end;
$$;

revoke all on function public.create_meeting_with_usage(uuid, uuid, uuid, text, text, text, text, bigint, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.create_meeting_with_usage(uuid, uuid, uuid, text, text, text, text, bigint, integer, integer, integer)
  to service_role;

create or replace function public.reserve_meeting_audio_seconds(
  p_meeting_id uuid,
  p_duration_seconds integer,
  p_max_audio_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_plan text;
  v_status text;
  v_used bigint;
begin
  if p_duration_seconds not between 1 and 3600
    or p_max_audio_seconds not between 1 and 2678400
  then
    raise exception 'Invalid audio duration';
  end if;
  select workspace_id into v_workspace_id
  from public.meetings where id = p_meeting_id and status = 'processing';
  if not found then
    raise exception 'Meeting is not processing';
  end if;
  perform 1 from public.workspaces where id = v_workspace_id for update;
  select plan, status into v_plan, v_status
  from public.subscriptions where workspace_id = v_workspace_id;
  if v_plan <> 'pro' or v_status <> 'active'
    or not exists (
      select 1 from public.subscriptions
      where workspace_id = v_workspace_id and current_period_end > now()
    )
  then
    select coalesce(sum(quantity), 0) into v_used
    from public.usage_events
    where workspace_id = v_workspace_id
      and period_start = (
        select date_trunc('month', created_at at time zone 'UTC')::date
        from public.meetings where id = p_meeting_id
      )
      and event_type = 'audio_minutes_reserved'
      and idempotency_key <> 'audio:' || p_meeting_id::text;
    if v_used + p_duration_seconds > p_max_audio_seconds then
      return false;
    end if;
  end if;

  insert into public.usage_events(workspace_id, meeting_id, event_type, quantity, unit, idempotency_key, period_start)
  values (v_workspace_id, p_meeting_id, 'audio_minutes_reserved', p_duration_seconds, 'seconds',
          'audio:' || p_meeting_id::text,
          (select date_trunc('month', created_at at time zone 'UTC')::date
           from public.meetings where id = p_meeting_id))
  on conflict (idempotency_key) do update
    set quantity = excluded.quantity, period_start = excluded.period_start;
  return true;
end;
$$;

revoke all on function public.reserve_meeting_audio_seconds(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_meeting_audio_seconds(uuid, integer, integer) to service_role;

create or replace function public.accept_workspace_invitation(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email text := lower((select auth.jwt() ->> 'email'));
  v_invitation public.workspace_invitations%rowtype;
begin
  if v_user_id is null or v_email is null then raise exception 'Authentication required'; end if;
  select * into v_invitation from public.workspace_invitations
  where token_hash = p_token_hash and lower(email) = v_email
    and accepted_at is null and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception 'Invitation is invalid or expired'; end if;

  insert into public.workspace_members(workspace_id, user_id, role)
  values (v_invitation.workspace_id, v_user_id, v_invitation.role)
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invitations set accepted_at = now()
  where id = v_invitation.id;
  return v_invitation.workspace_id;
end;
$$;

revoke all on function public.accept_workspace_invitation(text) from public, anon;
grant execute on function public.accept_workspace_invitation(text) to authenticated;

create or replace function public.apply_paystack_payment(
  p_reference text,
  p_amount_minor bigint,
  p_currency text,
  p_provider_customer_id text,
  p_provider_subscription_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_transaction public.billing_transactions%rowtype;
  v_inserted integer;
begin
  if p_reference is null or length(p_reference) not between 1 and 200
    or p_amount_minor <= 0 or p_currency !~ '^[A-Z]{3}$'
  then
    raise exception 'Invalid payment details';
  end if;

  select * into v_transaction
  from public.billing_transactions
  where reference = p_reference
  for update;
  if found then
    if v_transaction.status = 'paid' then return false; end if;
    if p_provider_subscription_id is null then
      raise exception 'Recurring subscription details are missing';
    end if;
    if v_transaction.expires_at <= now()
      or v_transaction.amount_minor <> p_amount_minor
      or v_transaction.currency <> p_currency
    then
      raise exception 'Payment does not match a valid checkout';
    end if;
    v_workspace_id := v_transaction.workspace_id;
    update public.billing_transactions set status = 'paid' where reference = p_reference;
  else
    if p_provider_subscription_id is null then
      raise exception 'Payment does not match a valid checkout';
    end if;
    select workspace_id into v_workspace_id
    from public.subscriptions
    where provider_subscription_id = p_provider_subscription_id
      and amount_minor = p_amount_minor
      and currency = p_currency
    for update;
    if not found then raise exception 'Payment does not match an active subscription'; end if;
    insert into public.billing_transactions(
      reference, workspace_id, amount_minor, currency, status, expires_at
    ) values (
      p_reference, v_workspace_id, p_amount_minor, p_currency, 'paid', now() + interval '1 day'
    ) on conflict (reference) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then return false; end if;
  end if;

  update public.subscriptions
  set plan = 'pro',
      status = 'active',
      provider_reference = p_reference,
      provider_customer_id = coalesce(p_provider_customer_id, provider_customer_id),
      provider_subscription_id = coalesce(p_provider_subscription_id, provider_subscription_id),
      amount_minor = p_amount_minor,
      currency = p_currency,
      current_period_start = case
        when current_period_end > now() then current_period_end
        else now()
      end,
      current_period_end = case
        when current_period_end > now() then current_period_end + interval '1 month'
        else now() + interval '1 month'
      end,
      updated_at = now()
  where workspace_id = v_workspace_id;

  if not found then raise exception 'Workspace subscription unavailable'; end if;
  return true;
end;
$$;

revoke all on function public.apply_paystack_payment(text, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_paystack_payment(text, bigint, text, text, text) to service_role;
