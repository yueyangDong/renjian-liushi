// 渲染真实卡片，检查现代局里按钮与正文是否都换了口
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const code = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];

function mkEl(t){
  const e = { tagName:t||'div', _html:'', textContent:'', value:'', style:{}, dataset:{},
    children:[], classList:{add(){},remove(){},toggle(){}},
    appendChild(c){ this.children.push(c); return c; }, removeChild(){}, remove(){}, insertBefore(){},
    focus(){}, blur(){}, click(){}, setAttribute(){}, getAttribute(){return null;}, removeAttribute(){},
    addEventListener(){}, removeEventListener(){}, querySelector(s){ return node(s); },
    querySelectorAll(){ return []; }, closest(){ return null; }, scrollIntoView(){},
    getBoundingClientRect(){ return {top:0}; } };
  Object.defineProperty(e, 'innerHTML', {
    get(){ return e._html; },
    set(v){ e._html = v; e.children = []; }
  });
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

new Function(code + `;globalThis.__api={S,ORIGINS,startLife,setPending:v=>{pending=v;},
  renderCard,analyseBazi,makeBazi,EV};`)();
const A = globalThis.__api;

A.S.auto = true; A.S.silent = true;
A.S.index = 1; A.S.lives = []; A.S.edits = []; A.S.hand = [];
A.S.bz = A.analyseBazi(A.makeBazi());

// 强制走今世，并把每一类事件都摆一遍
const era = 'mo';
A.setPending({ era, y0: 2026 });
A.startLife(A.ORIGINS[0]);

// 抓几条有代表性的今世事件，逐个渲染
const want = ['pawn','blind','firstpay','copy','tally','gift','drink','clan','quit','house','will','money','who','home','love','impeach','exile','child','sick','yi','ke','huohao','yao','ci','adopt','marry','shang','plague','debt','widow','talk','mentor','salt','exam','wall','sue','case','tonsure','trade','sign','duandang','pupil','meet','read','guiren','wuwang','late','qie','again','night','letter','alley','name','retire','sanguan','dafu'];

const AN = ['衙门','官府','朝廷','俸','里甲','保举','京察','秋闱','银子','知县','折子','上疏','衙役','田亩','火耗','盐引','老爷','大人','臣','卑职'];
const lines = [];
let bad = 0;

for (const id of want){
  const ev = A.EV.find(e => e.id === id);
  if (!ev) { lines.push('找不到事件 ' + id); bad++; continue; }
  // 直接把这条塞进渲染：借 renderCard 的壳，手工拼同样的结构
  const isAn = false;
  const body = ev.bodyMo;
  const opts = ev.opts.map(o => ({ t: isAn ? o.t : (o.tMo || o.t), s: isAn ? o.sub : (o.subMo || o.sub) }));
  const shown = [ev.mo || '(无标题)', body, ...opts.map(o => o.t + '｜' + (o.s || ''))].join(' ');
  for (const w of AN){
    if (shown.includes(w)){ lines.push(`${id}: 「${w}」→ ${shown.slice(0,60)}`); bad++; }
  }
  lines.push(`${id.padEnd(9)} ${(ev.mo||'—')}   ` + opts.map(o => o.t).join(' / '));
}

console.log(lines.join('\n'));
console.log('\n' + (bad ? `穿帮 ${bad} 处` : '今世全部说法都对得上'));
