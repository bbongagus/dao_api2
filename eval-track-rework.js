/** Opt-in live-model regression. Synthetic graph only; no Redis or graph writes.
 * Usage: railway run -s web -- node eval-track-rework.js --live
 */
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'node:fs';
import { resolveProvider } from './src/ai/provider.js';
import { isPriced } from './src/ai/cost.js';
import { runGraphAgent } from './src/ai/agent.js';
import { projectDraft } from './src/ai/graphDraft.js';
import { trackReworkFixture } from './src/ai/fixtures/trackRework.js';

if (!process.argv.includes('--live')) throw new Error('This evaluation uses paid model calls. Pass --live explicitly.');
const provider = resolveProvider();
if (!provider.configured || !isPriced(provider.model)) throw new Error('A configured, priced provider is required.');
const f = trackReworkFixture();
const tools = [];
const client = new Anthropic({ ...provider.clientOptions, maxRetries:0 });
const result = await runGraphAgent({ client, model:provider.model, extraBody:provider.extraBody, thinking:provider.thinking,
  nodes:f.nodes, edges:f.edges, currentPath:['area'], canMove:true, emit:()=>{}, onToolCall:c=>tools.push(c),
  signal:AbortSignal.timeout(240000),
  messages:[{role:'user',content:'Переделай область «Публичное присутствие». Сейчас там папки-недели, а нужен единый связанный путь на одном уровне: один Track, от него профиль, затем подцель, затем первые три статьи, подцель, ещё три статьи, подцель, ещё три статьи и финальная подцель. Каждый этап одна неделя. Внутри каждого этапа параллельно основной работе нужен настоящий todo list на семь комментариев с отдельными галочками. Уже выполненный комментарий — первый пункт первого списка. Все существующие статьи, профиль, их задачи, отметки и даты сохрани. Первые две статьи уже опубликованы, их не начинать заново. Недельных групп быть не должно. Используй имеющиеся задачи, не создавай копии.'}],
});
let checks={proposed:result.type==='changes'};
try {
 if(result.type==='changes') {
  const d=projectDraft(f.nodes,f.edges,result.operations,f.aliases);
  const all=d.aliases.all.map(e=>e.node), byId=new Map(all.map(n=>[n.id,n]));
  const milestones=all.filter(n=>n.nodeSubtype==='upstream');
  const area=byId.get('area');
  const track=area.children.find(n=>n.nodeSubtype==='downstream');
  const reach=start=>{const visited=new Set(); const visit=id=>{if(visited.has(id))return;visited.add(id);d.edges.filter(e=>e.source===id).forEach(e=>visit(e.target));};visit(start);return visited;};
  const reachable=reach(track.id);
  const lists=all.filter(n=>n.nodeType==='dao'&&n.children.length);
  checks={...checks,
   oneTrack:track?.nodeSubtype==='downstream'&&all.filter(n=>n.nodeSubtype==='downstream').length===1,
   fourOutcomes:milestones.length===4,
   oneContainer:area.nodeSubtype==='category'&&all.filter(n=>n.nodeSubtype==='category').length===1,
   sameLevel:!track.children.length&&area.children.every(n=>reachable.has(n.id)),
   sequentialOutcomes:milestones.every((m,i)=>milestones.every((other,j)=>i===j||reach(m.id).has(other.id)||reach(other.id).has(m.id))),
   fourChecklists:lists.length===4&&lists.every(n=>n.children.length===7&&n.children.every(c=>!c.children.length&&!d.edges.some(e=>e.source===c.id||e.target===c.id))),
   preserved:f.aliases.all.filter(e=>e.node.nodeType==='dao'||e.node.nodeSubtype==='upstream').every(({node:n})=>byId.get(n.id)?.isDone===n.isDone&&byId.get(n.id)?.doneAt===n.doneAt),
   completedComment:lists.some(n=>n.children.some(c=>c.id==='commentDone'&&c.isDone)),
   nineArticles:all.filter(n=>/Опубликовать статью \d/.test(n.title)).length===9,
   unrelatedUntouched:JSON.stringify(byId.get('unrelated'))===JSON.stringify({...f.nodes[1],linkedNodeIds:{}}),
  };
 }
} catch(e) { checks.projection=e.message; }
writeFileSync('/private/tmp/dao-track-live-eval.json',JSON.stringify({checks,result,tools},null,2),{mode:0o600});
console.log(JSON.stringify({checks,type:result.type,usage:result.usage,tools:tools.map(c=>({name:c.name,ok:!String(c.result).startsWith('That did not work')}))},null,2));
if(!Object.values(checks).every(v=>v===true)) process.exitCode=1;
