'use strict';
/* ══════════════════════════════════════════════════════════════
   配平回归台 · 判定与报告
   ──────────────────────────────────────────────────────────────
   · compare()  指标 vs 基线 → 三档判定（PASS / CONCERNS / FAIL）
   · 终端对照表（中英混排按显示宽度对齐）
   · Markdown 报告
   ────────────────────────────────────────────────────────────── */

const { SPEC, VERDICTS } = require('./metrics');

/* ── 显示宽度：中文/全角算 2 列，否则 1 列 ───────────────────── */
function dispWidth(s) {
  let w = 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}

function pad(s, w, align) {
  const str = String(s == null ? '' : s);
  const fill = Math.max(0, w - dispWidth(str));
  if (align === 'right') return ' '.repeat(fill) + str;
  if (align === 'center') {
    const l = Math.floor(fill / 2);
    return ' '.repeat(l) + str + ' '.repeat(fill - l);
  }
  return str + ' '.repeat(fill);
}

function table(headers, rows, aligns) {
  const cols = headers.length;
  const w = new Array(cols).fill(0);
  for (let c = 0; c < cols; c++) w[c] = dispWidth(headers[c]);
  for (const r of rows) for (let c = 0; c < cols; c++) w[c] = Math.max(w[c], dispWidth(r[c]));
  const line = (cells) => cells.map((x, c) => pad(x, w[c], (aligns && aligns[c]) || 'left')).join('  ');
  const out = [line(headers), w.map(x => '─'.repeat(x)).join('  ')];
  for (const r of rows) out.push(line(r));
  return out.join('\n');
}

const fmtNum = v => {
  if (!Number.isFinite(v)) return '—';
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 10) / 10);
};
const fmtDiff = d => {
  if (!Number.isFinite(d)) return '—';
  const r = Math.round(d * 10) / 10;
  return (r > 0 ? '+' : '') + String(r);
};

/* ══════════════ 判定 ══════════════
   基线在 N=300 上取；本次如果换了局数，采样误差按 sqrt 缩放：
   2000 局比 300 局更稳，所以容差可以收紧；反之放宽。
   intent（设计意图）不进 FAIL，只报 CONCERNS —— README 自己说了那是示意值。 */
function compare(metrics, base, ctx) {
  ctx = ctx || {};
  const curLives = ctx.lives || metrics.lives || 1;
  const baseLives = ctx.baseLives || curLives;
  /* 换局数时容差怎么变：噪声 = 基线抽样误差 + 本次抽样误差
       SE_total² ∝ 1/N_base + 1/N_cur
     归一到 N_cur == N_base 时 scale = 1：scale = sqrt((1 + N_base/N_cur) / 2)
     注意：局数变大时 scale 只会降到 0.707，不会继续往下压 ——
     因为基线自己那点抽样误差不会因为这次多跑几局就消失。 */
  let scale = Math.sqrt((1 + Math.max(1, baseLives) / Math.max(1, curLives)) / 2);
  scale = Math.min(2.2, Math.max(0.7, scale));

  const rows = [];
  const counts = { PASS: 0, CONCERNS: 0, FAIL: 0, INFO: 0, NODATA: 0 };

  for (const spec of SPEC) {
    const key = spec.key;
    const cur = metrics[key];
    const b = base && base[key];

    if (!spec.gate) {
      rows.push({ key, label: spec.label, unit: spec.unit, cur, base: b ? b.value : null, diff: null, verdict: 'INFO' });
      counts.INFO++;
      continue;
    }
    if (!b || !Number.isFinite(b.value)) {
      // 基线里没有这个指标：多半是新增指标。不静默放过，但也别直接判死。
      rows.push({ key, label: spec.label, unit: spec.unit, cur, base: null, diff: null, verdict: 'CONCERNS', note: '基线缺该指标（新增？用 --write-baseline 重建）' });
      counts.CONCERNS++;
      continue;
    }
    const diff = (Number.isFinite(cur) ? cur : 0) - b.value;
    const ad = Math.abs(diff);
    const warn = (b.warn == null ? 0 : b.warn) * scale;
    const fail = (b.fail == null ? 0 : b.fail) * scale;
    let verdict, note = '';
    if (ad <= warn) verdict = 'PASS';
    else if (ad <= fail) verdict = 'CONCERNS';
    else verdict = 'FAIL';
    if (scale !== 1) note = `容差×${scale.toFixed(2)}`;
    rows.push({ key, label: spec.label, unit: spec.unit, cur, base: b.value, diff, verdict, note, warn, fail });
    counts[verdict]++;
  }
  return { rows, counts, scale };
}

