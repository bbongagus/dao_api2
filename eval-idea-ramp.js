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
 *        EVAL_ONLY=camper,gym … to run some wishes only
 *        node eval-idea-ramp.js --rejudge eval-results/<file>.json
 *        (the checks of today over a saved run — free, for a new check)
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
  {
    // A friend's real ramp, 2026-09-23: they wanted to *try* living in a van,
    // and got buy → convert → a test trip → give up the flat.
    key: 'camper',
    answers: [
      'Хочу дом на колёсах — минивэн',
      'Попробовать пожить в таком доме вместо квартиры, каково это',
      'Машины нет, нужно найти',
      '5000 евро, время — выходные',
    ],
    startsFrom: /попроб|нет машин|машины нет|5000|5 000/i,
    // A trial, and no purchase that does not wait on it along the arrows. A
    // plan that stops at "decide whether to go on" buys nothing, and passes.
    trialBefore: { trial: /аренд|прокат/i, commit: /купить|покупк|куплен/i },
  },
  {
    // The user's own, 2026-09-23: two ideas that looked like one until the
    // fourth answer. The agent kept one, said "the system allows one plan at
    // a time", promised the other for the next message, and ended on a
    // routine ("the rhythm holds") where the point was a new job.
    key: 'linkedin',
    answers: [
      'Мне нужно продвигать свою страницу в LinkedIn и писать посты про продукт, который я пишу, не знаю, как это запланировать. Ещё хочу потихоньку пиарить сам продукт в соцсетях, но тоже не знаю как',
      'Каждый день по час-два',
      '1200 подписчиков, постил давно, год назад, сейчас не пишу вообще',
      'Пользователей у продукта нет. Но это две задачи: продвижение себя для поиска новой работы и продвижение продукта — отдельные штуки',
      'Личный бренд важнее',
    ],
    others: 1,
    // The last milestone is the result, not the habit that leads to it.
    outcome: /собеседован|интервью|оффер|приглашен|работ|рекрут|отклик|предложен/i,
  },
  {
    // The user's own: "бюджет есть", no amount, no currency — and the plan
    // put its test at "10–15 тыс. рублей".
    key: 'dao-clients',
    answers: ['Мне надо начать продвигать свой продукт — ДАО', 'Найти первых клиентов', 'С нуля', 'Час-два в день, бюджет есть'],
    noCurrency: true,
    outcome: /клиент|пользовател|продаж|оплат/i,
  },
];

const ONLY = (process.env.EVAL_ONLY || '').split(',').map((k) => k.trim()).filter(Boolean);

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

// Russian only: the panel's own opening says «вы», and so should the agent.
// Word edges by hand — \b in a JavaScript regex knows only ASCII letters.
const word = (alternatives) => new RegExp(`(?<![а-яё])(${alternatives})(?![а-яё])`, 'iu');
const SAYS_TY = word('ты|тебя|тебе|тобой|твой|твоя|твоё|твои|твоего|твоей|[а-яё]+(?:ешь|ёшь|ишь)');
// Nothing is applied until the person confirms: a plan is proposed, not done.
const REPORTS_DONE = word('собрал|построил|заложил|составил|сделал|разбил');
// The person never sees tools; a promise for "the next message" is kept by no one.
const SPEAKS_OF_TOOLS = /plan_path|один план за раз|систем[аеуы]\s+(?:не\s+)?(?:даёт|дает|разрешает|позволяет)|в следующем сообщении/iu;
const NAMES_CURRENCY = /руб|₽|\$|доллар|евро|€|(?<![a-z])(?:usd|eur|rub)(?![a-z])/iu;

const isQuestion = (result) => result?.type === 'text' && result.message.includes('?');
// One short sentence with a few example answers — generous, so it catches a
// lecture, not a long-ish question.
const isShort = (result) => (result?.message || '').length <= 320;

/** The milestone nothing else waits on — where the plan ends. */
function lastMilestone(operations) {
  const adds = operations.filter((o) => o.op === 'add');
  const feeds = new Set([
    ...adds.filter((o) => (o.downstream || []).length).map((o) => o.alias),
    ...operations.filter((o) => o.op === 'link').map((o) => o.source),
  ]);
  const ends = adds.filter((o) => o.nodeType === 'fundamental' && o.nodeSubtype === 'upstream' && !feeds.has(o.alias));
  return ends.at(-1) || null;
}

/**
 * Whether the plan tries before it commits: some node titled like `trial`,
 * and every node titled like `commit` reached from one along the arrows.
 */
function triesFirst(operations, trial, commit) {
  const adds = operations.filter((o) => o.op === 'add');
  if (!adds.some((o) => trial.test(o.title))) return false;
  return adds
    .filter((o) => commit.test(o.title) && !trial.test(o.title))
    .every((o) => reachedFrom(operations, trial, o.alias));
}

