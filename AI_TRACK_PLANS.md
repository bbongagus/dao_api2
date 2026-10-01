# Connected Track plans

Implementation, 2026-10-01. Corrects Decision 039's
weekly-Group interpretation. The requested result is one visible level inside
one enclosing plan Group:
Track → tasks → Milestone → next stage's tasks → … → final Milestone.
Parallel article chains and a real finite checklist join each stage outcome.

`plan_path` accepts `layout: "track"`, `sequence`, and `existing` aliases on
stages, steps and checklist objects. `sequence: true` compiles stage order into
actual prerequisites, respecting the user's chosen progression. For other
DAGs, `after` is used and exactly one final outcome is required. The old group
layout remains for explicit containment and legacy callers; it cannot silently
consume existing-reference objects. `checklistCount` must equal the number of
provided items. Existing completed items can be moved into a new checklist.

An existing Group stays the container. Its Track, tasks and Milestones sit
together inside it, keeping ids/completion dates. An existing inner Track is
reused; a root-level Track gets one enclosing Group. Repeated edits do not add
more wrappers or Tracks. Every piece of work in
the old area must be accounted for. Unconnected, unmarked organizational Group
nested wrappers are removed only after contents move. Reuse maps are validated before
staging; duplicate references, lost work, incompatible kinds, incorrect counts,
missing dependencies and cycles are refused without modifying the old draft.
External links across the selected scope are conservatively refused, rather
than silently severed. Existing connected Group wrappers are not auto-deleted.

The compiler emits only existing frontend operation types. Its Track contract
is checked against the final draft: one-level structure, expected links,
checklist items without their own arrows, and retained completed work. Subsequent
tool edits cannot silently break that contract. This checks the supplied plan,
not whether every natural-language request was understood; live-model evals
remain necessary. `inspect_draft` displays validation failures to the agent.

Any turn stopped by iteration/token/context limits with staged changes returns
`incomplete_plan` as an error, without operations. No Apply is offered for a
partial restructure. The existing execution budget and explicit confirmation
remain. Group additions earlier in a turn can now be used by `plan_path`.

Frontend preflight now removes deleted wrappers from its simulated parent map,
so bottom-up deletion of nested empty wrappers does not falsely report contents.
It still refuses completed/connected nodes and parents with remaining children.

## Verification

- Node 22 backend: 495 passed, 15 Redis-dependent skipped; final agent-only
  check 38 passed after adding rejection-of-damaged-Track coverage.
- Frontend: 798 tests / 91 suites; production build passed (existing chunk-size warning).
- Actual frontend store applies the generated synthetic proposal, preserving
  ticks/dates, with four seven-item checklists and a reachable flat path.
- Local browser renders/applies it with no page errors. Screenshot:
  `/private/tmp/dao-track-canvas.png` (ephemeral local artifact).
- `eval-track-rework.js --live`: opt-in paid model evaluation, synthetic graph
  only, no Redis imports or graph writes. Two live runs passed structural checks
  with 9 and 8 model calls. First revealed that the compiler's start-now list
  included completed profile tasks; corrected, and the second suggested only
  unfinished comments. Combined reported usage was about $0.0092.
- Evaluations use the configured model through Railway's injected environment;
  no credentials are printed and no `.env` file is read. Output stays in
  `/private/tmp/dao-track-live-eval*.json` and is not committed.

Deploy the frontend empty-wrapper preflight fix before this backend.
Deployment verification is recorded in the workspace release log. The user's existing production graph
has not been repaired or rewritten by this implementation.

Opening a Track through inspect now follows its connected path, including
checklist contents, so a later edit can read the flat graph without opening
every node individually. Pagination and stable aliases still apply.

## Containment and geometry correction (local, 2026-10-01)

The earlier release incorrectly converted the outer Group to a root-level
Track. The compiler and final contract now retain one enclosing Group.
Canvas layout packs non-overlapping branch spans into reusable display rows,
including outgoing arrow spans. Logical branch ranking used by the phone path
is unchanged. Stage chains no longer accumulate rows down the canvas.

Regression coverage includes new plans, grouped rework, wrapping an existing
root Track, repeated edits by Track or Group, completion retention, frontend
application, non-overlap and layout idempotence. Local browser application
passed. On a read-only saved copy of the owner's graph the bounding height
fell from 4675 to 1588 pixels, with identical coordinates on the second tidy.
Final checks: backend 498 passed / 15 Redis-dependent skipped; frontend 799
passed / 91 suites, production build passed (existing chunk-size warning).
No production graph writes or deployment in this correction.
