/**
 * A plan, as the model describes it, compiled into DAO nodes and arrows.
 *
 * The model says what depends on what — domain knowledge, which it has. This
 * decides which kind goes where, which way the arrows run and where each node
 * sits — mechanics, which it gets wrong.
 *
 * Each stage becomes its steps closed by a Mi. A Mi walking left stops at the
 * previous Mi without counting it, so a stage that follows another still
 * reports only its own work, and the section around them averages the stages.
 * See CLAUDE.md, "How progress actually behaves".
 *
 * A fork is one more task on the plan's level, marked `fork`: the Milestones
 * it waits for point at it, and it points at the first step of each option's
 * stage. Every arrow leaving a fork is an alternative, of which the person
 * takes one; the app folds away what only the others lead to (forks.js).
 *
 * Pure: no Redis, no SDK. Refusals are sentences the model can act on.
 */

import { KIND_TO_TYPES } from './graphReadTools.js';
import { compileTrackPlan } from './trackPlanCompiler.js';

export const COLUMN = 380;
export const ROW = 160;

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const list = (value) => (Array.isArray(value) ? value : []);
const ids = (value) => [...new Set(list(value).map(text).filter(Boolean))];

/** Every id after the ids it depends on; null when they form a circle. */
function topoOrder(all, dependsOn) {
  const state = new Map();
  const order = [];
  const visit = (id) => {
    if (state.get(id) === 'done') return true;
    if (state.get(id) === 'visiting') return false;
    state.set(id, 'visiting');
    for (const dep of dependsOn(id)) if (!visit(dep)) return false;
    state.set(id, 'done');
    order.push(id);
    return true;
  };
  for (const id of all) if (!visit(id)) return null;
  return order;
}

