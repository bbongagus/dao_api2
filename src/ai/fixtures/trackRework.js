// Synthetic graph with the same structural failure; no production ids/data.
import { buildAliasTable } from '../aliases.js';
const task = (id, title, done = false) => ({ id, title, description: '', position: { x: 0, y: 0 }, nodeType: 'dao', nodeSubtype: 'simple', children: [], isDone: done,
  ...(done ? { doneAt: '2026-09-20T12:00:00Z' } : {}) });
export function trackReworkFixture() {
  const edges = [];
  const link = (source, target) => edges.push({ source, target, direction: 'downstream' });
  const weeks = Array.from({ length: 4 }, (_, i) => ({ ...task(`week${i+1}`, `Неделя ${i+1}`), nodeType: 'fundamental', nodeSubtype: 'category',
    children: [task(`comments${i+1}`, i ? 'Оставить 7 комментариев' : 'Оставить ещё 6 комментариев')] }));
  weeks[0].children.push(task('headline','Обновить заголовок профиля',true), task('about','Обновить описание профиля',true),
    { ...task('profile','Профиль обновлён'), nodeType:'fundamental', nodeSubtype:'upstream' }, task('commentDone','Опубликованный комментарий',true));
  link('headline','profile'); link('about','profile');
  for(let n=1;n<=9;n++) {
    const week = weeks[Math.ceil(n/3)];
    week.children.push(task(`topic${n}`,`Выбрать тему статьи ${n}`,n<=3), task(`write${n}`,`Написать статью ${n}`,n<=2), task(`publish${n}`,`Опубликовать статью ${n}`,n<=2));
    link(`topic${n}`,`write${n}`); link(`write${n}`,`publish${n}`);
    if(n<=3) link('profile',`topic${n}`);
  }
  const nodes = [{ ...task('area','Публичное присутствие'), nodeType:'fundamental', nodeSubtype:'category', children:weeks }, task('unrelated','Другая цель',true)];
  const aliases = buildAliasTable(nodes), ref=id=>aliases.aliasOf(id);
  const step = (id, after=[]) => ({ id, title:aliases.nodeAt(ref(id)).title, existing:ref(id), description:'', after, checklistCount:0, checklist:[] });
  const stages = weeks.map((_,i) => ({ id:`s${i+1}`, title:`Этап ${i+1} завершён`, description:'Одна неделя', after:[], ...(i===0?{existing:ref('profile')}:{}),
    steps:[...(i===0?[step('headline'),step('about')]:Array.from({length:3},(_,j)=>i*3-2+j).flatMap(n=>[step(`topic${n}`),step(`write${n}`,[`topic${n}`]),step(`publish${n}`,[`write${n}`])])),
      { id:'comments', title:'7 комментариев', description:'Отметить каждый опубликованный комментарий', existing:ref(`comments${i+1}`), after:[], checklistCount:7,
        checklist:Array.from({length:7},(_,j)=>i===0&&j===0?{title:'Опубликованный комментарий',existing:ref('commentDone')}:`Комментарий ${j+1}`) }] }));
  const plan = { layout:'track', sequence:true, section:ref('area'), sectionTitle:'Публичное присутствие', sectionDescription:'', stages };
  return { nodes, edges, aliases, plan };
}
