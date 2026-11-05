'use strict';
/* ══════════════════════════════════════════════════════════════
   配平回归台 · 加载器（harness）
   ──────────────────────────────────────────────────────────────
   职责（只有四件）：
     1. 读 index.html，取出 <script> 里的游戏源码
     2. 把源码里的 Math.random 换成可注入的种子流（不改任何玩法逻辑）
     3. 造一套 DOM / window / localStorage 桩，让游戏能在 Node 里跑
     4. 暴露一组驱动句柄：开一局 / 取当前事件 / 选一个选项 / 推一折

   红线：不写回 index.html，不改任何数值。注入只发生在内存里的字符串上。

   ── 为什么必须关掉定时器（2026-11 实测） ─────────────────────
   `choose()` 结尾是 setTimeout(advanceFold, S.auto?0:900)。
   历史脚本（_sim4.js 等）在 choose() 之后又手动调了一次 advanceFold()，
   于是每折排了两个回调，同步循环跑完后几千个回调集中爆发：
     · 200 局从 0.2 秒变成 **94 秒**
     · 已结束的局被重复推进（死亡后仍 --fold），污染后续统计
   本台把 setTimeout/setInterval 换成丢弃式桩，每折只由 harness 推一次。
   ────────────────────────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_ENTRY = path.join(PROJECT_ROOT, 'index.html');

/* ── 种子随机：mulberry32，32 位状态，够快够均匀，零依赖 ───────── */
function mulberry32(a) {
  let s = a | 0;
  return function next() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 把若干个整数搅成一个 32 位种子（FNV-1a）。同一组输入永远同一组输出。 */
function hash32() {
  let h = 0x811c9dc5;
  for (let i = 0; i < arguments.length; i++) {
    let n = arguments[i] | 0;
    h = (h ^ (n & 0xff)) >>> 0;          h = Math.imul(h, 0x01000193) >>> 0;
    h = (h ^ ((n >>> 8) & 0xff)) >>> 0;  h = Math.imul(h, 0x01000193) >>> 0;
    h = (h ^ ((n >>> 16) & 0xff)) >>> 0; h = Math.imul(h, 0x01000193) >>> 0;
    h = (h ^ ((n >>> 24) & 0xff)) >>> 0; h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/* ══════════════ 1. 取源码 ══════════════ */
function extractScript(html) {
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  const blocks = [];
  let m;
  while ((m = re.exec(html))) {
    const body = m[1];
    // 这块 script 在 html 里从第几行开始（1-based）
    const line = html.slice(0, m.index).split('\n').length;
    blocks.push({ code: body, htmlLine: line });
  }
  if (!blocks.length) throw new Error('index.html 里没有找到 <script> 块');
  if (blocks.length > 1) {
    // 游戏目前是单 script。多块时仍可跑，但行号对不上，注入报告会提示。
  }
  const code = blocks.map(b => b.code).join('\n');
  return { code, blocks, htmlLineOfFirstBlock: blocks[0].htmlLine };
}

/* ══════════════ 2. Math.random 注入 ══════════════
   要求：
     · `Math.random()` 和裸 `Math.random`（当函数值用）两种写法都要覆盖
     · 不能误伤字符串 / 模板串 / 注释里的同名文本
     · 替换后必须断言"剩余 0 处"，否则直接报错退出（不静默放过）
   做法：一个带状态栈的词法扫描；只在 code 状态里替换标识符。
   `Math.random` -> `__rng`，而 `__rng` 是个函数（返回 [0,1)），
   所以 `Math.random()` -> `__rng()`、裸 `Math.random` -> `__rng` 两种语义都保住。 */
const RNG_NAME = '__rng';
const NEEDLE = 'Math.random';

function injectRng(code) {
  const n = code.length;
  const out = [];
  let i = 0;
  let line = 1;
  const hits = [];      // 被替换的站点（行号）
  let inTextHits = 0;   // 字符串/模板/注释里的同名文本（不许有）

  const stack = [{ s: 'code', depth: 0 }];   // code|sq|dq|tpl|expr|lc|bc
  const top = () => stack[stack.length - 1];
  const isIdent = c => c !== undefined && /[A-Za-z0-9_$]/.test(c);

  while (i < n) {
    const c = code[i];
    const c2 = code[i + 1];
    const st = top().s;

    if (st === 'lc') {                    // 行注释
      if (c === '\n') { line++; stack.pop(); }
      out.push(c); i++;
      continue;
    }
    if (st === 'bc') {                    // 块注释
      if (c === '*' && c2 === '/') { out.push('*/'); i += 2; stack.pop(); continue; }
      if (c === '\n') line++;
      if (c === 'M' && code.startsWith(NEEDLE, i)) inTextHits++;
      out.push(c); i++;
      continue;
    }
    if (st === 'sq' || st === 'dq') {     // 单/双引号串
      const q = st === 'sq' ? "'" : '"';
      if (c === '\\') { out.push(code.substr(i, 2)); i += 2; continue; }
      if (c === '\n') line++;
      if (c === q) { stack.pop(); out.push(c); i++; continue; }
      if (c === 'M' && code.startsWith(NEEDLE, i)) inTextHits++;
      out.push(c); i++;
      continue;
    }
    if (st === 'tpl') {                   // 模板串正文
      if (c === '\\') { out.push(code.substr(i, 2)); i += 2; continue; }
      if (c === '\n') line++;
      if (c === '`') { stack.pop(); out.push(c); i++; continue; }
      if (c === '$' && c2 === '{') { out.push('${'); i += 2; stack.push({ s: 'expr', depth: 0 }); continue; }
      if (c === 'M' && code.startsWith(NEEDLE, i)) inTextHits++;
      out.push(c); i++;
      continue;
    }
    if (st === 'expr') {                  // 模板串 ${ ... } 里的代码
      if (c === '}') {
        if (top().depth === 0) { stack.pop(); out.push('}'); i++; continue; }
        top().depth--; out.push(c); i++; continue;
      }
      if (c === '{') { top().depth++; out.push(c); i++; continue; }
      // 落到下面按 code 处理（字符串、注释都要认）
      if (c === '/' && c2 === '/') { out.push('//'); stack.push({ s: 'lc' }); i += 2; continue; }
      if (c === '/' && c2 === '*') { out.push('/*'); stack.push({ s: 'bc' }); i += 2; continue; }
      if (c === "'") { stack.push({ s: 'sq' }); out.push(c); i++; continue; }
      if (c === '"') { stack.push({ s: 'dq' }); out.push(c); i++; continue; }
      if (c === '`') { stack.push({ s: 'tpl' }); out.push(c); i++; continue; }
      if (c === 'M' && code.startsWith(NEEDLE, i) && !isIdent(code[i + NEEDLE.length])) {
        hits.push(line); out.push(RNG_NAME); i += NEEDLE.length; continue;
      }
      out.push(c); i++;
      continue;
    }

    /* ── code 状态 ── */
    if (c === '\n') line++;
    if (c === '/' && c2 === '/') { out.push('//'); stack.push({ s: 'lc' }); i += 2; continue; }
    if (c === '/' && c2 === '*') { out.push('/*'); stack.push({ s: 'bc' }); i += 2; continue; }
    if (c === "'") { stack.push({ s: 'sq' }); out.push(c); i++; continue; }
    if (c === '"') { stack.push({ s: 'dq' }); out.push(c); i++; continue; }
    if (c === '`') { stack.push({ s: 'tpl' }); out.push(c); i++; continue; }
    if (c === 'M' && code.startsWith(NEEDLE, i) && !isIdent(code[i + NEEDLE.length])) {
      hits.push(line); out.push(RNG_NAME); i += NEEDLE.length; continue;
    }
    out.push(c); i++;
  }

  const injected = out.join('');

  /* ── 断言：不许剩下任何一处 Math.random ── */
  const left = injected.split(NEEDLE).length - 1;
  if (left !== 0) {
    throw new Error(
      `RNG 注入不完整：替换后仍剩 ${left} 处 '${NEEDLE}'。\n` +
      `  代码上下文剩余应为 0；字符串/注释里也不允许出现该文本（否则无法断言注入完整）。\n` +
      `  检测到字符串/注释内同名文本 ${inTextHits} 处 —— 请改名，或修改 harness.injectRng 的断言策略。`
    );
  }
  if (inTextHits !== 0) {
    throw new Error(`字符串/注释里出现了 '${NEEDLE}' 文本 ${inTextHits} 处，拒绝继续（无法保证注入完整）。`);
  }
  return { code: injected, sites: hits.length, lines: hits };
}

/* ══════════════ 3. DOM / 浏览器桩 ══════════════
   只做到"够游戏跑"的程度：所有渲染都是往桩对象上写字符串，
   读回来的值没人看，所以不会影响任何玩法判定。 */
function mkEl(tag) {
  const el = {
    tagName: tag || 'div', id: '', innerHTML: '', textContent: '', value: '', title: '',
    style: {}, dataset: {}, children: [], className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, insertBefore() {},
    focus() {}, blur() {}, click() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return mkEl(); }, querySelectorAll() { return []; },
    closest() { return null; }, scrollIntoView() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    offsetWidth: 0, offsetHeight: 0
  };
  return el;
}

/* 每次 createHarness 都重置一份，避免跨 run 串味 */
function installStubs() {
  const cache = new Map();
  const node = id => {
    if (!cache.has(id)) cache.set(id, mkEl());
    return cache.get(id);
  };
  // 闪字、结算动效都往 body 上 append，跑几千局会越堆越多；这里直接丢弃
  const body = mkEl('body');
  body.appendChild = function (c) { return c; };
  body.removeChild = function () {};
  body.children = [];

  const doc = {
    getElementById: id => node('#' + id),
    querySelector: s => node(String(s)),
    querySelectorAll: () => [],
    createElement: t => mkEl(t),
    createTextNode: () => mkEl('text'),
    addEventListener() {}, removeEventListener() {},
    body, documentElement: mkEl('html'), head: mkEl('head'),
    title: ''
  };

  const store = new Map();
  const storage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
    clear: () => store.clear()
  };

  const loc = { search: '', href: 'http://localhost/', hash: '', protocol: 'http:' };
  const win = {
    location: loc, scrollTo() {}, scrollY: 0, innerWidth: 1280, innerHeight: 800,
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeListener() {}, addListener() {} }),
    localStorage: storage,
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    devicePixelRatio: 1, AudioContext: undefined, webkitAudioContext: undefined,
    document: doc
  };

  const G = globalThis;
  /* Node 22 的 globalThis.navigator 只有 getter，直接赋值会抛 TypeError
     （历史脚本 _sim4.js 在旧版 Node 上能跑，在 v22 上会炸在这里）。
     统一走 defineProperty，覆盖掉只读的描述符。 */
  const def = (name, value) => {
    try {
      Object.defineProperty(G, name, { value, writable: true, configurable: true, enumerable: false });
    } catch (e) {
      try { G[name] = value; } catch (e2) { /* 实在写不进去就算了 */ }
    }
  };

  def('document', doc);
  def('window', win);
  def('localStorage', storage);
  def('location', loc);
  def('navigator', { userAgent: 'node-balance-harness' });
  def('requestAnimationFrame', () => 0);
  def('cancelAnimationFrame', () => {});
  def('Image', function Image() { return {}; });
  def('Audio', function Audio() {
    return { play() {}, pause() {}, cloneNode() { return { play() {} }; }, volume: 1 };
  });
  /* 关键：丢弃式定时器（见文件头注释） */
  def('setTimeout', () => 0);
  def('clearTimeout', () => {});
  def('setInterval', () => 0);
  def('clearInterval', () => {});
  /* 音乐/音效在游戏里靠 AudioContext，桩里不给，代码自己有 try/catch */

  return { doc, win, body };
}

