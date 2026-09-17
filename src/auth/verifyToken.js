/**
 * One check for every way in: HTTP requests and WebSocket subscriptions both
 * learn who is asking here, and only here.
 */

import { createRemoteJWKSet, importJWK, jwtVerify } from 'jose';

/** Any token that does not prove a user. The message is for the log, never for the client. */
export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * The token could not be checked at all: Auth0's key set timed out, could not
 * be fetched, or came back malformed. The caller answers "try again later",
 * not "sign in again".
 */
export class VerifierUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VerifierUnavailableError';
  }
}

export function createTokenVerifier({ issuer, audience, jwksUrl, publicJwk }) {
  // Auth0's key set is fetched on first use, cached, and fetched again when a
  // token names a key it has not seen — which is how a key rotation lands.
  const key = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : importJWK(publicJwk, 'RS256');

  return async function verifyToken(token) {
    if (typeof token !== 'string' || token === '') throw new AuthError('no token');

    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwksUrl ? key : await key, {
        algorithms: ['RS256'],
        issuer,
        audience,
        // jose accepts a token without these unless told they are required.
        requiredClaims: ['exp', 'sub'],
      }));
    } catch (error) {
      // A key set Auth0 cannot serve right now says nothing about the token.
      // Refused, the person would be sent to sign in, signed straight back in,
      // and refused again.
      if (keySetUnavailable(error)) throw new VerifierUnavailableError(error.code || error.message);
      throw new AuthError(error.code || error.message);
    }

    // The user id becomes part of every Redis key, where ':' separates the parts.
    if (typeof payload.sub !== 'string' || payload.sub === '' || payload.sub.includes(':')) {
      throw new AuthError('unusable sub');
    }

    return { userId: payload.sub };
  };
}

// Every verdict jose reaches about a token carries one of these codes. A key set
// that could not be reached at all — a refused connection, a DNS failure — fails
// with none.
const JOSE_CODE = /^ERR_(JOSE|JWT|JWS|JWK|JWKS|JWE)_/;

// The codes that say the key set, not the token, is the problem.
// `ERR_JOSE_GENERIC` is jose's unspecified error, and jose raises it in exactly
// two places, both while fetching the key set: a response that is not 200, and
// one that does not parse as JSON. Auth0 answering 502, or a proxy serving a
// maintenance page, arrives here.
const KEY_SET_CODE = new Set(['ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID', 'ERR_JOSE_GENERIC']);

function keySetUnavailable(error) {
  if (KEY_SET_CODE.has(error.code)) return true;
  return !JOSE_CODE.test(error.code ?? '');
}
