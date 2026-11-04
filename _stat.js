// 量一次「一局到底有几个决定」：折数、卒年、六事各出现几次
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const code = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];

function mkEl(t){
  const e = { tagName:t||'div', innerHTML:'', textContent:'', value:'', style:{}, dataset:{},
    children:[], classList:{add(){},remove(){},toggle(){}},
    appendChild(c){return c;}, removeChild(){}, remove(){}, insertBefore(){},
    focus(){}, blur(){}, click(){}, setAttribute(){}, getAttribute(){return null;}, removeAttribute(){},
    addEventListener(){}, removeEventListener(){}, querySelector(){return mkEl();},
    querySelectorAll(){return [];}, closest(){return null;}, scrollIntoView(){},
    getBoundingClientRect(){return {top:0};} };
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
global.requestAnimationFrame = f=>setTimeout(f,0);
global.cancelAnimationFrame = () => {};
global.Image = function(){ return {}; };
global.Audio = function(){ return { play(){}, pause(){}, cloneNode(){ return { play(){} }; }, volume:1 }; };

new Function(code + `;globalThis.__api={S,EV,ORIGINS,startLife,setPending:v=>{pending=v;},choose,advanceFold,
  analyseBazi,makeBazi,hook:()=>{renderCard=function(){globalThis.__ev=pickEvent();};}};`)();
const A = globalThis.__api;
A.S.auto = true; A.S.silent = true;
A.hook();

const N = 300;
const foldHist = {}, deathAge = {}, dimCount = { 室:0, 财:0, 子:0, 禄:0, 寿:0, 誉:0 };
let foldsTotal = 0, covered = 0, evTotal = 0;
const sixSeen = {};
const perLifeCover = {};
const shouAt = {};
const evFreq = {}; let kidCount = 0;  // fold -> 平均寿

for (let t = 0; t < N; t++){
  A.S.index = 1; A.S.lives = []; A.S.edits = []; A.S.hand = [];
  A.S.bz = A.analyseBazi(A.makeBazi());
  const era = t % 2 ? 'mo' : 'an';
  A.setPending({ era, y0: era === 'mo' ? 2026 : 1526 });
  A.startLife(A.ORIGINS[Math.floor(Math.random()*A.ORIGINS.length)]);

  const dims = new Set();
  let f = 0;
  for (; f < 16; f++){
    const ev = globalThis.__ev;
    if (!ev || !A.S.life) break;
    // 这条事件碰了哪几样
    const touched = new Set();
    ev.opts.forEach(o => { for (const k in (o.eff||{})) if (k !== '寿' || Math.abs(o.eff[k]) >= 4) touched.add(k); });
    if (ev.opts.some(o => o.concubine || o.love)) touched.add('室');
    if (ev.opts.some(o => o.adopt || o.loseChild || o.raised !== undefined)) touched.add('子');
    if (ev.opts.some(o => o.monk)) touched.add('寿');
    touched.forEach(k => { dims.add(k); dimCount[k] = (dimCount[k]||0)+1; });
    evTotal++; evFreq[ev.id] = (evFreq[ev.id]||0)+1;

    const o = ev.opts[Math.floor(Math.random()*ev.opts.length)];
    try { A.choose(ev, o); } catch(e){ break; }
    if (!A.S.life) break;
    try { A.advanceFold(); } catch(e){ break; }
    if (!A.S.life){ break; }
    const LL=A.S.life; (shouAt[LL.fold]=shouAt[LL.fold]||[]).push(LL.six["寿"]);
    if (A.S.life.fold >= 16 || A.S.life.six['寿'] <= 0) break;
  }
  const L = A.S.life;
  const n = L ? L.fold : 16;
  foldHist[n] = (foldHist[n]||0)+1;
  foldsTotal += n;
  if (L) deathAge[Math.round(L.age/4)*4] = (deathAge[Math.round(L.age/4)*4]||0)+1;
  const cs = [...dims].filter(k => ['室','财','子','禄','寿','誉'].includes(k)).length;
  perLifeCover[cs] = (perLifeCover[cs]||0)+1;
  if (cs >= 6) covered++;
  if (L && L.heir && L.heir.has) kidCount++;
}

console.log(`=== ${N} 局 ===`);
console.log('平均决定数（折）:', (foldsTotal/N).toFixed(1));
const fk = Object.keys(foldHist).map(Number).sort((a,b)=>a-b);
console.log('决定数分布:', fk.map(k=>`${k}次:${foldHist[k]}`).join('  '));
const ak = Object.keys(deathAge).map(Number).sort((a,b)=>a-b);
console.log('结束年龄分布:', ak.map(k=>`${k}岁:${deathAge[k]}`).join('  '));
console.log('六事覆盖（一局里碰到几样）:', [0,1,2,3,4,5,6].map(k=>`${k}样:${perLifeCover[k]||0}`).join('  '));
console.log('六样全碰到的局:', (covered/N*100).toFixed(1) + '%');
console.log('各事累计出场:', Object.entries(dimCount).map(([k,v])=>`${k} ${(v/N).toFixed(2)}次/局`).join('  '));

console.log('有孩子的人生:', (kidCount/N*100).toFixed(1)+'%');
console.log('子相关事件:', ['heir','child','marry','shang','adopt','qie','fenjia','sun','zhaogu'].map(k=>k+':'+(evFreq[k]||0)).join('  '));
console.log('出现最多的八件:', Object.entries(evFreq).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>k+':'+v).join('  '));
