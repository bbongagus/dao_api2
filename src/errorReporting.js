/**
 * Errors to Sentry — and nothing a person wrote.
 *
 * Off unless SENTRY_DSN is set. Errors only: tracing in ESM needs
 * `node --import`, which would change the start command railway.json pins.
 * Request bodies, headers and console breadcrumbs carry node titles, so they
 * never leave. See docs/superpowers/specs/2026-09-18-telemetry-design.md.
 */
import * as Sentry from '@sentry/node';

export function scrubEvent(event) {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
  }
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.filter((crumb) => crumb.category !== 'console');
  }
  return event;
}

export function initErrorReporting(env = process.env, sdk = Sentry) {
  if (!env.SENTRY_DSN) return false;
  sdk.init({
    dsn: env.SENTRY_DSN,
    environment: env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || 'development',
    release: env.RAILWAY_GIT_COMMIT_SHA,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: (crumb) => (crumb.category === 'console' ? null : crumb),
  });
  return true;
}

export function reportError(error, sdk = Sentry) {
  if (!(error instanceof Error) || !sdk.isInitialized()) return;
  sdk.captureException(error);
}

/** After the routes: whatever escapes them. Routes that answer 500 themselves report through logger.error. */
export function attachExpressErrorHandler(app, sdk = Sentry) {
  if (sdk.isInitialized()) sdk.setupExpressErrorHandler(app);
}
