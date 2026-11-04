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
   同规则（strat=home）：选"室 + 子台阶"收益最大的那项。

   ── 为什么必须给「子」单独计价（裁决 01 ②）───────────────────
   子 不走 eff（index.html:3104 明确 `if (k === '子') continue;`），
   它走台阶：有后 25 / 立业 20 / 有孙 20 / 家和 15 / 四世同堂 20
   （heirScore，index.html:3262）。
   原先这里只累加 eff.室，于是「求子／纳妾／认命」三个选项的分是
   0 / −10 / +2 —— 「认命」必胜，顾家 100% 选认命，绝后 52.7%。
   现在按选项自带的键映射到台阶增量，与 index.html:2624 的 dataset.home
   逐字同账（线上 ?auto=1&strat=home 与回归台再也不分家）。 */
const HOME_CHILD = { child: 22, adopt: 25, grand: 20, raised: 6, noHeir: -18, loseChild: -25 };

function homeScore(o, L) {
  const H = L.heir || {};
  const e = o.eff || {};
  let s = (e['室'] || 0) + (e['子'] || 0);
  if (o.child && !H.has) s += HOME_CHILD.child * (o.child || 0);   // 求子：成率打折后的期望
  if (o.adopt && !H.has) s += HOME_CHILD.adopt;                    // 过继：一级「有后」
  if (o.grand && H.has && !H.grand) s += HOME_CHILD.grand;         // 二级「有孙」
  if (o.raised !== undefined && H.has) s += HOME_CHILD.raised * o.raised;  // 教：影响二十岁那年立业
  if (o.noHeir && !H.has) s += HOME_CHILD.noHeir;                  // 认了断后 = 把「绝」写死
  if (o.loseChild && H.has) s += HOME_CHILD.loseChild;
  return s;
}

const home = {
  id: 'home',
  label: '顾家',
  desc: '挑"室 + 子台阶"收益最大的那一项（=游戏内 smart/home）',
  choose(ctx) {
    // 优先用游戏里那一份（index.html 的 homeScoreOpt，dataset.home 就是它算的）；
    // 拿不到才退回本地镜像（老版本 index.html 没有这个函数时台子仍能跑）。
    const api = ctx.api, L = ctx.L;
    const score = (o) => (api && typeof api.homeScoreOpt === 'function')
      ? api.homeScoreOpt(o, L) : homeScore(o, L);
    let best = 0, bv = -Infinity;
    ctx.opts.forEach((v, k) => {
      const s = score(v.o);
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

      /* d) 律：85 就是「覆」。墨是律的影子（index.html:3114，§1.1 的 ×0.6） */
      const ink = o.ink || 0;
      if (ink) {
        const lawNext = Math.min(100, lawNow + Math.round(ink * 0.6) + (o.law || 0));
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

/* ── 5. lone：无室／孤臣 ─────────────────────────────────────
   裁决 01 ① 的关键证据（一个主动一辈子不娶的人，38 个里只有 1 个被判「孤」，
   倒有 1/4 被判「六全」）在现有四策略里看不见 —— 没这条，① 就无法回归。
   它代表的人：不娶、不与人为党、把 室 压到 0，把钱和名声顶住。

   怎么想：
     a) 判「孤」要 室 ≤ 5（index.html:3887）。最干净的一条路是归到「孤臣」轨：
        那一轨的 cap 把 室 直接钉成 0（index.html:854），此后 室 再也长不回来。
        开轨条件是 loneOpen（室=0 / lone / cutParty），归轨要 trk分 ≥ 5。
        所以 `lone` / `cutParty` / `tr:{孤臣}` 是本打法的第一优先。
     b) 不走过继、不要孩子：`子 ≤ 5`（或 lone）是「孤」的另一半判据；
        有了后，`子` 会去补 min，反而把人推进「六全」。
     c) 出家（monk）不选：`aloner` 有 `!L.monk` 这一条（方外无后按方外判），
        剃了度就判不出「孤」了。
     d) 财 必须顶住 30：覆 的 clause-4 是「室≤2 && 子≤5 && 财≤30 && age≥44」
        （index.html:3884），无室的打法天然满足前三项，唯一能挡的是 财。
     e) 寿 只求活过 40（孤 的年龄门槛），不为命牺牲别的。
   ─────────────────────────────────────────────────────────── */
const lone = {
  id: 'lone',
  label: '孤臣',
  desc: '不娶、不断党就断党：室压到 0，财/誉 顶住，不走过继',
  choose(ctx) {
    const { opts, L, api, predictDelta } = ctx;
    const law = L.law || 0;
    const shi = L.six['室'];
    let best = 0, bv = -Infinity;

    for (let k = 0; k < opts.length; k++) {
      const o = opts[k].o;
      const eff = o.eff || {};
      let s = 0;

      /* a) 无室：拒婚最值钱；"将就"会把 lone 撤回，等于前功尽弃 */
      if (o.love === 'none') s += 40;
      if (o.lone) s += 34;
      if (o.unlone) s -= 60;

      /* b) 孤臣轨：这一轨的 cap 室 = 0，是拿到「孤」的主路 */
      if (o.tr && o.tr['孤臣']) s += 10 * o.tr['孤臣'];
      if (o.cutParty) s += 14;

      /* c) 不走过继、不要孩子 */
      if (o.adopt) s -= 45;
      if (o.child) s -= 10;
      if (o.noHeir) s += 12;
      if (o.loseChild) s -= 5;

      /* d) 出家判不出「孤」（!L.monk） */
      if (o.monk) s -= 30;

      /* e) 财 顶住 30（挡 clause-4）、誉 顺手顶（覆 的第一条判据不看誉，但誉高不吃亏） */
      if (eff['财']) s += predictDelta('财', eff['财']) * (L.six['财'] < 45 ? 1.5 : 0.6);
      if (eff['誉']) s += predictDelta('誉', eff['誉']) * 0.8;
      /* 禄：不图它，但「断党」要 禄 ≥ 30，低的时候补一点 */
      if (eff['禄']) s += predictDelta('禄', eff['禄']) * (L.six['禄'] < 35 ? 0.8 : 0.25);

      /* f) 室：离 5 越远，每减一分越值钱；已经 ≤5 就没必要再压 */
      if (eff['室']) {
        const d = predictDelta('室', eff['室']);
        s -= d * (shi > 5 ? 1.8 : 0.2);
      }

      /* g) 寿：只要活过 40（孤 的年龄门槛） */
      if (eff['寿']) s += predictDelta('寿', eff['寿']) * (L.age < 40 ? 0.8 : 0.3);

      /* h) 律：85 直接判「覆」 */
      if (o.ink) {
        const next = Math.min(100, law + Math.round(o.ink * 0.6) + (o.law || 0));
        s -= o.ink * (next >= 85 ? 3.2 : (next >= 60 ? 1.0 : 0.3));
      } else if (o.law) {
        s -= o.law * (law >= 60 ? 1.0 : 0.3);
      }

      /* i) 已经到顶的格子再堆是白堆 */
      for (const key of ['财', '誉', '禄']) {
        if (L.six[key] >= 92 && (eff[key] || 0) > 0) s -= 3;
      }

      if (s > bv) { bv = s; best = k; }
    }
    return best;
  }
};

const ALL = [random, cai, home, balanced, lone];
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

module.exports = { ALL, BY_ID, resolve, random, cai, home, balanced, lone, homeScore, JUDGED, thinnest, heirPoints };
