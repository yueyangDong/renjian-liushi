#!/usr/bin/env node
'use strict';
/* ══════════════════════════════════════════════════════════════
   配平回归台 · CLI
   ──────────────────────────────────────────────────────────────
   用法：
     node tools/balance/run.js                      # 默认 300 局 × 4 策略
     node tools/balance/run.js --lives 300 --seed 42
     node tools/balance/run.js --strategy balanced --lives 2000
     node tools/balance/run.js --only 结局           # 只看含"结局"的指标
     node tools/balance/run.js --verbose             # 每局打一行
     node tools/balance/run.js --write-baseline      # 重建基线（v+1）

   退出码：PASS / CONCERNS = 0，FAIL = 1，跑挂 = 2
   ────────────────────────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');

const H = require('./harness');
const S = require('./strategies');
const M = require('./metrics');
const R = require('./report');

const HERE = __dirname;
const DEFAULT_BASELINE = path.join(HERE, 'baseline.json');
const REPORT_DIR = path.join(HERE, 'reports');

/* ── 设计意图（来自 README，不是实测；只做并列记录） ───────────── */
const INTENT = {
  'verdict.寻常.pct': 6,
  'verdict.起伏.pct': 35,
  'mech.duizhi.pct': 19.5,
  'mech.peers.perLife': 2.6,
  'mech.due.perLife': 1.0,
  'heir.job.商': 51,
  'heir.job.仕': 28,
  'heir.job.市': 26
};

/* ══════════════ 参数 ══════════════ */
function parseArgs(argv) {
  const o = {
    lives: 300, seed: 20260101, strategy: 'all', only: null,
    verbose: false, report: true, writeBaseline: false,
    baseline: DEFAULT_BASELINE, json: false, help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`参数 ${a} 缺值`);
      return v;
    };
    switch (a) {
      case '-n': case '--lives': o.lives = parseInt(next(), 10); break;
      case '-s': case '--seed': o.seed = parseInt(next(), 10); break;
      case '--strategy': o.strategy = next(); break;
      case '--only': o.only = next(); break;
      case '-v': case '--verbose': o.verbose = true; break;
      case '--no-report': o.report = false; break;
      case '--write-baseline': o.writeBaseline = true; break;
      case '--baseline': o.baseline = path.resolve(next()); break;
      case '--json': o.json = true; break;
      case '-h': case '--help': o.help = true; break;
      default:
        if (a.startsWith('--lives=')) o.lives = parseInt(a.slice(8), 10);
        else if (a.startsWith('--seed=')) o.seed = parseInt(a.slice(7), 10);
        else if (a.startsWith('--strategy=')) o.strategy = a.slice(11);
        else if (a.startsWith('--only=')) o.only = a.slice(7);
        else throw new Error(`不认识的参数：${a}（--help 看用法）`);
    }
  }
  if (!Number.isFinite(o.lives) || o.lives < 1) throw new Error('--lives 必须是正整数');
  if (!Number.isFinite(o.seed)) throw new Error('--seed 必须是整数');
  return o;
}

function help() {
  console.log(`配平回归台

  node tools/balance/run.js [选项]

  --lives, -n <N>       每个策略跑多少局（默认 300）
  --seed, -s <N>        随机种子（默认 20260101）。同种子同局数 → 结果与 digest 完全一致
  --strategy <list>     random,cai,home,balanced（默认 all）
  --only <名字>         只看匹配的指标（子串匹配中文名或 key）
  --verbose, -v         每局打一行摘要
  --write-baseline      用本次实测值重建 baseline.json（版本 +1）
  --baseline <path>     指定基线文件
  --no-report           不写 reports/ 下的文件
  --json                只把结果 JSON 打到 stdout

  退出码：PASS/CONCERNS = 0，FAIL = 1，出错 = 2`);
}

/* ══════════════ 基线 ══════════════ */
function loadBaseline(p) {
  if (!fs.existsSync(p)) return null;
  try {
    const b = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!b || !b.strategies) throw new Error('结构不对：缺 strategies');
    return b;
  } catch (e) {
    throw new Error(`基线文件读不了（${p}）：${e.message}`);
  }
}

const r1 = x => Math.round(x * 10) / 10;