export function compilePlan(plan, { nodes = [], aliases, edges = [] }) {
  if (plan?.sequence && list(plan?.forks).length) {
    return { error: 'A plan with a fork cannot use sequence: true: that puts every stage after the one before it, and a fork\'s options are alternatives. Set sequence: false and give each stage its after.' };
  }
  if (plan?.layout === 'track') return compileTrackPlan(plan, { nodes, aliases, edges }, compilePlan);
  if ((plan?.stages || []).some(s => s.existing || (s.steps || []).some(step => step.existing
    || (step.checklist || []).some(item => typeof item !== 'string')))) {
    return { error: 'Use layout: track to reuse existing tasks or checklist items.' };
  }
  for (const stage of plan?.stages || []) for (const step of stage.steps || []) {
    if (step.checklistCount !== undefined && step.checklistCount !== (step.checklist || []).length) {
      return { error: `Step ${step.id} must supply ${step.checklistCount} checklist items.` };
    }
  }
  const operations = [];

  // --- where the plan goes
  let parent;
  let baseY = 0;
  const sectionAlias = text(plan?.section);
  if (sectionAlias) {
    const section = aliases.nodeAt(sectionAlias);
    if (!section) return { error: `There is no node called ${sectionAlias}.` };
    if (section.nodeType !== 'fundamental' || section.nodeSubtype !== 'category') {
      return { error: `${sectionAlias} is not a ryu. A plan goes inside a ryu: give its alias, or leave section empty and give a sectionTitle for a new one.` };
    }
    parent = section.id;
    const inside = list(section.children);
    if (inside.length) baseY = Math.max(...inside.map((c) => c.position?.y ?? 0)) + 2 * ROW;
  } else {
    const title = text(plan?.sectionTitle);
    if (!title) {
      return { error: 'Say where the plan goes: the alias of a ryu as section, or an empty section and a sectionTitle for a new one.' };
    }
    const tops = list(nodes).map((n) => n.position?.y ?? 0);
    operations.push({
      op: 'add', alias: 'plan:section', parent: null, title,
      description: text(plan?.sectionDescription), ...KIND_TO_TYPES.ryu,
      x: 0, y: tops.length ? Math.max(...tops) + 2 * ROW : 0, downstream: [],
    });
    parent = 'plan:section';
  }

  // --- the stages and steps are well formed
  const stages = list(plan?.stages);
  if (stages.length === 0) return { error: 'A plan needs at least one stage.' };

  const stageById = new Map();
  const stageOfStep = new Map();
  let nodeCount = operations.length;

  for (const stage of stages) {
    const id = text(stage?.id);
    if (!id) return { error: 'Every stage needs an id.' };
    // ':' is the alias separator (plan:<stage>, plan:<stage>:<step>) and
    // 'section' is what a new section's own alias is called — either one in
    // a stage id would collide with a minted alias and silently misdirect
    // a later link or parent.
    if (id.includes(':')) return { error: `Stage id ${id} cannot contain ':'. Use letters, digits, - or _.` };
    if (id === 'section') return { error: `section is reserved; give the stage another id.` };
    if (stageById.has(id)) return { error: `Two stages are called ${id}. Stage ids must be unique.` };
    if (!text(stage.title)) return { error: `Stage ${id} needs a title: the outcome that closes it.` };
    const steps = list(stage.steps);
    if (steps.length === 0) {
      return { error: `Stage ${id} has no steps. A stage with nothing to do reports nothing; give it steps or drop it.` };
    }
    const seen = new Set();
    for (const step of steps) {
      const stepId = text(step?.id);
      if (!stepId) return { error: `Every step in stage ${id} needs an id.` };
      // Same reason as the stage id above: a step's alias is plan:<stage>:<stepId>.
      if (stepId.includes(':')) return { error: `Step id ${stepId} cannot contain ':'. Use letters, digits, - or _.` };
      if (seen.has(stepId)) return { error: `Stage ${id} has two steps called ${stepId}. Step ids must be unique within a stage.` };
      seen.add(stepId);
      if (!text(step.title)) return { error: `Step ${stepId} in stage ${id} needs a title.` };
      const checklist = list(step.checklist).map(text).filter(Boolean);
      if (!stageOfStep.has(stepId)) stageOfStep.set(stepId, id);
      nodeCount += 1 + checklist.length;
    }
    nodeCount += 1; // its Mi
    stageById.set(id, stage);
  }

  // No limit on size. There was one, 40 nodes counting checklist items,
  // set before checklists moved inside their card; it refused plans whose
  // canvas held 17-24 cards, and each retry cost a whole plan's worth of
  // output. The eval's fit check watches the cards on the canvas instead.

  // --- the forks are well formed
  const forkById = new Map();
  const forkOf = new Map(); // id of a stage that starts an option → id of its fork
  for (const fork of list(plan?.forks)) {
    const id = text(fork?.id);
    if (!id) return { error: 'Every fork needs an id.' };
    // A fork's node is called plan:<fork>, as a stage's Milestone is called
    // plan:<stage>: the same alias rules, and one namespace for both.
    if (id.includes(':')) return { error: `Fork id ${id} cannot contain ':'. Use letters, digits, - or _.` };
    if (id === 'section') return { error: 'section is reserved; give the fork another id.' };
    if (stageById.has(id)) return { error: `${id} is the id of both a stage and a fork. Ids must be unique among stages and forks; give the fork another id.` };
    if (forkById.has(id)) return { error: `Two forks are called ${id}. Fork ids must be unique.` };
    if (!text(fork.title)) return { error: `Fork ${id} needs a title: the question the person answers by choosing.` };
    const options = list(fork.options);
    if (options.length < 2) {
      return { error: `Fork ${id} has fewer than two options. A fork is a choice between alternatives: give it at least two, or make its one path ordinary stages.` };
    }
    const own = new Set();
    for (const option of options) {
      const stageId = text(option?.stage);
      if (!stageId) return { error: `Every option of fork ${id} needs a stage: the id of the stage that option starts with.` };
      if (!stageById.has(stageId)) return { error: `An option of fork ${id} starts with stage ${stageId}, but there is no stage called ${stageId}.` };
      if (own.has(stageId)) return { error: `Two options of fork ${id} start with stage ${stageId}. Give each option a stage of its own.` };
      own.add(stageId);
      // Harmless only when one fork sits inside a path of the other; side by
      // side, a choice at one would fold away the stage chosen at the other.
      if (forkOf.has(stageId)) {
        return { error: `Stage ${stageId} is an option of both fork ${forkOf.get(stageId)} and fork ${id}. A stage can start an option of one fork only: give each fork its own stages, and let their paths meet in a later stage.` };
      }
      forkOf.set(stageId, id);
    }
    forkById.set(id, fork);
    nodeCount += 1;
  }
  for (const [id, fork] of forkById) {
    for (const dep of ids(fork.after)) {
      if (forkById.has(dep)) return { error: `Fork ${id} comes after ${dep}, which is a fork. A fork waits for stages: put the last stage of the path that leads to it in its after.` };
      if (!stageById.has(dep)) return { error: `Fork ${id} comes after ${dep}, but there is no stage called ${dep}.` };
    }
  }

  for (const [id, stage] of stageById) {
    for (const dep of ids(stage.after)) {
      // Its own fork, named again: the option already says so.
      if (forkById.has(dep) && forkOf.get(id) === dep) continue;
      if (forkById.has(dep)) {
        return { error: `Stage ${id} comes after ${dep}, which is a fork. Only the stages named in a fork's options start right after it; a stage that follows the choice lists the last stage of every option in its after.` };
      }
      if (!stageById.has(dep)) return { error: `Stage ${id} comes after ${dep}, but there is no stage called ${dep}.` };
    }
    const own = new Set(list(stage.steps).map((s) => text(s.id)));
    for (const step of list(stage.steps)) {
      for (const dep of ids(step.after)) {
        if (own.has(dep)) continue;
        if (stageOfStep.has(dep)) {
          const other = stageOfStep.get(dep);
          return {
            error: `Step ${text(step.id)} in stage ${id} waits for ${dep}, which belongs to stage ${other}. A step can only wait for steps of its own stage. Put ${other} in the after of stage ${id}; or, if only part of ${other} is needed first, split it so that part ends a stage of its own.`,
          };
        }
        return { error: `Step ${text(step.id)} in stage ${id} waits for ${dep}, but there is no such step.` };
      }
    }
  }

  const stageAfter = (id) => ids(stageById.get(id).after).filter((dep) => stageById.has(dep));
  if (!topoOrder([...stageById.keys()], stageAfter)) {
    return { error: 'The stages wait for each other in a circle. One of them has to come first.' };
  }
  // Stages and forks in one order: a fork after the stages it waits for, the
  // stage that starts an option after its fork.
  const waitsFor = (id) => (forkById.has(id)
    ? ids(forkById.get(id).after)
    : [...stageAfter(id), ...(forkOf.has(id) ? [forkOf.get(id)] : [])]);
  const stageOrder = topoOrder([...stageById.keys(), ...forkById.keys()], waitsFor);
  if (!stageOrder) {
    return { error: 'A fork waits for a stage that can only start after its own choice, so the forks and stages wait for each other in a circle. A fork\'s after names only stages that come before it.' };
  }

  const stepsOf = new Map();
  for (const [id, stage] of stageById) {
    const steps = new Map(list(stage.steps).map((s) => [text(s.id), s]));
    const order = topoOrder([...steps.keys()], (sid) => ids(steps.get(sid).after));
    if (!order) return { error: `The steps of stage ${id} wait for each other in a circle.` };
    const isLast = (sid) => !order.some((other) => ids(steps.get(other).after).includes(sid));
    stepsOf.set(id, { steps, order, isLast });
  }

  // Every arrow leaving a fork is an option, so an option leads to one node:
  // the single first step of its stage.
  const firstStep = new Map();
  for (const [stageId, forkId] of forkOf) {
    const { steps, order } = stepsOf.get(stageId);
    const first = order.filter((sid) => ids(steps.get(sid).after).length === 0);
    if (first.length !== 1) {
      return { error: `Stage ${stageId} starts an option of fork ${forkId}, but has ${first.length} first steps (${first.join(', ')}). A fork leads to exactly one step per option: give stage ${stageId} a single first step, and let the others wait for it.` };
    }
    firstStep.set(stageId, first[0]);
  }

  // C after A and B, with B already after A: the A → C arrow is implied.
  // Only a Milestone's arrow can be implied; a fork's arrow is the option.
  const ancestors = new Map();
  for (const id of stageOrder) {
    const all = new Set();
    for (const dep of waitsFor(id)) {
      all.add(dep);
      for (const a of ancestors.get(dep)) all.add(a);
    }
    ancestors.set(id, all);
  }
  const directAfter = (id) => {
    const deps = waitsFor(id);
    return deps.filter((dep) => stageById.has(dep) && !deps.some((other) => other !== dep && ancestors.get(other).has(dep)));
  };

  // --- columns follow prerequisites
  const stageAlias = (id) => `plan:${id}`;
  const stepAlias = (id, sid) => `plan:${id}:${sid}`;
  const forkAlias = (id) => `plan:${id}`;
  const column = new Map();
  for (const id of stageOrder) {
    // What it waits for directly: Milestones, and for a stage that starts an
    // option, its fork. A Milestone's alias and a fork's are built alike.
    const before = [...directAfter(id), ...(forkOf.has(id) ? [forkOf.get(id)] : [])];
    const start = before.length ? Math.max(...before.map((p) => column.get(stageAlias(p)))) + 1 : 0;
    if (forkById.has(id)) {
      column.set(forkAlias(id), start);
      continue;
    }
    const { steps, order, isLast } = stepsOf.get(id);
    for (const sid of order) {
      const deps = ids(steps.get(sid).after);
      column.set(stepAlias(id, sid), deps.length
        ? Math.max(...deps.map((d) => column.get(stepAlias(id, d)))) + 1
        : start);
    }
    column.set(stageAlias(id), Math.max(...order.filter(isLast).map((sid) => column.get(stepAlias(id, sid)))) + 1);
  }

  // --- rows follow the order the model gave; each stage gets its own band
  const links = [];
  const startNow = [];
  let rowOffset = 0;

  const placed = new Set(); // forks already given their node
  for (const stage of stages) {
    const id = text(stage.id);
    const { steps, order, isLast } = stepsOf.get(id);
    const prereqs = directAfter(id);
    const forkId = forkOf.get(id);

    // A fork goes on the first row of the first of its options: every node
    // of that stage sits right of it, so nothing is under it.
    if (forkId && !placed.has(forkId)) {
      placed.add(forkId);
      const fork = forkById.get(forkId);
      operations.push({
        op: 'add', alias: forkAlias(forkId), parent, title: text(fork.title), description: text(fork.description),
        ...KIND_TO_TYPES.dao,
        x: column.get(forkAlias(forkId)) * COLUMN, y: baseY + rowOffset * ROW, downstream: [],
        fork: true,
        forkOptions: list(fork.options).map((option) => ({
          target: stepAlias(text(option.stage), firstStep.get(text(option.stage))),
          label: text(option.label),
          hint: text(option.hint),
        })),
      });
      const waits = directAfter(forkId);
      for (const p of waits) links.push({ op: 'link', source: stageAlias(p), target: forkAlias(forkId) });
      if (waits.length === 0) startNow.push(text(fork.title));
    }

    const rowsUsed = new Map();
    const nextRow = (col) => {
      const row = rowsUsed.get(col) || 0;
      rowsUsed.set(col, row + 1);
      return row;
    };

    for (const sid of order) {
      const step = steps.get(sid);
      const alias = stepAlias(id, sid);
      const col = column.get(alias);
      const checklist = list(step.checklist).map(text).filter(Boolean);
      const kind = checklist.length
        ? { nodeType: 'dao', nodeSubtype: 'withChildren' }
        : KIND_TO_TYPES.dao;

      operations.push({
        op: 'add', alias, parent, title: text(step.title), description: text(step.description),
        ...kind,
        x: col * COLUMN, y: baseY + (rowOffset + nextRow(col)) * ROW, downstream: [],
      });
      checklist.forEach((item, i) => operations.push({
        op: 'add', alias: `${alias}:${i + 1}`, parent: alias, title: item, description: '',
        ...KIND_TO_TYPES.dao, x: 0, y: i * ROW, downstream: [],
      }));

      const deps = ids(step.after);
      for (const dep of deps) links.push({ op: 'link', source: stepAlias(id, dep), target: alias });
      if (deps.length === 0) {
        for (const p of prereqs) links.push({ op: 'link', source: stageAlias(p), target: alias });
        // The first step of an option waits for the choice, whatever else.
        if (forkId) links.push({ op: 'link', source: forkAlias(forkId), target: alias });
        if (prereqs.length === 0 && !forkId) startNow.push(text(step.title));
      }
      if (isLast(sid)) links.push({ op: 'link', source: alias, target: stageAlias(id) });
    }

    operations.push({
      op: 'add', alias: stageAlias(id), parent, title: text(stage.title), description: text(stage.description),
      ...KIND_TO_TYPES.mi,
      x: column.get(stageAlias(id)) * COLUMN, y: baseY + rowOffset * ROW, downstream: [],
    });
    rowOffset += Math.max(...rowsUsed.values());
  }

  return {
    operations: [...operations, ...links],
    startNow,
    stats: { stages: stages.length, nodes: nodeCount, links: links.length, forks: forkById.size },
  };
}

export default compilePlan;
