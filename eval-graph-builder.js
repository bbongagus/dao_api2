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
 * Usage: node --env-file=.env eval-graph-builder.js [baseUrl] [label] [goals.json]
 *
 * The built-in goals are the ones the prompt was tuned on, so a perfect score
 * on them can flatter it. eval-goals-holdout.json holds goals nobody tuned
 * against; pass it as the third argument to see how a prompt or a model does
 * on something new.
 */

import fs from 'fs';
import Redis from 'ioredis';

import { describeProposalShape, garbledWords } from './src/ai/graphShape.js';
import { devTokenFromEnv } from './src/auth/devToken.js';

const BASE = process.argv[2] || 'http://localhost:3011';
const LABEL = process.argv[3] || 'run';
const GOALS_FILE = process.argv[4];
const redis = new Redis({ host: 'localhost', port: 6379 });
const stamp = Date.now();

// The goals the prompt was tuned on. `merge`: the goal has a point where
// parallel work meets. `parallel`: whole stages of it can run side by side
// and meet later — documents and a host for the address, the edit and the
// cover — so a plan that is one chain of stages misstates what can start.
const TUNED_GOALS = JSON.parse(fs.readFileSync(new URL('./eval-goals-tuned.json', import.meta.url), 'utf8'));

const GOALS = GOALS_FILE ? JSON.parse(fs.readFileSync(GOALS_FILE, 'utf8')) : TUNED_GOALS;

/** Drive one turn and collect every event it emitted. */
async function turn(userId, text) {
  const startedAt = Date.now();
  const response = await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await devTokenFromEnv(userId)}` },
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
    ms: Date.now() - startedAt,
  };
}

/** Every goal is asked in Russian; a reply in another language is a failure a person would notice first. */
const inRussian = (text) => {
  const letters = text.match(/\p{L}/gu) || [];
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu) || [];
  return letters.length > 0 && cyrillic.length / letters.length > 0.6;
};

function judge(goal, { statuses, result, ms }) {
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
    ms,
    usage: result?.usage ?? null,
    outcome: result?.type ?? 'nothing',
    // Titles as a whole, not one by one: "DELE B2" is a fine title in a Russian plan.
    russian: inRussian(said) && inRussian(operations.filter((o) => o.op === 'add').map((o) => o.title).join(' ') || 'пусто'),
    checks: [
      ['used plan_path', proposed && statuses.some((s) => s.startsWith('planning '))],
      ['a stage waits for another', proposed && shape.stageLinks > 0],
      ['a merge point', proposed && (goal.merge ? shape.merges > 0 : true)],
      ['no task counted twice, no empty Mi', proposed && shape.doubleCounted.length === 0 && shape.miWithoutTasks === 0],
      ['names what can start now', proposed && shape.startNow.length > 0 && shape.startNow.some((t) => said.includes(t))],
      // Checklist items live inside their card, so only cards take room.
      ['fits: no overlap, 1–40 cards on the canvas', proposed && shape.overlaps.length === 0 && shape.canvasNodes <= 40],
      ['no endless habit beside a milestone', proposed && shape.habitsBesideMilestones.length === 0],
      ['stages run side by side where the goal allows', proposed && (goal.parallel ? shape.stageMerges > 0 : true)],
      ['no broken words', proposed && shape.garbled.length === 0 && garbledWords(said).length === 0],
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
  const spent = { dollars: 0, ms: 0, russian: 0 };

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
        // A turn that failed fails every check, however many there are.
        total += judge(goal, { statuses: [], result: null, ms: 0 }).checks.length;
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
      const dollars = verdict.usage?.dollars ?? 0;
      spent.dollars += dollars;
      spent.ms += verdict.ms;
      if (verdict.russian) spent.russian += 1;
      console.log(`  ${verdict.outcome}, $${dollars.toFixed(4)}, ${Math.round(verdict.ms / 1000)}s, ${verdict.usage?.calls ?? '?'} calls, ${verdict.russian ? 'in Russian' : 'NOT all in Russian'}`);
      report.push({
        goal: goal.key, checks: verdict.checks, shape, said: verdict.said, operations: verdict.operations,
        outcome: verdict.outcome, usage: verdict.usage, ms: verdict.ms, russian: verdict.russian,
      });
    }

    console.log(`\n${passed}/${total} checks passed — $${spent.dollars.toFixed(4)}, ${Math.round(spent.ms / 1000)}s, ${spent.russian}/${GOALS.length} in Russian`);
    fs.mkdirSync('eval-results', { recursive: true });
    const file = `eval-results/${LABEL}-${stamp}.json`;
    fs.writeFileSync(file, JSON.stringify({ label: LABEL, base: BASE, passed, total, spent, report }, null, 2));
    console.log(`Saved ${file}`);
  } finally {
    const keys = await redis.keys(`user:eval-*-${stamp}:graph:main`);
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
  }
}

main();
