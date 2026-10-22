import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentry";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.05,
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
});
