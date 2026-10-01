import { checkAvailability } from '../src/ops/availability.js';
try {
  const status = await checkAvailability({ healthUrl: process.env.PUBLIC_HEALTH_URL, siteUrl: process.env.PUBLIC_SITE_URL });
  console.log(`API: ${status.api ? 'available' : 'unavailable'}; site: ${status.site ? 'available' : 'unavailable'}`);
  if (!status.api || !status.site) process.exitCode = 1;
} catch { console.error('Availability check failed; verify public monitor URLs.'); process.exitCode = 1; }
