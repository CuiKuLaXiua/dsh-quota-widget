# 设计：把 dsh-providers-hub 网关用量并入本插件的统计（粗粒度）

> 前置事实见 `docs/plan-jet-hub-gateway-usage.md`（网关用量已落盘到 `$DSH_HOME/jet-hub/token-ledger.json`，按 `channel='gateway'` 可与直连分离）。
> 本文只回答「怎么设计」，不含实现代码。

---

## 1. 目标与边界

**目标**：小窗/设置页里看到的「总量、按日、按模型、按渠道、按区间」这五个口径**都包含网关流量**，不再少报。

**「不用像本机这么详细」的具体含义**（这是本设计的核心约束，不是妥协）：

| 维度 | 本机（TokenMeter） | 网关（并入后） | 原因 |
|---|---|---|---|
| 总量 / 请求数 | ✅ | ✅ | 对方有 |
| 按日序列（热力图/柱状/折线/CSV） | ✅ | ✅ | 对方有日聚合 |
| 按模型 | ✅ | ✅ | 桶键里有 model |
| 按渠道（provider） | ✅ | ✅ | 桶键里有 provider，且**与本插件同一套 route 名** |
| 按项目 | ✅ | ❌ 空 | 对方无字段 |
| 按会话 | ✅ | ❌ 空 | 网关请求不建会话 |
| 按工具 / 轮次 / 步数 | ✅ | ❌ 0 | 与 token 无关的 DSH 概念 |
| 24 小时分布 / 时段矩阵 | ✅ | ❌ 空 | 对方无小时桶 |
| 逐笔明细 / 首 token / 速度（tok/s） | ✅ | ❌ 无 | 只在对方**内存 500 条**里，重启即清 |
| 可靠性（重试/压缩/失败轮次） | ✅ | ❌ 0 | 对方无 |
| Live（正在对话） | ✅ | ❌ 不参与 | 网关无事件流 |

⇒ 一句话：**并入「量与钱」的维度，不并入「过程」的维度。**

---

## 2. 方案选型

| 方案 | 做法 | 判断 |
|---|---|---|
| **A. 灌进本插件 sqlite** | 把网关桶转成 `events` 行写进 `token-meter.db` | ❌ 否决。要伪造 `session_id`/`seq`，污染「按会话去重 / 补录 / 按项目清空 / 维度回填」四套语义；且对方文件一变就要重灌，双写难收敛 |
| **B. 读时叠加（overlay）** | 网关数据只存**内存**，在 `computeUsage()` 出口处与本地聚合**相加** | ✅ **采用**。零写盘、零污染、对方文件更新后自然跟随；本插件自己的库语义完全不变 |
| **C. 独立卡片** | 新开一张「网关用量」卡，与 TokenMeter 并列 | ❌ 否决。用户诉求是「统计到」，不是「另开一页」；并列会出现两个"总量"（实测差 0.4%，只会制造困惑） |

**选 B 的关键理由**：本插件所有对外读数都收敛在 `computeUsage()`（`lib/index.js:2973`）这一个函数里 —— 悬浮窗、设置页总览、排行榜、明细表、热力图、CSV 导出、复制摘要全部从它的返回值取数。**只改这一个出口，就能让全部 UI 一起变对**，不需要在客户端铺开改动。

---

## 3. 数据模型

### 3.1 内存容器（新增，模块级，不落盘）

```js
// lib/index.js，放在 usage 定义（line 1036）之后
const gateway = {
  // 元信息：供设置页「数据源」显示，也便于排障
  ok: false,              // 是否成功读到可用账本
  error: null,            // 'not-found' | 'bad-json' | 'bad-schema' | 'read-failed' | null
  schema: null,           // 账本里的 schema 原文
  path: null,             // 实际读取到的文件路径（多候选时回显命中的那个）
  mtimeMs: 0, size: 0,    // 缓存判据
  loadedAt: 0,            // 上次解析时刻
  dayCount: 0, bucketCount: 0,

  // 数据：一级键是**对方 UTC+8 日键**，未做任何时区改写（映射在读取视图时做，见 §3.4）
  perDay:      new Map(), // day -> agg{requests,input,output,cacheRead,tools:0,turns:0,steps:0,total}
  perModel:    new Map(), // day -> Map<model, agg>
  perProvider: new Map(), // day -> Map<provider, agg>
};
```

