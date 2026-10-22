import type { Event } from "@sentry/nextjs";

export function scrubSentryEvent<T extends Event>(event: T): T {
  event.message = undefined;
  event.request = undefined;
  event.user = undefined;
  event.extra = undefined;
  event.contexts = undefined;
  event.breadcrumbs = [];
  event.tags = undefined;
  event.fingerprint = undefined;
  event.transaction = undefined;
  event.spans = undefined;
  event.logentry = undefined;
  for (const exception of event.exception?.values ?? []) {
    exception.value = "[redacted]";
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars;
      delete frame.context_line;
      delete frame.pre_context;
      delete frame.post_context;
    }
  }
  return event;
}