/* ══════════════ 4. 加载 ══════════════ */
function createHarness(opts) {
  opts = opts || {};
  const entry = opts.entry || DEFAULT_ENTRY;
  const html = fs.readFileSync(entry, 'utf8');
  const sourceHash = crypto.createHash('sha1').update(html).digest('hex').slice(0, 12);

  const { code, blocks, htmlLineOfFirstBlock } = extractScript(html);
  const inj = injectRng(code);
  if (blocks.length > 1) {
    console.warn(`[harness] index.html 里有 ${blocks.length} 个 <script> 块，已拼接；注入报告的"行号"是相对整段代码的。`);
  }

  installStubs();

  /* 种子流：late-binding（每局换一条流），没设种子时退回 Math.random */
  let gameSeedFn = null;      // null = 用 Math.random 兜底
  const G = globalThis;
  G.__balanceRng = null;
  G.balanceSetGameStream = fn => { G.__balanceRng = fn; };

  /* 导出面。注意：全部走函数，因为 S 会被整体替换（每世 newSoul） */
  const API_NAMES = [
    'newSoul', 'autoStartLife', 'startLife', 'advanceFold', 'choose', 'pickEvent', 'endLife',
    'capOf', 'heirScore', 'clamp', 'JOB',
    // 「顾家」计价的唯一实现（index.html 的 dataset.home 用的就是它）。
    // home 策略走这里，保证"线上自动打法"与"回归台"不会各算一套。
    'homeScoreOpt'
  ];
  const API_VALUES = ['EV', 'EV_DIMS', 'SIXK', 'FOLD_MAX', 'ORIGINS', 'JOBS', 'TRACK'];

  const suffix = `
;globalThis.__balanceApi = {
  getS: function(){ return S; },
  setS: function(v){ S = v; },
  getEv: function(){ return globalThis.__balanceEv; },
  clearEv: function(){ globalThis.__balanceEv = null; },
  hook: function(){
    renderCard = function(){ globalThis.__balanceEv = pickEvent(); };
  },
  ${API_NAMES.map(n => `${n}: (typeof ${n} !== 'undefined' ? ${n} : null)`).join(',\n  ')},
  ${API_VALUES.map(n => `${n}: (typeof ${n} !== 'undefined' ? ${n} : null)`).join(',\n  ')}
};
/* ── 满招损 · 常态的漏：补计量缺口（README 已知局限第 2 条） ──────────
   stepFull（index.html:2838）每折 35% 让随机一项 −2，不产事件、只落一句手记，
   台子原先数不到。这里在它外面包一层计数：只看"调用前后六事有没有真的动"，
   动了才算漏了一次（被 0 顶住时不算）。
   红线不变：只包内存里这份代码，不写回 index.html、不改任何数值。 */
;(function(){
  const orig = stepFull;
  stepFull = function(L){
    const before = { 室:L.six['室'], 财:L.six['财'], 子:L.six['子'], 禄:L.six['禄'], 誉:L.six['誉'] };
    orig(L);
    let moved = 0;
    for (const k in before) moved += Math.abs(L.six[k] - before[k]);
    if (moved > 0) globalThis.__balanceFullSilent = (globalThis.__balanceFullSilent || 0) + 1;
  };
})();
/* ── 退还 ·「无人劝你」减半的可测形式（卡 03-03 §5 第 13 项） ──────────
   §1.1 的减半只落在「提点」这一条（refundEvent 里 p *= .5）。
   要验它，必须同时数"机会"和"触发"：只数触发会被"无室的人本来就少"骗过去。
   这里在 refundEvent 外面包一层：
     · 机会 = 这一折满足提点的前置（墨≥20、龄≥22、还没触发过）
     · 触发 = 真返回了 ref_warn
   两边都按 室≤5（无人劝你）/ 室>5 分桶。红线不变：只包内存里这份代码。 */
;(function(){
  const orig = refundEvent;
  refundEvent = function(L){
    const used = (L.used || []);
    let bucket = -1;
    if (!used.includes('ref_warn') && L.ink >= 20 && L.age >= 22){
      bucket = (L.lone || L.six['室'] <= 5) ? 1 : 0;
      globalThis.__balanceRefExp = globalThis.__balanceRefExp || [0, 0];
      globalThis.__balanceRefExp[bucket]++;
    }
    const ev = orig(L);
    if (ev && ev.id === 'ref_warn'){
      globalThis.__balanceRefFire = globalThis.__balanceRefFire || [0, 0];
      globalThis.__balanceRefFire[bucket < 0 ? 0 : bucket]++;
    }
    return ev;
  };
})();
`;

  const prelude =
    '/* harness 注入：种子随机入口。未设种子时退回 Math.random（默认行为不变）。 */\n' +
    'const ' + RNG_NAME + ' = function(){ ' +
    'return globalThis.__balanceRng ? globalThis.__balanceRng() : Math.random(); };\n';

  new Function(prelude + inj.code + suffix)();

  const api = G.__balanceApi;
  if (!api) throw new Error('游戏代码执行后没有拿到 __balanceApi');
  api.hook();

  /* 出厂自检：句柄都在 */
  const missing = [];
  for (const n of API_NAMES) if (typeof api[n] !== 'function') missing.push(n);
  for (const n of API_VALUES) if (api[n] === null || api[n] === undefined) missing.push(n);
  if (missing.length) {
    throw new Error(
      '注入失败：游戏代码里找不到 ' + missing.join(', ') +
      '。多半是 index.html 改名了 —— 请同步 tools/balance/harness.js 的导出面。'
    );
  }

  const meta = {
    entry: path.relative(PROJECT_ROOT, entry) || entry,
    sourceHash,
    sourceBytes: html.length,
    sourceLines: html.split('\n').length,
    scriptBlocks: blocks.length,
    scriptLine1: htmlLineOfFirstBlock,
    randomSites: inj.sites,
    randomSiteLines: inj.lines,
    eventCount: api.EV.length,
    foldMax: api.FOLD_MAX
  };

  /* ── 每局种子流 ── */
  let curGame = null;
  function setGameSeed(seedInt) {
    curGame = mulberry32(seedInt);
    G.balanceSetGameStream(curGame);
  }
  function useSystemRandom() { G.balanceSetGameStream(null); }

  return {
    api, meta,
    setGameSeed, useSystemRandom,
    mulberry32, hash32
  };
}

