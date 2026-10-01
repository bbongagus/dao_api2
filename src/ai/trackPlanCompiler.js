import { KIND_TO_TYPES } from './graphReadTools.js';
import { buildLinkIndex } from './links.js';

/** Reuse the stage compiler's DAG/layout; place its nodes beside one Track.
 * Existing references become moves/updates, never delete-and-recreate.
 * Pure and atomic: a refusal returns no operations.
 */
export function compileTrackPlan(plan, { nodes, aliases, edges = [] }, compileStages) {
  const fail = (error) => ({ error });
  const group = n => n?.nodeType === 'fundamental' && n.nodeSubtype === 'category';
  const track = n => n?.nodeType === 'fundamental' && n.nodeSubtype === 'downstream';
  const anchor = plan.section ? aliases.nodeAt(plan.section) : null;
  if (plan.section && !anchor) return fail('The Track or Group alias does not exist. Inspect the area first.');
  if (anchor && !group(anchor) && !track(anchor)) return fail('Choose a Track or Group to restructure.');
  const parentAlias = anchor ? aliases.entryAt(plan.section).parentAlias : null;
  const parent = parentAlias ? aliases.nodeAt(parentAlias).id : null;
  const selected = new Map();
  const map = new Map([['plan:section', anchor?.id || 'plan:section']]);
  let problem;
  const bind = (ref, generated, kind) => {
    if (!ref) return;
    const n = aliases.nodeAt(ref);
    if (!n || n.id === anchor?.id) { problem = `Unknown or invalid existing reference ${ref}.`; return; }
    if (selected.has(n.id)) { problem = `${ref} is used twice. Reuse every existing node only once.`; return; }
    if (kind === 'milestone' ? !(n.nodeType === 'fundamental' && n.nodeSubtype === 'upstream') : n.nodeType !== 'dao') {
      problem = `${ref} must be an existing ${kind}.`; return;
    }
    selected.set(n.id, n); map.set(generated, n.id);
  };
  const stages = (plan.stages || []).map((stage, i, all) => {
    const prefix = `plan:${stage.id}`;
    bind(stage.existing, prefix, 'milestone');
    return { ...stage, after: plan.sequence ? (i ? [all[i - 1].id] : []) : stage.after,
      steps: (stage.steps || []).map(step => {
        const alias = `${prefix}:${step.id}`;
        bind(step.existing, alias, 'task');
        const items = step.checklist || [];
        if (step.checklistCount !== undefined && step.checklistCount !== items.length) {
          problem = `Step ${step.id} requests ${step.checklistCount} checklist items but supplies ${items.length}. Provide every item.`;
        }
        const checklist = items.map((item, j) => {
          if (typeof item === 'string') return item;
          bind(item.existing, `${alias}:${j + 1}`, 'task');
          return item.title || aliases.nodeAt(item.existing)?.title || '';
        });
        const existing = step.existing && aliases.nodeAt(step.existing);
        if (existing?.isDone && !existing.children?.length && checklist.length) {
          problem = `Do not turn completed task ${step.existing} into unfinished work. Reuse it as a completed checklist item instead.`;
        }
        return { ...step, checklist };
      }) };
  });
  if (problem) return fail(problem);

  // Reusing an enclosing Group means accounting for all its contents. Empty
  // organizational wrappers may go; work and milestones may not disappear.
  const links = buildLinkIndex(nodes, edges);
  const scope = new Map();
  const collect = n => { scope.set(n.id, n); (n.children || []).forEach(collect); };
  if (anchor) {
    (anchor.children || []).forEach(collect);
    if (track(anchor)) {
      const visit = id => { if (scope.has(id)) return; const n = aliases.nodeAt(aliases.aliasOf(id));
        if (!n) return; collect(n); links.downstreamOf(id).forEach(visit); };
      links.downstreamOf(anchor.id).forEach(visit);
    }
    for (const id of selected.keys()) if (!scope.has(id)) return fail('An existing reference is outside this plan. Do not pull unrelated work into it.');
  }
  const wrappers = [];
  for (const [id, n] of scope) {
    if (selected.has(id)) continue;
    if (!group(n) || n.isDone || links.upstreamOf(id).length || links.downstreamOf(id).length) {
      return fail(`Existing work ${aliases.aliasOf(id)} "${n.title}" is missing from the plan. Include it using existing; do not recreate or discard it.`);
    }
    wrappers.push(n);
  }
  // A reused checklist must explicitly account for all its children too.
  for (const n of selected.values()) for (const child of n.children || []) {
    if (!selected.has(child.id)) return fail(`Include existing checklist item ${aliases.aliasOf(child.id)} before restructuring its parent.`);
  }
  const allOwned = new Set([...selected.keys(), ...wrappers.map(n => n.id), ...(anchor ? [anchor.id] : [])]);
  for (const id of allOwned) for (const other of [...links.downstreamOf(id), ...links.upstreamOf(id)]) {
    if (!allOwned.has(other)) return fail('This plan connects to work outside the selected area. Inspect those connections before restructuring it.');
  }

  const compiled = compileStages({ ...plan, layout: 'group', section: '',
    sectionTitle: plan.sectionTitle || anchor?.title,
    stages: stages.map(stage => ({ ...stage, existing: '', steps: stage.steps.map(step => ({ ...step, existing: '' })) })),
  }, { nodes, aliases });
  if (compiled.error) return compiled;
  const terminal = stages.filter(s => !stages.some(other => (other.after || []).includes(s.id)));
  if (terminal.length !== 1) return fail('A Track needs one final outcome. Connect the stage outcomes, or use sequence: true for the requested stage-by-stage path.');

  const ref = id => map.get(id) || id;
  const operations = [];
  let anchorUpdate;
  const desiredLinks = compiled.operations.filter(o => o.op === 'link').map(o => ({ ...o, source: ref(o.source), target: ref(o.target) }));
  const targets = new Set(desiredLinks.map(o => o.target));
  const directSteps = compiled.operations.filter(o => o.op === 'add' && o.parent === 'plan:section' && o.nodeType === 'dao');
  for (const step of directSteps) if (!targets.has(ref(step.alias))) desiredLinks.push({ op: 'link', source: ref('plan:section'), target: ref(step.alias) });
  const desiredPairs = new Set(desiredLinks.map(o => `${o.source}→${o.target}`));
  for (const id of allOwned) for (const to of links.downstreamOf(id)) {
    if (!desiredPairs.has(`${id}→${to}`)) operations.push({ op: 'unlink', source: id, target: to });
  }
  for (const op of compiled.operations.filter(o => o.op === 'add')) {
    const isAnchor = op.alias === 'plan:section';
    const destination = isAnchor || op.parent === 'plan:section' ? parent : ref(op.parent);
    const existingId = map.get(op.alias);
    if (existingId && (isAnchor ? anchor : selected.has(existingId))) {
      const old = isAnchor ? anchor : selected.get(existingId);
      if (!isAnchor) {
        const oldParentAlias = aliases.entryAt(aliases.aliasOf(old.id)).parentAlias;
        const oldParent = oldParentAlias ? aliases.nodeAt(oldParentAlias).id : null;
        if (oldParent !== destination) operations.push({ op: 'move', target: old.id, parent: destination });
      }
      const update = { op: 'update', target: old.id };
      if (op.title && op.title !== old.title) update.title = op.title;
      if (op.description && op.description !== old.description) update.description = op.description;
      // Convert the enclosing Group only after all its children have moved.
      if (isAnchor) Object.assign(update, KIND_TO_TYPES.kai);
      else if (op.nodeSubtype !== old.nodeSubtype) Object.assign(update, { nodeType: op.nodeType, nodeSubtype: op.nodeSubtype });
      if (Object.keys(update).length > 2) {
        if (isAnchor) anchorUpdate = update;
        else operations.push(update);
      }
    } else operations.push({ ...op, alias: ref(op.alias), parent: destination,
      ...(isAnchor ? KIND_TO_TYPES.kai : {}), x: isAnchor ? 0 : op.x + 380 });
  }
  // Only empty, unconnected organizational wrappers are deleted, bottom-up.
  wrappers.reverse().forEach(n => operations.push({ op: 'delete', target: n.id }));
  if (anchorUpdate) operations.push(anchorUpdate);
  for (const op of desiredLinks) if (!links.has(op.source, op.target)) operations.push(op);
  const startNow = directSteps.filter(op => !targets.has(ref(op.alias)))
    .filter(op => {
      const items = compiled.operations.filter(item => item.op === 'add' && item.parent === op.alias);
      return items.length ? !items.every(item => selected.get(ref(item.alias))?.isDone) : !selected.get(ref(op.alias))?.isDone;
    }).map(op => op.title);
  const additions = compiled.operations.filter(o => o.op === 'add');
  return { ...compiled, operations, startNow,
    contract: { anchor: ref('plan:section'), parent,
      direct: additions.filter(o => o.alias === 'plan:section' || o.parent === 'plan:section').map(o => ref(o.alias)),
      checklists: additions.filter(o => o.nodeSubtype === 'withChildren').map(o => ({ parent: ref(o.alias),
        items: additions.filter(item => item.parent === o.alias).map(item => ref(item.alias)) })),
      links: desiredLinks,
      completed: [...selected.values()].filter(n => n.isDone).map(n => ({ id: n.id, doneAt: n.doneAt })),
    },
    stats: { ...compiled.stats, reused: selected.size, links: desiredLinks.length } };
}

