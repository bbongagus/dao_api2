/**
 * Changing an existing graph, not just building a new one.
 *
 * The model answers with sets of operations rather than a list of nodes, and
 * nothing is applied until the person confirms it. Two things keep that safe:
 * every node is addressed by an alias the server minted (see graphContext.js),
 * and the rules below refuse a change whose consequence the model cannot see.
 *
 * Operations are grouped by kind rather than expressed as a tagged union: the
 * JSON-schema subset the API accepts does not enforce enums, so a union would
 * be a suggestion, and every operation would have to carry every field.
 */

import { z } from 'zod';

import { resolveAliases } from './graphContext.js';
import { GRAPH_SEMANTICS } from './graphPlan.js';


export const CHANGE_SYSTEM_PROMPT = `You edit a person's graph of work in the DAO editor, and build one when it is empty.

${GRAPH_SEMANTICS}

## What you are working on

You are given the current graph. Every node appears under a short alias -
n1, n2 and so on - with its kind, its links and its description. Address
existing nodes by those aliases and nothing else. An alias you were not given
refers to nothing and the change will be discarded.

## How to answer

Answer with kind "question" when you genuinely cannot tell what is wanted.
Otherwise answer with kind "changes" and fill only the lists you need:

- add - new nodes. Give each one an alias of your own so other operations in
  the same answer can point at it. Place it in free space: do not put a new
  node where an existing one already sits.
- update - change a node in place. Every field you leave empty stays as it is,
  so send only what actually changes. An update that changes nothing is
  discarded.
- remove - delete a node. Only leaves: a node with nested children cannot be
  removed from here, because its contents would go with it.
- link / unlink - connect or disconnect two nodes downstream.

"summary" is one sentence the person reads before deciding. Say what changes
and why, in their language. It is not a list - they can see the list.

## Editing etiquette

Change what was asked and what plainly follows from it. Do not tidy, rename or
restructure nodes the person did not raise: they wrote them, and a graph that
rearranges itself is hard to trust.

When you add to an existing graph, join the new work to it. A branch that
hangs off nothing reports its own progress and contributes to none.

If what is asked would break one of the progress rules above - hanging a lone
task beside a large branch, putting an endless habit under a milestone,
pointing one milestone at another - do it the way that keeps the rollup honest
and say so in one clause of the summary.

## Example

Graph: n1 [fundamental/downstream] Виза · n1 → n2 · n2 [dao/simple] Получить оффер

Person: "добавь сбор документов после оффера и допиши, что оффер должен быть с визовой поддержкой"

{
  "kind": "changes",
  "summary": "Добавил сбор документов после оффера и уточнил требование к офферу.",
  "add": [
    { "alias": "docs", "title": "Собрать документы на визу", "description": "Петиция работодателя, подтверждение квалификации, загранпаспорт со сроком не меньше полугода после въезда.", "nodeType": "dao", "nodeSubtype": "simple", "x": 760, "y": 0, "downstream": [] }
  ],
  "update": [
    { "target": "n2", "title": "", "description": "Оффер должен быть с визовой поддержкой — без неё ветка не двигается.", "nodeType": "", "nodeSubtype": "", "requiredCompletions": 0 }
  ],
  "remove": [],
  "link": [{ "source": "n2", "target": "docs" }],
  "unlink": []
}`;

// A single exchange should not be able to rewrite the whole graph.
export const MAX_OPERATIONS = 30;

const NODE_TYPES = ['dao', 'fundamental', 'repeatable'];
const SUBTYPES_BY_TYPE = {
  dao: ['simple'],
  fundamental: ['category', 'downstream', 'upstream'],
  repeatable: ['bounded', 'infinity'],
};

const AddOp = z.object({
  alias: z.string().describe('Short id for this new node, unique within this answer'),
  title: z.string(),
  description: z.string(),
  nodeType: z.enum(NODE_TYPES),
  nodeSubtype: z.enum(['simple', 'category', 'downstream', 'upstream', 'bounded', 'infinity']),
  x: z.number(),
  y: z.number(),
  downstream: z.array(z.string()).describe('Aliases this node leads to - existing ones or ones you are adding'),
});

const UpdateOp = z.object({
  target: z.string().describe('Alias of the existing node to change'),
  title: z.string().describe('Empty string leaves the title alone'),
  description: z.string().describe('Empty string leaves the description alone'),
  nodeType: z.string().describe('Empty string leaves the kind alone'),
  nodeSubtype: z.string().describe('Empty string leaves the kind alone'),
  requiredCompletions: z.number().describe('0 leaves the goal alone'),
});

