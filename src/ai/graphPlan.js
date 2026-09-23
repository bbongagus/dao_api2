/**
 * How the graph reads, in words a model can follow.
 *
 * The agent's system prompt (agentPrompt.js) teaches this. It was once shared
 * with the one-shot plan generator behind /api/ai/generate-plan, which is gone.
 */

export const GRAPH_SEMANTICS = `## How the graph reads

Left to right by dependency: what a node waits for sits to its left. An arrow
means "this cannot start before that is done" - not "this usually comes
later". If a step waits for another - the visa for the certificate, the
decree for the interview - there is an arrow between them, whichever part of
the graph each sits in. A dependency written only in a description is a
mistake: the graph then shows as possible now something that is not. An
arrow where there is no dependency is the same mistake the other way round:
it hides work that could start now.

## The kinds, and what progress each one reports

- dao/simple - a concrete task. Progress is 0 or 1: done or not.
- dao/withChildren - a step with a checklist inside. Progress is the share of
  the checklist done.
  Something to be done several times is still one task: put the count in
  its description ("12 runs over four weeks").
- fundamental/upstream (Mi) - closes a stage. Progress is the work since the
  previous Mi: it walks left and stops at the previous Mi, or at a Kai,
  without counting either.
- fundamental/downstream (Kai) - everything reachable to its right. It walks
  through every Mi and Kai on the way and counts what lies beyond them too.
- fundamental/category (Ryu) - a section. It averages the Mi and Kai inside
  it, plus any task none of them counts.

## Rules that follow from how progress is computed

An aggregate averages its dependencies **without weighting them**. One task
and a ten-task branch hanging off the same parent count the same. So keep the
stages of one plan comparable in size - if one needs ten steps and another
one, give the detail of the big one a checklist, or split it.

A chain counts every node in it. If a milestone points at A, and A points at
B, and B at C, the milestone averages over A, B and C - not just A.

Stages that follow each other are closed by a Mi each, and the next stage's
first steps hang off that Mi. Each Mi then reports its own stage, and the
section reports the average of the stages.

A Kai counts everything to its right, so keep it for a direction that depends
on nothing else and that nothing else depends on. Never run a Kai into
another stage or point it at another Kai: it would count that work too.

## Descriptions

Every node carries a description as well as a title. The title is what the
person scans; the description is what they read when they open the node and
have forgotten why it is there.

One to three sentences. Say why the node exists, what counts as done, and any
concrete detail that will not fit in a title - a number, a threshold, an order
of operations, a thing to watch out for. When you planned from a source the
person linked, this is where its specifics belong: the timings, quantities and
conditions the page gave. Do not restate the title, and do not pad. A step with a checklist
says what counts as done, or what to watch out for; it does not list the
checklist again.

Because the detail has a home, keep titles short.

## Positions

A node is 180 wide and 60 tall. Put 380 between the x of one column and the
next, and 160 between the y of one row and the next, so nothing overlaps.
Start at x 0. Centre a parent vertically against the rows it points at.
`;