/* 容差不是拍脑袋定的：按"这个指标有几个样本"推标准误，再乘系数。
   - 份额类：SE = sqrt(p(1-p)/N)
   - 每局计数类：SE ≈ sqrt(mean/N)（泊松）
   - 分位数类：分布可能是一级一级的（子：0/25/40/60/85/100），给宽，只抓"整条分布移动了"
   这样 --lives 变了也不会因为"指标更准了"而误报。 */
function bandFor(key, value, d, n) {
  d = d || {};
  // 注意：指标里的份额都是"百分数"（36.3 表示 36.3%），推标准误前要先除回 0..1
  const shareOf = (pctValue, N, k1, k2) => {
    const p = Math.min(1, Math.max(0, pctValue / 100));
    const se = Math.sqrt(Math.max(p * (1 - p), 1e-4) / Math.max(1, N)) * 100;
    return { warn: r1(Math.max(k1 * se, 2)), fail: r1(Math.max(k2 * se, 5)) };
  };
  if (/^verdict\..+\.pct$/.test(key)) return shareOf(value, n, 3, 5.5);
  if (key === 'reveal.pct' || key === 'mech.duizhi.pct' ||
      key === 'mech.full.livesPct' || key === 'heir.has.pct') return shareOf(value, n, 3, 5.5);
  if (/^choice\.idx\d\.pct$/.test(key)) return shareOf(value, d.picks || n, 3, 5.5);
  if (key === 'choice.mono.pct') return shareOf(value, d.monoPool || n, 3.5, 6);
  if (/^heir\.job\./.test(key)) {
    const axis = key.split('.')[2];
    const ns = d['heirN.' + axis] || 0;
    // 子样本太小（<40 个"有后 + 这个轴"的局）就别装精密了
    if (ns < 40) return { warn: 12, fail: 25, note: `子样本仅 ${ns} 局，容差放宽` };
    return shareOf(value, ns, 3.5, 6);
  }
  if (/\.perLife$/.test(key)) {
    const se = Math.sqrt(Math.max(value, 0.02) / Math.max(1, n));
    return { warn: r1(Math.max(3 * se, 0.15)), fail: r1(Math.max(5 * se, 0.35)) };
  }
  if (key === 'avgFolds') return { warn: 0.6, fail: 1.8 };
  if (key === 'avgAge') return { warn: 1.2, fail: 3.0 };
  if (/^six\./.test(key)) return { warn: 8, fail: 20 };
  if (key === 'coverage.pct' || key === 'coverage.repeat.pct') return shareOf(value, n, 3, 5.5);
  if (key === 'coverage.seen' || key === 'coverage.missing') return { warn: 2, fail: 6 };
  return null;
}

function buildBaselineEntry(metrics, detail, spec, nLives) {
  const out = {};
  for (const s of spec) {
    const v = metrics[s.key];
    if (!Number.isFinite(v)) continue;
    const band = s.band ? bandFor(s.key, v, detail, nLives) : null;
    out[s.key] = {
      value: v,
      warn: band ? band.warn : 0,
      fail: band ? band.fail : 0,
      unit: s.unit,
      label: s.label,
      gate: s.gate,
      ...(band && band.note ? { note: band.note } : {})
    };
  }
  return out;
}

function writeBaseline(p, prev, payload) {
  const version = prev && prev.version ? prev.version + 1 : 1;
  const obj = {
    version,
    updatedAt: new Date().toISOString(),
    note: '配平回归台基线。value=基线值，warn/fail=容差（|本次-基线| 超过即 CONCERNS / FAIL）。改这里就是改门槛。',
    meta: {
      sourceHash: payload.meta.sourceHash,
      livesAt: payload.meta.lives,
      seedAt: payload.meta.seed,
      strategyIds: payload.meta.strategyIds
    },
    intent: INTENT,
    intentNote: '来自 README 的设计意图/示意值，不是实测；只与 random 策略比对，偏离只报 CONCERNS。',
    strategies: {}
  };
  for (const id of payload.meta.strategyIds.concat(['__pool'])) {
    const m = id === '__pool' ? payload.pool.metrics : payload.runs[id].metrics;
    const d = id === '__pool' ? payload.pool.detail : payload.runs[id].detail;
    obj.strategies[id] = buildBaselineEntry(m, d, M.SPEC, payload.meta.lives);
  }
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
  return obj;
}

