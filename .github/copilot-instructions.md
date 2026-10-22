# Repository Coding Instructions

## TypeScript and application structure

- Use TypeScript strict mode. Do not weaken strict compiler options to work around a type error.
- Keep components small and focused. Prefer Server Components; use Client Components only when browser interactivity is required.
- Follow the existing Next.js App Router and Tailwind conventions. Avoid unrelated refactors and unnecessary abstractions.
- Keep privileged operations, provider SDKs, secrets, and service-role Supabase access in server-only modules. Never expose secrets or privileged clients to browser code.

## Validation and errors

- Validate all untrusted input at the boundary with Zod: API bodies, query parameters, form submissions, uploaded-file metadata, webhooks, and external/model output.
- Treat client validation as a usability aid, not a security boundary. Repeat authorization, limits, and validation on the server.
- Return clear, stable, non-sensitive errors. Do not expose stack traces, raw provider responses, credentials, or private meeting content.
- Make webhook and retried operations idempotent where duplicate delivery is possible; verify signatures before processing.

## Security and privacy

- Never put secrets in source code, committed configuration, tests, fixtures, or logs. Use documented environment variables and safe placeholders in `.env.example`.
- Keep meeting storage private and use short-lived, scoped signed URLs. Enforce access through Supabase RLS on every table and test denied access paths.
- Do not log audio, transcripts, minutes, action-item text, signed URLs, tokens, or personal data. Scrub monitoring events.
- Obtain explicit recording-consent acknowledgement before starting capture. Do not infer facts that are absent from a transcript.

## Testing and quality

- Add or update tests for every API route, covering relevant validation, authorization, success, and error behavior. Webhook routes also require signature and duplicate-delivery coverage.
- Add focused unit/integration tests for meaningful behavior changes, especially RLS, storage access, asynchronous processing, and AI output validation.
- Run the relevant tests and lint/type-check commands before considering a change complete; report any checks that could not be run.
- Keep tests deterministic. Mock external providers at the boundary and never require live credentials for the normal test suite.

## Change hygiene

- Use conventional commit messages, for example `feat: add meeting upload` or `fix: verify transcription webhook`.
- Keep changes scoped to the requested phase and preserve existing user changes.
- Update documentation and `.env.example` when configuration, setup, or operational behavior changes.
- Never commit secrets, real user data, audio, or generated personal data.