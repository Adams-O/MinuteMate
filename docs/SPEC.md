# MinuteMate Product Specification

## 1. Product Overview

MinuteMate is a privacy-conscious SaaS web application that records or accepts uploaded meetings, transcribes them asynchronously, and produces useful meeting minutes and action items. The initial release serves an individual user; later phases add collaboration, billing, and production operations.

### Product goals

- Make it easy to capture a meeting or upload an existing recording.
- Produce accurate, source-grounded transcripts, summaries, decisions, and follow-up tasks.
- Keep meeting audio and derived data private and accessible only to authorized users.
- Make processing status and failures understandable without requiring users to wait on a long-running request.

### Non-goals for Phase 1

- Real-time transcription during recording.
- Collaborative editing, billing, workspace invitations, and public sharing.
- Automatic calendar or conferencing integrations.
- AI-generated facts that are not supported by the transcript.

## 2. Users and Core Workflows

### Phase 1 user

An authenticated person who owns their meetings and can record, upload, review, and delete them.

### Core workflows

1. Create an account or sign in with email or Google.
2. Start a browser recording after acknowledging the participant-consent notice; pause, resume, stop, and see elapsed time.
3. Alternatively, upload an MP3, WAV, M4A, or MP4 file within the configured duration and size limits.
4. See the meeting move through `uploading`, `processing`, and `ready`, or reach `failed` with a clear recovery path.
5. Review the generated summary, transcript, and action items on separate meeting-page tabs.
6. Choose whether to retain audio; by default, delete it after transcription has completed successfully.
7. Delete a meeting and its associated data.

## 3. Functional Requirements by Phase

### Phase 1: Core

- Authentication: sign up, sign in, sign out, and protected application routes using Supabase Auth with email and Google providers.
- Capture: browser recording with start, pause/resume, stop, elapsed-time display, and explicit consent acknowledgement before recording begins. The UI must clearly tell users to obtain consent from all participants.
- Upload: accept `mp3`, `wav`, `m4a`, and `mp4`; enforce a maximum duration of 60 minutes and a maximum file size of 100 MB. Validate actual file metadata/content where practical; do not trust the filename or client-provided MIME type alone.
- Storage: upload directly from the browser to a private Supabase Storage bucket using a short-lived, narrowly scoped authorization mechanism. Never make the bucket public. Limit signed URL lifetime and scope.
- Processing: create a meeting record and start AssemblyAI transcription asynchronously. The user-facing request must not wait for transcription to finish. Process AssemblyAI webhook callbacks only after verifying their signature and associating the callback with the expected meeting/job.
- Transcription: request speaker labels and store timestamped segments and speaker identifiers/names. Handle duplicate callbacks idempotently and represent processing failures on the meeting.
- Minutes: send transcript content to Claude from server-side code only. Require structured JSON matching a runtime schema. Use the model name from a server-side environment variable. The AI may use only transcript evidence; unspecified owners and deadlines must be exactly `Not stated`. Never invent attendees, figures, or decisions. Validate generated JSON and retry once if invalid; if the retry is invalid, fail the generation step safely and expose a useful, non-sensitive error.
- Meeting detail: provide Summary, Transcript, and Action Items tabs. Display processing state and actionable failure states.
- Live status: use Supabase Realtime for meeting status updates, with authorization constrained to the owning user.
- Retention: delete source audio after successful transcription by default. Offer an explicit user choice to keep it. Retention preference and deletion outcome must be reflected in the data model and processing workflow.
- Privacy controls: allow an owner to delete a meeting and associated audio, transcript, minutes, and action items.

### Phase 2: Collaboration

- Edit meeting title and generated minute fields; edit action item task, owner, deadline, priority, and status.
- Rename speakers consistently in the transcript and related views.
- Search meetings by title and supported text fields while enforcing ownership and workspace access.
- Export minutes/action items as PDF and Word documents.
- Email minutes to attendees through Resend after user confirmation. Validate recipients and avoid exposing meeting content in logs.
- Create secure share links with explicit expiry, revocation, and least-privilege access. Do not expose private storage URLs as share links.

