'use strict';
/* ══════════════════════════════════════════════════════════════
   配平回归台 · 指标
   ──────────────────────────────────────────────────────────────
   输入：harness 跑出来的一串"局记录"
   输出：扁平指标表（可直接写进 baseline.json）+ 明细（给报告用）

   指标分三类：
     · 规模：局数 / 平均折数 / 平均卒年 / 耗时
     · 分布：结局八层、终局六事 P10/P50/P90
     · 机制：透、对质局、同榜、事后账簿、满招损、事件覆盖、抉择多样性
   ────────────────────────────────────────────────────────────── */

const crypto = require('crypto');

const VERDICTS = ['覆', '六全', '孤', '绝', '寻常', '起伏', '缺一', '空'];
const SIX = ['室', '财', '子', '禄', '寿', '誉'];

/* ── 指标清单（顺序 = 表里的顺序；band = 默认容差，写进 baseline 后可改） ──
   band 的含义：|本次 - 基线| <= warn  → PASS
                warn < |差| <= fail     → CONCERNS
                |差| > fail             → FAIL
   gate:false 的指标只展示、不判定（输入回显 / 结构性数字 / 自检项）。 */
const SPEC = [];
function add(key, label, unit, band, gate) {
  SPEC.push({ key, label, unit: unit || '', band: band || null, gate: gate !== false });
}

const B_PCT = { warn: 3, fail: 8 };
const B_RATE = { warn: 4, fail: 10 };
const B_PER = { warn: 0.4, fail: 1.0 };
const B_AVG = { warn: 0.6, fail: 1.5 };
const B_SIX = { warn: 4, fail: 10 };
const B_CNT = { warn: 2, fail: 6 };

add('lives', '局数', '局', null, false);
add('avgFolds', '平均折数', '折', B_AVG);
add('avgAge', '平均卒年', '岁', B_AVG);

for (const v of VERDICTS) add(`verdict.${v}.pct`, `结局 · ${v}`, '%', B_PCT);
for (const v of VERDICTS) add(`verdict.${v}.count`, `结局 · ${v}（计数）`, '局', null, false);

/* 「覆」的成因分布（裁决 01 ③ 要求：clause-4「无室无后且家底空」不许独占覆）。
   分母是「覆」的局数，样本小，所以只展示不判定；门槛走 baseline 的 intent。 */
add('verdict.覆.cause.clause4.pct', '覆 · 成因 clause-4（无室无后·家底空）', '%', null, false);
add('verdict.覆.cause.coffer.pct', '覆 · 成因 财禄室同时见底', '%', null, false);
add('verdict.覆.cause.law.pct', '覆 · 成因 律≥85', '%', null, false);
add('verdict.覆.cause.ruined.pct', '覆 · 成因 倒台', '%', null, false);

for (const k of SIX) {
  add(`six.${k}.p10`, `终局六事 · ${k} P10`, '', B_SIX);
  add(`six.${k}.p50`, `终局六事 · ${k} P50`, '', B_SIX);
  add(`six.${k}.p90`, `终局六事 · ${k} P90`, '', B_SIX);
}

add('reveal.pct', '「透」触发率', '%', B_RATE);

add('mech.duizhi.pct', '对质局占比', '%', B_RATE);
add('mech.peers.perLife', '同榜事件', '次/局', B_PER);
add('mech.due.perLife', '事后账簿合计', '笔/局', B_PER);
add('mech.due_audit.perLife', '· 旧账（audit）', '笔/局', B_PER);
add('mech.due_grudge.perLife', '· 旧怨（grudge）', '笔/局', B_PER);
add('mech.due_favor.perLife', '· 旧恩（favor）', '笔/局', B_PER);
add('mech.full.perLife', '满招损（树大事件）', '次/局', B_PER);
add('mech.full.livesPct', '满招损 · 撞上的局占比', '%', B_RATE);
/* 满招损的另一层：常态的漏（index.html:2843，≥92、35%/折、随机一项 −2）。
   它不产事件，只在手记里落一句 —— 台子原先数不到（README 已知局限第 2 条），
   现在由 harness 在 stepFull 外面包一层计数补上。 */
add('mech.full.silent.perLife', '满招损·常态的漏', '次/局', B_PER);
add('mech.full.silent.livesPct', '满招损·常态的漏 · 撞上的局占比', '%', B_RATE);