const TargetOp = z.object({ target: z.string() });
const LinkOp = z.object({ source: z.string(), target: z.string() });

export const GraphChangeSchema = z.object({
  kind: z.enum(['question', 'changes']),
  message: z.string().describe('Set when kind is "question"'),
  summary: z.string().describe('Set when kind is "changes": one sentence saying what you are proposing'),
  add: z.array(AddOp),
  update: z.array(UpdateOp),
  remove: z.array(TargetOp),
  link: z.array(LinkOp),
  unlink: z.array(LinkOp),
});

function normaliseKind(nodeType, nodeSubtype) {
  const subtypes = SUBTYPES_BY_TYPE[nodeType];
  if (!subtypes || !subtypes.includes(nodeSubtype)) {
    return { nodeType: 'dao', nodeSubtype: 'simple' };
  }
  return { nodeType, nodeSubtype };
}

const finiteOrZero = (v) => (Number.isFinite(v) ? v : 0);
const text = (value) => (typeof value === 'string' ? value : '');

/** Index every node in the level by id, remembering whether it has children. */
function indexLevel(nodes) {
  const index = new Map();
  const walk = (list) => {
    for (const node of list || []) {
      index.set(node.id, node);
      walk(node.children);
    }
  };
  walk(nodes);
  return index;
}

const asText = (message) => ({ type: 'text', message });

/**
 * Turn one validated answer into a set of operations the editor can apply,
 * or into a message when there is nothing safe to propose.
 */
export function toChangeResponse(parsed, aliasToId, levelNodes) {
  if (!parsed) return asText('The model returned nothing usable.');

  if (parsed.kind === 'question' && /\p{L}/u.test(parsed.message || '')) {
    return asText(parsed.message);
  }

  const index = indexLevel(levelNodes);
  const flat = [];

  for (const op of parsed.add || []) {
    flat.push({
      op: 'add',
      alias: op.alias,
      title: op.title,
      description: text(op.description),
      ...normaliseKind(op.nodeType, op.nodeSubtype),
      x: finiteOrZero(op.x),
      y: finiteOrZero(op.y),
      downstream: op.downstream || [],
    });
  }

  for (const op of parsed.update || []) {
    // An empty field means "leave it alone", so an update that sets nothing
    // is not a change and should not appear in the confirmation.
    const change = { op: 'update', target: op.target };
    if (text(op.title)) change.title = op.title;
    if (text(op.description)) change.description = op.description;
    if (text(op.nodeType) && text(op.nodeSubtype)) {
      Object.assign(change, normaliseKind(op.nodeType, op.nodeSubtype));
    }
    if (Number.isFinite(op.requiredCompletions) && op.requiredCompletions > 0) {
      change.requiredCompletions = op.requiredCompletions;
    }
    if (Object.keys(change).length > 2) flat.push(change);
  }

  for (const op of parsed.remove || []) {
    flat.push({ op: 'delete', target: op.target });
  }
  for (const op of parsed.link || []) {
    flat.push({ op: 'link', source: op.source, target: op.target });
  }
  for (const op of parsed.unlink || []) {
    flat.push({ op: 'unlink', source: op.source, target: op.target });
  }

  if (flat.length > MAX_OPERATIONS) {
    return asText(
      `That would take ${flat.length} changes at once, which is more than I will apply in one step. Ask for one part of it at a time.`
    );
  }

  const resolved = resolveAliases(flat, aliasToId);

  // A node with children cannot be deleted from here: it would orphan the
  // subtree, and nothing in the context tells the model that subtree exists
  // in enough detail to judge.
  const orphaning = resolved.filter(
    (op) => op.op === 'delete' && (index.get(op.target)?.children?.length > 0)
  );
  if (orphaning.length > 0) {
    const names = orphaning.map((op) => `"${index.get(op.target).title}"`).join(', ');
    return asText(
      `I will not delete ${names} from here - ${orphaning.length > 1 ? 'they have' : 'it has'} nested nodes that would be lost with ${orphaning.length > 1 ? 'them' : 'it'}. Open the node and remove its contents first.`
    );
  }

  if (resolved.length === 0) {
    return asText(
      parsed.summary && /\p{L}/u.test(parsed.summary)
        ? `${parsed.summary} — but nothing in that turned out to be applicable to this graph.`
        : 'I could not find anything to change here. Tell me a bit more about what you want.'
    );
  }

  const counts = {
    add: resolved.filter((o) => o.op === 'add').length,
    update: resolved.filter((o) => o.op === 'update').length,
    delete: resolved.filter((o) => o.op === 'delete').length,
  };

  return { type: 'changes', summary: text(parsed.summary), operations: resolved, counts };
}
