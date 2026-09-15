#!/usr/bin/env node
// dao_api2/eval-graph-builder.js
/**
 * How well the agent lays out a goal — measured, not eyeballed.
 *
 * Each goal runs against the live endpoint with an empty graph under its own
 * throwaway user, and the proposal is judged by structure alone: does a stage
 * wait for another, is there a merge point where the goal has one, is any
 * task counted by two milestones, can something start now and does the agent
 * say so, does it fit on a screen. The outline is printed for a human read.
 *
 * It costs one agent turn per goal. Run it before and after a prompt change.
 *
 * Usage: node --env-file=.env eval-graph-builder.js [baseUrl] [label]
 */

import fs from 'fs';
import Redis from 'ioredis';

import { describeProposalShape } from './src/ai/graphShape.js';

const BASE = process.argv[2] || 'http://localhost:3011';
const LABEL = process.argv[3] || 'run';
const redis = new Redis({ host: 'localhost', port: 6379 });
const stamp = Date.now();

const GOALS = [
  {
    key: 'citizenship', merge: true,
    text: 'Хочу получить болгарское гражданство по происхождению, живу в Белграде. Запись в консульство занята до 2028 года, поэтому план такой: найти человека в Болгарии, который пропишет меня у себя, получить визу D по происхождению и подаваться уже из Болгарии. Построй план.',
  },
  {
    key: 'career', merge: false,
    text: 'Построй план перехода в Applied AI Engineer за шесть месяцев: агенты, MCP, evals, RAG, продакшен-агенты, портфолио и поиск работы.',
  },
  {
    key: 'move', merge: true,
    text: 'Построй план переезда в Португалию с семьёй через полгода: виза, удалённая работа, жильё, школа для ребёнка, сам переезд.',
  },
  {
    key: 'language', merge: false,
    text: 'Построй план, как выучить испанский с нуля до B2 за год и сдать DELE.',
  },
  {
    key: 'product', merge: false,
    text: 'Построй план запуска небольшого SaaS для учёта привычек: от проверки идеи до первых платящих пользователей.',
  },
];

/** Drive one turn and collect every event it emitted. */
async function turn(userId, text) {
  const response = await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify({ messages: [{ role: 'user', content: text }], currentPath: [] }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop();
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (line) events.push(JSON.parse(line.slice(6)));
    }
  }

  return {
    statuses: events.filter((e) => e.type === 'status').map((e) => e.text),
    result: events.find((e) => e.type === 'result')?.result || events.find((e) => e.type === 'error'),
  };
}

function judge(goal, { statuses, result }) {
  const operations = result?.type === 'changes' ? result.operations : [];
  const shape = describeProposalShape(operations);
  const said = `${result?.summary || ''} ${result?.message || ''}`;
  // No nodes means no proposal at all (a refusal, or the agent running out of
  // room mid-turn) — every check fails then, not just the ones that happen to
  // read false on an empty shape.
  const proposed = shape.nodes > 0;

  return {
    operations,
    shape,
    said,
    checks: [
      ['used plan_path', proposed && statuses.some((s) => s.startsWith('planning '))],
      ['a stage waits for another', proposed && shape.stageLinks > 0],
      ['a merge point', proposed && (goal.merge ? shape.merges > 0 : true)],
      ['no task counted twice, no empty Mi', proposed && shape.doubleCounted.length === 0 && shape.miWithoutTasks === 0],
      ['names what can start now', proposed && shape.startNow.length > 0 && shape.startNow.some((t) => said.includes(t))],
      ['fits: no overlap, 1–40 nodes', proposed && shape.overlaps.length === 0 && shape.nodes <= 40],
      ['no endless habit beside a milestone', proposed && shape.habitsBesideMilestones.length === 0],
    ],
  };
}

function outline(operations) {
  const adds = operations.filter((o) => o.op === 'add');
  const title = new Map(adds.map((o) => [o.alias, o.title]));
  const arrows = [
    ...adds.flatMap((o) => (o.downstream || []).map((d) => [o.alias, d])),
    ...operations.filter((o) => o.op === 'link').map((o) => [o.source, o.target]),
  ];
  return [
    ...adds.map((o) => `    [${o.nodeType}/${o.nodeSubtype}] ${o.title}`),
    ...arrows.map(([s, t]) => `      ${title.get(s) || s} → ${title.get(t) || t}`),
  ].join('\n');
}

async function main() {
  console.log(`\n📐 Graph builder eval "${LABEL}" — ${BASE}`);
  const report = [];
  let passed = 0;
  let total = 0;

  // A throw anywhere in here — a bad turn, a full disk on the write — must
  // still leave Redis clean; this run's eval-*-<stamp> users are throwaway,
  // but the cleanup and disconnect below are what actually throws them away.
  try {
    for (const goal of GOALS) {
      const user = `eval-${goal.key}-${stamp}`;
      await redis.set(`user:${user}:graph:main`, JSON.stringify({
        nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, version: 1, userId: user,
      }));

      console.log(`\n── ${goal.key}`);
      let verdict;
      try {
        verdict = judge(goal, await turn(user, goal.text));
      } catch (error) {
        console.log(`  💥 ${error.message}`);
        report.push({ goal: goal.key, error: error.message });
        total += 7;
        continue;
      }

      for (const [name, ok] of verdict.checks) {
        console.log(`  ${ok ? '✅' : '❌'} ${name}`);
        total += 1;
        if (ok) passed += 1;
      }
      const { shape } = verdict;
      console.log(`  ${shape.nodes} nodes, ${shape.arrows} arrows, ${shape.merges} merges, ${shape.stageLinks} stage links; start now: ${shape.startNow.join(', ') || '—'}`);
      console.log(outline(verdict.operations));
      console.log(`  said: ${verdict.said.replace(/\s+/g, ' ').slice(0, 300)}`);
      report.push({ goal: goal.key, checks: verdict.checks, shape, said: verdict.said, operations: verdict.operations });
    }

    console.log(`\n${passed}/${total} checks passed`);
    fs.mkdirSync('eval-results', { recursive: true });
    const file = `eval-results/${LABEL}-${stamp}.json`;
    fs.writeFileSync(file, JSON.stringify({ label: LABEL, base: BASE, passed, total, report }, null, 2));
    console.log(`Saved ${file}`);
  } finally {
    const keys = await redis.keys(`user:eval-*-${stamp}:graph:main`);
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
  }
}

main();
