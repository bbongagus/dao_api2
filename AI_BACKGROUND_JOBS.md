# Background chat replies

Modern `/api/ai/chat` requests carry a UUID `requestId`, a `chatId` and optional
`displayText`. Before running the agent, the server writes an account-scoped
Redis job. HTTP/SSE closure detaches the viewer; it does not cancel that job.
Legacy requests without requestId keep their original stream cancellation
behavior. Deploy backend before frontend.

- `GET /api/ai/turns/latest?graphId=main`: latest unacknowledged job for this
  authenticated account and graph, or null.
- `GET /api/ai/turns/:id`: running status or finished result for the owner.
- `POST /api/ai/turns/:id/stop`: explicit cancellation, idempotent.
- `POST /api/ai/turns/:id/ack`: receipt after apply/discard or leaving the chat
  for a new conversation. A browser receipt prevents re-offering a consumed
  proposal after a lost acknowledgement.

Redis keys `ai:job`, `ai:active`, `ai:latest` encode account IDs. Jobs, results
and request context expire after 24 hours; these hold private conversation
content and must never enter telemetry. Creation and the per-user lease are
atomic. Repeating the same request ID reads the existing job, not another
model call. Other accounts cannot read or cancel it. Quota checks still apply;
usage is charged even after viewer disconnection, including loop guard exits.

A job has an eight-minute execution deadline and a ten-second heartbeat. Stop
uses both the local controller and a Redis cancellation marker. The agent
remains in the API process: this is **not** a durable worker that restarts an
interrupted model computation. A job whose worker disappeared is reported as
interrupted after 45 seconds without a heartbeat; it is never silently rerun
and billed again. Completed results survive a deploy while Redis retains them.
Nothing applies graph operations on the server's behalf; the user still
reviews and applies the proposal in the editor. Recovered proposals should
be reviewed against the current graph. Confirming the same proposal at the
same instant from different devices is not an atomic graph transaction.

The agent permits one draft reset. An empty reset tells it to repair the tool
arguments; a second reset request stops the loop before executing more tools
or making another provider call. `plan_path` already replaces a prior valid
plan atomically where no other staged edits reference it. This guard prevents
a reset loop; it is not evidence that the reported user's exact prompt now
produces a good plan (that prompt has not been provided).

Validation: route tests cover detach/reconnect/idempotence, ownership, Stop,
quota/concurrency through the original tests and stale workers; frontend tests
cover polling, detach vs Stop, account changes and lost receipts. A local
Chromium scenario uses real HTTP/WebSocket handlers and an isolated empty
Redis, with a controllable fake agent: hide, close tab, return without another
turn, recover a completed proposal across reload, explicit Apply, then Stop.
No paid model requests or production user data were used.
