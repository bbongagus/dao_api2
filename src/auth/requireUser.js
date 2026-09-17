/**
 * Every /api route runs behind this: the user is the one the bearer token
 * proves, or the request stops with 401 — or with 503 while the token cannot
 * be checked at all.
 */

import { logger } from '../utils/logger.js';
import { VerifierUnavailableError } from './verifyToken.js';

export function createRequireUser(verifyToken, log = logger) {
  return async function requireUser(req, res, next) {
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization || '');

    let userId;
    try {
      if (!match) throw new Error('no bearer token');
      ({ userId } = await verifyToken(match[1]));
    } catch (error) {
      // Nothing is known against the token; a 401 would send the person to
      // sign in again for an outage that is not theirs.
      if (error instanceof VerifierUnavailableError) {
        log.error(`${req.method} ${req.originalUrl} could not be checked: ${error.message}`);
        return res.status(503).json({ error: 'unavailable' });
      }

      // Which check failed is for the log; telling the caller helps only
      // someone shaping a forged token. The token itself is never logged.
      log.warn(`${req.method} ${req.originalUrl} refused: ${error.message}`);
      return res.status(401).json({ error: 'unauthorized' });
    }

    req.userId = userId;
    next();
  };
}
