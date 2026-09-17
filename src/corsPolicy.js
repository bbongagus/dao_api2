/**
 * Which sites the browser may call this API from.
 *
 * `app.use(cors())` allowed every origin on the internet, and the
 * `CORS_ORIGINS` variable that was supposed to narrow it had been declared in
 * `.env.example` and never read. Every request still has to carry a bearer
 * token, so this was never the only lock on the door — but it is the one that
 * keeps another site from making a signed-in person's browser act for it.
 */

/** Vercel gives every preview deployment of the frontend a fresh hostname. */
const PREVIEW = /^https:\/\/graphy-[a-z0-9]+-bbongagus-projects\.vercel\.app$/;

const FALLBACK = [
  'https://graphy-one.vercel.app',  // production
  PREVIEW,
  'http://localhost:3002',          // the dev frontend
  'http://localhost:3000',
];

/**
 * @param {object} env normally `process.env`.
 * @returns {(string|RegExp)[]} `CORS_ORIGINS` when it is set — comma separated,
 *   and then exact, with no preview pattern implied — otherwise the places this
 *   app is actually served from.
 */
export function allowedOrigins(env = process.env) {
  const configured = (env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  return configured.length > 0 ? configured : [...FALLBACK];
}

/**
 * @param {string|undefined} origin — absent for curl, a health check, or any
 *   server-to-server call. Those are allowed: CORS protects browsers.
 */
export function isOriginAllowed(origin, list = allowedOrigins()) {
  if (!origin) return true;
  return list.some((allowed) => (allowed instanceof RegExp ? allowed.test(origin) : allowed === origin));
}

/** Options for the `cors` middleware. */
export function corsOptions(env = process.env) {
  const list = allowedOrigins(env);
  return {
    origin: (origin, callback) => callback(null, isOriginAllowed(origin, list)),
  };
}
