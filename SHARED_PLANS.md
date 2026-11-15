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
| `shared:<slug>` | the page, as the very text that is served |
| `shared:<slug>:owner` | `{ userId, graphId, nodeId, title, publishedAt }` — never served; what the list reads |
| `user:<userId>:shares` | a hash, the plan → slug. The field is `<length of graphId>:<graphId>:<nodeId>`, so graph `a` + node `b:c` and graph `a:b` + node `c` are two plans |

None matches `user:*:graph:*`: graph scans (the census, the habit counter,
`remove-kata`) pass them by. `scripts/redis-backup.js` copies every key, so a
backup holds them too.

Publishing takes its turn in the graph's operation queue, so the copy is the
graph between two operations and two publishes of one plan cannot both find
it unpublished. The owner's record is written first: a page never stands
where nobody can take it down.

## What the copy is

The plan's node with everything inside it, and the arrows between those
nodes — nothing of the rest of the graph. It is the plan as nobody has walked
it: no tick, no time, no count, no option taken at a fork. It carries the
fields the app draws and nothing else (`publishedCopy`), and nothing that
says whose it is. A fork is served with names only for the options it has —
the steps its arrows lead to inside the plan: the node keeps a name for every
option it ever had, a step since deleted included, and none of that is the
page's to show.

It is a copy, not a view: what the owner changes later shows when they
publish again, under the same slug. A reader's own ticks never come here;
the page keeps them in the reader's browser.

A slug is 12 characters of base64url — 72 random bits. An address of any
other shape is answered 404 before a key is built from it. Publishing reads
the stored graph through `readGraph`, not `getGraph`, whose NodeIndex belongs
to the operation queue.

## Bounds

The read is free to anyone, so what an account can store here a stranger can
make the server fetch and send. A page is refused (413) beyond 500 nodes —
counted as they are walked, so two that share an id are two — 2,000 arrows,
or 512 KB as served; an account holds up to 50 pages (409). The page is
served as stored, with nothing parsed, and `Cache-Control: private,
max-age=30`: a page taken down must not live on in a cache between the
server and its reader.

## Not there

A rate limit on the public read (it needs the client's address, and so
`trust proxy` set for Railway); an expiry; a page that follows its plan;
anything that keeps a reader's progress on the server.

`test-auth-isolation.js` holds the live checks: publishing, listing and
taking down without the owner's token, and what the page serves.