/* ══════════════ 5. 一局一局地推 ══════════════
   分工：
     harness 只管"怎么把游戏推下去"（开一局 / 取事件 / 选 / 推一折 / 判结束）
     strategies 只管"选哪个"（统一接口，加新策略不用改这里）
     metrics  只管"记什么"
   ─────────────────────────────────────────── */

/* UI 层会把某些选项藏掉（index.html:2618）。策略只能选玩家点得到的。
   历史脚本直接从 ev.opts 里抽，等于让玩家点了看不见的按钮 —— 本台按 UI 规则过滤。 */
function visibleOpts(api, ev, L) {
  const isAn = L.era === 'an';
  const lu = L.six['禄'];
  const minLu = ev.minLu || 40;
  const vis = [];
  for (let i = 0; i < ev.opts.length; i++) {
    const o = ev.opts[i];
    if (o.edit && (!isAn || lu < minLu)) continue;   // 与 index.html:2618 一致
    vis.push({ o, i });                              // 带原始下标，便于比对
  }
  return vis.length ? vis : ev.opts.map((o, i) => ({ o, i }));
}

/* 选项效果的"预测模型"（只用于 balanced 策略与漂移自检）
   抄自 index.html:3106-3108：
     let v = Math.round(raw * (raw > 0 ? 0.8 : 0.72));
     if (v === 0) v = raw > 0 ? 1 : -1;
     L.six[k] = clamp(L.six[k] + v, 0, capOf(L, k));
   子 不走这套（走台阶），这里返回 0。 */
