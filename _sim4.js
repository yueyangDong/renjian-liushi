const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const code = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];

function mkEl(t){
  const e = { tagName:t||'div', innerHTML:'', textContent:'', value:'', style:{}, dataset:{},
    children:[], classList:{add(){},remove(){},toggle(){}},
    appendChild(c){this.children.push(c);return c;}, removeChild(){}, remove(){}, insertBefore(){},
    focus(){}, blur(){}, click(){}, setAttribute(){}, getAttribute(){return null;}, removeAttribute(){},
    addEventListener(){}, removeEventListener(){}, querySelector(){return mkEl();},
    querySelectorAll(){return [];}, closest(){return null;}, scrollIntoView(){},
    getBoundingClientRect(){return {top:0,left:0,width:0,height:0};} };
  return e;
}
const reg = {};
const node = id => reg[id] || (reg[id] = mkEl());
global.document = { getElementById:id=>node('#'+id), querySelector:s=>node(s), querySelectorAll:()=>[],
  createElement:t=>mkEl(t), createTextNode:()=>mkEl('text'), addEventListener(){},
  body:mkEl('body'), documentElement:mkEl('html'), head:mkEl('head') };
global.window = { location:{search:'',href:'',hash:''}, scrollTo(){}, scrollY:0, innerWidth:1280, innerHeight:800,
  addEventListener(){}, removeEventListener(){}, matchMedia:()=>({matches:false,addEventListener(){},addListener(){}}),
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}}, requestAnimationFrame:f=>setTimeout(f,0),
  cancelAnimationFrame(){}, devicePixelRatio:1 };
global.localStorage = window.localStorage;
global.location = window.location;
global.navigator = { userAgent:'node' };
global.requestAnimationFrame = window.requestAnimationFrame;
global.cancelAnimationFrame = () => {};
global.Image = function(){ return {}; };
global.Audio = function(){ return { play(){}, pause(){}, cloneNode(){ return { play(){} }; }, volume:1 }; };

const wrapped = code + `;globalThis.__api={S,ORIGINS,startLife,pickEvent,EV,choose,advanceFold,setPending:v=>{pending=v;},analyseBazi,makeBazi,makePeers,peerTitle,duizhiEvent,dueEvent,fullEvent,peerEvent,
hook:()=>{renderCard=function(){globalThis.__ev=pickEvent();};}};`;
new Function(wrapped)();
const A = globalThis.__api, S = A.S;
S.auto = true; S.silent = true;
A.hook();

const tally = {}, evt = {}, errs = {};
let n = 0, folds = 0, duizhi = 0, love2 = 0, dueTotal = 0, fullTotal = 0, peerTotal = 0;

for (let t = 0; t < 200; t++){
  S.index = 1; S.lives = []; S.edits = []; S.hand = [];
  S.bz = A.analyseBazi(A.makeBazi()); S.rooted = false; S.rootAt = null;
  const era = t % 2 ? 'mo' : 'an';
  A.setPending({ era, y0: era === 'mo' ? 2026 : 1526 });
  A.startLife(A.ORIGINS[Math.floor(Math.random()*A.ORIGINS.length)]);
  let hadL2 = false;
  for (let f = 0; f < 16 && S.life; f++){
    let ev = globalThis.__ev;
    if (!ev) break;
    if (!ev) break;
    evt[ev.id] = (evt[ev.id]||0)+1;
    if (ev.id === 'duizhi') duizhi++;
    const o = ev.opts[Math.floor(Math.random()*ev.opts.length)];
    try { A.choose(ev, o); } catch(e){ errs['choose:'+e.message] = (errs['choose:'+e.message]||0)+1; break; }
    if (S.life && S.life.love2) hadL2 = true;
    try { A.advanceFold(); } catch(e){ errs['adv:'+e.message] = (errs['adv:'+e.message]||0)+1; break; }
    folds++;
    if (!S.life) break;
  }
  if (S.life && S.life.love2) hadL2 = true;
  const L = S.life;
  if (hadL2) love2++;
  n++;
  const r = S.lives[0];
  if (r){ const k = r.verdict.split(' · ')[0]; tally[k] = (tally[k]||0)+1; }
}

console.log('局数', n, '总折', folds, '平均折', (folds/n).toFixed(2));
console.log('结局', JSON.stringify(tally));
const rel = {};
for (const k in tally) rel[k] = (tally[k]/n*100).toFixed(1)+'%';
console.log('占比', JSON.stringify(rel));
console.log('新事件触发次数：');
['peer_ask','peer_block','peer_fall','peer_pay','full','duizhi','due_audit','due_grudge','due_favor'].forEach(k =>
  console.log('  ', k, evt[k] || 0));
console.log('有第二段关系的局:', love2, '（' + (love2/n*100).toFixed(1) + '%）  对质局:', duizhi);
console.log('错误:', Object.keys(errs).length ? JSON.stringify(errs) : '无');
