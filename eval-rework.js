#!/usr/bin/env node
// dao_api2/eval-rework.js
/**
 * How the agent reshapes a section that already exists — measured on the one
 * that went wrong on 2026-09-25. Asked to take two checklists apart into
 * separate tasks, it deleted the items and both milestones and added new
 * tasks in their place: the three ticks were gone.
 *
 * The section is seeded as it stood then, under a throwaway user, and the
 * request is the person's own words. The proposal is judged by what it would
 * do to what is there: every tick kept, every milestone kept, the items taken
 * out by moving them. It runs the turn several times, since one run of a
 * model says little.
 *
 * Usage: node --env-file=.env eval-rework.js [baseUrl] [runs]
 */

import Redis from 'ioredis';

import { devTokenFromEnv } from './src/auth/devToken.js';

const BASE = process.argv[2] || 'http://localhost:3011';
const RUNS = Number(process.argv[3]) || 3;
const redis = new Redis({ host: 'localhost', port: 6379 });
const stamp = Date.now();

const task = (id, title, extra = {}) => ({
  id, title, description: '', nodeType: 'dao', nodeSubtype: 'simple', isDone: false,
  position: { x: 0, y: 0 }, children: [], linkedNodeIds: { upstream: [], downstream: [] }, ...extra,
});
const items = (prefix, titles, done) => titles.map((title, i) => task(`${prefix}${i + 1}`, title, {
  isDone: done, position: { x: 0, y: i * 160 },
}));

const SECTION = task('sec', 'Public identity для поиска работы', {
  nodeType: 'fundamental', nodeSubtype: 'category',
  description: 'Публичное присутствие (в первую очередь на LinkedIn), которое подтверждает экспертизу и работает на поиск работы через собственный проект.',
  children: [
    task('topics', 'Выбрать темы с агентом', {
      nodeSubtype: 'withChildren', position: { x: 0, y: 0 },
      description: 'Сесть с агентом и определить темы для первых статей о проекте на LinkedIn.',
      children: items('t', ['Тема 1 выбрана', 'Тема 2 выбрана', 'Тема 3 выбрана'], true),
    }),
    task('mi1', 'Темы статей выбраны', { nodeType: 'fundamental', nodeSubtype: 'upstream', position: { x: 380, y: 0 } }),
    task('write', 'Написать 3 статьи', {
      nodeSubtype: 'withChildren', position: { x: 760, y: 0 },
      description: 'Три статьи по выбранным темам, написанные руками (не агентом) — 3 текста для начала.',
      children: items('a', ['Статья 1 написана', 'Статья 2 написана', 'Статья 3 написана'], false),
    }),
    task('mi2', 'Первые статьи написаны', { nodeType: 'fundamental', nodeSubtype: 'upstream', position: { x: 1140, y: 0 } }),
  ],
});
const EDGES = [['topics', 'mi1'], ['mi1', 'write'], ['write', 'mi2']]
  .map(([source, target], i) => ({ id: `e${i}`, source, target, direction: 'downstream' }));

const REQUEST = 'Слушай, давай вот там, где public для поиска работы, там есть сейчас блоки, которые включают в себя типа… выбрать темы с агентом и написать три статьи, Они представлены в виде to do листа. Давай-ка это и расставим их параллельно идущими треками. То есть чтобы у нас была одна DAU task тема один выбрана, другая DAO task, тем два выбрана, и третья тема три выбрана, без вложенности. И то же самое про написать три статьи, и после первые статьи написаны, ээ, сделай… выложить эти статьи. В общем, мне надо как-то сделать так, чтобы я… чтобы мне не обязательно было писать, ээ, все статьи разом. Чтобы я мог написать одну выбрать одну тему, написать другую статью и её. А не всё сразу.';

const TITLE = new Map();
const walk = (node) => { TITLE.set(node.id, node.title); node.children.forEach(walk); };
walk(SECTION);
const TICKED = ['t1', 't2', 't3'];
const MILESTONES = ['mi1', 'mi2'];
const ITEMS = ['t1', 't2', 't3', 'a1', 'a2', 'a3'];

async function turn(userId) {
  const response = await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await devTokenFromEnv(userId)}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: REQUEST }], currentPath: [], applies: ['move'] }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const text = await response.text();
  const events = text.split('\n\n')
    .map((chunk) => chunk.split('\n').find((l) => l.startsWith('data: ')))
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(6)));
  return { result: events.find((e) => e.type === 'result')?.result || events.find((e) => e.type === 'error') };
}

function judge({ result }) {
  const ops = result?.type === 'changes' ? result.operations : [];
  const said = `${result?.summary || ''} ${result?.message || ''}`.replace(/\s+/g, ' ').trim();
  const deleted = new Set(ops.filter((o) => o.op === 'delete').map((o) => o.target));
  const moved = new Set(ops.filter((o) => o.op === 'move').map((o) => o.target));
  return {
    ops,
    said,
    dollars: result?.usage?.dollars ?? 0,
    checks: [
      ['proposed something', ops.length > 0],
      ['every tick kept', TICKED.every((id) => !deleted.has(id))],
      ['every milestone kept', MILESTONES.every((id) => !deleted.has(id))],
      ['every item moved out, none deleted', ITEMS.every((id) => moved.has(id) && !deleted.has(id))],
      ['publishing added', ops.some((o) => o.op === 'add' && /опубликов|выложить|публикац/iu.test(o.title))],
    ],
  };
}

function describe(ops) {
  const name = (ref) => TITLE.get(ref) || ops.find((o) => o.alias === ref)?.title || ref;
  return ops.map((o) => {
    switch (o.op) {
      case 'add': return `    add    ${o.title}${o.parent ? ` in ${name(o.parent)}` : ''}`;
      case 'move': return `    move   ${name(o.target)} → ${o.parent ? name(o.parent) : 'top level'}`;
      case 'link': case 'unlink': return `    ${o.op.padEnd(6)} ${name(o.source)} → ${name(o.target)}`;
      default: return `    ${o.op.padEnd(6)} ${name(o.target)}${o.title ? ` → «${o.title}»` : ''}`;
    }
  }).join('\n');
}

async function main() {
  console.log(`\n🔧 Rework eval — ${BASE}, ${RUNS} runs`);
  let passed = 0;
  let total = 0;
  let dollars = 0;
  try {
    for (let run = 1; run <= RUNS; run += 1) {
      const user = `eval-rework-${run}-${stamp}`;
      await redis.set(`user:${user}:graph:main`, JSON.stringify({
        nodes: [SECTION], edges: EDGES, viewport: { x: 0, y: 0, zoom: 1 }, version: 1, userId: user,
      }));
      console.log(`\n── run ${run}`);
      let verdict;
      try {
        verdict = judge(await turn(user));
      } catch (error) {
        console.log(`  💥 ${error.message}`);
        total += judge({ result: null }).checks.length;
        continue;
      }
      for (const [name, ok] of verdict.checks) {
        console.log(`  ${ok ? '✅' : '❌'} ${name}`);
        total += 1;
        if (ok) passed += 1;
      }
      console.log(describe(verdict.ops));
      console.log(`  said: ${verdict.said.slice(0, 300)}`);
      dollars += verdict.dollars;
    }
    console.log(`\n${passed}/${total} checks passed — $${dollars.toFixed(4)}`);
  } finally {
    const keys = await redis.keys(`user:eval-rework-*-${stamp}:graph:main`);
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
  }
}

main();
