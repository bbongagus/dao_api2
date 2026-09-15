/**
 * The contract between Claude and the graph editor.
 *
 * The frontend already knows how to apply a plan (see addPlanToGraph in
 * graphy/components/AIPrompt): a flat list of nodes, each carrying its own
 * position and its downstream links by nodeId. The schema below asks Claude
 * for exactly that, so no free-form parsing sits between the two.
 *
 * The model answers with one of two kinds: a clarifying question, or a plan.
 * That keeps the existing chat behaviour - the assistant may ask before it
 * commits to a graph.
 */

import { z } from 'zod';

const NODE_KINDS = [
  { nodeType: 'dao', nodeSubtype: 'simple', note: 'a concrete task to do once' },
  { nodeType: 'fundamental', nodeSubtype: 'category', note: 'a grouping / area of life' },
  { nodeType: 'fundamental', nodeSubtype: 'downstream', note: 'a milestone fed by the tasks after it' },
  { nodeType: 'fundamental', nodeSubtype: 'upstream', note: 'an outcome fed by the tasks before it' },
  { nodeType: 'repeatable', nodeSubtype: 'bounded', note: 'a habit with a target count' },
  { nodeType: 'repeatable', nodeSubtype: 'infinity', note: 'an ongoing habit with no target' },
];

const PlanNode = z.object({
  nodeId: z.string().describe('Short id unique within this plan, referenced by downstream'),
  title: z.string().describe('Short imperative title, in the language the user wrote in'),
  description: z
    .string()
    .describe('One to three sentences: why this node exists, what counts as done, and any concrete detail that will not fit in the title'),
  nodeType: z.enum(['dao', 'fundamental', 'repeatable']),
  nodeSubtype: z.enum(['simple', 'category', 'downstream', 'upstream', 'bounded', 'infinity']),
  x: z.number().describe('Horizontal position. The graph reads left to right: earlier work has a smaller x'),
  y: z.number().describe('Vertical position. Parallel branches get different y'),
  downstream: z.array(z.string()).describe('nodeIds of the nodes this one leads to'),
});

export const GraphPlanSchema = z.object({
  kind: z.enum(['question', 'plan']),
  message: z.string().describe('Set when kind is "question": what you need to know before planning'),
  nodes: z.array(PlanNode).describe('Set when kind is "plan": the nodes to create'),
});

export const GRAPH_SEMANTICS = `## How the graph reads

Left to right, in time: what has to happen first sits further left. An arrow
means "this cannot start before that is done". If a step waits for another -
the visa for the certificate, the decree for the interview - there is an
arrow between them, whichever part of the graph each sits in. A dependency
written only in a description is a mistake: the graph then shows as possible
now something that is not.

## The kinds, and what progress each one reports

- dao/simple - a concrete task. Progress is 0 or 1: done or not.
- dao/withChildren - a step with a checklist inside. Progress is the share of
  the checklist done.
- repeatable/bounded - a habit with a target count. Progress is
  completed / target, so it moves gradually.
- repeatable/infinity - an ongoing habit with no end. Progress is 1 only on a
  day it was ticked, and 0 otherwise.
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

Keep repeatable/infinity out of any stage or section that is meant to finish.
It reads as 0 on any day it has not been ticked, which would drag progress
down every morning. Ongoing habits belong on their own.

## Descriptions

Every node carries a description as well as a title. The title is what the
person scans; the description is what they read when they open the node and
have forgotten why it is there.

One to three sentences. Say why the node exists, what counts as done, and any
concrete detail that will not fit in a title - a number, a threshold, an order
of operations, a thing to watch out for. When you planned from a source the
person linked, this is where its specifics belong: the timings, quantities and
conditions the page gave. Do not restate the title, and do not pad.

Because the detail has a home, keep titles short.

## Positions

A node is 180 wide and 60 tall. Put 380 between the x of one column and the
next, and 160 between the y of one row and the next, so nothing overlaps.
Start at x 0. Centre a parent vertically against the rows it points at.
`;