### Phase 3: Business

- Add workspaces, membership, invitations, and role-based permissions.
- Add free and paid plans. Initial configurable example free allowance: 3 meetings or 90 audio minutes per billing month. Define whether either limit is reached first and enforce it server-side.
- Add Paystack checkout and verified, idempotent payment webhooks.
- Track usage through usage events and show plan, usage, and billing state in a billing page.
- Keep plan limits, pricing identifiers, and provider secrets in configuration, not client code.

### Phase 4: Production Hardening

- Add Upstash rate limiting to abuse-sensitive routes and operations.
- Add Sentry error reporting with scrubbing so transcripts, audio, credentials, and personal data are not sent as event payloads.
- Publish privacy policy, terms, and cookie pages.
- Implement account deletion that removes or schedules deletion of all user data across database, storage, and connected processing systems; communicate completion/failure clearly.
- Implement user data export.
- Audit RLS policies for every table and add tests for allowed and denied access.
- Add unit and integration tests, including API route tests.
- Add GitHub Actions for lint, type-check, and tests.
- Add `.env.example`, `DEPLOYMENT.md`, error pages, accessibility and mobile checks, and basic privacy-conscious analytics.

## 4. Data Model

All tables use UUID primary keys unless a provider requires a different identifier. Include `created_at` and `updated_at` where relevant. Use foreign keys, indexes, constraints, and deletion behavior deliberately. Every table has Row Level Security enabled; policies are deny-by-default and tested.

### `profiles`

- `id`: UUID, primary key and reference to `auth.users.id`.
- `display_name`: nullable text.
- `created_at`, `updated_at`.

### `workspaces`

- `id`: UUID primary key.
- `name`: required text.
- `created_by`: profile/user UUID.
- `created_at`, `updated_at`.

### `workspace_members`

- `id`: UUID primary key.
- `workspace_id`: foreign key to `workspaces`.
- `user_id`: foreign key to `profiles`.
- `role`: constrained role such as `owner`, `admin`, or `member`.
- Unique constraint on (`workspace_id`, `user_id`).
- `created_at`.

### `meetings`

- `id`: UUID primary key.
- `owner_id`: foreign key to `profiles`.
- `workspace_id`: nullable foreign key to `workspaces` for later phases.
- `title`: required text with a safe default.
- `status`: constrained to `uploading`, `processing`, `ready`, or `failed`.
- `source_type`: constrained to recording or upload.
- `storage_path`: private object path, not a public URL.
- `audio_retention`: constrained preference such as `delete_after_transcription` or `keep`.
- `duration_seconds`, `size_bytes`: nullable validated numeric values.
- `transcription_job_id`: nullable provider job reference; do not treat it as a secret.
- `failure_code`: safe machine-readable code; do not store raw provider responses or sensitive data.
- `created_at`, `updated_at`, `completed_at`.

### `transcripts`

- `id`: UUID primary key.
- `meeting_id`: unique foreign key to `meetings`.
- `segments`: JSONB array validated on write. Each segment contains start/end timestamps, text, and a nullable speaker identifier/label.
- `language`: nullable language code.
- `created_at`, `updated_at`.

### `minutes`

- `id`: UUID primary key.
- `meeting_id`: unique foreign key to `meetings`.
- `summary`: text.
- `key_points`: JSONB array of strings.
- `decisions`: JSONB array of strings.
- `created_at`, `updated_at`.

### `action_items`

- `id`: UUID primary key.
- `meeting_id`: foreign key to `meetings`.
- `task`: required text.
- `owner`: required text; use exactly `Not stated` when the transcript does not identify an owner.
- `deadline`: required text; use exactly `Not stated` when the transcript does not state a deadline. Preserve a stated value rather than inferring one.
- `priority`: constrained enum/value set, nullable or explicitly unknown when not supported by transcript evidence.
- `status`: constrained to `open`, `in_progress`, or `done` (final labels may be refined in Phase 2).
- `created_at`, `updated_at`.