function predictDelta(api, L, k, raw) {
  if (k === '子' || !raw) return 0;
  let v = Math.round(raw * (raw > 0 ? 0.8 : 0.72));
  if (v === 0) v = raw > 0 ? 1 : -1;
  const cap = api.capOf(L, k);
  const cur = L.six[k];
  return api.clamp(cur + v, 0, cap) - cur;
}

/* 这些键一出现，说明这个选项除了 eff 还动了别的东西（子台阶、情关、账簿……），
   纯加法模型就不再成立 —— 漂移自检时跳过，免得天天喊狼来了。 */
const SPECIAL_KEYS = [
  'child', 'concubine', 'love', 'love2', 'adopt', 'monk', 'unlone', 'loseChild', 'grand',
  'noHeir', 'raised', 'knot', 'duizhi', 'peer', 'job', 'jobAxis', 'edit', 'law', 'ink',
  'study', 'yun', 'pupil', 'deed', 'cutParty', 'faction', 'lone',
  // 卡 03-03：退还只减墨（不动律），上船记号不进六事 —— 两者都不满足纯加法模型
  'inkOff', 'darkIn'
];
function isCleanOpt(o) {
  for (let i = 0; i < SPECIAL_KEYS.length; i++) if (o[SPECIAL_KEYS[i]] !== undefined) return false;
  return true;
}

