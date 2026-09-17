# Authentication

Every request to `/api` and every WebSocket subscription proves its user with
a JWT signed RS256. The user id is the token's `sub` and nothing else: no
header, no field in a message, no default user.

## Whom the server trusts

`src/auth/config.js` reads exactly one issuer from the environment, and the
server refuses to start with none, with both, or with a dev key under
`NODE_ENV=production`.

| Where | Variables | Issuer |
|---|---|---|
| Production (Railway) | `AUTH0_DOMAIN`, `AUTH_AUDIENCE` | `https://<domain>/`, keys from its JWKS |
| Locally | `AUTH_DEV_PUBLIC_KEY`, `AUTH_AUDIENCE`, from `npm run auth:dev-keys` | `dao-dev` |

A token must carry `exp` and `sub` (`jose` accepts a token without them unless
told otherwise). A `sub` containing `:` is refused: `:` separates the parts of
a Redis key.

## HTTP

`requireUser` runs before every `/api` route and wants
`Authorization: Bearer <token>`; anything else is `401 {"error":"unauthorized"}`.
Which check failed goes to the log; the token never does. `/health` is open.

## WebSocket

```json
{ "type": "SUBSCRIBE", "graphId": "main", "token": "<jwt>" }
```

A refused token gets `{"type":"AUTH_ERROR"}` and a close with code 4401, and
nothing is read. `OPERATION` and `SYNC` are refused until a subscription has
succeeded. An open socket is not checked again when its token expires; a
reconnect brings a fresh one.

## Locally

```bash
npm run auth:dev-keys                                   # once: a key pair in .env
npm run -s token -- dev-user-1 --days 365               # graphy/.env.local: VITE_DEV_TOKEN=<this>
node --env-file=.env scripts/ws-graph-check.js ws://localhost:3011 dev-user-1
node --env-file=.env test-auth-isolation.js http://localhost:3011
```

The server reads only the public key. Scripts sign with the private one through
`devTokenFromEnv` (`src/auth/devToken.js`), which the server never imports.

To rehearse the real sign-in: `AUTH0_DOMAIN` in place of the dev key in `.env`,
and `VITE_AUTH0_ENABLED=true` with `VITE_AUTH0_AUDIENCE` in `graphy/.env.local`.
Auth0 allows `http://localhost:3002` as a callback.

## Data from before

Graphs saved under Auth0 ids (`google-oauth2|…`, `auth0|…`) belong to whoever
signs in with that account. `dev-user-1` and `1` are no longer reachable
through the app; nothing was migrated or deleted.