agg 形状**刻意复用**本插件既有的 `emptyAgg()`（`lib/index.js:1211`）：`{requests,input,output,cacheRead,tools,turns,steps,total}`。
这样 `mergeAgg()`（`:1214`）可以直接复用，`computeUsage` 里的折叠逻辑一行都不用改。

字段映射（对方 → 本插件）：

| token-ledger 桶字段 | 本插件 agg |
|---|---|
| `requests` | `requests` |
| `inputTokens`（未命中缓存的输入） | `input` |
| `outputTokens` | `output` |
| `cacheReadTokens` | `cacheRead` |
| `cacheWriteTokens` / `reasoningTokens` / `errors` / `ttft*` / `tps*` | **丢弃**（口径不同，且不属于"粗粒度"） |
| — | `tools/turns/steps` 恒 0 |

### 3.2 归一化（纯函数，进 `__testing`）

```js
// 只读、绝不抛错；任何异常都退化成 {ok:false}
function normalizeJetHubLedger(doc) {
  // 返回 { ok, error, schema, perDay, perModel, perProvider, bucketCount }
  // 规则：
  //   1) doc.schema 必须以 'dsh-codearts-auth/token-ledger/' 开头（v2 起向上兼容读取）
  //   2) doc.days 必须是对象；日键必须匹配 /^\d{4}-\d{2}-\d{2}$/
  //   3) 桶键 split('|') 必须恰好 4 段（channel|provider|account|model）
  //   4) **只收 channel === 'gateway'**；'direct' 一律丢弃（与本插件自己的库重复）
  //   5) 数值：Number() → 非有限/负数 → 0 → trunc
  //   6) model 走 cleanModel()（line 1226）归一 unknown 变体
}
```

### 3.3 读取（带缓存）

```js
// 候选 home：与 dsh-providers-hub 同序（jet-hub-store.ts:1378），命中即止
function jetHubHomeCandidates(ctx) {
  // DSH_JET_HUB_STATE_DIR → ctx.get('profileContext').home → $DSH_HOME
  //   → ctx.get('dshHomePath')() → ~/.dsh
}

function refreshGatewayLedger(ctx, logger, opts) {
  // opts.force：跳过节流
  // 1) 对每个候选 home 拼 joinPath(home, 'jet-hub/token-ledger.json')，statSync
  // 2) 命中文件后比对 mtimeMs + size；未变且已 ok → 直接 return（零解析）
  // 3) 变了 → readFileSync → JSON.parse → normalizeJetHubLedger
  // 4) 成功则替换 gateway 的三个 Map，并 **bumpUsage()**（否则客户端按 version 跳过重渲染）
  // 5) 失败只写 logger.warn 一次（同一 error 不重复刷屏），保留上一份成功数据
}
```

**节流**：`REFRESH_MIN_MS = 5000`。轮询是 15s/5s，5s 节流足以覆盖；`stat` 开销可忽略。
**触发点**：`apply()` 初始化一次（不阻塞首屏，`setTimeout(…, 800)`）+ `/api/token-meter` 每次请求前（不带 force，靠 mtime 判据）。

> 为什么不用 `fs.watch`：对方是**原子 rename 写**（`token-ledger-store.ts:641-649` 先写 `.tmp` 再 rename），watch 收到的 rename 可能对应旧 inode；轮询 `stat` 判据更稳且无句柄泄漏。

### 3.4 日界映射（唯一需要小心的地方）

