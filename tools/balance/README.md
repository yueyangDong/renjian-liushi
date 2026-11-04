# 配平回归台（tools/balance）

把《人间六事 · 五世》跑成**可复现的数字**，用来回答一个问题：

> 改了一个数之后，结局分布到底动没动？会不会被"会玩的人"打穿？

零依赖、无构建、不改 `index.html` 一个字节。只要 `node`（v18+）。

---

## 三十秒上手

```bash
cd 人间六事

node tools/balance/run.js                     # 默认：300 局 × 5 策略，约 1.2 秒
node tools/balance/run.js --lives 300 --seed 42
node tools/balance/run.js --strategy balanced --lives 2000
node tools/balance/run.js --only 结局           # 只看名字里带"结局"的指标
node tools/balance/run.js --verbose            # 每局打一行摘要
```

退出码：**PASS = 0，CONCERNS = 0（会显式打印），FAIL = 1，跑挂 = 2**。可以直接挂 CI。

每次运行会写两份报告：

```
tools/balance/reports/balance-<YYYYMMDD-HHmm>.json   全部指标 + 判定 + 明细
tools/balance/reports/balance-<YYYYMMDD-HHmm>.md     给人看的那一份
```

终端里是一张对照表：**指标 / 基线 / 本次 / 偏差 / 判定**。

---

## 确定性：同种子 = 同一个世界

| 要素 | 做法 |
|---|---|
| 游戏侧随机 | `index.html` 里的 **25 处 `Math.random`** 在加载时被替换成 `__rng`，指向一条种子流 |
| 未设种子 | `__rng` 退回 `Math.random` —— 默认行为完全不变 |
| 策略侧随机 | 另开一条独立种子流，**不碰全局 `Math.random`**，不会污染游戏 |
| 播种粒度 | 每局按 `hash(seed, 魂序号, 局序号)` 单独播种 |
| 校验 | `digest` = 全部指标数值的 sha1。同 `--seed` 同 `--lives` 必须一致 |

因为按局播种，还顺带得到一个好性质：

> `--lives 300` 的前 300 局，和 `--lives 2000` 的前 300 局，**逐局完全相同**。
> 所以加大局数只是"多采样"，不会把前面的结论推翻。

`digest` 不含耗时、不含时间戳 —— 只串指标。改了玩法数值，digest 一定变；只改注释，digest 不变。

跑两次对一下：

```bash
node tools/balance/run.js --seed 42 --no-report | grep digest
node tools/balance/run.js --seed 42 --no-report | grep digest   # 两行必须一模一样
```

---

## 五种策略

| `--strategy` | 名字 | 怎么选 | 它代表谁 |
|---|---|---|---|
| `random` | 随机 | 均匀随机 | 闭着眼睛玩的人。README 里那些设计意图数字，最可能是这个口径量出来的 |
| `cai` | 专精 | 挑 `sum(o.cai)` 最大的 | 游戏内 `?auto=1&smart=1&strat=cai` 同规则 |
| `home` | 顾家 | 挑 `室 + 子台阶` 最大的 | 游戏内 `strat=home` 同规则 |
| `balanced` | 贪心平衡 | 缺什么补什么（见下） | **会玩的人**。检验数值会不会被最优打法击穿，只看它 |
| `lone` | 孤臣 | 拒婚 + 走孤臣轨 + 不走过继，把 室 压到 0 | **主动选择一辈子不娶的人**。检验「孤」这条判词拿不拿得到 |

`lone` 是裁决 01 ① 加上来的：裁决举证"一个主动一辈子不娶的人，38 个里只有 1 个被判「孤」，
倒有 1/4 被判「六全」"，而这件事在原来四策略里看不见 —— 没有它，「孤」的改动无法回归。

`home` 的计价（`室 + 子台阶`）与游戏里**同一份实现**：`strategies.js` 优先调 `api.homeScoreOpt`
（就是 `index.html` 里 `dataset.home` 用的那个函数），拿不到才退回本地镜像。
线上 `?auto=1&strat=home` 与回归台因此不会各算一套。

`balanced` 的启发式（`strategies.js` 里有逐条注释）：

1. 终局判词看的是"最薄那一格"（`index.html:3873-3898`），所以离自己的顶越远的格子，每一分越值钱；
2. 子 是台阶制（有后 25 / 立业 20 / 有孙 20 / 家和 15 / 四世同堂 20），只能靠 `child/adopt/grand` 这类选项往上走，单独计价；
3. 律到 85 直接判「覆」，墨会把律带上去（`ink × 0.8`），律高了主动避墨；
4. 寿是命不是分，寿低于 32 时保命优先。