/* 推完一世（5 局，共用一个八字，古/今按游戏自己的平衡规则掷） */
function runSouls(h, opts) {
  const api = h.api;
  const lives = opts.lives | 0;
  const seed = opts.seed | 0;
  const strategy = opts.strategy;
  const onLife = opts.onLife || (() => {});

  const diag = opts.diag || null;          // 漂移自检累加器（可选）

  const perSoul = 5;                        // 五世
  const souls = Math.max(1, Math.ceil(lives / perSoul));
  const out = [];
  let made = 0;

  for (let s = 0; s < souls && made < lives; s++) {
    /* 一魂：八字一次定死，五局共用（与线上一致） */
    h.setGameSeed(h.hash32(seed, s, 0x5EED));
    api.clearEv();
    api.setS(api.newSoul());                // 内含 makeBazi / analyseBazi
    const S = api.getS();
    S.auto = true;
    S.silent = true;

    for (let l = 0; l < perSoul && made < lives; l++) {
      const rec = playLife(h, strategy, {
        seed, soul: s, life: l, diag
      });
      out.push(rec);
      made++;
      onLife(rec, made);
    }
  }
  return out;
}

/* 推一局 */
function playLife(h, strategy, ctx) {
  const api = h.api;
  const S = api.getS();
  const idxBefore = S.index;

  /* 每局独立种子流：同一 (seed, soul, life) 永远同一局，
     所以 --lives 300 的前 300 局和 --lives 2000 的前 300 局完全一样。 */
  h.setGameSeed(h.hash32(ctx.seed, ctx.soul, ctx.life, 0xA5A5));
  const stratRng = mulberry32(h.hash32(ctx.seed, ctx.soul, ctx.life, 0x5B5B));

  api.clearEv();
  globalThis.__balanceFullSilent = 0;   // 满招损·常态的漏：本局计数从 0 起
  globalThis.__balanceRefExp = [0, 0];  // 提点机会：室>5 / 室≤5
  globalThis.__balanceRefFire = [0, 0]; // 提点触发：室>5 / 室≤5
  api.autoStartLife();           // 掷古/今（含五局平衡）、掷出身、renderLife -> renderCard -> pickEvent

  const rec = {
    era: null, age: null, folds: 0,
    verdict: null, verdictRaw: null, minK: null, minV: null, maxV: null,
    six: null, revealed: false, revealAt: 0, revealWhy: null,
    job: null, jobAxis: null, track: null, trackAt: 0,
    heirHas: false, heirJob: false, heirGrand: false, heirGreat: false,
    love: false, duizhi: false, concubine: false, monk: false,
    events: [], choices: [],
    peers: 0, due: 0, dueKinds: { audit: 0, grudge: 0, favor: 0 }, full: 0,
    fullSilent: 0, wipedBy: null, law: 0,
    inkGross: 0,          // 本局"墨的供给"：选项里写下的 ink 之和（含后来被退还掉的那部分）
    inkFinal: 0,          // 终局实际留在身上的墨
    darkIn: false,        // 上过船（深水链的二、三道门只认它）
    refExp: [0, 0], refFire: [0, 0],
    capLuBase: null, capLu: null, study: 0, luInMin: null,
    capYuBase: null, capYu: null,
    folds16: false, ended: false, error: null, stratErr: 0
  };

  for (let step = 0; step <= api.FOLD_MAX + 1; step++) {
    const ev = api.getEv();
    if (!ev) break;
    const L = api.getS().life;
    if (!L) break;

    const vis = visibleOpts(api, ev, L);
    const sixBefore = Object.assign({}, L.six);
    // 顶也要拍快照：choose 里 stepTrack + recalcCaps 可能改顶（例如归到某一轨）
    const capBefore = { 室: api.capOf(L, '室'), 财: api.capOf(L, '财'), 禄: api.capOf(L, '禄'), 寿: api.capOf(L, '寿') };
    const trackBefore = L.track;

    /* ── 策略选一个 ── */
    let pick = 0;
    try {
      const r = strategy.choose({
        ev, opts: vis, L, api, rng: stratRng,
        predictDelta: (k, raw) => predictDelta(api, L, k, raw)
      });
      pick = (typeof r === 'number') ? r : (r && typeof r.idx === 'number' ? r.idx : 0);
    } catch (e) {
      rec.stratErr++;
      if (!rec.error) rec.error = 'strategy: ' + (e && e.message);
      pick = 0;
    }
    if (!(pick >= 0 && pick < vis.length)) pick = 0;

    const venue = vis[pick];
    const o = venue.o;
    const evId = ev.id || '?';

    api.choose(ev, o);           // 真代码
    rec.folds++;
    if (o.ink) rec.inkGross += o.ink;   // 墨的供给按"选项上写的数"记，不按终局余额
    rec.events.push(evId);
    rec.choices.push({ id: evId, idx: venue.i, n: ev.opts.length, nVis: vis.length, t: o.t || '', pick });

    /* ── 模型漂移自检（只查"纯加法"选项的 室/财/禄/寿） ── */
    // 只查"纯加法 + 轨没变"的选项：归到某条轨会重算顶（recalcCaps 会把超顶的格直接压下来），
    // 那是另一套机制，不该记成加法模型的偏差。
    if (ctx.diag && isCleanOpt(o) && L.track === trackBefore && evId !== 'case') {
      const eff = o.eff || {};
      for (const k of ['室', '财', '禄', '寿']) {
        const raw = eff[k];
        if (!raw) continue;
        // 注意：这里必须从"选之前"的值算预测（choose 已经改过 L.six 了）
        let v = Math.round(raw * (raw > 0 ? 0.8 : 0.72));
        if (v === 0) v = raw > 0 ? 1 : -1;
        const cap = capBefore[k];
        const pred = api.clamp(sixBefore[k] + v, 0, cap) - sixBefore[k];
        const act = L.six[k] - sixBefore[k];
        ctx.diag.checked++;
        const d = Math.abs(pred - act);

        /* 已知的一类偏差，不算模型错：
           choose() 末尾会 recalcCaps()，而它用的是"裸顶" capSix（不含 study 加成），
           并且会把超过裸顶的格子直接压回去（index.html:859）。
           capOf() 却算上了 study 加成（index.html:837-839）。
           结果：study 抬起来的那点顶，每次选择后都会被吃掉。
           —— 这是游戏既有行为，本台不改游戏，只把它单独记一笔。 */
        const rawCap = L.capSix ? L.capSix[k] : undefined;
        const clawed = act < pred && rawCap !== undefined && rawCap < cap;
        if (clawed) {
          ctx.diag.capClaw = (ctx.diag.capClaw || 0) + 1;
          if (!ctx.diag.clawSample) ctx.diag.clawSample = { ev: evId, k, base: sixBefore[k], cap, rawCap, pred, act };
          continue;
        }

        if (d > ctx.diag.maxDiff) {
          ctx.diag.maxDiff = d;
          ctx.diag.worst = { ev: evId, k, raw, base: sixBefore[k], cap, pred, act, line: 'index.html:3106' };
        }
        if (d > 0 && (ctx.diag.diffs || []).length < 50) {
          ctx.diag.diffs = ctx.diag.diffs || [];
          ctx.diag.diffs.push({ ev: evId, k, base: sixBefore[k], cap, rawCap, pred, act });
        }
      }
    }

    if (api.getS().index !== idxBefore) { rec.ended = true; break; }

    api.advanceFold();           // 真代码（含 endLife）
    if (api.getS().index !== idxBefore) { rec.ended = true; break; }
  }

  /* 兜底：万一事件池空 / 一直没死，也要给一局收尾，不能悄悄丢一局 */
  if (api.getS().index === idxBefore) {
    rec.error = rec.error || 'life-not-ended';
    try { api.endLife('harness'); } catch (e) { /* 收不了尾就记下来 */ }
  }

  rec.fullSilent = globalThis.__balanceFullSilent || 0;
  rec.refExp = (globalThis.__balanceRefExp || [0, 0]).slice();
  rec.refFire = (globalThis.__balanceRefFire || [0, 0]).slice();

  const r = api.getS().lives[idxBefore - 1];
  if (!r) {
    rec.error = rec.error || 'no-record';
    return rec;
  }

  rec.era = r.era;
  rec.age = r.age;
  rec.verdictRaw = r.verdict;
  rec.verdict = normalizeVerdict(r.verdict);
  rec.minK = r.minK;
  rec.minV = r.minV;
  rec.six = r.six;
  rec.revealed = !!r.revealed;
  rec.revealAt = r.revealAt || 0;
  rec.revealWhy = r.revealWhy || null;
  rec.job = r.job;
  rec.track = r.track;
  rec.trackAt = r.trackAt || 0;
  rec.heirHas = !!(r.heirAt && r.heirAt.has);
  rec.heirJob = !!(r.heirAt && r.heirAt.job);
  rec.heirGrand = !!(r.heirAt && r.heirAt.grand);
  rec.heirGreat = !!(r.heirAt && r.heirAt.great);
  rec.love = !!r.love;
  rec.concubine = !!r.concubine;
  rec.monk = !!r.monk;
  rec.folds16 = rec.folds >= api.FOLD_MAX;
  // 末态最大格（判「起伏」用）
  let maxV = -1;
  for (const k of api.SIXK) if (k !== '寿' && rec.six[k] > maxV) maxV = rec.six[k];
  rec.maxV = maxV;

  const L2 = api.getS().life;
  if (L2) {
    rec.jobAxis = (api.JOB(L2.job) || {}).axis || null;
    rec.peers = countPrefix(rec.events, 'peer_');
    rec.due = countPrefix(rec.events, 'due_');
    for (const e of rec.events) {
      if (e === 'due_audit') rec.dueKinds.audit++;
      else if (e === 'due_grudge') rec.dueKinds.grudge++;
      else if (e === 'due_favor') rec.dueKinds.favor++;
    }
    rec.duizhi = rec.events.indexOf('duizhi') >= 0;
    rec.full = rec.events.filter(e => e === 'full').length;
    rec.law = L2.law || 0;
    rec.inkFinal = L2.ink || 0;
    rec.darkIn = !!L2.darkIn;

    /* ── 自检：capOf / recalcCaps 的口径（⑤ 的验收靠这三个数） ──────
       capSix 是"裸顶"（出身＋行当＋轨），capOf 才是玩家真正撞到的顶。
       ① 幻顶：裸顶 0（市井无禄）却被 study 顶出 1~12 → 系统把这人当成"有俸禄的人"；
       ② 结算：无禄的人，禄 不该进 min；
       ③ 压顶：裸顶 110 的誉，study 只许抬不许压。 */
    rec.capLuBase = (L2.capSix && L2.capSix['禄'] !== undefined) ? L2.capSix['禄'] : null;
    rec.capLu = api.capOf(L2, '禄');
    rec.study = L2.study || 0;
    rec.capYuBase = (L2.capSix && L2.capSix['誉'] !== undefined) ? L2.capSix['誉'] : null;
    rec.capYu = api.capOf(L2, '誉');
    // 情关锁顶（index.html:3649 lockSix）会把誉顶压到 70 —— 那是设计，不是 ⑤ 的 bug
    rec.capYuLocked = !!(L2.lockSix && L2.lockSix['誉'] !== undefined);
    if (rec.capLuBase === 0) {
      // 复刻 index.html:3862-3868 的结算取项，只回答一件事：禄 在不在里面
      let keys = (L2.lone ? api.SIXK.filter(k => k !== '室') : api.SIXK.slice()).filter(k => k !== '寿');
      if (rec.capLu === 0) keys = keys.filter(k => k !== '禄');
      rec.luInMin = keys.indexOf('禄') >= 0;
    }

    /* ── 覆 的成因（只有判「覆」的局才有意义） ────────────────────
       顺序与 index.html:3882-3884 的 || 链一致，先命中先记。 */
    if (rec.verdict === '覆') {
      if (L2.ruined) rec.wipedBy = 'ruined';
      else if (rec.law >= 85) rec.wipedBy = 'law';
      else if (L2.six['财'] <= 6 && L2.six['禄'] <= 6 && L2.six['室'] <= 12) rec.wipedBy = 'coffer';
      else if (L2.six['室'] <= 2 && L2.six['子'] <= 5 && L2.six['财'] <= 30 && L2.age >= 44) rec.wipedBy = 'clause4';
      else rec.wipedBy = '?';
    }
  }
  return rec;
}

function countPrefix(arr, p) {
  let c = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i].indexOf(p) === 0) c++;
  return c;
}

/* 判词里的字之间有空格：'六 全' / '寻 常' / '起 伏' / '缺 一'
   → 一律去掉空白再比对，避免八层里四层对不上。 */
function normalizeVerdict(v) {
  if (!v) return '?';
  const head = String(v).split(' · ')[0] || '';
  return head.replace(/\s+/g, '');
}

module.exports = {
  createHarness,
  runSouls,
  playLife,
  predictDelta,
  visibleOpts,
  isCleanOpt,
  normalizeVerdict,
  mulberry32,
  hash32,
  PROJECT_ROOT,
  DEFAULT_ENTRY
};
