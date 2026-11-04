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
