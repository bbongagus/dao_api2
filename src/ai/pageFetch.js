/**
 * Reading a page someone pasted, from our own server.
 *
 * The address comes from whoever is typing, and the server sits inside
 * Railway's private network next to Redis — so a fetch that follows the
 * address wherever it leads is a way in (SSRF). Every connection is allowed
 * only to a public unicast address, and the check is made on the address the
 * socket actually connects to, inside the DNS lookup of that very connection:
 * a name that resolves somewhere public for a check and somewhere private for
 * the connect (DNS rebinding) is caught, and so is every hop of a redirect,
 * each of which opens its own connection.
 *
 * An IP literal never goes through DNS, so it is checked before the request.
 * `new URL()` has already turned 0x7f.1, 2130706433 and 0177.0.0.1 into
 * dotted form by then.
 *
 * `fetch` comes from the undici package, not the global one: the global fetch
 * bundles its own undici and refuses an Agent from another version.
 */

import dns from 'node:dns';
import net from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch } from 'undici';
import { parseHTML } from 'linkedom';
import { Defuddle } from 'defuddle/node';

const MAX_REDIRECTS = 5;
const PAGE_TYPES = new Set(['text/html', 'application/xhtml+xml', 'text/plain']);

export class BlockedAddressError extends Error {
  constructor(address) {
    super(`refusing to connect to ${address}: not a public address`);
    this.name = 'BlockedAddressError';
  }
}

/**
 * True only for a public unicast address. Everything else is refused:
 * loopback, private and carrier-grade NAT ranges, link-local (the cloud
 * metadata address among them), unique-local IPv6 (Railway's own network),
 * multicast, and IPv4 dressed up as IPv6.
 */
export function isPublicAddress(ip) {
  try {
    return ipaddr.process(ip).range() === 'unicast';
  } catch {
    return false;
  }
}

/** Plain text of a page: the article when one can be found, the body otherwise. */
async function readable(markup, url) {
  const { document } = parseHTML(markup);
  // useAsync false: some of defuddle's extractors call third-party APIs
  // (YouTube, Reddit, X) on their own, and nothing leaves here but the fetch.
  const result = await Defuddle(document, url, { markdown: true, useAsync: false });
  const markdown = (result.content || '').trim() || (document.body?.textContent || '').trim();
  // A link's address is tokens the brief is billed for and never uses.
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  return { title: result.title || document.title || '', text };
}

function decoderFor(contentType) {
  const charset = /charset=([^;]+)/i.exec(contentType || '')?.[1]?.trim();
  try {
    return new TextDecoder(charset || 'utf-8');
  } catch {
    return new TextDecoder('utf-8');
  }
}

/** The first BlockedAddressError in an error's chain of causes. */
function blockedCause(error) {
  for (let e = error; e; e = e.cause) {
    if (e instanceof BlockedAddressError) return e;
  }
  return null;
}

/**
 * @param {object} [options]
 * @param {(ip: string) => boolean} [options.isAllowedAddress] tests only; the
 *        default lets through public addresses and nothing else.
 * @param {number} [options.maxBytes] read no more of a response than this.
 * @param {number} [options.maxChars] hand on no more text than this — about
 *        16k tokens by default, the ceiling the old server-side fetch had.
 * @param {number} [options.timeoutMs] for the whole fetch, redirects included.
 * @returns {(address: string, opts?: { signal?: AbortSignal }) =>
 *           Promise<{ url: string, title: string, text: string }>}
 */
export function createPageFetcher({
  isAllowedAddress = isPublicAddress,
  maxBytes = 2_000_000,
  maxChars = 40_000,
  timeoutMs = 15_000,
} = {}) {
  const dispatcher = new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    connect: {
      lookup(hostname, options, callback) {
        dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
          if (error) return callback(error);
          const refused = addresses.find((a) => !isAllowedAddress(a.address));
          if (refused) return callback(new BlockedAddressError(refused.address));
          if (options.all) return callback(null, addresses);
          return callback(null, addresses[0].address, addresses[0].family);
        });
      },
    },
  });

  return async function fetchPage(address, { signal } = {}) {
    const deadline = AbortSignal.timeout(timeoutMs);
    const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let url = new URL(address);

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`only http and https pages can be read, not ${url.protocol}`);
      }
      if (url.username || url.password) throw new Error('an address with credentials in it is not read');

      const host = url.hostname.replace(/^\[|\]$/g, '');
      if (net.isIP(host) && !isAllowedAddress(host)) throw new BlockedAddressError(host);

      let response;
      try {
        response = await fetch(url, {
          dispatcher,
          redirect: 'manual',
          signal: abort,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; DAO-link-reader/1.0)',
            Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
          },
        });
      } catch (error) {
        throw blockedCause(error) || error;
      }

      const location = response.status >= 300 && response.status < 400 && response.headers.get('location');
      if (location) {
        await response.body?.cancel();
        url = new URL(location, url);
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      const type = contentType.split(';')[0].trim().toLowerCase();
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`the page answered ${response.status}`);
      }
      if (!PAGE_TYPES.has(type)) {
        await response.body?.cancel();
        throw new Error(`not a page that can be read: ${type || 'no content type'}`);
      }

      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        const room = maxBytes - size;
        chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
        size += Math.min(chunk.length, room);
        if (size >= maxBytes) break;
      }
      const body = decoderFor(contentType).decode(Buffer.concat(chunks));

      const page = type === 'text/plain' ? { title: '', text: body.trim() } : await readable(body, url.href);
      return { url: url.href, title: page.title, text: page.text.slice(0, maxChars) };
    }

    throw new Error(`more than ${MAX_REDIRECTS} redirects`);
  };
}

export default createPageFetcher;
