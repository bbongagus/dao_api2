/**
 * What a set of staged operations would look like as a graph.
 *
 * The eval and the gate need to judge a proposal by its structure — does one
 * stage wait for another, is any task counted twice, can anything start now —
 * without applying it. The walk mirrors ProgressCalculator's Mi rule: going
 * left, a previous Mi stops the walk and is not counted, a Kai is skipped.
 */

const isTaskKind = (o) => o?.nodeType === 'dao' || o?.nodeType === 'repeatable';
const MILESTONE = new Set(['upstream', 'downstream']);

export function describeProposalShape(operations = []) {
  const adds = operations.filter((o) => o.op === 'add');
  const byAlias = new Map(adds.map((o) => [o.alias, o]));

  // A node nested inside a task is a checklist item, not a node on the canvas.
  const onCanvas = (o) => !(o.parent && byAlias.get(o.parent)?.nodeType === 'dao');
  const kind = (ref) => byAlias.get(ref)?.nodeSubtype;
  const isMi = (ref) => byAlias.get(ref)?.nodeType === 'fundamental' && kind(ref) === 'upstream';
  const isKai = (ref) => byAlias.get(ref)?.nodeType === 'fundamental' && kind(ref) === 'downstream';
  const isTask = (ref) => isTaskKind(byAlias.get(ref)) && onCanvas(byAlias.get(ref));

  const arrows = [
    ...adds.flatMap((o) => (o.downstream || []).map((target) => [o.alias, target])),
    ...operations.filter((o) => o.op === 'link').map((o) => [o.source, o.target]),
  ];
  const upstream = new Map();
  for (const [source, target] of arrows) {
    if (!upstream.has(target)) upstream.set(target, []);
    upstream.get(target).push(source);
  }
  const incoming = (ref) => upstream.get(ref) || [];

  const countedBy = new Map();
  let miWithoutTasks = 0;
  for (const mi of adds.filter((o) => isMi(o.alias))) {
    const seen = new Set();
    const tasks = new Set();
    const walk = (ref) => {
      for (const up of incoming(ref)) {
        if (seen.has(up)) continue;
        seen.add(up);
        if (isMi(up) || isKai(up)) continue;
        if (isTask(up)) tasks.add(up);
        walk(up);
      }
    };
    walk(mi.alias);
    if (tasks.size === 0) miWithoutTasks += 1;
    for (const task of tasks) countedBy.set(task, (countedBy.get(task) || 0) + 1);
  }

  const overlaps = [];
  const canvas = adds.filter(onCanvas);
  for (const a of canvas) {
    for (const b of canvas) {
      if (a.alias >= b.alias || (a.parent ?? null) !== (b.parent ?? null)) continue;
      if (Math.abs(a.x - b.x) < 180 && Math.abs(a.y - b.y) < 60) overlaps.push(`${a.title} / ${b.title}`);
    }
  }

  return {
    nodes: adds.length,
    arrows: arrows.length,
    merges: adds.filter((o) => onCanvas(o) && incoming(o.alias).length > 1).length,
    stageLinks: arrows.filter(([source, target]) => isMi(source) && isTask(target)).length,
    kaiIntoKai: arrows.filter(([source, target]) => isKai(source) && isKai(target)).length,
    doubleCounted: [...countedBy].filter(([, n]) => n > 1).map(([alias]) => byAlias.get(alias).title),
    miWithoutTasks,
    startNow: adds
      .filter((o) => isTask(o.alias) && incoming(o.alias).every((s) => !isTask(s) && !isMi(s)))
      .map((o) => o.title),
    overlaps,
    habitsBesideMilestones: adds
      .filter((o) => o.nodeSubtype === 'infinity'
        && adds.some((m) => m.nodeType === 'fundamental' && MILESTONE.has(m.nodeSubtype)
          && (m.parent ?? null) === (o.parent ?? null)))
      .map((o) => o.title),
  };
}

export default describeProposalShape;