对方日键是**固定 UTC+8**（`token-ledger.ts:534 utc8DayKey`），本插件的 `dayKeyOf`（`lib/index.js:1183`）是**本机时区**。

```js
// 把 UTC+8 日键映射到「本机日键」：锚在该日 12:00（UTC+8）= UTC 04:00
function gatewayDayToLocalDay(day) {
  const ms = Date.parse(day + 'T12:00:00+08:00');
  if (!Number.isFinite(ms)) return day;
  return dayKeyOf(ms);   // 本机日键
}
```

- 本机 UTC+8（当前机器）⇒ **恒等映射**，零误差。
- 其它时区 ⇒ 只有「本地日界离 UTC+8 日界超过 12h」的极端情形才可能整体偏一天；12:00 锚点把偏差降到最小。
- **不要**把对方日键直接当本机日键混用：在非 +8 机器上会整体错位一天，且用户**看不出**（数字依然"合理"）。
- **不要**做反向换算（本地日 → UTC+8 日去查）：`1d` 窗口会因此漏掉最近 8 小时。

UI 上统一标一句「网关口径：UTC+8 日界」，不伪装成本地日界。

---

## 4. 合并点（`computeUsage` 内，共 6 处）

先算一次「窗口内的网关视图」，再逐处相加：

```js
// computeUsage 里拿到 current / winKeys 之后（line 3010 附近）
const gw = gatewayViewFor(winKeys /* 或 current */, { withModels: true, withProviders: true });
// → { totals, perDay: Map<localDay, agg>, perModel: Map<model, agg>, perProvider: Map<provider, agg> }
```

| # | 位置 | 改法 |
|---|---|---|
| 1 | `dayList`（`:2974-2977`） | 追加 `gw.perDay` 里有、本地 `perDay` 里没有的天（否则"今天只有网关流量、本机没对话"时该天整天消失） |
| 2 | `totals`（`:3010`） | `mergeAgg(totals, gw.totals)` |
| 3 | `prevTotals`（`:3011`） | 同理，按 `previous` 窗口再算一份 |
| 4 | `models`（`:3012-3026`） | 遍历 `gw.perModel`，与本地同名 model 相加；输出行沿用现有字段名（`freshInput/input/output/cacheRead/total`） |
| 5 | `providers`（`:3057-3063`） | 遍历 `gw.perProvider`，与本地同名 provider 相加 —— **能相加的前提已实测成立**：双方都用 DSH llm 的 route 名（本机实测两边都有 `buddy` / `trae` / `qodercn` / `workbuddy`） |
| 6 | `mapDaily`（`:3112-3131`） | 每行 `requests/prompt/completion/cache_read/total` 加上该天的 gw agg，该天 `models[]` 并入 gw 模型；`topProject` 保持 `""`、`avgMs` 保持 `null`（明细表显示 `—`） |

另外**新增**一个拆分段（不合并，只透明，放在 `:3139` 之后）：

```js
sources: {
  local:   { total, requests },   // 本机 TokenMeter
  gateway: { total, requests, available: gateway.ok, dayCount, bucketCount, note: 'UTC+8 日界' },
}
```

---

## 5. 必须**排除**网关的地方（否则会引入错误）

| 位置 | 为什么必须排除 | 改法 |
|---|---|---|
| `importPreview` 的 `currentTotal`（`:2289`） | 「补录预览」比的是**本插件账本**的当前值/投影值；掺进网关会让"补录后总量"变成假话 | `computeUsage("all", { localOnly: true })` |
| `importMissingSessions` 的 `after`（`:2347`） | 同上（补录前后校验） | 同上 |
| `dayDetail`（`:2738`）的 24 小时分布 | 网关没有小时桶，硬填会让分时图撒谎 | 保持本地；返回值另加 `gateway: {requests,total}` 供界面标注 |
| `hours`（`:3083-3094`）时段矩阵 | 同上 | 保持本地 |
| `live`（`:3108`） | 网关无事件流，"正在对话"会误判 | 保持本地 |
| `reliability`（`:3096-3107`） | 对方无重试/压缩概念 | 保持本地 |
| `records`（`:3150`） | 明细来自本插件 events 表 | 保持本地 |
| `projects` / `sessions` / `tools` | 无字段 | 保持本地 |

