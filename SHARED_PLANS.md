# A plan published as a page

Local `feat/forks`, 2026-11-15, not deployed. `src/routes/sharedRoutes.js`.

The owner of a graph publishes one plan; anyone with its link reads it and
ticks its steps for themselves, with no account.

| | Route | Token |
|---|---|---|
| Publish, or publish again | `POST /api/graphs/:graphId/shares` `{ nodeId }` → `{ slug, publishedAt }` | yes |
| List a graph's pages | `GET /api/graphs/:graphId/shares` → `{ shares: [{ nodeId, slug, title, publishedAt }] }` | yes |
| Take down | `DELETE /api/shares/:slug` | yes |
| Read the page | `GET /shared/:slug` → `{ slug, title, publishedAt, nodes, edges }` | **no** |

`/shared` is mounted outside `/api`, so `requireUser` never sees it.

## What is stored

| Key | Holds |
|---|---|
| `shared:<slug>` | the copy that is served |
| `shared:<slug>:owner` | `{ userId, graphId, nodeId }` — never served |
| `user:<userId>:shares` | a hash, `<graphId>:<nodeId>` → slug |

None matches `user:*:graph:*`: graph scans (the census, the habit counter,
`remove-kata`) pass them by. `scripts/redis-backup.js` copies every key, so a
backup holds them too.

## What the copy is

The plan's node with everything inside it, and the arrows between those
nodes — nothing of the rest of the graph. It is the plan as nobody has walked
it: no tick, no time, no count, no option taken at a fork. It carries the
fields the app draws and nothing else (`publishedCopy`), and nothing that
says whose it is.

It is a copy, not a view: what the owner changes later shows when they
publish again, under the same slug. A reader's own ticks never come here;
the page keeps them in the reader's browser.

A slug is 12 characters of base64url — 72 random bits. An address of any
other shape is answered 404 before a key is built from it. A plan of more
than 500 nodes is refused (413). Publishing reads the stored graph through
`readGraph`, not `getGraph`, whose NodeIndex belongs to the operation queue.

## Not there

A rate limit on the public read; an expiry; a page that follows its plan;
anything that keeps a reader's progress on the server.