/* ══════════════ 设计意图对照 ══════════════
   README 的数字是设计目标，不是实测；偏离只提示，不拦。 */
function compareIntent(metrics, intent) {
  const rows = [];
  if (!intent) return rows;
  for (const key in intent) {
    const want = intent[key];
    const cur = metrics[key];
    if (!Number.isFinite(cur) || !Number.isFinite(want)) continue;
    const diff = cur - want;
    const band = Math.max(5, Math.abs(want) * 0.4);   // 意图本身是示意值，给宽一点
    rows.push({
      key, want, cur,
      diff: Math.round(diff * 10) / 10,
      verdict: Math.abs(diff) <= band ? 'PASS' : 'CONCERNS',
      band: Math.round(band * 10) / 10
    });
  }
  return rows;
}

/* ══════════════ 结论 ══════════════
   这一节是这次交付真正要回答的问题。全部由数据推出来，不写死。 */
function conclusion(payload) {
  const lines = [];
  const runs = payload.runs || {};
  const bal = runs.balanced;
  const rnd = runs.random;

  if (!bal) {
    lines.push('· 本次没跑 balanced，无法回答"会不会被最优打法打穿"。请加 --strategy balanced。');
  } else {
    const bm = bal.metrics;
    let topV = null, topP = -1;
    for (const v of VERDICTS) {
      const p = bm[`verdict.${v}.pct`];
      if (p > topP) { topP = p; topV = v; }
    }
    const empty = VERDICTS.filter(v => bm[`verdict.${v}.pct`] < 1);
    if (topP >= 75) {
      lines.push(`· **会打穿**：balanced 手里「${topV}」占 ${topP}%，已接近必然。这一层不再是"选择的结果"，是默认结局。`);
    } else if (topP >= 55) {
      lines.push(`· **偏挤**：balanced 手里最厚的一层是「${topV}」${topP}%，还没到必然，但已明显压倒其他层。`);
    } else {
      lines.push(`· **没打穿**：balanced 手里最厚的一层是「${topV}」${topP}%，八层仍是有分布的。`);
    }
    if (empty.length) {
      lines.push(`· balanced 下几乎不出现的层：${empty.map(v => `「${v}」(${bm[`verdict.${v}.pct`]}%)`).join('、')}。` +
        `这些层在"会玩"的打法里基本摸不到 —— 要么是设计如此，要么是通往它们的路被堵死了。`);
    }
    const mono = bm['choice.mono.pct'];
    if (Number.isFinite(mono)) {
      lines.push(`· 抉择集中度：${mono}% 的事件在 balanced 下有单一选项占比 ≥90%（样本 ≥15 次）。` +
        (mono >= 30
          ? '偏高 —— 这些事件对"会玩的人"没有取舍（注意：balanced 本身是确定性的，重心在"事件是否被数值定死"，不在"策略会不会犹豫"）。'
          : '正常 —— 多数事件仍有取舍。'));
    }
    lines.push(`· 「透」在 balanced 下触发率 ${bm['reveal.pct']}%，对质局 ${bm['mech.duizhi.pct']}%，` +
      `满招损 ${bm['mech.full.perLife']} 次/局。`);
  }

  if (bal && rnd) {
    const rows = [];
    for (const v of VERDICTS) {
      const a = rnd.metrics[`verdict.${v}.pct`];
      const b = bal.metrics[`verdict.${v}.pct`];
      rows.push({ v, a, b, d: Math.round((b - a) * 10) / 10 });
    }
    rows.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    const top = rows[0];
    if (top && Math.abs(top.d) >= 1) {
      lines.push(`· balanced vs random：差得最多的是「${top.v}」—— random ${top.a}% → balanced ${top.b}%（${fmtDiff(top.d)} 个百分点）。`);
    }
    const up = rows.filter(r => r.d >= 3).map(r => `${r.v} ${fmtDiff(r.d)}`);
    const down = rows.filter(r => r.d <= -3).map(r => `${r.v} ${fmtDiff(r.d)}`);
    if (up.length) lines.push(`· 会玩的人明显更容易拿到：${up.join('、')}（百分点）。`);
    if (down.length) lines.push(`· 会玩的人明显更少拿到：${down.join('、')}（百分点）。`);
  }
  return lines;
}