**清空账本**（`clearUsageLedger`，`:2563`）：逻辑无需改 —— 它只清本插件 sqlite，网关数来自对方文件，刷新后仍在。但**提示文案必须改**：清空页加一句「本操作不影响网关用量（来自 dsh-providers-hub 账本）」，否则用户会认为"没清干净"。

---

## 6. UI 改动（按"不详细"的要求，只加不重构）

### 6.1 悬浮窗（`lib/client.js` `renderTmCompact` / `renderTmClassic`）

- 主数字（`totalVal`）**自动变成合计值**（因为 `totals` 已合并），无需改渲染。
- 「缓存命中率 / 总量」那一行旁补一枚小角标 `含网关 52%`，`title` 展开成 `本机 226.7M · 网关 250.7M（UTC+8）`。
- 新增**一个** `_pill("网关 ", …)`（复用 `:1998-1999` 的 pill 网格）显示网关请求数；无网关数据时不渲染（现有 `.filter(Boolean)` 已能处理）。
- 开关关掉时：主数字回到"仅本机"，并在同一位置显示灰色 `仅本机` 角标（**必须**有，否则用户会以为功能坏了/数据丢了）。
- 不新增轮播页、不新增图表。

### 6.2 设置页「用量统计」

| 区块 | 改动 |
|---|---|
| 总览（`overviewBlock`，`:3201`） | 三段占比不变（已含网关）；末尾加一行「其中网关 X · 占 Y%」 |
| 排行榜（`rankItems`，`:4139`） | **模型 / 渠道**两 tab 自动包含网关（数据已在 `d0.models` / `d0.providers`），**不改代码**；**项目 / 会话 / 工具** 三 tab 的 `rankNote` 补一句「网关流量无此维度，仅统计本机会话」 |
| 逐日明细表 | `topProject` / `avgMs` 对纯网关天显示 `—`（`detailVal` 已能处理 `""` / `null`） |
| 热力图 / 柱状 / 折线 / CSV / 复制摘要 | 自动包含，无需改动 |
| 单日下钻 | 分时图旁加「另含网关 N 次 / X token（无分时数据）」 |

### 6.3 「数据源」面板：**不加**网关条目

该面板里每一条都是**出站凭据源**（`token` / `baseUrl` / 「测试连接」/ 掩码 chip）。

网关是**入站只读数据源**：没有凭据可填。塞进去会渲染出空的 `••••` chip 和一个点不动的「测试连接」（`providerForm` 的占位符对 `key!=="opencode"/"r4coder"` 会落到 `sk-...`，语义完全错）。

⇒ 网关改由**独立 tab** 承载（§7）。「数据源」保持三家不变。

---

## 7. 设置页新增「网关」tab

### 7.1 为什么值得单开一个 tab

| 理由 | 说明 |
|---|---|
| 用户要「管理是否监测」 | 这是一个**授权**动作（允许本插件读另一个插件的文件），不是填个 URL。混在凭据列表里会被当成"又一个要配 key 的源" |
| 用户要「看到监测到了什么」 | 状态、规模（多少天/多少桶）、时间跨度、错误原因、内容预览、与本机的对照 —— 信息量远超一条摘要行 |
| 天然带诊断属性 | 对方哪天改了格式，"为什么我的数变小了"必须能在这里一眼看到，而不是藏在控制台日志 |
| 语义边界 | 「数据源」= 我往外要额度；「网关」= 我从别人的账本里读用量。两件事放两个 tab，不会互相误导 |

Tab 位置：`["usage","conf","data","gen","maint"]`（`:4060`）末尾追加 `["gateway","网关"]` ⇒ 6 个。`oq-tabs` 已是 `display:flex` + 调用处 `flexWrap:"wrap"`（`:4061`），6 个 13px 标签在窄侧栏会换行，**不需要改 CSS**。

