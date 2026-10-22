# Phase 2 Operations

## Configuration and migrations

- Configure `RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL` for each environment. Both values are server-only.
- Apply all migrations in `supabase/migrations`, including the Phase 2 search and share-link migrations.
- Verify `meeting_shares` has RLS enabled and no grants or policies for `anon` or `authenticated`; share management and resolution use narrowly scoped server handlers after owner checks.
- The public share view exposes only the meeting title, summary, key points, decisions, and action items. It never returns transcript segments or audio paths.

## Share-link lifecycle

- Links use 256 bits of random token entropy. Store only the SHA-256 token hash; the plaintext link is returned once at creation and placed in the URL fragment, which is not sent in the initial HTTP request.
- Expiry is explicit and limited to 1 hour through 30 days. Revocation takes effect on the next request.
- Do not put share URLs in analytics, application logs, or third-party referrers. The viewer removes the fragment from browser history before submitting the token in a bounded, no-store request body. The public share page is marked `noindex` and sets `no-referrer`.
- Treat the share URL as a bearer credential. Anyone who obtains it can read the shared minutes until it expires or is revoked.

## Email and exports

- The owner enters recipients and confirms the send in the UI. The server independently validates the confirmation and every unique address, checks ownership, and sends only minutes/action items through Resend; additional recipients are placed in BCC.
- Do not log addresses, meeting content, Resend request payloads, or provider responses.
- PDF and Word downloads are private, owner-authorized, non-cacheable attachments. They contain minutes and action items, not the transcript or audio.

## Before enabling Phase 2 in production

- Verify the Resend sender domain and send a test message to multiple controlled addresses; confirm addresses are not exposed to one another.
- Apply the migrations to a test Supabase project and verify search results and share links cannot cross owner boundaries.
- Create, expire, and revoke share links; confirm revoked/expired links fail and links never expose transcript/audio or allow mutation.
- Download and open both PDF and Word exports with accented text.
- Test edits to title, minutes, action items, action status, and speaker names; confirm a different account cannot edit or export the meeting.
