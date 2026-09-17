/**
 * Whom the server believes about who is asking.
 *
 * A request never names its own user: the user is the `sub` of a token signed
 * by the one issuer this process trusts. In production that is the Auth0
 * tenant; anywhere else, a key pair made by `npm run auth:dev-keys`. With
 * neither configured the server does not start — there is no mode in which a
 * header or a message field is taken at its word.
 */

export const DEV_ISSUER = 'dao-dev';

export function readAuthConfig(env) {
  const domain = env.AUTH0_DOMAIN?.trim();
  const devKey = env.AUTH_DEV_PUBLIC_KEY?.trim();
  const audience = env.AUTH_AUDIENCE?.trim();

  if (!audience) throw new Error('AUTH_AUDIENCE is not set — run npm run auth:dev-keys locally, or set it on Railway');
  if (domain && devKey) throw new Error('Set AUTH0_DOMAIN or AUTH_DEV_PUBLIC_KEY, not both');
  if (!domain && !devKey) {
    throw new Error('Set AUTH0_DOMAIN (production) or AUTH_DEV_PUBLIC_KEY (npm run auth:dev-keys)');
  }

  if (domain) {
    const host = domain.replace(/^https:\/\//, '').replace(/\/+$/, '');
    return {
      issuer: `https://${host}/`,
      audience,
      jwksUrl: `https://${host}/.well-known/jwks.json`,
    };
  }

  // A dev key signs whatever its holder likes; production trusts Auth0 only.
  if (env.NODE_ENV === 'production') {
    throw new Error('AUTH_DEV_PUBLIC_KEY is refused under NODE_ENV=production');
  }

  let publicJwk;
  try {
    publicJwk = JSON.parse(devKey);
  } catch {
    throw new Error('AUTH_DEV_PUBLIC_KEY is not a JSON JWK');
  }

  // The server holds the public half only. The private half signs tokens on a
  // developer's machine, and a server that had it could sign them too.
  if (publicJwk?.kty !== 'RSA' || !publicJwk.n || !publicJwk.e || 'd' in publicJwk) {
    throw new Error('AUTH_DEV_PUBLIC_KEY must be the public half of an RSA key');
  }

  return { issuer: DEV_ISSUER, audience, publicJwk };
}