### `subscriptions`

- `id`: UUID primary key.
- `workspace_id` or `user_id`: subscription subject, constrained so the intended owner is explicit.
- `provider`: payment provider identifier.
- `provider_customer_id`, `provider_subscription_id`: nullable provider references with appropriate uniqueness.
- `plan`, `status`, `current_period_start`, `current_period_end`: validated billing state.
- `created_at`, `updated_at`.

### `usage_events`

- `id`: UUID primary key.
- `workspace_id` or `user_id`: usage subject, consistent with subscription ownership.
- `meeting_id`: nullable foreign key.
- `event_type`: constrained event name.
- `quantity`: non-negative numeric amount and `unit` (for example meetings or seconds).
- `idempotency_key`: unique provider/request key where applicable.
- `created_at`.

### Data integrity and access rules

- Every migration that creates a table enables RLS in the same migration and adds explicit policies.
- A user can read and mutate only records they own or are authorized to access through workspace membership. Phase 1 may use owner-only policies; later phases extend them through membership and role checks.
- Child records must be authorized through their parent meeting/workspace, not by trusting a client-supplied owner ID.
- Use transactions or reliable job state transitions to avoid partially visible processing results.
- Keep provider webhook identifiers and idempotency constraints to prevent duplicate processing and billing effects.

## 5. Architecture

### Application

- Next.js App Router with TypeScript strict mode and Tailwind CSS.
- Server Components by default; client components only for interactive capture, upload, realtime status, and editing workflows.
- Route Handlers/server-side modules own privileged operations, provider API calls, signed upload authorization, and webhook processing.
- Validate request bodies, query parameters, file metadata, provider callbacks, and model output at runtime with Zod (or an agreed equivalent only when documented).
- Return typed, minimal errors. Never return stack traces, secrets, provider payloads, or transcript content in error messages.

### Supabase

- Supabase Postgres is the system of record; schema changes are versioned SQL migrations.
- Supabase Auth provides email and Google authentication.
- Supabase Storage contains private audio objects; access is mediated by short-lived signed URLs or equivalent scoped policies.
- Supabase Realtime publishes only authorized meeting status changes.
- The service-role key is server-only and must never be used in browser code. Prefer user-scoped database access under RLS; isolate narrowly scoped service-role operations on the server.

### Asynchronous transcription and generation

1. The authenticated server validates the request, creates a meeting, and authorizes a bounded direct upload to private storage.
2. After upload confirmation and metadata checks, the server creates an AssemblyAI transcription job and records its provider ID. Requests return promptly with the meeting ID/status.
3. AssemblyAI calls a dedicated webhook endpoint. The endpoint verifies the provider signature using the raw request body and configured secret, validates the event, checks the expected job/meeting association, and handles duplicate delivery idempotently.
4. On successful transcription, persist validated timestamped segments and speaker labels. Delete source audio when the user's retention setting requires it.
5. Generate minutes from the transcript using Claude from server-side code. Validate structured output; retry once on schema-invalid output. Do not include unrelated user data in the prompt.
6. Mark the meeting ready only after required transcript and minutes data have been stored. On unrecoverable errors, mark it failed with a safe code and preserve enough state for supported retry/recovery.

Webhook endpoints must return promptly after safely recording/dispatching work where necessary. If provider limits or platform execution limits make processing inline unreliable, use a durable job/queue mechanism. Do not assume an in-memory background task will survive serverless execution.

### External services and hosting

- AssemblyAI: speech-to-text with speaker labels and signed webhook verification.
- Claude API: transcript-grounded structured minutes; model selected by server environment configuration.
- Resend: transactional emails in collaboration phase.
- Paystack: checkout and verified payment webhooks in business phase.
- Upstash: rate limiting in production-hardening phase.
- Sentry: error monitoring with sensitive-data scrubbing in production-hardening phase.
- Vercel: application hosting; configure environment variables per deployment environment.
- GitHub Actions: lint, type-check, and tests in production-hardening phase.

