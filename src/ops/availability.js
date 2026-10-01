/** No response bodies, tokens, URLs or user data go into monitor logs. */
export async function checkAvailability({ healthUrl, siteUrl, fetcher = fetch }) {
  for (const value of [healthUrl, siteUrl]) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Monitor needs public HTTPS URLs without credentials or query strings');
  }
  const outcomes = await Promise.allSettled([
    (async () => {
      const reply = await fetcher(healthUrl, { signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!reply.ok) return false;
      const body = await reply.json();
      return body.status === 'healthy' && body.redis === true;
    })(),
    (async () => {
      const reply = await fetcher(siteUrl, { signal: AbortSignal.timeout(10000), redirect: 'error' });
      return reply.ok && /<div\s+id=["']root["']/.test(await reply.text());
    })(),
  ]);
  return { api: outcomes[0].status === 'fulfilled' && outcomes[0].value === true,
    site: outcomes[1].status === 'fulfilled' && outcomes[1].value === true };
}