/* ══════════════ 终端输出 ══════════════ */
function buildTerminal(payload, opts) {
  opts = opts || {};
  const only = opts.only ? String(opts.only) : null;
  const match = (label, key) => !only || label.includes(only) || key.includes(only);
  const L = [];
  const m = payload.meta;

  L.push('');
  L.push('══════════════════════════════════════════════════════════════════');
  L.push('  人间六事 · 配平回归台（balance regression）');
  L.push('══════════════════════════════════════════════════════════════════');
  L.push(`  源码      ${m.entry}  sha1:${m.sourceHash}  ${m.sourceLines} 行 / ${m.eventCount} 条事件`);
  L.push(`  注入      ${m.randomSites} 处 Math.random → __rng（种子随机；未设种子时退回 Math.random）`);
  L.push(`  种子      ${m.seed}   ·   每策略 ${m.lives} 局   ·   策略 ${m.strategyIds.join(' / ')}`);
  L.push(`  耗时      ${(m.durationMs / 1000).toFixed(2)}s`);
  L.push(`  digest    ${payload.digest}`);

  /* ── 一、门槛总览 ── */
  L.push('');
  L.push('── 一、门槛总览 ─────────────────────────────────────────────────');
  if (!payload.baseline.loaded) {
    L.push(`  基线：本次首次运行，已把实测值写入 ${payload.baseline.path}（v1）。`);
    L.push('        设计意图（README）只作为 intent 并列记录，不参与 PASS/FAIL。');
  } else {
    const bl = payload.baseline.livesAt;
    const age = (bl && bl !== m.lives)
      ? `基线取样 ${bl} 局，本次 ${m.lives} 局 —— 容差按 √(${bl}/${m.lives}) 缩放`
      : `基线取样 ${bl || m.lives} 局，与本次一致`;
    L.push(`  基线：${payload.baseline.path}（v${payload.baseline.version}）· ${age}`);
  }
  const rowsA = [];
  for (const id of payload.strategyIds) {
    const j = payload.judge[id];
    const c = j.counts;
    const overall = c.FAIL > 0 ? 'FAIL' : (c.CONCERNS > 0 ? 'CONCERNS' : 'PASS');
    rowsA.push([payload.labelOf[id], c.PASS, c.CONCERNS, c.FAIL, overall]);
  }
  {
    const j = payload.judge.__pool;
    const c = j.counts;
    const overall = c.FAIL > 0 ? 'FAIL' : (c.CONCERNS > 0 ? 'CONCERNS' : 'PASS');
    rowsA.push(['全体（合并）', c.PASS, c.CONCERNS, c.FAIL, overall]);
  }
  L.push(table(['策略', 'PASS', 'CONCERNS', 'FAIL', '判定'], rowsA, ['left', 'right', 'right', 'right', 'left']));

  const bad = [];
  for (const id of payload.strategyIds.concat(['__pool'])) {
    const name = id === '__pool' ? '全体' : payload.labelOf[id];
    for (const r of payload.judge[id].rows) {
      if (r.verdict === 'CONCERNS' || r.verdict === 'FAIL') bad.push([name, r]);
    }
  }
  if (bad.length) {
    L.push('');
    L.push('  不达标 / 需关注的行：');
    L.push(table(
      ['策略', '指标', '基线', '本次', '偏差', '判定'],
      bad.map(([n, r]) => [n, r.label, r.base == null ? '—' : fmtNum(r.base), fmtNum(r.cur), fmtDiff(r.diff), r.verdict]),
      ['left', 'left', 'right', 'right', 'right', 'left']
    ));
  } else {
    L.push('');
    L.push('  所有受控指标均在容差内。');
  }

  /* ── 二、结局八层跨策略对照 ── */
  L.push('');
  L.push('── 二、结局八层 · 跨策略对照 ────────────────────────────────────');
  const headB = ['结局'];
  for (const id of payload.strategyIds) headB.push(payload.labelOf[id]);
  headB.push('设计意图');
  const intentV = payload.intentMap || {};
  const rowsB = VERDICTS.map(v => {
    const r = [v];
    for (const id of payload.strategyIds) r.push(fmtNum(payload.runs[id].metrics[`verdict.${v}.pct`]) + '%');
    const ig = intentV[`verdict.${v}.pct`];
    r.push(ig == null ? '—' : ig + '%');
    return r;
  });
  if (!only || '结局'.includes(only)) {
    L.push(table(headB, rowsB, headB.map((_, i) => (i === 0 ? 'left' : 'right'))));
  }

  /* ── 三、主策略全量对照 ── */
  const primary = payload.primary;
  L.push('');
  L.push(`── 三、主策略「${payload.labelOf[primary]}」全量对照 ${'─'.repeat(Math.max(4, 40 - payload.labelOf[primary].length * 2))}`);
  const rowsC = [];
  for (const r of payload.judge[primary].rows) {
    if (!match(r.label, r.key)) continue;
    rowsC.push([
      r.label + (r.unit ? `（${r.unit}）` : ''),
      r.base == null ? '—' : fmtNum(r.base),
      fmtNum(r.cur),
      r.diff == null ? '—' : fmtDiff(r.diff),
      r.verdict
    ]);
  }
  L.push(table(['指标', '基线', '本次', '偏差', '判定'], rowsC, ['left', 'right', 'right', 'right', 'left']));

  /* ── 四、设计意图 ── */
  const intents = payload.intentRows || [];
  if (intents.length) {
    L.push('');
    L.push('── 四、设计意图 vs 实测（README 的数字是示意值，只报 CONCERNS） ──');
    const rowsD = intents.map(r => {
      const spec = SPEC.find(s => s.key === r.key);
      return [spec ? spec.label : r.key, r.want, r.cur, fmtDiff(r.diff), `±${r.band}`, r.verdict];
    });
    L.push(table(['指标', '设计意图', '实测(random)', '偏差', '容忍带', '判定'], rowsD,
      ['left', 'right', 'right', 'right', 'right', 'left']));
  }

  /* ── 五、结论 ── */
  L.push('');
  L.push('── 五、结论 ──────────────────────────────────────────────────────');
  for (const line of payload.conclusionLines) L.push('  ' + line);

  /* ── 六、自检 ── */
  const diag = payload.pool.detail.diag;
  L.push('');
  L.push('── 六、自检 ──────────────────────────────────────────────────────');
  if (diag) {
    L.push(`  效果模型漂移  ${diag.maxDiff === 0 ? '0（加法预测与游戏完全一致）' : diag.maxDiff + ' ← 有偏差：' + JSON.stringify(diag.worst)}`);
    L.push(`  校验样本      ${diag.checked} 个 (事件,格子) 对`);
    if (diag.capClaw) {
      L.push(`  顶被压回      ${diag.capClaw} 次 —— study 抬高的顶，在 recalcCaps() 里被裸顶压回去`);
      L.push(`                （index.html:837 抬 / :859 压。游戏既有行为，不是本台算错。例：${JSON.stringify(diag.clawSample)}）`);
    }
  }
  const errs = payload.pool.detail.errorLives.length;
  L.push(`  异常局        ${errs === 0 ? '0' : errs + '（前 3 例：' + payload.pool.detail.errorLives.slice(0, 3).map(r => r.error).join('；') + '）'}`);
  L.push(`  策略异常      ${payload.pool.detail.stratErr} 次`);
  L.push('');
  L.push(`  报告：${payload.reportPaths ? payload.reportPaths.md : '（未写盘）'}`);
  L.push('');
  return L.join('\n');
}

