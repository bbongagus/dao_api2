/**
 * Every /api route runs behind this: the user is the one the bearer token
 * proves, or the request stops with 401.
 */

import { logger } from '../utils/logger.js';

export function createRequireUser(verifyToken, log = logger) {
  return async function requireUser(req, res, next) {
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization || '');

    let userId;
    try {
      if (!match) throw new Error('no bearer token');
      ({ userId } = await verifyToken(match[1]));
    } catch (error) {
      // Which check failed is for the log; telling the caller helps only
      // someone shaping a forged token. The token itself is never logged.
      log.warn(`${req.method} ${req.originalUrl} refused: ${error.message}`);
      return res.status(401).json({ error: 'unauthorized' });
    }

    req.userId = userId;
    next();
  };
}