export function validateTrackDraft(draft, contract) {
  const byId = new Map(draft.aliases.all.map(e => [e.node.id, e]));
  const anchor = byId.get(contract.anchor)?.node;
  if (anchor?.nodeType !== 'fundamental' || anchor.nodeSubtype !== 'downstream' || anchor.children.length) return 'The plan must start with an empty Track whose work sits beside it.';
  const parentOf = entry => entry.parentAlias ? draft.aliases.nodeAt(entry.parentAlias).id : null;
  for (const id of contract.direct) if (!byId.has(id) || parentOf(byId.get(id)) !== contract.parent) return 'The Track, tasks and Milestones must all remain on one level.';
  for (const list of contract.checklists) {
    const parent = byId.get(list.parent)?.node;
    if (parent?.nodeType !== 'dao' || parent.nodeSubtype !== 'withChildren' || parent.children.length !== list.items.length
      || list.items.some(id => !parent.children.some(n => n.id === id && !n.children.length && n.nodeType === 'dao'))) return 'A requested checklist is missing items or has the wrong structure.';
    if (draft.edges.some(e => list.items.includes(e.source) || list.items.includes(e.target))) return 'Checklist items must not carry arrows; connect their parent task.';
  }
  const pairs = new Set(draft.edges.map(e => `${e.source}→${e.target}`));
  const expected = new Set(contract.links.map(e => `${e.source}→${e.target}`));
  const owned = new Set([...contract.direct, ...contract.checklists.flatMap(c => c.items)]);
  if (contract.links.some(e => !pairs.has(`${e.source}→${e.target}`))
    || draft.edges.some(e => (owned.has(e.source) || owned.has(e.target)) && !expected.has(`${e.source}→${e.target}`))) return 'The path no longer matches the planned stage connections. Repair it with plan_path.';
  for (const saved of contract.completed) {
    const n = byId.get(saved.id)?.node;
    if (!n?.isDone || n.doneAt !== saved.doneAt) return 'Completed work or its completion date was lost.';
  }
  return null;
}