/* 律这条暗线（裁决 01 ③：只承诺"不许再压"，不承诺"可达"）。
   立案事件出现率是唯一的观测量，律的分位数用来看系数 0.8→0.6 的方向。 */
add('mech.case.livesPct', '立案（问拟）· 撞上的局占比', '%', B_RATE);
add('law.p50', '律 · 终局 P50', '', B_SIX, false);
add('law.p90', '律 · 终局 P90', '', B_SIX, false);

/* ── 墨与黑线（卡 03-03）───────────────────────────────────────
   律 = 累计墨 × 0.6，所以"立案（律 60）"等价于"单局累计墨 ≥100"。
   墨的供给因此要看 gross（选项上写下多少墨），不看终局余额：
   退还只减墨，终局余额会把"曾经很深、后来退了"的人生抹平。 */
add('ink.gross.mean', '墨供给 · 单局均值', '', { warn: 3, fail: 8 });
add('ink.gross.p50', '墨供给 · P50', '', { warn: 6, fail: 15 }, false);
add('ink.gross.p90', '墨供给 · P90', '', { warn: 8, fail: 20 }, false);
add('ink.final.mean', '墨 · 终局余额均值', '', { warn: 3, fail: 8 }, false);

/* 退还：只清自己的账，不销衙门的账（三条，一世各一次） */
add('mech.refund.livesPct', '退还 · 触发过的局占比', '%', B_RATE);
add('mech.refund.warn.pct', '· 提点（有人拦你）', '%', null, false);
add('mech.refund.pay.pct', '· 退赃（你去还）', '%', null, false);
add('mech.refund.stop.pct', '· 收手（你自己回头）', '%', null, false);
/* §1.1「无人劝你」只落在提点上：看的是"触发率之比"，不是"人数之比" */
add('mech.refund.noRoom.ratio', '· 提点触发率比（室≤5 ÷ 室>5）', '', { warn: 0.15, fail: 0.35 }, false);

/* 深水四道门：门路 → 封口 → 同船 → 收网（上船容易，下船贵） */
add('mech.dark.livesPct', '深水 · 走过任一道门的局占比', '%', null, false);
add('mech.dark.door.pct', '· 门路（被找上门）', '%', B_RATE);
add('mech.dark.seal.pct', '· 封口（同船的人被带走）', '%', null, false);
add('mech.dark.boat.pct', '· 同船（最后一票）', '%', null, false);
add('mech.dark.net.pct', '· 收网（案前来人）', '%', null, false);
/* 走到这条线上的人，最后有多少等到了立案 */
add('mech.dark.case.rate', '深水 · 上过船者的立案率', '%', B_RATE);
add('mech.darkink40.case.rate', '深水 · 墨≥40 者的立案率', '%', B_RATE);

add('coverage.seen', '事件覆盖 · 抽到条数', '条', B_CNT);
add('coverage.pct', '事件覆盖 · 覆盖率', '%', B_PCT);
add('coverage.missing', '事件覆盖 · 未抽到条数', '条', B_CNT);
add('coverage.repeat.pct', '事件重复率', '%', B_PCT);

add('choice.idx0.pct', '抉择 · 选第 1 项', '%', B_RATE);
add('choice.idx1.pct', '抉择 · 选第 2 项', '%', B_RATE);
add('choice.idx2.pct', '抉择 · 选第 3 项', '%', B_RATE);
add('choice.idx3.pct', '抉择 · 选第 4 项', '%', B_RATE);
add('choice.mono.pct', '抉择 · 高度集中事件占比', '%', B_RATE);

add('heir.has.pct', '有后率', '%', B_RATE);
add('heir.job.仕', '立业率 · 仕', '%', B_RATE);
add('heir.job.商', '立业率 · 商', '%', B_RATE);
add('heir.job.市', '立业率 · 市', '%', B_RATE);

add('model.drift', '效果模型漂移（自检）', '', { warn: 1, fail: 2 }, false);

/* capOf / recalcCaps 的口径自检（⑤ 的验收指标）。
   三个都是"条件占比"：分母是满足前提的局数，所以只看是不是 0。 */
add('selfcheck.luPhantom.pct', '自检 · 无禄局长出幻顶', '%', null, false);
add('selfcheck.luInMin.pct', '自检 · 无禄局把禄计进 min', '%', null, false);
add('selfcheck.yuClaw.pct', '自检 · 誉顶 110 被压回', '%', null, false);
add('selfcheck.capClaw', '自检 · 顶被压回（次）', '次', null, false);