/* ══════════════ 主流程 ══════════════ */
function main(argv) {
  const opt = parseArgs(argv);
  if (opt.help) { help(); return 0; }

  const t0 = Date.now();
  const strategyList = S.resolve(opt.strategy);
  const h = H.createHarness();
  const meta = h.meta;
  const eventIds = h.api.EV.map(e => e.id);

  const runs = {};
  const poolRecs = [];
  const poolDiag = { maxDiff: 0, checked: 0, worst: null, capClaw: 0, clawSample: null };   // 各策略漂移自检合并

  for (const strat of strategyList) {
    const ts = Date.now();
    const diag = { maxDiff: 0, checked: 0, worst: null };
    const recs = H.runSouls(h, {
      lives: opt.lives,
      seed: opt.seed,
      strategy: strat,
      diag,
      onLife: opt.verbose
        ? (r, i) => {
          const six = M.SIX.map(k => k + Math.round(r.six[k])).join(' ');
          console.log(`  [${strat.id}] #${String(i).padStart(3)} ${r.era || '--'} ` +
            `${String(r.age).padStart(3)}岁 ${String(r.folds).padStart(2)}折 ` +
            `${r.verdict}${r.revealed ? ' 透@' + r.revealAt + r.revealWhy : ''} ` +
            `同榜${r.peers} 账${r.due} 满${r.full} | ${six}` +
            (r.error ? `  ⚠${r.error}` : ''));
        }
        : null
    });
    if (diag.maxDiff > poolDiag.maxDiff) { poolDiag.maxDiff = diag.maxDiff; poolDiag.worst = diag.worst; }
    poolDiag.checked += diag.checked;
    poolDiag.capClaw += (diag.capClaw || 0);
    if (!poolDiag.clawSample && diag.clawSample) poolDiag.clawSample = diag.clawSample;
    const c = M.compute(recs, { eventIds, diag });
    runs[strat.id] = { metrics: c.metrics, detail: c.detail, label: strat.label, desc: strat.desc };
    for (const r of recs) poolRecs.push(r);
    if (!opt.verbose) process.stderr.write(`  · ${strat.label} ${opt.lives} 局 ${((Date.now() - ts) / 1000).toFixed(2)}s\n`);
  }

  /* 合并口径 */
  const poolC = M.compute(poolRecs, { eventIds, diag: poolDiag });
  const pool = { metrics: poolC.metrics, detail: poolC.detail };

  /* digest：只串指标，不串耗时 */
  const digestPayload = { seed: opt.seed, lives: opt.lives, runs: {}, pool: pool.metrics };
  for (const id of Object.keys(runs)) digestPayload.runs[id] = runs[id].metrics;
  const digest = M.digest(digestPayload);

  /* 基线 */
  const prev = loadBaseline(opt.baseline);
  let baselineObj = prev;
  let created = false;
  if (opt.writeBaseline || !prev) created = true;

  const payload = {
    meta: {
      entry: meta.entry,
      sourceHash: meta.sourceHash,
      sourceLines: meta.sourceLines,
      sourceBytes: meta.sourceBytes,
      eventCount: meta.eventCount,
      randomSites: meta.randomSites,
      seed: opt.seed,
      lives: opt.lives,
      strategyIds: strategyList.map(s => s.id),
      durationMs: Date.now() - t0,
      stamp: stamp(),
      node: process.version
    },
    runs,
    pool,
    labelOf: {},
    strategyIds: strategyList.map(s => s.id),
    primary: runs.balanced ? 'balanced' : strategyList[0].id,
    digest,
    conclusionLines: [],
    intentRows: [],
    intentMap: INTENT,
    baseline: {
      path: path.relative(H.PROJECT_ROOT, opt.baseline),
      loaded: !created,
      version: prev ? prev.version : 1,
      livesAt: prev && prev.meta ? prev.meta.livesAt : opt.lives
    }
  };
  for (const s of strategyList) payload.labelOf[s.id] = s.label;

  /* 判定 */
  payload.judge = {};
  for (const id of strategyList.map(s => s.id).concat(['__pool'])) {
    const curM = id === '__pool' ? pool.metrics : runs[id].metrics;
    const base = created ? null : (prev.strategies && prev.strategies[id]);
    payload.judge[id] = R.compare(curM, base || {}, {
      lives: opt.lives,
      baseLives: payload.baseline.livesAt
    });
  }

  /* 设计意图：只与 random 比 */
  const intentSrc = (runs.random ? runs.random.metrics : pool.metrics);
  payload.intentRows = R.compareIntent(intentSrc, (prev && prev.intent) || INTENT);

  /* 结论 */
  payload.conclusionLines = R.conclusion(payload);

  /* 首次 / 重建基线：以本次实测写入 */
  if (created) {
    baselineObj = writeBaseline(opt.baseline, prev, payload);
    payload.baseline.loaded = false;
    payload.baseline.version = baselineObj.version;
    // 写完立刻用新基线重算一遍判定：这样"首次运行"的判定也有对照，而不是全 INFO
    for (const id of strategyList.map(s => s.id).concat(['__pool'])) {
      const curM = id === '__pool' ? pool.metrics : runs[id].metrics;
      payload.judge[id] = R.compare(curM, baselineObj.strategies[id], {
        lives: opt.lives,
        baseLives: baselineObj.meta.livesAt
      });
    }
  }

  /* 报告写盘 */
  if (opt.report) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    // 同一分钟内跑两次不能互相覆盖
    let base = path.join(REPORT_DIR, `balance-${payload.meta.stamp}`);
    let n = 1;
    while (fs.existsSync(base + '.json') || fs.existsSync(base + '.md')) {
      n++;
      base = path.join(REPORT_DIR, `balance-${payload.meta.stamp}-${n}`);
    }
    fs.writeFileSync(base + '.json', JSON.stringify(toJSON(payload), null, 2) + '\n');
    fs.writeFileSync(base + '.md', R.buildMarkdown(payload) + '\n');
    payload.reportPaths = { json: base + '.json', md: base + '.md' };
  }

  /* 终端 */
  if (opt.json) {
    console.log(JSON.stringify(toJSON(payload), null, 2));
  } else {
    console.log(R.buildTerminal(payload, { only: opt.only }));
  }

  /* 退出码 */
  let fail = false, concerns = false;
  for (const id in payload.judge) {
    if (payload.judge[id].counts.FAIL > 0) fail = true;
    if (payload.judge[id].counts.CONCERNS > 0) concerns = true;
  }
  if (opt.json) process.stderr.write(`digest ${digest} · ${fail ? 'FAIL' : (concerns ? 'CONCERNS' : 'PASS')}\n`);
  else if (fail) console.log('判定：FAIL（退出码 1）\n');
  else if (concerns) console.log('判定：CONCERNS —— 有指标超出容差但在容忍带内（退出码 0，不拦 CI，但要人看一眼）\n');
  else console.log('判定：PASS（退出码 0）\n');

  return fail ? 1 : 0;
}

