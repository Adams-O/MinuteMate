begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(32);

select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'profiles has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.workspaces'::regclass), 'workspaces has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.workspace_members'::regclass), 'workspace_members has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.workspace_invitations'::regclass), 'workspace_invitations has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.meetings'::regclass), 'meetings has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.transcripts'::regclass), 'transcripts has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.minutes'::regclass), 'minutes has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.action_items'::regclass), 'action_items has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.subscriptions'::regclass), 'subscriptions has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.usage_events'::regclass), 'usage_events has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.billing_transactions'::regclass), 'billing_transactions has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.meeting_shares'::regclass), 'meeting_shares has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.assemblyai_webhook_events'::regclass), 'assemblyai_webhook_events has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.analytics_daily_events'::regclass), 'analytics_daily_events has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'storage.objects'::regclass), 'storage objects have RLS enabled');
select ok(exists (
  select 1 from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'Workspace members read meeting audio'
), 'private audio policy scopes reads to workspace members');

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'rls-owner@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'rls-other@example.test');

insert into public.meetings (id, owner_id, workspace_id, title, source_type, storage_path, size_bytes)
select
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  member.workspace_id,
  'RLS fixture meeting',
  'upload',
  '11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/audio.wav',
  10
from public.workspace_members member
where member.user_id = '11111111-1111-4111-8111-111111111111'
  and member.role = 'owner';

insert into public.transcripts (meeting_id, segments)
values ('33333333-3333-4333-8333-333333333333', '[]'::jsonb);
insert into public.minutes (meeting_id, summary)
values ('33333333-3333-4333-8333-333333333333', 'RLS fixture');
insert into public.action_items (meeting_id, task)
values ('33333333-3333-4333-8333-333333333333', 'RLS fixture');
insert into public.assemblyai_webhook_events (meeting_id, transcription_job_id, event_status)
values ('33333333-3333-4333-8333-333333333333', 'rls-fixture-job', 'completed');
insert into public.meeting_shares (meeting_id, token_hash, expires_at)
values ('33333333-3333-4333-8333-333333333333', repeat('a', 64), now() + interval '1 hour');
insert into public.workspace_invitations (
  workspace_id, email, role, token_hash, expires_at, created_by
)
select member.workspace_id, 'rls-invite@example.test', 'member', repeat('b', 64), now() + interval '1 hour',
  '11111111-1111-4111-8111-111111111111'
from public.workspace_members member
where member.user_id = '11111111-1111-4111-8111-111111111111'
  and member.role = 'owner';
insert into public.usage_events (
  workspace_id, meeting_id, event_type, quantity, unit, idempotency_key, period_start
)
select member.workspace_id, '33333333-3333-4333-8333-333333333333',
  'meeting_created', 1, 'meetings', 'rls-fixture-usage', date_trunc('month', now())::date
from public.workspace_members member
where member.user_id = '11111111-1111-4111-8111-111111111111'
  and member.role = 'owner';
insert into public.billing_transactions (
  reference, workspace_id, amount_minor, currency, created_by, expires_at
)
select 'rls-fixture-payment', member.workspace_id, 100, 'NGN',
  '11111111-1111-4111-8111-111111111111', now() + interval '1 hour'
from public.workspace_members member
where member.user_id = '11111111-1111-4111-8111-111111111111'
  and member.role = 'owner';

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
set local role authenticated;

select is((select count(*)::int from public.profiles where id = '22222222-2222-4222-8222-222222222222'), 1, 'can read own profile');
select is((select count(*)::int from public.workspace_members where user_id = '22222222-2222-4222-8222-222222222222'), 1, 'can read own workspace membership');
select is((select count(*)::int from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 0, 'cannot read another profile');
select is((select count(*)::int from public.workspaces workspace join public.workspace_members member on member.workspace_id = workspace.id where member.user_id = '11111111-1111-4111-8111-111111111111'), 0, 'cannot read another workspace');
select is((select count(*)::int from public.workspace_members where user_id = '11111111-1111-4111-8111-111111111111'), 0, 'cannot read another membership');
select is((select count(*)::int from public.workspace_invitations where token_hash = repeat('b', 64)), 0, 'cannot read another workspace invitation');
select is((select count(*)::int from public.meetings where id = '33333333-3333-4333-8333-333333333333'), 0, 'cannot read another workspace meeting');
select is((select count(*)::int from public.transcripts where meeting_id = '33333333-3333-4333-8333-333333333333'), 0, 'cannot read another workspace transcript');
select is((select count(*)::int from public.minutes where meeting_id = '33333333-3333-4333-8333-333333333333'), 0, 'cannot read another workspace minutes');
select is((select count(*)::int from public.action_items where meeting_id = '33333333-3333-4333-8333-333333333333'), 0, 'cannot read another workspace action items');
select is((select count(*)::int from public.subscriptions subscription join public.workspace_members member on member.workspace_id = subscription.workspace_id where member.user_id = '11111111-1111-4111-8111-111111111111'), 0, 'cannot read another workspace subscription');
select is((select count(*)::int from public.usage_events where idempotency_key = 'rls-fixture-usage'), 0, 'cannot read another workspace usage');
select is((select count(*)::int from public.billing_transactions where reference = 'rls-fixture-payment'), 0, 'cannot read another workspace billing transaction');
select is((select count(*)::int from public.assemblyai_webhook_events where transcription_job_id = 'rls-fixture-job'), 0, 'cannot read private webhook jobs');
select ok(not has_table_privilege('authenticated', 'public.meeting_shares', 'select'), 'authenticated users cannot query share tokens');
select ok(not has_table_privilege('authenticated', 'public.analytics_daily_events', 'select'), 'authenticated users cannot query aggregate analytics');

select * from finish();
rollback;
