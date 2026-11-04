'use strict';
/* ══════════════════════════════════════════════════════════════
   配平回归台 · 玩家策略
   ──────────────────────────────────────────────────────────────
   统一接口，加新策略不用改 harness：

     {
       id:    'balanced',            // 命令行 --strategy 用这个
       label: '贪心平衡',
       desc:  '每次选择让最薄的那一格收益最大',
       choose(ctx) -> number         // 返回点在 ctx.opts（可见选项）里的下标
     }

   ctx = {
     ev      当前事件（原对象）
     opts    玩家点得到的选项 [{ o, i }]，i 是它在 ev.opts 里的原始下标
     L       当前这一局 (S.life)，可以读 six / cap / heir / law / ink / yun ...
     api     游戏句柄（capOf / clamp / heirScore / JOB ...）
     rng     本局专属的策略随机流（与游戏的随机流完全分开，互不污染）
     predictDelta(k, raw)  预测某个 eff 落到 six 上的真实增量（含封顶）
   }
   ────────────────────────────────────────────────────────────── */

/* ── 1. random：均匀随机 ─────────────────────────────────────
   这是"闭着眼睛玩"，也是 README 里那些设计意图数字最可能的取样口径。 */
const random = {
  id: 'random',
  label: '随机',
  desc: '均匀随机选，不看选项内容',
  choose(ctx) {
    return Math.floor(ctx.rng() * ctx.opts.length);
  }
};

/* ── 2. cai：专精一路 ────────────────────────────────────────
   与游戏内 ?auto=1&smart=1&strat=cai 完全同规则（index.html:2635-2648）：
   选 sum(o.cai) 最大的那项。并列取先出现的。 */
const cai = {
  id: 'cai',
  label: '专精',
  desc: '挑"最练才"的那一项（=游戏内 smart/cai）',
  choose(ctx) {
    let best = 0, bv = -Infinity;
    ctx.opts.forEach((v, k) => {
      const o = v.o;
      let s = 0;
      for (const key in (o.cai || {})) s += o.cai[key] || 0;
      if (s > bv) { bv = s; best = k; }
    });
    return best;
  }
};

/* ── 3. home：顾家一路 ───────────────────────────────────────
   同规则（strat=home）：选 eff.室 + eff.子 最大的那项。 */
const home = {
  id: 'home',
  label: '顾家',
  desc: '挑"室 + 子"收益最大的那一项（=游戏内 smart/home）',
  choose(ctx) {
    let best = 0, bv = -Infinity;
    ctx.opts.forEach((v, k) => {
      const e = v.o.eff || {};
      const s = (e['室'] || 0) + (e['子'] || 0);
      if (s > bv) { bv = s; best = k; }
    });
    return best;
  }
};

/* ── 4. balanced：贪心平衡 ───────────────────────────────────
   这个策略代表"会玩的人"。它的存在意义只有一个：
   检验数值会不会被最优打法击穿 —— 如果某一层结局在它手里变成必然，
   那不是玩家会玩，是数值漏了。

   它怎么想（全部是启发式，不追求最优，只追求"像个懂行的人"）：
     a) 终局判词看的是「最薄那一格」（index.html:3873-3898），
        所以缺什么补什么，离自己的顶越远的格子，每一分越值钱。
     b) 子 是台阶制的（有后 25 / 立业 20 / 有孙 20 / 家和 15 / 四世同堂 20），
        只能靠关键选项往上走，所以对 child/adopt/grand 这类选项单独计价。
     c) 律 到 85 直接判「覆」（index.html:3882），墨（ink）会把律带上去，
        所以律高了以后要主动避墨。
     d) 寿 是命，不是分。寿低的时候保命优先。
   注意：这套模型只用来"选"，从不写回游戏。predictDelta 的加法规与
   index.html:3106 一致，harness 另有漂移自检盯着它（model.drift）。
   ─────────────────────────────────────────────────────────── */

/* 六事里参与判词的那五格（寿按卒年另算，见 index.html:3862-3872） */
const JUDGED = ['室', '财', '子', '禄', '誉'];