### 7.2 Tab 内部结构（四张卡，自上而下）

```
┌ 网关监测 ──────────────────────────────────────────┐
│ ● 已启用        读取 dsh-providers-hub 的用量账本    [开/关]│
│ 只读：不写入、不修改对方任何文件；不含对话内容。             │
└──────────────────────────────────────────────────┘

┌ 数据源 ────────────────────────────────────────────┐
│ ● 正常    Jet Hub 账本 v2                            │
│ C:\Users\sky\.dsh\jet-hub\token-ledger.json           │
│ 12 天 · 143 桶 · 92 KB · 文件更新 2 分钟前             │
│ [重新读取]  [复制诊断]                                 │
└──────────────────────────────────────────────────┘

┌ 监测到的内容（UTC+8 日界）─────────────────────────────┐
│ 今日  709 次 · 250.7M Token                           │
│ 输入 0.5M · 缓存读 214M · 输出 36M                     │
│ ▁▂▃▅▂▇▆  （近 7 天迷你柱，悬停看当天分项）              │
│ 渠道 Top5   buddy 198M · trae 32M · …                 │
│ 模型 Top5   deepseek-v4.1-flash 186M · …              │
└──────────────────────────────────────────────────┘

┌ 与本机的对照 ───────────────────────────────────────┐
│ 本机 226.7M ＋ 网关 250.7M ＝ 477.4M（网关占 52.5%）    │
│ 网关无：项目 / 会话 / 工具 / 24 小时分布 / 逐笔明细。     │
└──────────────────────────────────────────────────┘
```

- 卡片外壳全部复用 `card({title,desc,control})`（`:2945`）、`switchEl`（`:2940`）、`groupHead`（`:2922`）、`sectionLabel`（`:2930`）——**不新增任何视觉组件**。
- 迷你柱复用悬浮窗那套写法（`:1987-1991`），只是数据源换成 `gw.days`。
- 「近 7 天」与当前 `meterRangeState` 解耦：这一卡只回答"监测到什么"，不参与全局区间（避免"切了 30 天，这里却没变"的困惑）。区间总量用**当前 tab 自己的** `1d/7d/30d` 小 pills（默认 `1d`）。

### 7.3 六种状态与文案（必须全部覆盖）

| 状态 | 状态点 | 主文案 | 副文案 / 动作 |
|---|---|---|---|
| 已关闭 | 灰 | 未监测 | 「开启后自动读取 dsh-providers-hub 的用量账本」+ 开关 |
| 正常 | 绿 | `正常 · 账本 v2` | 路径 / 规模 / 更新时间；[重新读取] |
| 未安装 | 黄 | 未找到 Jet Hub 账本 | 「未安装 dsh-providers-hub，或它从未记录过用量」+ 已尝试的路径列表（折叠在 `details` 里） |
| 格式不兼容 | 黄 | 账本格式不认识 | 「读到 `schema: xxx`，本版本只支持 `dsh-codearts-auth/token-ledger/v2` 及以上」+ 原文 + [复制诊断] |
| 读取失败 | 红 | 读取失败 | `error.message` + 路径 + [重新读取]（下一次轮询自动恢复） |
| 空账本 | 黄 | 账本里没有网关流量 | 「账本存在但只有直连记录（`direct`），网关可能被关闭或从未被外部客户端使用」 |

⚠️ 第 6 条容易被漏掉：账本存在、`gateway|` 桶为 0 是完全正常的状态（对方网关默认只绑回环，用户可能从没用过外部客户端）。**不能**显示成"正常 · 0"或报错。

### 7.4 数据获取