**它不是最优解，只是个懂行的玩家。** 也正因为如此，它打出来的分布才是"这游戏最容易被玩成的样子"。

加策略不用改 harness，只要在 `strategies.js` 里加一个：

```js
const myStrat = {
  id: 'my', label: '我的打法', desc: '……',
  choose({ ev, opts, L, api, rng, predictDelta }) { return 0; }   // 返回 opts 的下标
};
```

---

## 指标

| 组 | 指标 |
|---|---|
| 规模 | 局数、平均折数、平均卒年 |
| 结局 | 八层（覆／六全／孤／绝／寻常／起伏／缺一／空）各自占比 + 计数 + **覆·成因分布**（clause-4／财禄室见底／律≥85／倒台） |
| 终局六事 | 室／财／子／禄／寿／誉 的 P10 / P50 / P90 |
| 「透」 | 一格推到自己的顶的触发率 |
| 机制 | 对质局占比、同榜事件 次/局、事后账簿（旧账/旧怨/旧恩）笔/局、满招损（树大）次/局 + **满招损·常态的漏** 次/局、立案（问拟）局占比、律 P50/P90 |
| 事件覆盖 | 抽到条数、覆盖率、未抽到条数（ID 列在报告里）、重复率 |
| 抉择多样性 | 第 1/2/3/4 项各被选多少、**高度集中事件占比**（某选项 ≥90% = 疑似"唯一最优解"） |
| 有后 / 立业 | 有后率、按行当轴分的立业率（仕／商／市） |
| 自检 | 效果模型漂移、异常局、策略异常、**无禄局长出幻顶 / 无禄局把禄计进 min / 誉顶被压回 / 顶被压回** |

判定口径见报告底部「口径说明」。

---

## 门槛：baseline.json

首次运行会把**本次实测值**写成 `baseline.json` v1，并把 README 的设计意图数字并列记进 `intent`。

```jsonc
{
  "version": 1,
  "meta": { "livesAt": 300, "seedAt": 20260101, "strategyIds": [...] },
  "intent": { "verdict.寻常.pct": 6, "verdict.起伏.pct": 35, ... },
  "strategies": {
    "balanced": {
      "verdict.覆.pct": {
        "value": 0,      // 基线值
        "warn": 2,       // |本次-基线| <= warn → PASS
        "fail": 5,       // warn < |差| <= fail → CONCERNS；> fail → FAIL
        "unit": "%", "label": "结局 · 覆", "gate": true
      }
    }
  }
}
```

**改阈值就是改这个文件。** 想让它更严就把 `warn/fail` 调小；`gate: false` 表示只展示不判定。

### 三档

| 判定 | 含义 | 退出码 |
|---|---|---|
| `PASS` | 在容差内 | 0 |
| `CONCERNS` | 超出容差、但在容忍带内；或偏离设计意图 | 0（显式打印，不拦 CI） |
| `FAIL` | 越界 / 基线缺指标 / 跑挂 | 1 |
| `INFO` | 输入回显、结构性数字、自检项，不判定 | — |

**设计意图（`intent`）只报 CONCERNS，永不 FAIL。** README 自己写明原型数值是示意值。

### 容差怎么来的

不是拍脑袋：

- 份额类：`SE = sqrt(p(1-p)/N)`，`warn = max(3·SE, 2)`，`fail = max(5.5·SE, 5)`
- 每局计数类（同榜／账簿／满招损）：`SE ≈ sqrt(mean/N)`（泊松）
- 立业率这类**子样本**指标：分母是"有后 且 走这个行当"的局数，`< 40` 时直接放宽到 `warn 12 / fail 25`
- 分位数类：分布可能是**一级一级的台阶**（子：0/25/40/65/85/100），给 `warn 8 / fail 20`，只抓"整条分布移动了"

换 `--lives` 时容差按 `sqrt((1 + N基线/N本次)/2)` 缩放，最小只收到 `0.707` ——
因为**基线自己那份抽样误差不会因为这次多跑几局就消失**。

### 重建基线

```bash
node tools/balance/run.js --write-baseline                 # 用当前实测覆盖，版本 +1
node tools/balance/run.js --write-baseline --lives 2000    # 做 CI 基线建议用大样本
```

> 建议：CI 用的基线和 CI 跑的 `--lives` 用同一个数，否则容差要缩放，结论会毛。

---

## 报告怎么看

