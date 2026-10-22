# Phase 1 Operations

## Required configuration

Set separate values for local development, preview, and production. Never reuse production credentials in preview.

- `NEXT_PUBLIC_APP_URL`: the exact public origin for this environment.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the environment's Supabase project.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase service-role key.
- `ASSEMBLYAI_API_KEY`: server-only AssemblyAI API key.
- `ASSEMBLYAI_WEBHOOK_SECRET`: a high-entropy random value used as AssemblyAI's configured webhook authentication header.
- `ANTHROPIC_API_KEY`: server-only Anthropic API key.
- `CLAUDE_MODEL`: a currently supported Claude model identifier.
- `CRON_SECRET`: a high-entropy secret used to authorize the durable transcription-event worker.

Generate unique secrets outside the application, for example with a cryptographically secure random generator. Do not use the safe placeholders in `.env.example` as credentials.

## Supabase setup

1. Apply all migrations in `supabase/migrations` to the intended project.
2. Confirm that `meeting-audio` exists and is private. The migration creates or updates its private bucket configuration and owner-scoped Storage policies.
3. Confirm Row Level Security is enabled on all Phase 1 tables and that an authenticated user cannot read or mutate another user's meeting or child data.
4. Enable Realtime for `public.meetings`; authorization remains governed by the meeting's owner-only RLS policy.
5. Enable email authentication. For Google sign-in, configure the Google OAuth client and Supabase provider, then allow `<NEXT_PUBLIC_APP_URL>/auth/callback` in Supabase's redirect URL settings.

## AssemblyAI webhook authentication

MinuteMate supplies `/api/webhooks/assemblyai?meetingId=<uuid>` as each transcription's callback URL and sets `webhook_auth_header_name` and `webhook_auth_header_value`. The callback checks this shared secret using a constant-time comparison, validates the event schema and meeting/job association, then stores only the minimal callback fields in a private database queue.

AssemblyAI's documented pre-recorded audio webhook mechanism is a custom authentication header, not a cryptographic signature over the raw body. Do not describe this mechanism as HMAC/signature verification. If raw-body cryptographic signatures become a strict requirement, use a provider or trusted gateway that supports them.

## Durable processing schedule

The Vercel Cron configuration invokes `/api/cron/process-transcription-events` every minute. Vercel must support that schedule and the route's 120-second maximum execution duration. Vercel sends `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is configured.

The upload-completion route also uses a 120-second maximum because it inspects media before submitting a transcription job. Confirm the deployment plan supports both route durations. Configure the cron request with an `Authorization: Bearer <secret>` header.

The worker currently processes one queued event per invocation. With the included one-minute schedule, its maximum drain rate is one event per minute; use a scalable queue/worker before onboarding workloads that can exceed that rate.

If using a different scheduler, invoke the same route with the bearer secret. Keep the secret private, use HTTPS, and alert on sustained non-2xx responses. Queue entries use leases, bounded retries, and safe failure codes so interrupted processing can be retried without exposing transcript content.

## Production checks before accepting real meetings

- Verify the production callback URL is reachable from AssemblyAI and the configured webhook header is secret and unique to the environment.
- Exercise duplicate callback delivery and confirm only one transcript/minutes result is committed.
- Upload valid MP3, WAV, M4A, and MP4 media; also test a renamed/mismatched file, a zero-byte file, a file over 100 MB, and a recording over 60 minutes.
- Confirm upload authorization is short-lived, scoped to one object, and cannot be used to access other users' storage paths.
- Test audio retention for both choices, including a simulated Storage deletion failure followed by retry.
- Verify a failed provider/model/database request reports a safe failure state and does not emit transcript, audio, signed URL, or credential data to logs.
