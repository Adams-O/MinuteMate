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
  select m.id, m.title, m.status, m.created_at
  from public.meetings as m
  where m.owner_id = (select auth.uid())
    and length(trim(p_query)) between 2 and 100
    and (
      position(lower(trim(p_query)) in lower(m.title)) > 0
      or exists (
        select 1
        from public.minutes as minutes
        where minutes.meeting_id = m.id
          and (
            position(lower(trim(p_query)) in lower(minutes.summary)) > 0
            or position(lower(trim(p_query)) in lower(minutes.key_points::text)) > 0
            or position(lower(trim(p_query)) in lower(minutes.decisions::text)) > 0
          )
      )
      or exists (
        select 1
        from public.transcripts as transcripts
        where transcripts.meeting_id = m.id
          and position(lower(trim(p_query)) in lower(transcripts.segments::text)) > 0
      )
      or exists (
        select 1
        from public.action_items as items
        where items.meeting_id = m.id
          and (
            position(lower(trim(p_query)) in lower(items.task)) > 0
            or position(lower(trim(p_query)) in lower(items.owner)) > 0
          )
      )
    )
  order by m.created_at desc
  limit 50;
$$;

revoke all on function public.search_meetings(text) from public, anon;
grant execute on function public.search_meetings(text) to authenticated;