/* 报告里的 JSON 去掉巨量明细（每局记录不进报告，只进汇总） */
function toJSON(p) {
  const o = {
    meta: p.meta,
    digest: p.digest,
    baseline: p.baseline,
    strategyIds: p.strategyIds,
    primary: p.primary,
    labelOf: p.labelOf,
    runs: {},
    pool: { metrics: p.pool.metrics },
    judge: {},
    intent: { map: p.intentMap, rows: p.intentRows },
    conclusion: p.conclusionLines,
    detail: {
      missingIds: p.pool.detail.missingIds,
      monoPool: p.pool.detail.monoPool,
      monoEvents: p.runs[p.primary].detail.monoEvents,
      diag: p.pool.detail.diag,
      errorLives: p.pool.detail.errorLives.map(r => r.error),
      stratErr: p.pool.detail.stratErr
    }
  };
  for (const id in p.runs) o.runs[id] = { label: p.runs[id].label, desc: p.runs[id].desc, metrics: p.runs[id].metrics };
  for (const id in p.judge) o.judge[id] = p.judge[id];
  return o;
}

function stamp(d) {
  d = d || new Date();
  const p2 = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
}

/* ══════════════ 入口 ══════════════ */
if (require.main === module) {
  let code = 0;
  try {
    code = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write('\n跑挂了：' + (e && e.stack ? e.stack : e) + '\n\n');
    code = 2;
  }
  process.exit(code);
}

module.exports = { main, INTENT };
