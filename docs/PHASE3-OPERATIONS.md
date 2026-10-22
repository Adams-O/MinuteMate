# Phase 3 operations

## Supabase migration

Apply `202610230003_phase3_workspaces_billing.sql` after the Phase 1 and Phase 2 migrations. It backfills existing accounts into personal workspaces, assigns their meetings, and records historical usage. Apply first to a non-production project and verify the resulting rows, RLS behavior, workspace membership, and private Storage access before production rollout.

The database enforces configurable free-plan caps transactionally through server-only RPCs. `FREE_PLAN_MAX_MEETINGS` and `FREE_PLAN_MAX_AUDIO_SECONDS` default to 3 and 5,400, respectively; whichever limit is reached first applies for the UTC calendar month. Meetings are charged to the month in which they were created, including audio reservations processed after the month boundary. Workspace access and invitation acceptance are checked in database functions; service-role access remains server-only.

## Paystack setup

Configure these server-side environment values:

- `PAYSTACK_SECRET_KEY`: Paystack secret key. The webhook signature is HMAC-SHA512 over the exact raw request body using this key.
- `PAYSTACK_PLAN_CODE`: Paystack monthly recurring plan code.
- `PAYSTACK_AMOUNT_MINOR`: the plan amount in the smallest currency unit, matching the configured Paystack plan.
- `PAYSTACK_CURRENCY`: ISO 4217 code, for example `NGN`.
- `NEXT_PUBLIC_APP_URL`: the canonical HTTPS origin for the application.

Set the Paystack webhook URL to `/api/webhooks/paystack`. Checkout creates a server-only pending intent tied to the authenticated workspace before returning the authorization URL. The handler rejects invalid signatures, ignores other signed event types, and re-verifies `charge.success` references with Paystack before changing subscription state. The initial successful payment must include a recurring subscription code, and renewal payments must match a subscription code already stored for that workspace. Transaction references are unique in the database, so duplicate deliveries do not extend the paid period twice.

Use Paystack test keys and a monthly test plan first. Verify checkout authentication and the callback, successful and failed charges, incorrect amount/currency, malformed/invalid signatures, duplicate webhook delivery, and recurring renewal events. Confirm the webhook payload includes a workspace identifier for the initial payment and a subscription code for renewals. Do not enable live billing until the configured plan, amount, currency, and renewal payload have been confirmed in the Paystack dashboard.

## Workspace and invite checks

Test account signup creates a personal workspace. Verify that a member can read shared meeting data but cannot invite members, change billing, or delete another member's meeting. Verify that owners/admins can invite, invitations expire after seven days, acceptance requires the invited email, and invalid/revoked/duplicate invitations are rejected. Confirm invitation tokens are only stored as SHA-256 hashes and are removed from the browser URL before submission.

## Outstanding deployment checks

The migration has not been applied against a live PostgreSQL/Supabase project in this repository session. Before release, validate it against the deployed schema and Supabase Storage policies in a disposable project, then perform the provider-backed Paystack tests above.
