#!/usr/bin/env node
// dao_api2/eval-idea-ramp.js
/**
 * How well the idea ramp turns a wish into a plan — measured, not eyeballed
 * (plans/2026-09-23-idea-ramp-design.md).
 *
 * Each wish runs as a ramp chat against the live endpoint, on an empty graph
 * under its own throwaway user. The person's answers are scripted and fed one
 * per turn, whatever the agent asked; once they run out, the person says
 * "хватит, строй". The conversation is judged by its shape: the agent asks
 * before it plans, one short question at a time, stops when told, plans
 * within five turns, and the plan carries what the answers said.
 *
 * It costs up to five agent turns per wish. Run it before and after a change
 * to RAMP_PROMPT; eval-graph-builder.js still measures the ordinary chat.
 *
 * Usage: node --env-file=.env eval-idea-ramp.js [baseUrl] [label]
 */

import fs from 'fs';
import Redis from 'ioredis';

import { describeProposalShape } from './src/ai/graphShape.js';
import { devTokenFromEnv } from './src/auth/devToken.js';

const BASE = process.argv[2] || 'http://localhost:3011';
const LABEL = process.argv[3] || 'ramp';
const redis = new Redis({ host: 'localhost', port: 6379 });
const stamp = Date.now();

const MAX_TURNS = 5;
const STOP = 'Хватит, строй.';

const WISHES = [
  {
    key: 'gym',
    answers: [
      'Хочу накачаться',
      'Никогда не ходил в зал, весь день сижу за компьютером',
      'Подтягиваться 10 раз и чтобы плечи стали шире',
      'Часа три в неделю, по вечерам',
      'Бросал бег через две недели — одному скучно',
    ],
    // The section should say where this person starts from.
    startsFrom: /зал|нул|новичок|никогда|компьютер|сидяч/i,
  },
  {
    key: 'stop-early',
    answers: ['Выучить испанский', STOP],
    stopAt: 2,
    startsFrom: null,
  },
  {
    key: 'several',
    answers: [
      'Накачаться, выучить испанский и сменить работу',
      'Давай с испанского',
      'С нуля, знаю пару слов',
      'Полчаса в день',
    ],
    others: 2,
    startsFrom: /нул|пару слов|начина/i,
  },
  {
    key: 'dont-know',
    answers: ['Начать бегать', 'Не знаю', 'Не знаю', 'Не знаю'],
    startsFrom: null,
  },
];

/** Drive one turn of a ramp chat and collect every event it emitted. */
async function turn(userId, messages) {
  const response = await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await devTokenFromEnv(userId)}` },
    body: JSON.stringify({ messages, currentPath: [], mode: 'ramp' }),
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

/** The whole chat: answers one per turn until a plan comes, or five turns pass. */
async function converse(userId, wish) {
  const messages = [];
  const turns = [];
  for (let i = 0; i < MAX_TURNS; i++) {
    const said = wish.answers[i] ?? STOP;
    messages.push({ role: 'user', content: said });
    const { statuses, result } = await turn(userId, messages);
    turns.push({ said, statuses, result });
    if (result?.type !== 'text') break;
    messages.push({ role: 'assistant', content: result.message });
  }
  return turns;
}

const isQuestion = (result) => result?.type === 'text' && result.message.includes('?');
// One short sentence with a few example answers — generous, so it catches a
// lecture, not a long-ish question.
const isShort = (result) => (result?.message || '').length <= 320;

function judge(wish, turns) {
  const last = turns.at(-1);
  const planned = last.result?.type === 'changes' && last.statuses.some((s) => s.startsWith('planning '));
  const operations = planned ? last.result.operations : [];
  const shape = describeProposalShape(operations);
  const said = last.result?.summary || last.result?.message || '';
  const asked = turns.slice(0, -1).map((t) => t.result);
  const section = operations.find((o) => o.alias === 'plan:section');
  const others = operations.filter((o) => o.op === 'add' && !o.alias.startsWith('plan:') && o.nodeType === 'dao' && !o.parent);

  const checks = [
    ['asks before it plans', turns[0].result?.type === 'text' && isQuestion(turns[0].result)],
    ['every question is short, and one', asked.every((r) => isQuestion(r) && isShort(r) && (r.message.match(/\?/g) || []).length <= 2)],
    [`plans within ${MAX_TURNS} turns`, planned],
    ['no task counted twice, no empty Mi', planned && shape.doubleCounted.length === 0 && shape.miWithoutTasks === 0],
    ['names what can start now', planned && shape.startNow.length > 0 && shape.startNow.some((t) => said.includes(t))],
  ];
  if (wish.stopAt) checks.push(['plans on the turn it is told to', planned && turns.length === wish.stopAt]);
  if (wish.startsFrom) checks.push(['the section says where they start', planned && wish.startsFrom.test(section?.description || '')]);
  if (wish.others) checks.push([`keeps the other ${wish.others} ideas as tasks`, planned && others.length === wish.others]);

  return { checks, shape, operations, section, others, said };
}

async function main() {
  console.log(`\n🌱 Idea ramp eval "${LABEL}" — ${BASE}`);
  const report = [];
  let passed = 0;
  let total = 0;

  // A throw anywhere in here must still leave Redis clean: the cleanup and
  // disconnect below are what throw this run's eval-ramp-*-<stamp> users away.
  try {
    for (const wish of WISHES) {
      const user = `eval-ramp-${wish.key}-${stamp}`;
      await redis.set(`user:${user}:graph:main`, JSON.stringify({
        nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, version: 1, userId: user,
      }));

      console.log(`\n── ${wish.key}`);
      let turns;
      try {
        turns = await converse(user, wish);
      } catch (error) {
        console.log(`  💥 ${error.message}`);
        report.push({ wish: wish.key, error: error.message });
        continue;
      }

      for (const t of turns) {
        console.log(`  › ${t.said}`);
        const reply = t.result?.type === 'text' ? t.result.message : (t.result?.summary || t.result?.message || '');
        console.log(`    ${reply.replace(/\s+/g, ' ').slice(0, 300)}`);
      }

      const verdict = judge(wish, turns);
      for (const [name, ok] of verdict.checks) {
        console.log(`  ${ok ? '✅' : '❌'} ${name}`);
        total += 1;
        if (ok) passed += 1;
      }
      const { shape } = verdict;
      console.log(`  ${turns.length} turns; ${shape.nodes} nodes, ${shape.arrows} arrows; start now: ${shape.startNow.join(', ') || '—'}`);
      if (verdict.section) console.log(`  section: ${verdict.section.title} — ${verdict.section.description}`);
      if (verdict.others.length) console.log(`  kept for later: ${verdict.others.map((o) => o.title).join(', ')}`);
      const dollars = turns.reduce((sum, t) => sum + (t.result?.usage?.dollars || 0), 0);
      console.log(`  cost: $${dollars.toFixed(4)}`);
      report.push({ wish: wish.key, checks: verdict.checks, shape, turns, dollars });
    }

    console.log(`\n${passed}/${total} checks passed`);
    fs.mkdirSync('eval-results', { recursive: true });
    const file = `eval-results/${LABEL}-${stamp}.json`;
    fs.writeFileSync(file, JSON.stringify({ label: LABEL, base: BASE, passed, total, report }, null, 2));
    console.log(`Saved ${file}`);
  } finally {
    const keys = await redis.keys(`user:eval-ramp-*-${stamp}:graph:main`);
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
  }
}

main();
