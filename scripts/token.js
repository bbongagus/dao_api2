/**
 * Print a token a local server will accept, for one user.
 *
 * Usage: npm run token -- <userId> [--days N]      (default 30 days)
 *        npm run -s token -- dev-user-1 --days 365  (-s: the token alone, for pasting)
 */

import { devTokenFromEnv } from '../src/auth/devToken.js';

const [userId, flag, value] = process.argv.slice(2);
const days = flag === undefined ? 30 : Number(value);

if (!userId || (flag !== undefined && (flag !== '--days' || !(days > 0)))) {
  console.error('Usage: npm run token -- <userId> [--days N]');
  process.exit(1);
}

try {
  console.log(await devTokenFromEnv(userId, { expiresInSeconds: Math.round(days * 86400) }));
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}