function thinnest(L) {
  let k = JUDGED[0], v = Infinity;
  for (let i = 0; i < JUDGED.length; i++) {
    const x = JUDGED[i];
    if (L.six[x] < v) { v = L.six[x]; k = x; }
  }
  return { k, v };
}

/* 子：把台阶换算成"六事分"。数值取自 heirScore（index.html:3262-3272） */
function heirPoints(o, L) {
  const H = L.heir || {};
  let g = 0;
  if (o.adopt && !H.has) g += 25;
  if (o.child && !H.has) g += 25 * (o.child || 0);          // o.child 是成功率
  if (o.grand && H.has && !H.grand) g += 20;
  if (o.raised !== undefined && H.has) g += 4 * o.raised;    // 影响二十岁那年的立业判定
  if (o.loseChild && H.has) g -= 25;
  if (o.noHeir && !H.has) g -= 18;                           // 认了断后，是把「绝」写死
  if (o.monk) g -= 45;                                       // 方外无后
  return g;
}

const balanced = {
  id: 'balanced',
  label: '贪心平衡',
  desc: '缺什么补什么：让最薄那一格的边际收益最大',
  choose(ctx) {
    const { opts, L, api, predictDelta } = ctx;
    const thin = thinnest(L);
    const lawNow = L.law || 0;
    const heirNow = api.heirScore(L) || 0;
    const shouNow = L.six['寿'];
    const shouLow = shouNow < 32;

    let best = 0, bv = -Infinity;

    for (let k = 0; k < opts.length; k++) {
      const o = opts[k].o;
      const eff = o.eff || {};
      let score = 0;

      /* a) 室 / 财 / 禄 / 誉：真实增量 × 缺口权重 */
      for (let j = 0; j < 4; j++) {
        const key = ['室', '财', '禄', '誉'][j];
        const raw = eff[key];
        if (!raw) continue;
        const d = predictDelta(key, raw);
        if (!d) continue;
        const cap = api.capOf(L, key);
        const room = cap > 0 ? Math.max(0, cap - L.six[key]) / cap : 0;  // 离自己的顶还有多远
        score += d * (0.6 + 1.8 * room);
        if (key === thin.k) score += d * 1.4;                             // 补最薄那一格
      }

      /* b) 子：台阶制，单独计价 */
      const hp = heirPoints(o, L);
      if (hp) {
        const room = Math.max(0, 100 - heirNow) / 100;
        score += hp * (0.8 + 1.2 * room);
        if (thin.k === '子') score += hp * 0.6;
      }

      /* c) 寿：命。低的时候一分当三分用 */
      if (eff['寿']) {
        const d = predictDelta('寿', eff['寿']);
        score += d * (shouLow ? 2.5 : 0.3);
      }

      /* d) 律：85 就是「覆」。墨是律的影子（index.html:3114） */
      const ink = o.ink || 0;
      if (ink) {
        const lawNext = Math.min(100, lawNow + Math.round(ink * 0.8) + (o.law || 0));
        const risk = lawNext >= 85 ? 3.2 : (lawNext >= 60 ? 1.1 : 0.3);
        score -= ink * risk;
      } else if (o.law) {
        score -= o.law * (lawNow >= 60 ? 1.0 : 0.3);
      }

      /* e) 已经透了 / 封顶的格子，再堆是白堆（满招损会往回漏） */
      for (const key of ['室', '财', '禄', '誉']) {
        if (L.six[key] >= 92 && (eff[key] || 0) > 0) score -= 3;
      }

      if (score > bv) { bv = score; best = k; }
    }
    return best;
  }
};

const ALL = [random, cai, home, balanced];
const BY_ID = {};
for (const s of ALL) BY_ID[s.id] = s;

function resolve(spec) {
  if (!spec) return ALL.slice();
  const ids = String(spec).split(',').map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const id of ids) {
    if (id === 'all') return ALL.slice();
    const s = BY_ID[id];
    if (!s) throw new Error(`未知策略「${id}」，可选：${Object.keys(BY_ID).join(' / ')} / all`);
    out.push(s);
  }
  return out;
}

module.exports = { ALL, BY_ID, resolve, random, cai, home, balanced, JUDGED, thinnest, heirPoints };