- 新增客户端状态 `gwData / gwLoading / gwErr`；
- **只在 `tabState[0]==="gateway"` 时拉**（`useEffect` 依赖 tabState），不参与悬浮窗的 15s/5s 轮询 —— 这是"管理页"，不是常驻看板；
- 打开 tab 拉一次 `GET /api/token-meter/gateway`；点「重新读取」拉 `?force=1`；
- 切走再切回来重新拉（廉价：宿主侧有 mtime+size 缓存，未变时不 parse）。

### 7.5 开关语义：真开关（修正上一版）

上一版我建议「只影响显示口径」，那个设计有个硬伤：**用户关掉隐私开关后文件仍被读取**，这是对"关闭"的欺骗。既然现在有了明确的授权 UI，开关就应该是**真的**：

| | 开启（默认） | 关闭 |
|---|---|---|
| 宿主读文件 | ✅ | ❌ 立即停读，内存里的 `gateway.*` 三个 Map 清空 |
| `computeUsage` 合并 | ✅ | ❌ 不合并 → 总量回到"仅本机" |
| UI 标记 | 无 | 悬浮窗 + 总览都显示 `仅本机` 角标 |

**怎么把开关送到宿主**：本插件目前**没有宿主侧配置文件**（所有配置都在浏览器 localStorage），所以不引入新机制，用查询参数：

```js
// 客户端：两个取数入口都带上
fetchTokenMeter(...)  → /api/token-meter?range=…&gw=0|1
fetchGateway(...)     → /api/token-meter/gateway?gw=0|1
```

- 宿主：`gw=0` ⇒ `computeUsage` 传 `{ localOnly: true }`（该能力本来就要为补录入口实现，复用），且 `refreshGatewayLedger` 直接返回；
- 唯一真相源仍是 localStorage 的 `cfg.sources.gateway.enabled`，不会出现两份配置；
- 多标签页：`storage` 事件已监听 `LS_KEY`（`:1412`），改完自动 `reload`。

⚠️ **必须同步修一处缓存判据**：客户端靠 `version + range` 判断"数据没变就跳过 setState"（`:1334`、`refreshMeter` 的 `skipIfSame`，`:2680`）。开关切换**不改变** `usage.version`，所以要再记一个 `gwAppliedRef`，把它纳入比较，否则会出现"点了开关但界面没反应，直到下一次有对话"。

### 7.6 tab 角标与首次引导

- `tabState[0]!=="gateway"` 时，若**检测到账本但监测已关闭**，tab 文字后挂一个小圆点（`oq-tab` 内联 `<i>`，6px，`ACCENT` 色）—— 与"有更新"的心智一致，点击即进入 tab；
- **首次检测到账本且开关为默认开**时不做任何弹窗/吐司（避免打扰）；只有用户主动关掉后，才在总览处显示 `仅本机` 角标 —— 那时用户是知情的。

### 7.7 tab 状态记忆（顺手修）

`tabState=react.useState("usage")`（`:2495`）**不持久化**：在「网关」tab 里刷新页面会跳回「用量统计」。建议加 `LS_TAB="oq_settings_tab"`（白名单校验），只存不广播。这一条与网关无关，但在这个 tab 上体感最明显。

### 7.8 配置项

```js
// 独立于 providers（那是凭据源），默认 true
cfg.sources = { gateway: { enabled: true } }
```

- `defaultProviders()`（`:17`）不动；新增 `defaultSources()`；
- `loadConfig()`（`:19`）对老配置补 `sources`；
- `update()`（`:2592`）的深合并只处理 `patch.providers`，需要同样处理 `patch.sources`（否则 `update({sources:{gateway:{enabled:false}}})` 会整块覆盖丢字段）；
- 「重置配置」（`resetConfig`，`:2880`）要一并还原 `sources`。

默认 `true` 的依据：无文件即无效果，与"当前行为"完全一致；而默认关闭会让大多数用户永远看不到已经少报一半的总量。

---

## 8. 宿主新增路由

