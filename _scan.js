// 语词扫描：现代面的文案里不该出现古代的官职、制度、器物
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

new Function(code + `;globalThis.__api={EV,TRACK,ORIGINS,JOBS,makePeer,makeFull,makeDuizhi,makeDue,
  analyseBazi,makeBazi};`)();
const A = globalThis.__api;
const EV = A.EV;

// 现代面出现这些词就是穿帮（只收绝对属于旧制的词，避开"家""族""乡"这类两可的）
const AN_WORDS = ['衙门','官府','朝廷','陛下','微臣','卑职','下官','俸','里甲','保举','外放','封疆',
  '京察','秋闱','乡试','会试','殿试','及第','银子','知县','知府','巡抚','按察','都察','折子','上疏',
  '圣旨','中旨','堂上','轿','长随','衙役','书吏','师爷','田亩','佃','里正','族长','祠堂','续弦',
  '纳妾','丁忧','守制','服阕','生祠','火耗','盐引','漕运','卫所','戍边','虏','俺答','万历','崇祯',
  '嘉靖','隆庆','康熙','雍正','乾隆','官人','老爷','大人','小女','犬子','贱内','愚兄'];
// 古面出现这些词就是穿帮
const MO_WORDS = ['微信','手机','项目','公司','集团','领导','工资','视频','群聊','房贷','网贷','打卡',
  '加班','考核','编制','学区','地铁','高铁','护照','医保','社保','派出所','小区','物业','合同'];

const hits = [];
let checked = 0;

function scan(str, where, isAn){
  if (!str) return;
  checked++;
  const list = isAn ? MO_WORDS : AN_WORDS;
  for (const w of list){
    if (str.includes(w)) hits.push(`${where} 出现「${w}」：${str.slice(0, 46)}`);
  }
}

EV.forEach(e => {
  const an = !!e.onlyAn;
  scan(e.an, e.id + '.an', true);
  scan(e.bodyAn, e.id + '.bodyAn', true);
  if (!an){
    if (!e.mo) hits.push(`${e.id}: 现代局没有标题（mo）`);
    if (!e.bodyMo) hits.push(`${e.id}: 现代局没有正文`);
    scan(e.mo, e.id + '.mo', false);
    scan(e.bodyMo, e.id + '.bodyMo', false);
  }
  e.opts.forEach((o, i) => {
    scan(o.t, `${e.id}[${i}].t`, true);
    scan(o.sub, `${e.id}[${i}].sub`, true);
    scan(o.line, `${e.id}[${i}].line`, true);
    if (!an){
      scan(o.tMo, `${e.id}[${i}].tMo`, false);
      scan(o.subMo, `${e.id}[${i}].subMo`, false);
      scan(o.lineMo, `${e.id}[${i}].lineMo`, false);
    }
  });
});

// ── 生成式事件：拿假的人生把四个生成器都跑一遍 ──
const bz = A.analyseBazi(A.makeBazi());
const L = {
  era:'mo', six:{室:40,财:40,子:40,禄:60,寿:50,誉:50}, fold:5, age:40,
  peers:[{ n:'沈明远', lu:50, alive:true, debt:-1, debtAt:2, blocked:false, asked:true, paid:false, visited:false },
         { n:'顾嘉树', lu:62, alive:true, debt:1, debtAt:2, blocked:false, asked:true, paid:false, visited:false },
         { n:'陆立诚', lu:38, alive:false, fell:true, debt:0, debtAt:0, blocked:false, asked:true, paid:false, visited:false }],
  love:{ done:true }, love2:{ xing:'沈', since:2 }, cai:{}, bz, cd:{}, due:[],
  used:[], minAt:{}, lines:[], trk:{}, heir:{}, job:'wen', track:'清流'
};
const gens = [];
['ask','block','fall','pay'].forEach(k => {
  const p = L.peers[k === 'fall' ? 2 : 0];
  try { gens.push(A.makePeer(L, p, k)); } catch(err){ hits.push('makePeer('+k+') 抛错: '+err.message); }
});
['室','财','子','禄','誉'].forEach(k => {
  try { gens.push(A.makeFull(Object.assign({}, L), k)); } catch(err){ hits.push('makeFull('+k+') 抛错: '+err.message); }
});
try { gens.push(A.makeDuizhi(L)); } catch(err){ hits.push('makeDuizhi 抛错: '+err.message); }
['audit','grudge','favor'].forEach(k => {
  try { gens.push(A.makeDue(L, k)); } catch(err){ hits.push('makeDue('+k+') 抛错: '+err.message); }
});

gens.forEach(e => {
  if (!e) { hits.push('生成事件返回空'); return; }
  if (!e.mo) hits.push(`${e.id}: 现代局没有标题`);
  if (!e.bodyMo) hits.push(`${e.id}: 现代局没有正文`);
  scan(e.mo, e.id + '.mo', false);
  scan(e.bodyMo, e.id + '.bodyMo', false);
  (e.opts || []).forEach((o, i) => {
    if (!o.tMo) hits.push(`${e.id}[${i}]「${o.t}」缺 tMo`);
    scan(o.tMo, `${e.id}[${i}].tMo`, false);
    scan(o.subMo, `${e.id}[${i}].subMo`, false);
    scan(o.lineMo, `${e.id}[${i}].lineMo`, false);
  });
});

console.log(`扫描 ${checked} 段文字，生成式事件 ${gens.length} 条`);
console.log(hits.length ? hits.join('\n') : '（没有穿帮）');