## 6. Security, Privacy, and Reliability Requirements

- Never commit secrets. Provider API keys, Supabase service-role key, webhook secrets, and model configuration are server-side environment variables only. Public Supabase configuration may be exposed only where intended by Supabase's client model and must still be protected by RLS.
- All private media remains in a private bucket. Signed URLs are short-lived, scoped, and never persisted as durable identifiers.
- Verify every incoming webhook: signature, timestamp/replay protections when supported, event schema, resource association, and idempotency.
- Validate all user and provider input at trust boundaries. Enforce upload size, format, duration, and authorization on the server as well as in the UI.
- Do not log audio, transcripts, minutes, action item text, authentication tokens, signed URLs, or personal data. Scrub error monitoring and analytics payloads.
- Ask users to obtain participant consent before recording and present the notice before capture starts.
- Apply least privilege and RLS to every table. Test cross-user and cross-workspace denial, including nested records, Realtime subscriptions, and storage access.
- Use secure cookies/session handling, CSRF protections where applicable, content security controls, and safe output rendering.
- Make deletion and retention behavior explicit, retryable, and observable without retaining sensitive payloads in logs.
- Add rate limits and abuse controls before broad production launch.
- Meet accessibility expectations for keyboard use, labels, focus states, contrast, and screen-reader status announcements; support mobile layouts.

## 7. Configuration and Operations

Maintain an `.env.example` containing variable names and safe placeholders only. Expected server configuration includes Supabase URL/public client key as appropriate, Supabase service-role key, AssemblyAI API and webhook secrets, Claude API key and model name, Resend API key, Paystack credentials/webhook secret, Upstash credentials, and Sentry DSN. Exact names are defined during implementation and documented without values.

Provide deployment documentation for migrations, auth provider setup, private bucket/policies, provider webhook URLs, environment configuration, and production checks. Separate development, preview, and production credentials and callback URLs.

## 8. Acceptance Criteria and Phase Gates

Each phase is implemented and reviewed independently. At the end of a phase, provide a concise list of implemented behavior, tests run, and specific manual checks to perform; then wait for explicit user approval before starting the next phase.

### Phase 1 exit checks

- Email and Google authentication work; unauthorized users cannot read another user's meetings.
- Recording requires consent acknowledgement and supports start, pause/resume, stop, and timer behavior.
- Supported uploads enforce 100 MB and 60-minute limits and use private storage.
- Upload/processing requests return without waiting for transcription completion.
- Invalid webhook signatures are rejected; valid and duplicate events are handled safely.
- Transcript segments preserve timestamps and speaker labels; audio is deleted or retained according to the selected preference.
- AI output passes schema validation, follows transcript-only rules, uses `Not stated` for absent owners/deadlines, and retries invalid JSON at most once.
- Meeting tabs render expected data, and authorized Realtime updates change status.
- Meeting deletion removes or reliably schedules deletion of all associated data and audio.
- API route tests cover validation, authorization, success, failure, and relevant webhook paths.

### Phase 2 exit checks

- Edits persist with authorization; speaker renames are consistent; action statuses update.
- Search, PDF/Word export, email sending, and expiring/revocable share links work without bypassing access controls.

### Phase 3 exit checks

- Workspace membership/invitations enforce roles; usage limits are enforced server-side.
- Paystack checkout and verified webhooks are idempotent; billing and usage views reflect persisted state.

### Phase 4 exit checks

- RLS tests cover every table and cross-tenant denial; unit/integration/API tests pass.
- CI runs lint, type-check, and tests; deployment docs and environment template are complete.
- Account deletion and data export cover database and storage; privacy/legal pages, error handling, rate limiting, monitoring, accessibility, mobile, and analytics receive documented checks.