```
GET /api/token-meter/gateway[?force=1]   // 只读诊断端点，不参与主链路
→ { ok, available, error, schema, path, mtimeMs, loadedAt,
    dayCount, bucketCount, firstDay, lastDay,
    days: [{ day, requests, total, freshInput, cacheRead, output }],
    models: [{ model, total }], providers: [{ provider, total }] }
```

- 首行 `localGuard(req, res)`，非 GET → 405，与现有 13 条同款。
- **不**掺进 `/api/token-meter` 响应：那条响应已有 `READY_WAIT` 等待语义与体积约束，多一个数据源不该让它变慢或引入新失败面。
- `days` 只回最近 90 天且按日裁剪；**只回聚合、不回 `accountId`**（桶键含账号 id，属隐私）。

---

## 9. 测试清单

**`test/host.test.mjs`（新分节「网关账本叠加」）**

1. 夹具：`mkdtempSync` 造临时 home + 手写 `jet-hub/token-ledger.json`，`process.env.DSH_HOME` 指向它（沿用 `:1484` 的 `makeSessionFiles` 范式）。
2. `normalizeJetHubLedger`：
   - `direct|` 桶被丢弃、`gateway|` 被收（**核心断言**）；
   - 非法 `schema` ⇒ `ok:false, error:'bad-schema'`；
   - 坏 JSON ⇒ 不抛、`ok:false`；
   - 数值钳制：`-5` / `"abc"` / `NaN` ⇒ 0；
   - 模型名含 `/`（`vendor/model`）不被误拆；含 `|` 的（会被对方转义成 `/`）断言"不崩"即可；
   - 桶键只有 3 段 ⇒ 整桶丢弃。
3. `computeUsage` 合并：
   - 同一模型本地 + 网关 ⇒ 一行、数值相加；
   - 同一天只有网关流量 ⇒ 该天仍出现在 `daily[]`（回归 #1 那个坑）；
   - `sources.gateway.total === 手工累加值`；
   - 纯网关天 `daily[i].topProject === ''`、`avgMs === null`。
4. `localOnly`：
   - `computeUsage("all", {localOnly:true}).totals.total` 不含网关（对应 §5 两个补录入口）；
   - 补录预览 `projectedTotal` 不受网关影响。
5. 缓存：同 `mtime/size` 下二次 `refreshGatewayLedger` 不重新 parse（注入计数桩）。
6. 日界映射：`gatewayDayToLocalDay('2026-10-27')` 在本机（+8）恒等；`TZ=UTC` 子进程里不抛且落在相邻日。

**`test/settings-render.test.mjs`**

7. 新 tab 存在且可点击：`findClickable(tree,"oq-tab")` 里能找到文本 `网关`（现有 `tabText()` 辅助函数直接可用，见 `:334-347`）；
8. 六种状态文案各断言一次：正常 / 未找到 / 格式不兼容 / 读取失败 / 空账本 / 已关闭（`fetch` 桩按 §7.3 的六种 shape 返回）；
9. 开关默认开；关掉后 ① 「网关监测」卡的状态点变灰、② 悬浮窗与总览出现 `仅本机` 角标、③ 下一次 `/api/token-meter` 请求带 `gw=0`；
10. 切回「用量统计」tab 时**不**再请求 `/api/token-meter/gateway`（断言 `calls` 计数）。

---

## 10. 风险与验收

