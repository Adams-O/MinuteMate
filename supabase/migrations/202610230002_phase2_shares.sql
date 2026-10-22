create table public.meeting_shares (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index meeting_shares_meeting_id_idx on public.meeting_shares (meeting_id, created_at desc);
create index meeting_shares_expiry_idx on public.meeting_shares (expires_at) where revoked_at is null;

alter table public.meeting_shares enable row level security;
revoke all on table public.meeting_shares from public, anon, authenticated;