export const PLAN_SYSTEM_PROMPT = `You lay out a person's goal as a graph of work in the DAO editor.
${GRAPH_SEMANTICS}

## Shape

Plans are flat: no node contains another. Grouping is expressed by pointing a
category or milestone at the nodes it covers.

Give the plan one entry point on the left. Aim for the work that actually
matters - eight to fifteen nodes is usually right. More than about twenty and
the graph stops being readable.

Write every title in the language the person used. Titles are short and
concrete - a few words, something that can be ticked off.

## Answering

Answer with kind "question" when the goal is too vague to lay out - put one
concrete question in "message" and leave "nodes" empty. Ask at most once;
if the person has already answered, plan with what you have.

Otherwise answer with kind "plan".

## Example

Person: "Хочу переехать в Нью-Йорк весной"

{
  "kind": "plan",
  "nodes": [
    { "nodeId": "root", "title": "Переезд в Нью-Йорк", "description": "Общая цель: жить и работать в Нью-Йорке к началу весны. Считается выполненной, когда есть виза, жильё и вы на месте.", "nodeType": "fundamental", "nodeSubtype": "category", "x": 0, "y": 320, "downstream": ["visa", "home", "move"] },
    { "nodeId": "visa", "title": "Виза и работа", "description": "Право на въезд и работу. Самая долгая ветка — её стоит начинать первой, остальное зависит от сроков консульства.", "nodeType": "fundamental", "nodeSubtype": "downstream", "x": 380, "y": 0, "downstream": ["offer"] },
    { "nodeId": "offer", "title": "Получить оффер", "description": "Подписанное предложение от работодателя, готового спонсировать визу. Без него остальная ветка не двигается.", "nodeType": "dao", "nodeSubtype": "simple", "x": 760, "y": 0, "downstream": ["docs"] },
    { "nodeId": "docs", "title": "Собрать документы на визу", "description": "Петиция работодателя, подтверждение квалификации, загранпаспорт со сроком действия не меньше полугода после въезда.", "nodeType": "dao", "nodeSubtype": "simple", "x": 1140, "y": 0, "downstream": ["interview"] },
    { "nodeId": "interview", "title": "Пройти собеседование в консульстве", "description": "Запись открывается неравномерно — проверять слоты стоит заранее и регулярно. Выполнено, когда виза вклеена в паспорт.", "nodeType": "dao", "nodeSubtype": "simple", "x": 1520, "y": 0, "downstream": [] },
    { "nodeId": "home", "title": "Жильё", "description": "Где жить с первого дня. Можно вести параллельно с визой, но депозит вносить только после одобрения.", "nodeType": "fundamental", "nodeSubtype": "downstream", "x": 380, "y": 320, "downstream": ["search"] },
    { "nodeId": "search", "title": "Отобрать районы и варианты", "description": "Сузить до двух-трёх районов по времени до работы и бюджету, собрать список конкретных вариантов.", "nodeType": "dao", "nodeSubtype": "simple", "x": 760, "y": 320, "downstream": ["deposit"] },
    { "nodeId": "deposit", "title": "Внести депозит", "description": "Обычно это первый месяц плюс депозит. Делать только после одобрения визы, иначе деньги зависнут.", "nodeType": "dao", "nodeSubtype": "simple", "x": 1140, "y": 320, "downstream": [] },
    { "nodeId": "move", "title": "Логистика", "description": "Физическое перемещение: билеты, вещи, всё что едет с вами. Последняя по срокам ветка.", "nodeType": "fundamental", "nodeSubtype": "downstream", "x": 380, "y": 640, "downstream": ["tickets"] },
    { "nodeId": "tickets", "title": "Купить билеты", "description": "Брать после получения визы. Дата вылета задаёт крайний срок для всего остального.", "nodeType": "dao", "nodeSubtype": "simple", "x": 760, "y": 640, "downstream": ["pack"] },
    { "nodeId": "pack", "title": "Собрать вещи", "description": "Разделить на то, что летит с вами, что отправляется отдельно и что остаётся. Выполнено, когда чемоданы закрыты.", "nodeType": "dao", "nodeSubtype": "simple", "x": 1140, "y": 640, "downstream": [] },
    { "nodeId": "english", "title": "Английский каждый день", "description": "Разговорная практика понемногу, но ежедневно. Стоит отдельно от вех: это привычка без финала, и она не должна тянуть их прогресс вниз.", "nodeType": "repeatable", "nodeSubtype": "infinity", "x": 0, "y": 800, "downstream": [] }
  ]
}

Note what the example does: three milestones of comparable size under one
category, each over its own chain; the daily habit stands apart from the
milestones so it cannot drag their progress down.`

const SUBTYPES_BY_TYPE = {
  // No withChildren: addPlanToGraph puts every node on the current level,
  // so nothing in a plan can own children.
  dao: ['simple'],
  fundamental: ['category', 'downstream', 'upstream'],
  repeatable: ['bounded', 'infinity'],
};

/**
 * The Anthropic JSON-schema subset does not enforce enums - zodOutputFormat
 * folds them into the field description - so a returned kind is a suggestion,
 * not a guarantee. An impossible pair would be rejected by the MST model on
 * the client, taking the whole plan with it; fall back to a plain task and
 * keep the node.
 */
function normaliseKind(nodeType, nodeSubtype) {
  const subtypes = SUBTYPES_BY_TYPE[nodeType];
  if (!subtypes || !subtypes.includes(nodeSubtype)) {
    return { nodeType: 'dao', nodeSubtype: 'simple' };
  }
  return { nodeType, nodeSubtype };
}

const finiteOrZero = (value) => (Number.isFinite(value) ? value : 0);

/**
 * Convert one validated model answer into the shape the frontend consumes.
 * Pure: no network, no SDK types.
 */
export function toClientResponse(parsed) {
  if (!parsed) {
    return { type: 'error', message: 'The model returned nothing usable.' };
  }

  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];

  // The message field only carries meaning when the answer is a question.
  // Seen live: a "plan" came back with no nodes and a lone comma in message,
  // which then reached the chat verbatim.
  const asksSomething = parsed.kind === 'question' && /\p{L}/u.test(parsed.message || '');

  if (asksSomething) {
    return { type: 'text', message: parsed.message };
  }

  if (nodes.length === 0) {
    return {
      type: 'text',
      message:
        'I could not turn that into a graph yet. Tell me a bit more about what you want to achieve.',
    };
  }

  const known = new Set(nodes.map((n) => n.nodeId));

  return {
    type: 'plan',
    data: {
      nodes: nodes.map((node) => ({
        nodeId: node.nodeId,
        title: node.title,
        // TreeNode declares description as a string, so anything else must
        // not reach the client.
        description: typeof node.description === 'string' ? node.description : '',
        ...normaliseKind(node.nodeType, node.nodeSubtype),
        x: finiteOrZero(node.x),
        y: finiteOrZero(node.y),
        linkedNodeIds: {
          // addPlanToGraph resolves each target against the nodes it just
          // created, so an id naming nothing - or itself - would quietly
          // produce no edge. Drop those here.
          downstream: (node.downstream || []).filter(
            (id) => id !== node.nodeId && known.has(id)
          ),
        },
      })),
    },
  };
}