| 风险 | 等级 | 缓解 | 验收 |
|---|---|---|---|
| 双计（把 `direct` 也合进来） | **高**（静默、数字看起来正常） | 归一化硬性 `channel === 'gateway'`；单测锁死 | 单测 2.1 |
| 时区错位（非 +8 机器整天偏移） | 中 | 12:00 锚点映射 + UI 标注 | 单测 2.6 |
| 对方 schema 升级（v1→v2 已发生过） | 中 | 前缀匹配 + `days` 形状校验；不认识就 `available:false`，UI 只说"格式不兼容" | 单测 2.2 |
| 大文件解析卡顿 | 低 | mtime+size 缓存；500KB 满量约 2ms | 单测 2.5 |
| 多 profile 共享 home ⇒ 含别的 profile | 低-中 | 与对方自身行为一致；UI 注明「本机 codearts 账本（多 profile 共享）」 | 文档 |
| 「清空了怎么还有数」误读 | 中 | 改清空文案（§5） | 手工 |
| 缓存命中率被拉偏 | 低 | 口径一致（都是 cacheRead/(freshInput+cacheRead)），可直接合 | 抽样对数 |
| 对方未安装 | 低 | `available:false` → 一行提示，其余不变 | 单测 8 |
| **开关切了界面没反应** | **中**（看起来像功能坏了） | `version`/`range` 之外再比 `gw` 标志（§7.5 末尾） | 手工 + 单测 9 |
| **`gw` 参数被漏传**（某个 fetch 忘了带） | 中（隐私：关了还在读） | 宿主默认 `gw` 缺失 = 按**开启**处理只在"从未配置过"时成立；实际按客户端每次都显式传，单测断言两个入口都带 | 单测 9 |
| 「已关闭但仍显示数字」 | 中 | 关闭时宿主清空 `gateway.*` 三个 Map 并 `bumpUsage()` | 单测 9 |

**回归红线**：`npm test` 全绿 + 手工核对一天 ——
`本插件 totals.total` 应 ≈ `本地(session) + 对方 gateway`。
用今天（2026-10-27）的数据应约 `226.7M + 250.7M ≈ 477M`（当前显示约 226M）。
关掉开关后应立刻回落到约 `226M`，且不重启就生效。

---

## 11. 明确不做

1. **不写对方的 `token-ledger.json`**（跨进程目录锁 + 增量合并写，第三方写入是最高风险动作）。
2. **不把网关行写进本插件 sqlite**（§2 方案 A 的三条否决理由）。
3. **不展示 `accountId`**（桶键含账号 id，只回 provider 级聚合）。
4. **不伪造项目/会话/小时**（宁可显示 `—`，也不要造一个"网关项目"垃圾桶）。
5. **不做实时明细**。要逐笔得走对方 RPC `usage.tokenLedger`（内存 500 条），属独立二期，且要接受契约耦合。

---

## 12. 改动清单（估算）

| 文件 | 改动 | 量级 |
|---|---|---|
| `lib/index.js` | `gateway` 容器 + `normalizeJetHubLedger` + `jetHubHomeCandidates` + `refreshGatewayLedger` + `gatewayDayToLocalDay` + `gatewayViewFor` | ~150 行 |
| `lib/index.js` | `computeUsage` 六处合并 + `sources` 段 + `localOnly`（三处调用点：补录预览 / 补录后校验 / `gw=0`） | ~45 行 |
| `lib/index.js` | `/api/token-meter/gateway` 路由（含 `gw=0` 分支）+ `/api/token-meter` 解析 `gw` 参数 + `__testing` 导出 | ~50 行 |
| `lib/client.js` | `defaultSources()` / `loadConfig()` 补 `sources` / `update()` 深合并 / `resetConfig` 还原 | ~25 行 |
| `lib/client.js` | 两个取数入口带 `gw` 参数 + `gwAppliedRef` 缓存判据 | ~20 行 |
| `lib/client.js` | **新增「网关」tab**：`tabBar` 加一项 + `gatewayPanel()` 四张卡（含六状态、迷你柱、渠道/模型 Top5、对照行） | ~180 行 |
| `lib/client.js` | 悬浮窗 `含网关 xx%` 角标 + `仅本机` 角标 + 一个 pill | ~25 行 |
| `lib/client.js` | 总览"其中网关"一行 + 三个 tab 的 `rankNote` + tab 状态记忆（`LS_TAB`） | ~30 行 |
| `test/*` | 上述 10 条 | ~160 行 |

无新增依赖、无构建步骤（本仓"手写即产物"）、无 CSS 改动（全部复用现有 `card`/`switchEl`/`oq-tabs`）。
