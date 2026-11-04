// 一次性审计脚本（_ 开头，被 .gitignore 忽略）
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

const wrapped = code + `;globalThis.__api={S,EV,ORIGINS,TRACK,JOB,startLife,pickEvent,choose,setPending:v=>{pending=v;},
  advanceFold,analyseBazi,makeBazi,hook:()=>{renderCard=function(){globalThis.__ev=pickEvent();};},
  poke:()=>{globalThis.__EV=EV; globalThis.__TRACK=TRACK; globalThis.__JOB=JOB; globalThis.__JOBS=JOBS; globalThis.__WX=WX_CAI;}};`;
new Function(wrapped)();
const A = globalThis.__api;
A.poke();
const { __EV: EV, __TRACK: TRACK, __JOB: JOB, __JOBS: JOBS } = globalThis;
const ORIGINS = A.ORIGINS;

const problems = [];
const P = (s) => problems.push(s);

/* ── 1. 事件表结构 ── */
const ids = new Map();
const HEADS = new Set(['study','yamen','home','wedding','journey','ruin','court','censor','winter','field','war','dispatch','examine']);
EV.forEach((e, i) => {
  if (e.onlyAn) return;          // 只有古世的事件，不要求今世文案
  if (!e.id) { P(`[${i}] 无 id`); return; }
  if (ids.has(e.id)) P(`重复 id: ${e.id}`);
  ids.set(e.id, e);
  if (e.head && !HEADS.has(e.head)) P(`${e.id}: head 未定义题图 → ${e.head}`);
  if (!e.bodyAn) P(`${e.id}: 缺 bodyAn`);
  if (!e.bodyMo) P(`${e.id}: 缺 bodyMo`);
  if (typeof e.minAge === 'number' && typeof e.maxAge === 'number' && e.minAge > e.maxAge)
    P(`${e.id}: minAge ${e.minAge} > maxAge ${e.maxAge}`);
  if (!Array.isArray(e.opts) || e.opts.length < 2) { P(`${e.id}: 选项少于 2 个`); return; }
  e.opts.forEach((o, j) => {
    if (!o.t) P(`${e.id} 选项${j}: 缺 t`);
    if (!o.tMo) P(`${e.id} 选项${j}「${o.t}」: 缺 tMo（现代局会显示古语）`);
    if (o.sub && !o.subMo) P(`${e.id} 选项${j}「${o.t}」: 有 sub 缺 subMo`);
    if (o.line && !o.lineMo) P(`${e.id} 选项${j}「${o.t}」: 有 line 缺 lineMo`);
    if (!o.eff || typeof o.eff !== 'object') P(`${e.id} 选项${j}: 缺 eff`);
    else for (const k in o.eff){
      if (!['室','财','子','禄','寿','誉'].includes(k)) P(`${e.id} 选项${j}: eff 键非法「${k}」`);
      if (typeof o.eff[k] !== 'number' || !isFinite(o.eff[k])) P(`${e.id} 选项${j}: eff.${k} 非数字`);
    }
    if (o.cai) for (const k in o.cai){
      if (!['智','体','言','巧','忍','缘'].includes(k)) P(`${e.id} 选项${j}: cai 键非法「${k}」`);
    }
  });
});

/* ── 2. 轨 / 出身 表 ── */
TRACK.forEach(t => {
  if (!t.an) P(`TRACK 缺 an: ${JSON.stringify(t)}`);
  if (!t.mo) P(`TRACK「${t.an}」缺 mo（现代局会显示古名）`);
});
ORIGINS.forEach(o => {
  if (!o.an) P(`ORIGIN 缺 an`);
  if (!o.mo) P(`ORIGIN「${o.an}」缺 mo`);
});
JOBS.forEach(j => { if (!j.an || !j.mo) P(`JOB 缺古今名: ${j.an||j.mo}`); if(!j.f) P(`JOB ${j.id} 缺 f`); });

/* ── 3. 跑局：真实代码，800 世 ── */
const seen = new Set();
const errs = {};
let lives = 0, folds = 0, maxAge = 0, badSix = 0, nanSix = 0, over = 0;

A.S.auto = true; A.S.silent = true;
A.hook();                 // renderCard 成为唯一抽事件出口

function runOne(){
  A.S.index = 1; A.S.lives = []; A.S.edits = []; A.S.hand = [];
  A.S.bz = A.analyseBazi(A.makeBazi()); A.S.rooted = false;
  const era = Math.random() < .5 ? 'an' : 'mo';
  A.setPending({ era, y0: era === 'an' ? 1494 + Math.floor(Math.random()*100) : 2020 + Math.floor(Math.random()*13) });
  A.startLife(A.ORIGINS[Math.floor(Math.random()*A.ORIGINS.length)]);

  for (let f = 0; f < 14; f++){
    const ev = globalThis.__ev;
    if (!ev || !A.S.life) break;
    seen.add(ev.id);
    const o = ev.opts[Math.floor(Math.random()*ev.opts.length)];
    if (!o){ P(`${ev.id}: 选不出选项`); break; }
    try { A.choose(ev, o); }
    catch(e){ const k = 'choose('+ev.id+'): ' + e.message; errs[k] = (errs[k]||0)+1; break; }
    foldCheck();
    if (!A.S.life) break;
    try { A.advanceFold(); }
    catch(e){ const k = 'advanceFold('+ev.id+'): ' + e.message; errs[k] = (errs[k]||0)+1; break; }
    if (!A.S.life) break;
  }
  lives++;
  if (A.S.life) maxAge = Math.max(maxAge, A.S.life.age);
}

function foldCheck(){
  const L = A.S.life;
  if (!L) return;
  folds++;
  for (const k of ['室','财','子','禄','寿','誉']){
    const v = L.six[k];
    if (typeof v !== 'number' || !isFinite(v)){ nanSix++; if (nanSix < 4) P(`six.${k} 非数字: ${v}（第 ${L.fold} 折）`); }
    else if (v < -40 || v > 110){ over++; if (over < 4) P(`six.${k} 越界: ${v}（第 ${L.fold} 折）`); }
  }
  if (L.age > 110){ badSix++; P(`age 越界: ${L.age}`); }
  // 暗线与各种标量：任何一个变成 NaN，后面的判断就全部静默失效
  for (const k of ["ink","law","yun","study","pupils","deeds","fold","age"]){
    const v = L[k];
    if (v !== undefined && (typeof v !== "number" || !isFinite(v)))
      P(`L.${k} = ${v}（第 ${L.fold} 折）`);
  }
  for (const k in (L.cai||{})){
    if (!isFinite(L.cai[k])) P(`cai.${k} = ${L.cai[k]}`);
  }
  if (L.six["寿"] > 0 && L.age >= 90) P(`${L.age} 岁还活着，寿 ${L.six["寿"]} —— 该死没死`);
}

for (let i = 0; i < 150; i++) runOne();

/* ── 4. 未被抽到的事件 ── */
const never = EV.filter(e => !seen.has(e.id)).map(e => e.id);

/* ── 报告 ── */
console.log('=== 结构问题 ===');
console.log(problems.length ? problems.join('\n') : '（无）');
console.log('\n=== 运行 ===');
console.log(`150 世 / ${folds} 折 / 最大年龄 ${maxAge} / six 非数字 ${nanSix} / 越界 ${over}`);
console.log('异常:', Object.keys(errs).length ? JSON.stringify(errs, null, 2) : '（无）');
console.log('\n=== 覆盖 ===');
console.log(`事件 ${EV.length} 条，抽到 ${seen.size} 条`);
console.log('从未抽到:', never.length ? never.join(' ') : '（全部覆盖）');
