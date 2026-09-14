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
  { nodeType: 'dao', nodeSubtype: 'withChildren', note: 'a task that contains sub-tasks' },
  { nodeType: 'fundamental', nodeSubtype: 'category', note: 'a grouping / area of life' },
  { nodeType: 'fundamental', nodeSubtype: 'downstream', note: 'a milestone fed by the tasks after it' },
  { nodeType: 'fundamental', nodeSubtype: 'upstream', note: 'an outcome fed by the tasks before it' },
  { nodeType: 'repeatable', nodeSubtype: 'bounded', note: 'a habit with a target count' },
  { nodeType: 'repeatable', nodeSubtype: 'infinity', note: 'an ongoing habit with no target' },
];

const PlanNode = z.object({
  nodeId: z.string().describe('Short id unique within this plan, referenced by downstream'),
  title: z.string().describe('Short imperative title, in the language the user wrote in'),
  nodeType: z.enum(['dao', 'fundamental', 'repeatable']),
  nodeSubtype: z.enum(['simple', 'withChildren', 'category', 'downstream', 'upstream', 'bounded', 'infinity']),
  x: z.number().describe('Horizontal position. The graph reads left to right: earlier work has a smaller x'),
  y: z.number().describe('Vertical position. Parallel branches get different y'),
  downstream: z.array(z.string()).describe('nodeIds of the nodes this one leads to'),
});

export const GraphPlanSchema = z.object({
  kind: z.enum(['question', 'plan']),
  message: z.string().describe('Set when kind is "question": what you need to know before planning'),
  nodes: z.array(PlanNode).describe('Set when kind is "plan": the nodes to create'),
});

export const PLAN_SYSTEM_PROMPT = `You turn a person's goal into a graph of work in the DAO editor.

The graph reads left to right: what happens first sits further left. Node kinds:
${NODE_KINDS.map((k) => `- ${k.nodeType}/${k.nodeSubtype} - ${k.note}`).join('\n')}

Answer with kind "question" when the goal is too vague to lay out, and put a
single concrete question in "message" - then leave "nodes" empty.

Otherwise answer with kind "plan". Lay the nodes out so they do not overlap:
about 280px between columns and 150px between rows. Give the plan one entry
point and let it fan out. Write titles in the same language the person used.
Keep it to the work that actually matters - a dozen nodes is usually plenty.`;


const SUBTYPES_BY_TYPE = {
  dao: ['simple', 'withChildren'],
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

  if (parsed.kind === 'question' || nodes.length === 0) {
    return {
      type: 'text',
      message: parsed.message || 'I need a bit more detail before I can lay this out.',
    };
  }

  const known = new Set(nodes.map((n) => n.nodeId));

  return {
    type: 'plan',
    data: {
      nodes: nodes.map((node) => ({
        nodeId: node.nodeId,
        title: node.title,
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