/** Whether some node titled like `from` reaches the node `target` along the plan's arrows. */
function reachedFrom(operations, from, target) {
  const adds = operations.filter((o) => o.op === 'add');
  const next = new Map(adds.map((o) => [o.alias, [...(o.downstream || [])]]));
  for (const link of operations.filter((o) => o.op === 'link')) next.get(link.source)?.push(link.target);
  // A step's checklist sits inside it; reaching the step reaches its items.
  for (const o of adds) if (o.parent && next.has(o.parent)) next.get(o.parent).push(o.alias);
  const starts = adds.filter((o) => from.test(o.title)).map((o) => o.alias);
  const seen = new Set();
  const queue = [...starts];
  while (queue.length) {
    const at = queue.shift();
    if (seen.has(at)) continue;
    seen.add(at);
    if (at === target) return true;
    queue.push(...(next.get(at) || []));
  }
  return false;
}

function judge(wish, turns) {
  const last = turns.at(-1);
  const planned = last.result?.type === 'changes' && last.statuses.some((s) => s.startsWith('planning '));
  const operations = planned ? last.result.operations : [];
  const shape = describeProposalShape(operations);
  const said = last.result?.summary || last.result?.message || '';
  const asked = turns.slice(0, -1).map((t) => t.result);
  const section = operations.find((o) => o.alias === 'plan:section');
  const others = operations.filter((o) => o.op === 'add' && !o.alias.startsWith('plan:') && o.nodeType === 'dao' && !o.parent);

  const agentSaid = turns.map((t) => (t.result?.type === 'text' ? t.result.message : t.result?.summary || '')).join('\n');

  const checks = [
    ['asks before it plans', turns[0].result?.type === 'text' && isQuestion(turns[0].result)],
    ['says «вы», as the panel does', !SAYS_TY.test(agentSaid)],
    ['proposes the plan, does not report it done', planned && !REPORTS_DONE.test(said)],
    ['never speaks of its tools, never promises a later message', !SPEAKS_OF_TOOLS.test(agentSaid)],
    ['every question is short, and one', asked.every((r) => isQuestion(r) && isShort(r) && (r.message.match(/\?/g) || []).length <= 2)],
    [`plans within ${MAX_TURNS} turns`, planned],
    ['no task counted twice, no empty Mi', planned && shape.doubleCounted.length === 0 && shape.miWithoutTasks === 0],
    ['names what can start now', planned && shape.startNow.length > 0 && shape.startNow.some((t) => said.includes(t))],
  ];
  if (wish.stopAt) checks.push(['plans on the turn it is told to', planned && turns.length === wish.stopAt]);
  if (wish.startsFrom) checks.push(['the section says where they start', planned && wish.startsFrom.test(section?.description || '')]);
  if (wish.others) checks.push([`keeps the other ${wish.others} ideas as tasks`, planned && others.length === wish.others]);
  if (wish.noCurrency) checks.push(['names no currency the person never gave', !NAMES_CURRENCY.test(agentSaid)]);
  if (wish.outcome) checks.push(['ends on the outcome', planned && wish.outcome.test(lastMilestone(operations)?.title || '')]);
  if (wish.trialBefore) checks.push(['tries it before it commits to it', planned && triesFirst(operations, wish.trialBefore.trial, wish.trialBefore.commit)]);

  return { checks, shape, operations, section, others, said };
}

/** Today's checks over a saved run, without a single upstream call. */
function rejudge(file) {
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  let passed = 0;
  let total = 0;
  for (const entry of saved.report) {
    const wish = WISHES.find((w) => w.key === entry.wish);
    if (!wish || !entry.turns) continue;
    console.log(`\n── ${entry.wish}`);
    for (const [name, ok] of judge(wish, entry.turns).checks) {
      console.log(`  ${ok ? '✅' : '❌'} ${name}`);
      total += 1;
      if (ok) passed += 1;
    }
  }
  console.log(`\n${passed}/${total} checks passed (rejudged ${file})`);
}

async function main() {
  console.log(`\n🌱 Idea ramp eval "${LABEL}" — ${BASE}`);
  const report = [];
  let passed = 0;
  let total = 0;

  // A throw anywhere in here must still leave Redis clean: the cleanup and
  // disconnect below are what throw this run's eval-ramp-*-<stamp> users away.
  try {
    for (const wish of WISHES.filter((w) => ONLY.length === 0 || ONLY.includes(w.key))) {
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

if (process.argv[2] === '--rejudge') {
  rejudge(process.argv[3]);
  redis.disconnect();
} else {
  main();
}