/* ── 统计小工具 ─────────────────────────────────────────────── */
function pctile(arr, p) {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const h = (a.length - 1) * p;
  const lo = Math.floor(h), hi = Math.ceil(h);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (h - lo);
}
const p1 = x => Math.round(x * 10) / 10;
const p2 = x => Math.round(x * 100) / 100;

/* ── 主计算 ─────────────────────────────────────────────────── */
function compute(recs, meta) {
  meta = meta || {};
  const n = recs.length;
  const M = {};
  const D = {};            // 明细

  M.lives = n;
  M.avgFolds = n ? p1(recs.reduce((a, r) => a + (r.folds || 0), 0) / n) : 0;
  M.avgAge = n ? p1(recs.reduce((a, r) => a + (r.age || 0), 0) / n) : 0;

  /* 结局八层 */
  const vc = {};
  for (const v of VERDICTS) vc[v] = 0;
  for (const r of recs) vc[r.verdict] = (vc[r.verdict] || 0) + 1;
  for (const v of VERDICTS) {
    M[`verdict.${v}.pct`] = n ? p1((vc[v] || 0) / n * 100) : 0;
    M[`verdict.${v}.count`] = vc[v] || 0;
  }
  D.verdictCount = vc;

  /* 覆 的成因分布（分母 = 覆 的局数） */
  const wipeKinds = ['clause4', 'coffer', 'law', 'ruined'];
  const wipeN = (vc['覆'] || 0);
  for (const k of wipeKinds) {
    const c = recs.filter(r => r.wipedBy === k).length;
    M[`verdict.覆.cause.${k}.pct`] = wipeN ? p1(c / wipeN * 100) : 0;
  }
  D.wipeKinds = {};
  for (const k of wipeKinds) D.wipeKinds[k] = recs.filter(r => r.wipedBy === k).length;
  D.wipeOther = recs.filter(r => r.verdict === '覆' && r.wipedBy === '?').length;

  /* 终局六事 */
  for (const k of SIX) {
    const arr = [];
    for (const r of recs) if (r.six && Number.isFinite(r.six[k])) arr.push(r.six[k]);
    M[`six.${k}.p10`] = p1(pctile(arr, 0.10));
    M[`six.${k}.p50`] = p1(pctile(arr, 0.50));
    M[`six.${k}.p90`] = p1(pctile(arr, 0.90));
  }

  /* 透 */
  const revealed = recs.filter(r => r.revealed).length;
  M['reveal.pct'] = n ? p1(revealed / n * 100) : 0;

  /* 机制触发 */
  const duizhi = recs.filter(r => r.duizhi).length;
  M['mech.duizhi.pct'] = n ? p1(duizhi / n * 100) : 0;
  const sum = f => recs.reduce((a, r) => a + (f(r) || 0), 0);
  const per = f => (n ? p2(sum(f) / n) : 0);
  M['mech.peers.perLife'] = per(r => r.peers);
  M['mech.due.perLife'] = per(r => r.due);
  M['mech.due_audit.perLife'] = per(r => r.dueKinds && r.dueKinds.audit);
  M['mech.due_grudge.perLife'] = per(r => r.dueKinds && r.dueKinds.grudge);
  M['mech.due_favor.perLife'] = per(r => r.dueKinds && r.dueKinds.favor);
  M['mech.full.perLife'] = per(r => r.full);
  const fullLives = recs.filter(r => (r.full || 0) > 0).length;
  M['mech.full.livesPct'] = n ? p1(fullLives / n * 100) : 0;

  /* 满招损 · 常态的漏（不产事件的那一层） */
  M['mech.full.silent.perLife'] = per(r => r.fullSilent);
  const silentLives = recs.filter(r => (r.fullSilent || 0) > 0).length;
  M['mech.full.silent.livesPct'] = n ? p1(silentLives / n * 100) : 0;

  /* 律 / 立案 */
  const caseLives = recs.filter(r => r.events.indexOf('case') >= 0).length;
  M['mech.case.livesPct'] = n ? p1(caseLives / n * 100) : 0;
  const lawArr = recs.map(r => r.law || 0);
  M['law.p50'] = p1(pctile(lawArr, 0.50));
  M['law.p90'] = p1(pctile(lawArr, 0.90));

  /* ── 墨的供给 / 退还 / 深水四道门（卡 03-03） ───────────────── */
  const inkGrossArr = recs.map(r => r.inkGross || 0);
  M['ink.gross.mean'] = n ? p1(sum(r => r.inkGross) / n) : 0;
  M['ink.gross.p50'] = p1(pctile(inkGrossArr, 0.50));
  M['ink.gross.p90'] = p1(pctile(inkGrossArr, 0.90));
  M['ink.final.mean'] = n ? p1(sum(r => r.inkFinal) / n) : 0;

  const hasEv = (r, id) => r.events.indexOf(id) >= 0;

  const refAny = recs.filter(r => hasEv(r, 'ref_warn') || hasEv(r, 'ref_pay') || hasEv(r, 'ref_stop'));
  M['mech.refund.livesPct'] = n ? p1(refAny.length / n * 100) : 0;
  D.refund = {};
  for (const pair of [['warn', 'ref_warn'], ['pay', 'ref_pay'], ['stop', 'ref_stop']]) {
    const c = recs.filter(r => hasEv(r, pair[1])).length;
    M[`mech.refund.${pair[0]}.pct`] = n ? p1(c / n * 100) : 0;
    D.refund[pair[0]] = c;
  }
  // 「无人劝你」减半：按"机会"加权，不按"人数"加权
  let eA = 0, fA = 0, eB = 0, fB = 0;
  for (const r of recs) {
    const e = r.refExp || [0, 0], f = r.refFire || [0, 0];
    eA += e[0] || 0; fA += f[0] || 0;
    eB += e[1] || 0; fB += f[1] || 0;
  }
  const rateA = eA ? fA / eA : 0;
  const rateB = eB ? fB / eB : 0;
  M['mech.refund.noRoom.ratio'] = rateA ? p2(rateB / rateA) : 0;
  D.refundBucket = { exp: [eA, eB], fire: [fA, fB], rate: [p2(rateA), p2(rateB)] };

  const darkGates = [['door', 'dark_door'], ['seal', 'dark_seal'], ['boat', 'dark_boat'], ['net', 'dark_net']];
  D.dark = {};
  for (const pair of darkGates) {
    const c = recs.filter(r => hasEv(r, pair[1])).length;
    M[`mech.dark.${pair[0]}.pct`] = n ? p1(c / n * 100) : 0;
    D.dark[pair[0]] = c;
  }
  M['mech.dark.livesPct'] = n
    ? p1(recs.filter(r => darkGates.some(p => hasEv(r, p[1]))).length / n * 100) : 0;

  const darkN = recs.filter(r => r.darkIn).length;
  const darkCase = recs.filter(r => r.darkIn && hasEv(r, 'case')).length;
  M['mech.dark.case.rate'] = darkN ? p1(darkCase / darkN * 100) : 0;
  const ink40N = recs.filter(r => (r.inkGross || 0) >= 40).length;
  const ink40Case = recs.filter(r => (r.inkGross || 0) >= 40 && hasEv(r, 'case')).length;
  M['mech.darkink40.case.rate'] = ink40N ? p1(ink40Case / ink40N * 100) : 0;
  D.darkN = darkN;
  D.darkCase = darkCase;
  D.ink40N = ink40N;
  D.ink40Case = ink40Case;

  /* 事件覆盖 */
  const allIds = Array.isArray(meta.eventIds) ? meta.eventIds : [];
  const seen = new Set();
  const hitCount = {};
  let picks = 0;
  for (const r of recs) {
    for (const id of r.events) {
      picks++;
      hitCount[id] = (hitCount[id] || 0) + 1;
      seen.add(id);
    }
  }
  const seenBase = allIds.filter(id => seen.has(id));
  const missing = allIds.filter(id => !seen.has(id));
  M['coverage.seen'] = seenBase.length;
  M['coverage.pct'] = allIds.length ? p1(seenBase.length / allIds.length * 100) : 0;
  M['coverage.missing'] = missing.length;
  M['coverage.repeat.pct'] = picks ? p1((picks - seen.size) / picks * 100) : 0;
  D.missingIds = missing;
  D.hitCount = hitCount;
  D.picks = picks;

  /* 抉择多样性：选项下标分布 + 每个事件的集中度 */
  const idxDist = [0, 0, 0, 0];
  let idxTotal = 0;
  const perEvent = {};       // id -> { n, byOpt: {idx: count} }
  for (const r of recs) {
    for (const c of r.choices) {
      const i = c.idx | 0;
      idxDist[Math.min(3, Math.max(0, i))]++;
      idxTotal++;
      let e = perEvent[c.id];
      if (!e) e = perEvent[c.id] = { n: 0, by: {} };
      e.n++;
      e.by[i] = (e.by[i] || 0) + 1;
    }
  }
  for (let i = 0; i < 4; i++) M[`choice.idx${i}.pct`] = idxTotal ? p1(idxDist[i] / idxTotal * 100) : 0;

  const MIN_SAMPLE = 15;
  const monoList = [];
  let monoPool = 0, monoHit = 0;
  for (const id in perEvent) {
    const e = perEvent[id];
    if (e.n < MIN_SAMPLE) continue;
    monoPool++;
    let mx = 0, mxIdx = -1;
    for (const k in e.by) if (e.by[k] > mx) { mx = e.by[k]; mxIdx = +k; }
    const share = mx / e.n * 100;
    if (share >= 90) { monoHit++; monoList.push({ id, n: e.n, opt: mxIdx, share: p1(share) }); }
  }
  M['choice.mono.pct'] = monoPool ? p1(monoHit / monoPool * 100) : 0;
  monoList.sort((a, b) => b.share - a.share);
  D.monoEvents = monoList;
  D.monoPool = monoPool;

  /* 有后 / 立业 */
  const withHeir = recs.filter(r => r.heirHas);
  M['heir.has.pct'] = n ? p1(withHeir.length / n * 100) : 0;
  for (const axis of ['仕', '商', '市']) {
    const grp = withHeir.filter(r => r.jobAxis === axis);
    M[`heir.job.${axis}`] = grp.length ? p1(grp.filter(r => r.heirJob).length / grp.length * 100) : 0;
    D[`heirN.${axis}`] = grp.length;
  }

  /* 自检：效果模型漂移（0 = balanced 的预测与游戏完全一致） */
  M['model.drift'] = meta.diag ? p1(meta.diag.maxDiff || 0) : 0;
  D.diag = meta.diag || null;

  /* 自检：capOf / recalcCaps 的口径（条件占比，分母写进明细） */
  const noLu = recs.filter(r => r.capLuBase === 0);
  M['selfcheck.luPhantom.pct'] = noLu.length
    ? p1(noLu.filter(r => (r.study || 0) >= 2 && r.capLu > 0).length / noLu.length * 100) : 0;
  M['selfcheck.luInMin.pct'] = noLu.length
    ? p1(noLu.filter(r => r.luInMin).length / noLu.length * 100) : 0;
  const yu110 = recs.filter(r => r.capYuBase === 110 && (r.study || 0) >= 2 && !r.capYuLocked);
  M['selfcheck.yuClaw.pct'] = yu110.length
    ? p1(yu110.filter(r => r.capYu !== 110).length / yu110.length * 100) : 0;
  M['selfcheck.capClaw'] = meta.diag ? (meta.diag.capClaw || 0) : 0;
  D.selfcheck = {
    noLuN: noLu.length,
    noLuStudy2N: noLu.filter(r => (r.study || 0) >= 2).length,
    luInMinN: noLu.filter(r => r.luInMin).length,
    yu110N: yu110.length,
    capLuP50: p1(pctile(noLu.map(r => r.capLu || 0), 0.50))
  };

  /* 异常局（不该有，有就说明 harness 或游戏出问题了） */
  D.errorLives = recs.filter(r => r.error);
  D.stratErr = recs.reduce((a, r) => a + (r.stratErr || 0), 0);
  D.endedShort = recs.filter(r => !r.ended).length;

  return { metrics: M, detail: D };
}

/* ── 合并多个策略的局记录（用于"全体"口径） ─────────────────── */
function pool(list) {
  const out = [];
  for (const arr of list) for (const r of arr) out.push(r);
  return out;
}

/* ── digest：把指标数值串起来做 hash ──────────────────────────
   只串指标，不串耗时/时间戳（否则每次都不一样，等于没做）。
   同一 seed + 同一 --lives + 同一份 index.html → digest 必须一致。 */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

function digest(payload) {
  return crypto.createHash('sha1').update(stableStringify(payload)).digest('hex');
}

module.exports = { SPEC, VERDICTS, SIX, compute, pool, digest, stableStringify, pctile };
