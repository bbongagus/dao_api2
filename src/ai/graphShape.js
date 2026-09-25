/**
 * What a set of staged operations would look like as a graph.
 *
 * The eval and the gate need to judge a proposal by its structure — does one
 * stage wait for another, is any task counted twice, can anything start now —
 * without applying it. The walk mirrors ProgressCalculator's Mi rule: going
 * left, a previous Mi stops the walk and is not counted, a Kai is skipped.
 */

const isTaskKind = (o) => o?.nodeType === 'dao' || o?.nodeType === 'repeatable';

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const LATIN = /\p{Script=Latin}/u;

/**
 * Words a person would read as broken: any with CJK characters in it, and
 * any that mixes Cyrillic and Latin letters ("наImageView", "общинe" with a
 * Latin e). A model served at low precision produces both, and a share of
 * Cyrillic letters does not notice them. A real brand spelt across both
 * alphabets (ЮKassa) is flagged too — rare enough to read past.
 */
export function garbledWords(text = '') {
  const words = String(text).match(/[\p{L}\p{M}]+/gu) || [];
  return [...new Set(words.filter((w) => CJK.test(w) || (CYRILLIC.test(w) && LATIN.test(w))))];
}
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
    // What takes room on the canvas; checklist items live inside their card.
    canvasNodes: canvas.length,
    steps: adds.filter((o) => isTask(o.alias)).length,
    // Steps with items inside. Most steps should have none: how to do a step
    // belongs in its description, not in a list of three sub-actions.
    checklisted: adds
      .filter((o) => isTask(o.alias) && adds.some((item) => item.parent === o.alias))
      .map((o) => o.title),
    arrows: arrows.length,
    merges: adds.filter((o) => onCanvas(o) && incoming(o.alias).length > 1).length,
    stageLinks: arrows.filter(([source, target]) => isMi(source) && isTask(target)).length,
    // A stage that waits for two or more others: stages that ran side by side
    // and meet here. A step waiting on two steps of its own stage is a merge,
    // but not this one — a plan of one long chain of stages can have those.
    stageMerges: adds.filter((o) => onCanvas(o) && new Set(incoming(o.alias).filter(isMi)).size > 1).length,
    kaiIntoKai: arrows.filter(([source, target]) => isKai(source) && isKai(target)).length,
    doubleCounted: [...countedBy].filter(([, n]) => n > 1).map(([alias]) => byAlias.get(alias).title),
    miWithoutTasks,
    startNow: adds
      .filter((o) => isTask(o.alias) && incoming(o.alias).every((s) => !isTask(s) && !isMi(s)))
      .map((o) => o.title),
    overlaps,
    garbled: [...new Set(adds.flatMap((o) => garbledWords(`${o.title || ''} ${o.description || ''}`)))],
    habitsBesideMilestones: adds
      .filter((o) => o.nodeSubtype === 'infinity'
        && adds.some((m) => m.nodeType === 'fundamental' && MILESTONE.has(m.nodeSubtype)
          && (m.parent ?? null) === (o.parent ?? null)))
      .map((o) => o.title),
  };
}

/**
 * A goal made of several things that each go their own way — three articles,
 * each chosen, written and published when it is ready: the one named by
 * `early.step` must not wait, through any chain of arrows or milestones, on a
 * node named by `early.notAfter`. Stages per activity (all topics, then all
 * writing) fail it: a milestone waits for everything before it.
 */
export function finishesEarly(operations, early) {
  const adds = operations.filter((o) => o.op === 'add');
  const arrows = [
    ...adds.flatMap((o) => (o.downstream || []).map((target) => [o.alias, target])),
    ...operations.filter((o) => o.op === 'link').map((o) => [o.source, o.target]),
  ];
  const first = adds.find((o) => new RegExp(early.step, 'iu').test(o.title));
  if (!first) return false;
  const byAlias = new Map(adds.map((o) => [o.alias, o]));
  const before = new Set();
  // A checklist item has no arrows of its own: it waits for what its step waits for.
  const walk = (ref) => {
    const holder = byAlias.get(byAlias.get(ref)?.parent);
    if (holder?.nodeType === 'dao') walk(holder.alias);
    for (const [source, target] of arrows) {
      if (target === ref && !before.has(source)) { before.add(source); walk(source); }
    }
  };
  walk(first.alias);
  const title = (ref) => adds.find((o) => o.alias === ref)?.title || '';
  return ![...before].some((ref) => new RegExp(early.notAfter, 'iu').test(title(ref)));
}

export default describeProposalShape;
