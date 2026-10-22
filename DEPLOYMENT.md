# Deployment and Operations

MinuteMate is not ready for live users until the service operator has configured provider accounts, reviewed the draft legal pages, and completed the post-deployment checks below. Applying these migrations to a live Supabase project and exercising real provider webhooks remain explicit launch tasks; local tests do not prove live RLS, billing, or webhook behavior.

## Required configuration

Copy `.env.example` to `.env.local` for local work. Use the hosting provider's encrypted environment-variable store for production, preview, and development. Never commit real values.

- **App:** `NEXT_PUBLIC_APP_URL` must be the canonical HTTPS origin in production.
- **Supabase:** configure the project URL, publishable/anon key, and server-only service-role key. Set the production and preview redirect URLs in Supabase Auth. Enable only the email and Google providers you intend to support.
- **AssemblyAI:** configure the API key and webhook authentication secret. The configured header secret must match the provider's webhook settings. Configure the webhook URL to the deployed AssemblyAI route and allow outbound media access from the provider.
- **Claude:** configure the Anthropic API key and an explicitly supported model identifier in `CLAUDE_MODEL`.
- **Resend:** verify the sending domain and sender address before enabling meeting email.
- **Paystack:** use test-mode credentials first. Configure the plan code, amount, currency, webhook URL, and the same secret key used to verify callback signatures. Verify real test-mode webhook payloads before switching live.
- **Upstash:** production requires the HTTPS REST URL and token. Rate-limited operations intentionally fail closed with a sanitized `503` if Upstash is unavailable or unconfigured. Local/test environments may run without Upstash; production must not.
- **Sentry:** configure the server DSN and public client DSN. Sentry is initialized with `sendDefaultPii: false` and event scrubbing; verify redaction in a test project before enabling production alerts.
- **Vercel:** configure all server variables in the intended environment scopes. Never expose the service-role key or provider API keys with a `NEXT_PUBLIC_` prefix.

## Database and storage setup

1. Create a Supabase project and take a backup before applying migrations to any existing database.
2. Apply all migrations in `supabase/migrations/` in order using the Supabase CLI or the project's migration workflow.
3. Confirm that the `meeting-audio` bucket is private, the configured maximum size is 100 MB, and only the declared content types are allowed.
4. Ensure the `meetings` table is in the `supabase_realtime` publication.
5. Run `supabase test db` against the local Supabase stack and review every RLS test result.
6. On staging, run the application security checklist below with two distinct accounts and workspaces. Do not treat `service_role` access as an RLS test.
7. Verify account deletion with a multi-member workspace and a personal workspace. Confirm storage objects are gone and remaining members retain the workspace.

## Local commands

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
supabase start
supabase test db
supabase stop
```

Set all required application integrations to test credentials before exercising external-service routes. Unit tests mock provider boundaries and do not require live credentials.

## Webhook setup and verification

- Set the AssemblyAI webhook callback URL and configured authentication header to match `ASSEMBLYAI_WEBHOOK_SECRET`. Confirm a bad header is rejected, a valid event is queued, duplicates do not repeat processing, and a completed event produces the expected meeting state.
- Set Paystack's webhook URL to `/api/webhooks/paystack`. Test valid and invalid signatures, provider-side transaction verification, duplicate references, and non-success events. The handler must not trust the event body alone for a paid state.
- Keep webhook secrets separate across local, staging, and production. Rotate provider secrets immediately if exposed.

## Launch checklist

- [ ] Review and complete the Privacy, Terms, and Cookies pages with qualified counsel and accurate business contact details.
- [ ] Verify recording consent is visible and required before the browser requests microphone access.
- [ ] Verify signed upload and download links expire and are scoped; verify the storage bucket is not public.
- [ ] Verify a user cannot read, edit, share, or delete another workspace's meeting or related content.
- [ ] Verify account export contains only the requesting user's authorized data and that retained audio links expire after five minutes.
- [ ] Verify deletion removes owned audio and account records and safely transfers workspaces with other members.
- [ ] Verify Upstash is configured and throttling returns `429` with `Retry-After`; force an Upstash outage and confirm sensitive operations fail closed.
- [ ] Trigger a Sentry test event and confirm it contains no request URL/headers, user identity, transcript, audio, minutes, or action-item content.
- [ ] Test email, Google sign-in, password reset/confirmation, recording/upload, transcript processing, Resend, Paystack, and webhooks using staging accounts and test credentials.
- [ ] Test keyboard-only interaction, visible focus, screen-reader labels/statuses, reduced-motion expectations, narrow mobile layouts, and mobile recording controls.
- [ ] Configure monitoring, backups, retention periods, incident response, support, and provider data-processing settings.

## Known operational limits

- Account export is a JSON download of the requesting user's visible profile, workspaces, membership, meeting content, usage, and subscription data. It is capped at 5,000 meetings and 50 MiB; an export over the response limit requires support-assisted handling.
- Retained audio links embedded in the export are temporary and expire in five minutes.
- Error events are intentionally scrubbed, so diagnose failures using safe event IDs/digests and operational metadata rather than meeting content.
- Aggregate analytics contains only UTC daily meeting-created and meeting-ready counts.
- Privacy, Terms, and Cookies pages are implementation templates and are not legal advice.