/* ══════════════ Markdown ══════════════ */
function mdTable(headers, rows, aligns) {
  const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|');
  const al = i => {
    const a = aligns && aligns[i];
    return a === 'l' ? ':---' : (a === 'c' ? ':---:' : '---:');
  };
  const out = [];
  out.push('| ' + headers.map(esc).join(' | ') + ' |');
  out.push('|' + headers.map((h, i) => al(i)).join('|') + '|');
  for (const r of rows) out.push('| ' + r.map(esc).join(' | ') + ' |');
  return out.join('\n');
}

function buildMarkdown(payload) {
  const m = payload.meta;
  const L = [];
  L.push(`# 配平回归报告 · ${m.stamp}`);
  L.push('');
  L.push('## 元信息');
  L.push('');
  L.push(`| 项 | 值 |`);
  L.push(`|---|---|`);
  L.push(`| 源码 | \`${m.entry}\` · sha1 \`${m.sourceHash}\` · ${m.sourceLines} 行 |`);
  L.push(`| 注入 | ${m.randomSites} 处 \`Math.random\` → \`__rng\` |`);
  L.push(`| 事件表 | ${m.eventCount} 条 |`);
  L.push(`| 种子 | \`${m.seed}\` |`);
  L.push(`| 每策略局数 | ${m.lives} |`);
  L.push(`| 策略 | ${m.strategyIds.join(' / ')} |`);
  L.push(`| 耗时 | ${(m.durationMs / 1000).toFixed(2)}s |`);
  L.push(`| digest | \`${payload.digest}\` |`);
  L.push(`| 基线 | ${payload.baseline.loaded ? '`' + payload.baseline.path + '` v' + payload.baseline.version : '首次生成'} |`);
  L.push('');

  L.push('## 结论');
  L.push('');
  for (const line of payload.conclusionLines) L.push(line.replace(/^· /, '- '));
  L.push('');

  L.push('## 结局八层 · 跨策略');
  L.push('');
  const head = ['结局'];
  for (const id of payload.strategyIds) head.push(payload.labelOf[id]);
  head.push('设计意图');
  const intentV = payload.intentMap || {};
  L.push(mdTable(head, VERDICTS.map(v => {
    const r = [v];
    for (const id of payload.strategyIds) r.push(fmtNum(payload.runs[id].metrics[`verdict.${v}.pct`]) + '%');
    r.push(intentV[`verdict.${v}.pct`] == null ? '—' : intentV[`verdict.${v}.pct`] + '%');
    return r;
  })));
  L.push('');

  L.push('## 门槛总览');
  L.push('');
  const rowsA = [];
  for (const id of payload.strategyIds.concat(['__pool'])) {
    const j = payload.judge[id];
    const c = j.counts;
    rowsA.push([id === '__pool' ? '全体（合并）' : payload.labelOf[id], c.PASS, c.CONCERNS, c.FAIL,
      c.FAIL > 0 ? 'FAIL' : (c.CONCERNS > 0 ? 'CONCERNS' : 'PASS')]);
  }
  L.push(mdTable(['策略', 'PASS', 'CONCERNS', 'FAIL', '判定'], rowsA, ['l','r','r','r','l']));
  L.push('');

  for (const id of payload.strategyIds.concat(['__pool'])) {
    const name = id === '__pool' ? '全体（合并）' : payload.labelOf[id];
    L.push(`## 指标对照 · ${name}`);
    L.push('');
    const rows = payload.judge[id].rows.map(r => [
      r.label + (r.unit ? `（${r.unit}）` : ''),
      r.base == null ? '—' : fmtNum(r.base),
      fmtNum(r.cur),
      r.diff == null ? '—' : fmtDiff(r.diff),
      r.verdict,
      r.note || ''
    ]);
    L.push(mdTable(['指标', '基线', '本次', '偏差', '判定', '备注'], rows, ['l','r','r','r','l','l']));
    L.push('');
  }

  if ((payload.intentRows || []).length) {
    L.push('## 设计意图 vs 实测');
    L.push('');
    L.push('> README 里的数字是设计目标/示意值，不是实测；偏离只报 CONCERNS，不判 FAIL。实测口径取 `random` 策略（最接近"不作策略地玩"）。');
    L.push('');
    L.push(mdTable(['指标', '设计意图', '实测', '偏差', '容忍带', '判定'],
      payload.intentRows.map(r => {
        const spec = SPEC.find(s => s.key === r.key);
        return [spec ? spec.label : r.key, r.want, r.cur, fmtDiff(r.diff), `±${r.band}`, r.verdict];
      })));
    L.push('');
  }

  L.push('## 明细');
  L.push('');
  const miss = payload.pool.detail.missingIds || [];
  L.push(`### 未抽到的事件（${miss.length}）`);
  L.push('');
  L.push(miss.length ? miss.map(x => '`' + x + '`').join('、') : '全部覆盖。');
  L.push('');

  L.push(`### 高度集中的事件（单选项 ≥90%，样本 ≥15）· ${payload.primary} 口径`);
  L.push('');
  const mono = payload.runs[payload.primary].detail.monoEvents || [];
  L.push(mono.length ? mono.map(x => `\`${x.id}\`：\`${x.opt}\` 号选项占 ${x.share}%（${x.n} 次）`).join('\n') : '无。');
  L.push('');
  L.push('> 上表只说明"这个事件在 balanced 下几乎只有一个答案"，不等于 bug —— 但值得逐个看是不是数值写歪了。');
  L.push('');

  L.push('## 口径说明');
  L.push('');
  L.push('- **一局** = 一世（16 折封顶 / 寿尽则终）。**一魂** = 五世共用一个八字，古/今由游戏自己的平衡规则掷（`autoStartLife`），不是固定 1:1。');
  L.push('- 每局的随机流按 `(seed, 魂序号, 局序号)` 单独播种，所以 `--lives 300` 的前 300 局与 `--lives 2000` 的前 300 局完全一致。');
  L.push('- 策略只能从**玩家点得到的**选项里选（复刻 `index.html:2618` 的隐藏规则：带 `edit` 的选项在古世或禄不够时不显示）。');
  L.push('- 「透」= 一格推到自己的顶（`L.revealed`）；「对质局」= 该局抽到过 `duizhi`；「同榜」= `peer_*` 事件次数；「事后账簿」= `due_*` 事件次数。');
  L.push('- 满招损分两条：`full` 事件（树大，每局 ≤2 次）与「常态的漏」（`stepFull`，不产事件、只在手记里落一句，本台无法直接计数，故不计入）。');
  L.push('- P10/P50/P90 是终局六事的线性插值分位数，样本 = 该策略全部局。');
  L.push('');
  return L.join('\n');
}

module.exports = {
  dispWidth, pad, table, compare, compareIntent, conclusion,
  buildTerminal, buildMarkdown, fmtNum, fmtDiff
};