```
── 一、门槛总览 ──      每个策略 PASS/CONCERNS/FAIL 各几条 + 不达标的行
── 二、结局八层 ──      四个策略并排 + 设计意图那一列
── 三、主策略全量 ──    贪心平衡的全部指标对照
── 四、设计意图 ──      README 的数字 vs 实测（random 口径）
── 五、结论 ──          打穿判定 / balanced vs random 差在哪层
── 六、自检 ──          模型漂移、异常局
```

第五节是这套台子存在的理由，它由数据推出来，不写死：

- **会打穿**：`balanced` 手里最厚一层 ≥ 75%
- **偏挤**：≥ 55%
- **没打穿**：都低于 55%

---

## 与历史脚本（`_sim4.js` / `_stat.js` / …）的区别

那五个脚本是历史存档，保留不动。本台修掉了它们身上的四件事：

1. **不可复现**：25 处 `Math.random` 没有种子入口，每次结果都不一样。
2. **定时器风暴**：`choose()` 结尾是 `setTimeout(advanceFold, 0)`，脚本又手动调了一次 `advanceFold()`。
   同步循环跑完后几千个回调集中爆发 —— 200 局从 **0.2 秒变成 94 秒**，而且**已经结束的局会被继续推进**。
   本台把 `setTimeout/setInterval` 换成丢弃式桩，每折只由 harness 推一次。
3. **能点到看不见的按钮**：UI 会把带 `edit` 的选项在某些条件下藏掉（`index.html:2618`），
   历史脚本直接从 `ev.opts` 里抽。本台按 UI 规则过滤，策略只能选玩家点得到的。
4. **各算各的**：五份 DOM 桩、五套指标。本台只有一份，指标一处定义、一处判定。

---

## 已知局限（都是"知道但没改"，不是没发现）

- **只跑单局，不跑完整"五世"之外的东西**：一魂五世共用一个八字、古/今由游戏自己的平衡规则掷（`autoStartLife`），
  但天机／命书那一屏不参与统计。
- **分位数是线性插值**，台阶型指标（子、寿）的 P10/P90 会跳级，容差给得宽。
- **抉择集中度受策略确定性影响**：`balanced` 是确定性打分，天然会集中。
  这个指标用来找"数值把选项定死了"，不能用来证明"玩家一定这么选"。
  真要判"唯一最优解"，看的是"是否所有合理打法都收敛到同一项"，本台只做了单策略口径。
- **`cai` / `home` 的集中度天然是 97~100%**：它们是"闭着眼睛按同一个数选"的策略，
  `choice.mono.pct` 对它们没有信息量，看这一项只看 `balanced` / `lone`。
- **不改游戏、不写回 `index.html`**：注入只发生在内存里的字符串上。造桩、替换、执行，全程只读。
  （唯一的例外是 `stepFull` 的包装计数：包的是内存里那份代码，为了数「满招损·常态的漏」。
  游戏文件本身没有被改。）

---

## 变更记录

### v2（裁决 01 的五处修复之后）

`index.html` 改了五处：`capOf`/`recalcCaps` 归一（⑤）、顾家计价补「子」（②）、
立业回设定公式（④）、律 0.8→0.6 / 55→60 / 去掉"一生一次"（③）、「孤」判据与顺序（①）。

- 基线：`--write-baseline --lives 2000 --seed 20260101`（**基线取样 2000 局，与 CI 跑的局数必须一致**）
- 新增策略 `lone`；新增指标 `mech.full.silent.*`、`mech.case.livesPct`、`law.p50/p90`、
  `verdict.覆.cause.*`、`selfcheck.*`
- 新增 `intent`：`verdict.孤.pct = 18`（裁决 ①：random 15~22%）、
  `verdict.覆.cause.clause4.pct = 50`（裁决 ③：clause-4 在覆里的占比 ≤50%）
- digest：改前 `970b40e719f72676bd9cc28656e7c0220c92d06c` → 改后 `9998cc7ec676a5aa86c290b8017da00901326c81`
  （同 2000 局 / 同 seed / 同指标口径；digest 只串指标，所以它变 = 数值变了）

### v1

首次运行，把当时的实测值写成基线，`intent` 只记 README 的六个示意值。

---

## 文件

```
tools/balance/
├── run.js          CLI：参数、编排、基线读写、退出码
├── harness.js      读 index.html → 注入种子 RNG → DOM 桩 → 驱动句柄
├── strategies.js   五种策略（加新策略只改这里）
├── metrics.js      指标定义（SPEC）+ 计算 + digest
├── report.js       判定、终端表、Markdown
├── baseline.json   基线 + 容差（可编辑，就是门槛本身）
└── reports/        每次运行的 .json / .md
```
