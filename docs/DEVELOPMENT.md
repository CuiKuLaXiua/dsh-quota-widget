# 开发说明

- 宿主端 `lib/index.js`：纯 Node ESM，注册 `/api/opencode/*`、`/api/deepseek/*`、
  `/api/r4coder/*`、`/api/token-meter` 等回环保护的同源 JSON 路由。
- 浏览器端 `lib/client.js`：按 DSH 模块加载器（`window.__ModuleLoader__.load`）
  格式手写的单文件 bundle，只依赖平台共享模块 `react` / `react/jsx-runtime`。
- 两端各有一个 `__testing` 出口（只含纯函数/内存容器，不参与运行时行为），供
  `test/` 下的 `node:test` 断言；改动日历窗口、分档、去重、路径解析后请跑 `npm test`。
- 本地测试安装：
  ```sh
  dsh plugin --profile web add file:D:\code\dsh-quota-widget
  ```

## ⚠️ 改 profile 文件必须存纯 UTF-8（无 BOM）

手工/脚本编辑 `<DSH_HOME>/profiles/<profile>/package.json`、`cordis.patch.yml` 这类
**DSH 启动时要读的文件**时，必须保存为**纯 UTF-8（无 BOM）**——带 BOM 的 JSON 会让
DSH 解析失败、桌面端直接无法启动。

坑在 PowerShell：Windows PowerShell 5.1（系统自带 `powershell.exe`）的
`-Encoding UTF8` 是**带 BOM** 的；PowerShell 7+（`pwsh`）的 `utf8` 才是无 BOM。
稳妥做法三选一：

```powershell
# 1) PS7 显式无 BOM
Set-Content $path $text -Encoding utf8NoBOM
# 2) .NET API（两种 PowerShell 都无 BOM）
[System.IO.File]::WriteAllText($path, $text)
# 3) 改完校验字节头，EF BB BF 必须不存在
[System.IO.File]::ReadAllBytes($path)[0..2]
```

> 桌面 profile 的本地插件依赖有两种声明：`link:D:/...` 是真目录链接（改代码重启即生效，
> 开发用这个），`file:D:/...` 是安装时复制的静态副本（改工作区代码**不会**生效，需重装）。
> 把 `file:` 换成 `link:` 并将 `node_modules/<pkg>` 替换为 junction
> （`New-Item -ItemType Junction -Path <node_modules里的路径> -Target <工作区>`）即可获得
> 即时生效的开发体验。

## 数据链路

```
DSH 会话事件流 ctx.on("session/event")   ← 实时增量（唯一入口）
        │
        ├─ 启动回填 ctx.get("sessionQuery").listSessions()/readSession()
        │     └─ 读不到 sessionQuery 时退化为扫描 <DSH home>/sessions 下的 *.jsonl(.zstd)
        │
        ▼
进程内聚合 usage.{perDay,perModel,records,live} + 兼容层 realtimeHourly（小时桶）
        │
        ▼
GET /api/token-meter?range=1d|7d|30d|90d|all[&withChart=1]  → computeUsage() 现算现发
```

- 日期口径一律"本地日"（`dayKeyOf()` = `getFullYear/getMonth/getDate`），DB 侧裁剪用
  `strftime(...,'localtime')` 与之一致。
- **小时口径也必须是本地**：`hourKeyOf()` 产出 `YYYY-MM-DDTHH`（本地），`realtimeHourly` 的
  桶键与 `hour` 字段都用它；`hydrateHourlyBuckets` 的 SQL 必须带 `'localtime'`。
  历史实现用 `toISOString()` 打 UTC 键，UTC+8 下本地 00:00–07:59 的桶日期段落到前一天，
  被客户端"按本地日过滤"整段丢弃（24 小时只剩 16 个）。桶里另带 `localDate` 供客户端
  优先按本地日过滤，旧 host 缺该字段时退回键的日期段。
- 去重靠"每会话水位线 `liveSeqs{sessionSeq,time}` + 复合键 `seenSeq`"：`seq` 只在会话内唯一，
  且存在编号代际重置（历史全局大 seq ↔ 新会话小 seq），所以比较时必须叠时间；`seenSeq`
  守的是"重置后旧事件被重新接受"那条路径，不能只留水位线。
- `realtimeHourly` 只服务客户端 1d 分时图，回填窗口是 `HOURLY_KEEP_MS`（2 天），
  客户端还会按本地日再过滤一次（历史实现两边都没收口，分时图曾混入 11 天共 59 列）。

## 存储与降级（踩过坑，务必先读）

- 账本：`<DSH home>/storages/token-meter.db`（`node:sqlite`，WAL，`SCHEMA_VERSION` 驱动迁移）。
  一张事实源 + 派生缓存：`events`（幂等账本，PK `(seq, session_id)`，`INSERT OR IGNORE`）与
  `meta`（迁移/水位元信息），外加 7 张派生表 `daily_usage` / `daily_tool` / `daily_project` /
  `daily_session` / `daily_hour` / `daily_reliability` / `daily_retry`（均为派生缓存，
  flush 时按受影响天**整分区重建**，不 `+=` 累加）。
  写入经 50ms 防抖队列；`beforeExit/exit` 兜底 flush。
- **home 解析两级**：`process.env.DSH_HOME` → 宿主 loader 提供的 `ctx.get("dshHomePath")("storages")`
  （来源 `@deepseek-ai/dsh-home-paths`，内部即 `DSH_HOME || ~/.dsh`）。
  ⚠️ 官方桌面版**不设** `DSH_HOME` 环境变量，只认 env 会让插件静默降级成纯内存：
  每次启动全量重扫会话、首屏还可能只有半截聚合。新增任何落盘路径都必须走这个两级解析。
- 降级语义：两级都拿不到 → `fail-closed` 纯内存（不落盘、不写共享目录），并在启动日志
  warn；`/api/token-meter` 的 `store` 字段（`db:<路径>` / `memory`）会在设置页显示一行，
  避免再次出现"静默降级查半天"。
- 保留窗口：`USAGE_KEEP_MS` 90 天，24h 节流的 `pruneExpired()` 同时裁 `events` 与 `daily_usage`。
- 就绪语义：`/api/token-meter` 在 `!usage.ready` 时会等回填结束（`READY_WAIT_MS` 上限 20s）再响应，
  客户端侧超时为 30s —— **两者必须保持"客户端 > 服务端"的关系**，否则会把携带完整口径的响应掐掉，
  退回"首屏半截数据"。

## v4 用量维度（工具 / 项目 / 渠道）

`SCHEMA_VERSION = "5"` 起，`events` 增补 `project` / `tool` / `ms` / `provider` 四列
（`ALTER TABLE`，老库升级前先按 `PRAGMA table_info` 判存在，幂等），并新增两张派生缓存：

| 表 | 维度 | 口径 |
|---|---|---|
| `daily_tool` | 工具 | 只统计 `tool/result`：`calls`、`ms`（= `tool/call`→`tool/result` 的墙钟耗时）、`errors` |
| `daily_project` | 项目 | 按会话头 `cwd` 的末段（小写）归集；`sessions` 为当日该项目下的会话数 |
| `daily_session` | 会话 | 按 `session_id` 归集；标题不入库（见 `sessionTitles`），只存计数 |
| `daily_hour` | 时段 | 按**本地小时**归集，7×24 矩阵的数据源；90 天 × 24 行上限 |
| `daily_reliability` | 可靠性 | 重试 / 压缩次数 / 被压缩 token 数 / 失败轮次 / 工具失败 |
| `daily_retry` | 重试原因 | `code`（`llm/retry.data.failure.code`）→ 次数，存于 `events.raw` |

> **v5 的两列**：`events.err`（该事件是失败：`turn/end.reason.kind=error`、`tool/result.isError`）、
> `events.num`（整数值，目前只放 `command/done` 文案里解析出的"被压缩 token 数"）。
> 这两列让上面两张可靠性表可以像其它维度一样**从 events 幂等重建**，而不是靠内存累加。
>
> **一次性补历史**：`llm/retry` / `compaction/end` / `command/done` / `session/title` 在 v4
> 及以前从未落库。`backfillExtra()` 在启动后 2.6s 异步重读一遍会话文件，只 ingest 这四类
> （绕过水位线），重建可靠性表并置 `meta.extra_backfill=1`；实测 81 个会话文件约 9s，
> 不阻塞首屏。空库直接跳过（全量扫描会一并写入）。
>
> **口径**：`reliability` 现在是**区间口径**（`since: "range"`），不再随重启归零；
> 界面上标注「可靠性（所选区间）」。

- **工具名从哪来**：只在 `tool/call.data.name` 上（实测 `read`/`edit`/`pwsh`/`grep`/`job_output`…）。
  `tool/call` 本身**不落库**（避免 events 体积 +15%），名字在内存里配对后写到对应的
  `tool/result` 行上，这样 `daily_tool` 仍可从 `events` 幂等重建。
- **项目名从哪来**：`session/event` 的 session 对象 → `listSessions().header.cwd` →
  会话文件目录名（`--D-code-token-lens--` 这种编码，**不可逆**：字面连字符与分隔符都写成 `-`，
  只作兜底）。项目名统一小写：Windows 大小写不敏感，实测同一目录会同时出现 `Zenith`/`zenith`。
- **一次性的历史回填**：`enrichDimensions()` 在 `meta.dims_backfill != '1'` 时跑一次，
  从会话事件流还原上述四列并 `UPDATE`（只补 `NULL`，不碰计数列，因此不会重复计数），
  最后重建两张派生表并重新 hydrate，置 `dims_backfill=1`。
  **按会话分批**（`ENRICH_BATCH_SESSIONS = 24`）：每读满 N 个会话就把收集到的 pairs 落库并释放，
  内存峰值只与 N 个会话的事件数有关、与历史总规模无关（旧实现攒完所有会话才写，
  峰值正比于 90 天内全部事件）。单批 UPDATE 再按 `ENRICH_MAX_PAIRS_PER_TXN = 150` 切分，
  保证绑定变量数不超过 SQLite 老版本的 999 上限。
  ⚠️ **读取下限只用保留窗口，不掺 `reset_at`**：`reset_at` 只该约束"哪些事件算数"，
  不该约束"哪些会话需要读"。把它塞进 cut 后，用户一点"清空账本"，cut 就等于清空时刻，
  所有更早创建的会话都被判越界 → 整轮回填一条都不处理，而 `dims_backfill` 仍被置 1，
  四个维度永久为空。同理循环内用 `continue` 而非 `break`（降序序列表在 cut 前移后不再保序）。
  实测本机 2.4k 条事件 / 7 个会话：8ms、applied=1584 行、`daily_project` 重建 9 行。
- **渠道维度不落派生表**：`perProviderDay` 在 hydrate 时按 `(day, provider)` 直接聚合 `events`，
  新事件实时累加（同名模型跨渠道是两笔账，旧实现只留 `model` 会把它们合并）。
- **`daily_usage` 的 `tools/turns/steps` 仍只落在 `model='__system'` 行**（历史口径，未动）：
  要按模型看工具/步数请用 `daily_tool` / `tools[]`，不要指望 `daily_usage` 的模型行。

### 清空用量账本

`POST /api/token-meter/reset` 清空 `events` 与全部 7 张派生表（`daily_usage` / `daily_tool` /
`daily_project` / `daily_session` / `daily_hour` / `daily_reliability` / `daily_retry`），并写 `meta.reset_at`；
此后 `scanHistory` / `scanFilesystemFallback` 的回填下限取 `max(now-90d, reset_at)`，
否则一次重启就会把刚清掉的历史重新灌回来。**只删本插件自己的账本，不动会话文件。**

## 实时指标的口径与自证

- `live.*` 全部是**本次进程启动至今**的累计值（`msgs`/`toolCalls`/`llmMs`/`toolMs`/首 token 均值），
  只有 `rate60` 是滑动窗口：近 `RATE_WINDOW_MS`(60s) 内 `assistant/message` 的
  `outputTokens` ÷ 60s（分母是墙钟时间）。`tokPerSec` 的分母是 LLM 忙碌时间，两者不可混用。
- **首 token 的坑**：`assistant/chunk` 在会话文件里 100% 带 `turn/step`（实测 3763 条零缺失），
  但**实时事件流是否投递它无法先验保证**——实测活跃对话下 `firstTokenCount` 恒为 0 而
  `steps`/`llmMs` 正常增长。因此对 `SIGNAL_EVENT_TYPES`（`assistant/chunk` / `text-chunks` /
  `reasoning-chunks` / `tool-call-chunks`）做广匹配，并把**按事件名的分类计数**
  `live.signalCount` 下发：任一名字被投递即可测出首 token 延迟，一个都没投递时
  设置页会显示"无样本"并在 tooltip 里列出各名字的计数，便于定位。
- 可靠性计数同样来自事件流：`llm/retry`（含 `failure.code`）、`compaction/end`、
  `turn/end` 里 `reason.kind==='error'`、`tool/result` 的 `isError`。

## 视图偏好

设置页（`SettingsPanel`）分五个 Tab：**用量统计 / 外观 / 数据源 / 通用 / 维护**。
- **外观**：悬浮窗观感（开关、模板、材质、小窗口图表），只影响小窗口，不管数据源凭证。
- **数据源**：各家额度来源的凭证 + 连通性测试，只管「数据从哪来」。
- **通用**：自动刷新周期 + 用量统计外观（预设 / A-B-C 风格，只存本机 localStorage）。
- **维护**：会动数据的操作，收敛成一张**「账本维护」操作列表**（手风琴，一次只展开一个）：
  - 「修复数据」区：补录缺失会话（橙 · 会改变总量）、补齐历史维度（绿 · 只补缺失列）；
  - 「危险区」：清空用量账本（红 · 不可逆）、账本快照（灰）。
  - 每行 = 功能名 + 危险徽标 + 一行状态 + 动作按钮；点开后才滑出详情区。
  - 重置配置 / 悬浮窗位置单独一张卡放列表外（它们不操作账本）。
  历史：这些曾是五张独立大卡，标题重复、描述冗长、按钮文案不一、危险度无分级，
  用户反馈"布局太乱、交互不够清晰明了"，后按列表 + 手风琴 + 危险度分级收敛。
历史：这些曾全挤在「数据源与通用」一个 Tab 里，分类混乱、要找的东西半天找不到，
后按「观感 / 凭证 / 节奏 / 维护」四组拆开（用户反馈"样式设计 UI、布局、分类效果很差"）。

- **范围**（1d/7d/30d/90d/all）由设置页与悬浮窗**共用** `LS_RANGE`，变更时广播
  `opencode:range-changed`，两边都监听（此前设置页另存 `oq_settings_range`，两个界面
  会显示不同时间段）。
- **自定义区间只在设置页**：`RANGE_KEYS` 里的 `custom` 只对设置页/全局面板生效，起止存
  `LS_CUSTOM_RANGE`（`oq_custom_range`，`{from,to}` 两个 `YYYY-MM-DD`）。悬浮窗维持五档，
  原因同下一条。

## 悬浮窗贴边收起（把手条）

开关：`localStorage["oq_edge_collapse"]`（默认 "0"）；收起状态：`["oq_edge_state"]`
（`{edge:"left"|"right"}`，空 = 展开）。

### 触发时机：吸附不变，再拽一下才收起

```
拖到左/右边缘松手 → 自动吸附（原有行为，未改）
   ↓ 已贴边时继续朝同侧拖 > 18px（EDGE_PULL_TRIGGER）
收成 14px 把手条（EDGE_HANDLE_W）
   ↓ 悬停 / 点击把手
展开（悬停移开 420ms 后自动收回；点击则锁定）
```

这是用户明确要求的交互：松手即收会在"正常拖动路过边缘"时误触发；"再拽一下"像按钮咔哒，
意图明确。判定条件是**拖拽过程中当前位置已经贴着该侧边缘**（`atLeft`/`atRight`），
不是"位置接近"，否则斜向拖拽会误吸。

### 三个踩过的真缺陷（"拽一下没反应"的直接原因）

1. **`armAt` 每帧重置**：若在每个 `mousemove` 里写 `armAt = 当前鼠标 x`，
   则 `pushed = armAt - x` 恒为 0，阈值永远达不到。必须**只在刚进入贴边的那一帧**
   记录锚点（按侧别变化判定），判定逻辑抽在纯函数 `edgePullVerdict()` 里，有变异测试守着。
2. **`oq-edge-open` 与 `oq-edge-{side}` 无条件并存**：两者都写 `transform`、
   特异性相同，`oq-edge-open{transform:none}` 写在前面 → 收起态被永久拉回原位，
   CSS 层面完全看不出问题，表现为"开关开了、也拽了、卡片不动"。
   由 `edgeCardClass()` 保证互斥：只有展开态才挂 `oq-edge-open`。
3. **吸入后 `mouseenter` 立刻弹回**：鼠标还停在卡片即将推出的区域上，`mouseenter` 立即
   `edgeOpen=true`。用 `edgeCollapseAtRef` 在吸入后 500ms 内抑制悬停展开。
   同理，吸入后只移除 `mousemove`、**保留 `mouseup`**，否则 `onUp` 不跑、
   `dragging.current` 永不清理。

### 动效：只让 transform 动

**禁止给 `left` / `bottom` 加过渡。** 一旦它们和 `transform` 都有过渡，两套动画各自计时、
缓动不同，视觉上就是"先抖一下再滑出去"（用户反馈"动画设计很差"的直接原因）。
现在 `collapseToEdge()` 对 left/bottom 是**瞬时写死**，动画全部交给 `transform`：

| | 时长 | 缓动 | 语义 |
|---|---|---|---|
| 收起 | 0.42s | `cubic-bezier(0.32,0.72,0,1)` | 收束、退进抽屉 |
| 展开 | 0.40s | `cubic-bezier(0.16,1,0.3,1)` | 前快后缓、抽屉拉出 |

配套：
- `.oq-body` 收起时 0.12s 淡出（远快于位移）→ "内容先退场、空壳再滑出"；
  展开时 0.21s 淡入、**不加延迟**（加了会先露一片空白，像卡住）。
- `.oq-edge` 必须 `will-change:transform`，否则每帧重绘 `backdrop-filter` 模糊层。
- 收起态要**整条覆盖** `transition`（不含 `height`），否则位移时基类的
  `transition:height 0.22s` 仍在跑，高度会跟着抖；展开态再把 height 加回来。
- 这些不变量由单测直接对 CSS 文本断言（`__EDGE_CSS_PROBE`），给 `.oq-edge-left`
  加回 `transition:left` 会让用例变红（已验证）。

### 收起态的"隐形"样式必须用 :not(.oq-edge-open) 限定

**这是"展开时变毛玻璃"的根因。**

```css
/* ❌ 收起态和展开态都会命中 */
.oq-card.oq-edge{background:transparent!important;backdrop-filter:none!important}

/* ✅ 只作用于真收起态 */
.oq-card.oq-edge:not(.oq-edge-open){background:transparent!important;...}
```

把 `background:transparent` 写在共用规则上，展开时卡片就**没有背景色**，只剩基类的
`backdrop-filter:blur(10px)` 在跑——视觉上就是"毛玻璃质感，要再点一下才恢复"
（用户实测反馈）。共用规则里只允许 `will-change` 和 `transition`。

收起态需要关掉的四类东西（缺一个就会在视口边缘留下痕迹）：

| 属性 | 不关会怎样 |
|---|---|
| `background` / `border-color` / `box-shadow` | 深色外壳、1px 描边、投影 |
| `backdrop-filter` | 卡片移出后仍在视口边缘留一条**模糊带** |
| `::before` / `::after` | 材质伪元素（液体玻璃高光与渐变描边、亚克力/纸面噪点）画在四边，会残留 |
| `overflow`（反向：要 `visible`） | 把手挂在卡片外侧（负偏移），`hidden` 会裁掉 |

### EDGE_GAP 是单一来源：改它就等于改全局间距

当前 `EDGE_GAP = 3`（曾为 6，用户反馈偏宽后减半）。它同时决定**四处**，任何一处
改写成字面量都会造成"落点不一致"或"漏边"：

| 用途 | 表达式 | 写错的后果 |
|---|---|---|
| 拖拽硬边界 | `Math.max(EDGE_GAP, ...)` | 能拖到边缘外/拖不到边缘 |
| 松手吸附 | `left = EDGE_GAP` | 吸附后离边缘距离与拖动时不同 → "弹一下" |
| 收起位移 | `translateX(calc(-100% - ${EDGE_GAP}px))` | 少减就漏一条边 |
| 把手外侧偏移 | `-(EDGE_GAP + (CAPSULE_W + HIT_W)/2)` | 少算胶囊半个宽度 → 胶囊偏离目标间距 1px |
| overlay 首屏 left | `left: ${EDGE_GAP}px` | 首次打开的位置与吸附落点不一致 |

这些都由单测 `贴边间距：EDGE_GAP 单一来源，CSS 不得写死 px` 断言（读常量而非硬编码 3，
所以以后调间距测试会自动跟随，不会变成"改了就红"的假警报）。

### ⚠️ `translateX` 不改命中区：卡片容器和它的父级都要关

这是被用户实测打回一次的坑：只给 `.oq-card` 加 `pointer-events:none` **无效**。

```
.oq-overlay{position:fixed;width:260px;pointer-events:auto}   ← 真正的命中盒（卡片的父级）
  └ .oq-card (translateX 出去了，但父级没动)
```

overlay 是 `position:fixed` 的容器，不随卡片位移。收起后它仍完整盖住面板原区域，
鼠标事件照样命中它。所以必须两级都处理：

```css
.oq-overlay.oq-overlay--collapsed{ pointer-events:none !important; }        /* 父级关掉 */
.oq-card.oq-edge:not(.oq-edge-open) .oq-edge-handle{ pointer-events:auto; }  /* 把手单独打开 */
```

`pointer-events:none` 可被子级 `auto` 覆盖回来，正好用来做"只留一个把手可点"。

另外把手的**纵向**热区也要收紧：旧写法 `top:0;bottom:0` 让它撑满整张卡片（~200px），
胶囊上下很远也会触发。现在 `top:50%` + `height:EDGE_CAPSULE_H`，命中区正好包住胶囊。

⚠️ 连带约束：**悬停态不能改变胶囊高度**（原来 44→52px）。热区高度=胶囊高度，
胶囊一变高，指针就可能落到热区外 → `mouseleave` → 收回 → 又进热区，抖成一团。
悬停反馈只靠提亮 + 外发光。

### 缓存命中率圆环：SVG 优于 conic-gradient

旧实现用 `conic-gradient` 画环，有三个绕不过去的限制：

1. **端点只能硬切**——没有 `linecap:round`，细环看起来像直角切口
2. **没法做线性渐变**——`conic-gradient` 的渐变是沿圆周的，不是我们要的左上→右下
3. **挖内孔要额外盖一个同色圆**（`::after{inset:4px}`），在半透明材质上会发白

改用 SVG（`ringEl()`，模块级纯函数）：

```jsx
<circle r stroke="url(#grad)" stroke-linecap="round"
        stroke-dasharray={dash + " " + (c - dash)}
        transform="rotate(-90 ...)" />   // 起点转到 12 点
```

**满环的处理是关键**（用户明确要求）：`round` 端点会在两端各多出 `stroke/2`，
所以 100% 不能简单用 `dash = c`（两个圆头会重叠成鼓包）。做法是**满环单独画整圈**：

```js
var full = has && v >= 100;
stroke-dasharray = full ? (c + " " + c) : (dash + " " + (c - dash))
```

非满环时留的缺口按**弧长**算（`dash = c*v/100 - stroke`），不是按角度——
这样 99% 在 34px 和 60px 直径下的缺口像素宽度一致，观感稳定。

### 环宽与缺口必须解耦

调环宽时有一个**连带陷阱**：如果缺口宽度直接复用 `stroke`（`gapLen = sw`），
环一改细缺口就跟着变窄，99% 又会看起来和 100% 一样。

所以拆成两个独立常量：

```js
var RING_STROKE = 4.2;   // 环宽：34px 直径下内孔占比 75.3%
var RING_GAP    = 5.5;   // 缺口：固定按弧长算，与环宽无关
```

判断"视觉粗细"用**内孔占比**而不是绝对像素：
`(size - 2*stroke) / size`，应 >= 0.68。这个指标跨尺寸可比——
改成 40px 直径时，同样的 4.2px 环会显得更细，届时按比例调。

⚠️ 内孔不要再加 `::after` 盖圆：SVG 的中心本来就是透明的，盖一层会挡住底槽。
半透明材质需要提高数字对比度时，给 `b` 加 `text-shadow` 即可。

### 收起态的命中区也必须收紧

`translateX` 只改变**视觉位置**，不改变**命中区域**。卡片收起后仍占据视口内 260px 的
`pointer-events` 范围，会带来两个问题：

1. 鼠标扫过整个面板宽度就触发 hover 展开（用户反馈"触发范围太大"）
2. 卡片挡住下面的宿主界面，点不到聊天内容

所以收起态必须：

```css
.oq-card.oq-edge:not(.oq-edge-open){ pointer-events:none; }
.oq-card.oq-edge:not(.oq-edge-open) .oq-edge-handle{ pointer-events:auto; }  /* 子级覆盖回来 */
```

JS 侧对应地把 hover 监听按状态换挂载点：

```js
var cardEvents = collapsed ? {} : { onMouseEnter: edgeHoverIn, onMouseLeave: edgeHoverOut };
// 收起态：<button class="oq-edge-handle" onMouseEnter={edgeHoverIn} ... />
```

⚠️ 反向约束：展开态**不能**有 `pointer-events:none`，否则卡片出来后点不动。
这条由单测守着。

### 胶囊配色：调色用区间断言，别写精确值

颜色被用户来回调过三次（太淡 → 太深 → 折中），所以测试断言改成**区间**而不是精确值：

| 项 | 允许区间 | 当前 |
|---|---|---|
| 渐变两端 | 0.35 ~ 0.60 | 0.46 |
| 渐变中部 | 0.65 ~ 0.85 | 0.74 |
| 描边 | 0.30 ~ 0.50 | 0.42 |

区间下界防"太淡"（第一版 0.10/0.42），上界防"太深"（第二版 0.72/0.92）。
改配色只要落在区间内就不会误报，超出说明偏得太远。

### 胶囊动效：三条不能违背的规则

1. **循环动画必须改 `box-shadow`，不能只改 `opacity`。**
   旧实现是 `opacity 0.86↔1`，幅度太小，用户反馈"看不出来"。
   改 `box-shadow` 还有一个好处：不触发渐变重绘的中间帧，GPU 更省。
2. **一次性反馈必须用 `box-shadow` 的 spread 扩散，不能用 `transform: scale`。**
   缩放会让胶囊离开调好的 `EDGE_GAP` 对齐基准；spread 是从边缘向外扩，不影响布局。
3. **循环动画只在 `:not(.oq-edge-open)` 下跑，悬停时 `paused`。**
   展开态卡片已经出来了，不需要再提示；悬停时指针已在交互，继续呼吸反而干扰。

另外两条实现细节：
- 瞬态类由 **React state** 驱动（直接改 DOM `className` 会被下一次重渲染覆盖）。
- 连续两次吸入要"先清再置"：同名 `animation` 在类持续存在时**不会重跑**。

### 别忘了那 1px 透明 border

收起态只把 `border-color` 设成 transparent，**border 宽度仍然存在**。而：

- 卡片位移 `translateX(-100%)` 是按 **border box** 宽度算的
- 把手 `position:absolute` 的包含块是卡片的 **padding box**（不含 border）

两者差 1px。漏掉它，胶囊就会从 3px 变成 2px（看起来"几乎贴死"）。所以偏移公式必须带
`CARD_BORDER_W`：

```
X = EDGE_GAP + CARD_BORDER_W + (CAPSULE_W + HIT_W)/2
  = 3 + 1 + 15 = 19px
```

同理，反推胶囊位置时要先减 1px：`(X - CARD_BORDER_W) - (HIT_W - CAPSULE_W)/2 - CAPSULE_W`。

### 把手偏移的几何推导（别凭感觉写）

要让**胶囊左边缘**距视口正好 `EDGE_GAP`，偏移量不是 `HIT_W - EDGE_GAP`（那少算了
胶囊自身宽度的一半，实测差 1px），而是：

```
偏移 = EDGE_GAP + (CAPSULE_W + HIT_W) / 2
     = 3 + (8 + 22)/2 = 18px        → 胶囊左边缘 = 18 - 11 - 4 = 3px ✅
```

推导（左停靠，卡片收起后右边界在视口 `x=0`）：

```
把手右偏移 = X           →  把手左边界 = X - HIT_W
把手中心  = X - HIT_W/2  →  胶囊与把手同心
胶囊左边缘 = X - HIT_W/2 - CAPSULE_W/2 ≡ EDGE_GAP
⇒ X = EDGE_GAP + (CAPSULE_W + HIT_W)/2
```

测试不写死 18，而是做几何自洽断言（`capLeft === EDGE_GAP`），
所以改 `EDGE_GAP` / 胶囊宽 / 热区宽时测试会自动跟随。

### 位移必须减掉 EDGE_GAP

卡片收起前 `left = EDGE_GAP`（6px，为了展开时离视口边缘有呼吸）。所以：

```css
/* ❌ 右边界停在 x=6px → 就是"残留侧边" */
.oq-card.oq-edge-left { transform: translateX(-100%) }

/* ✅ 右边界精确落在 x=0 */
.oq-card.oq-edge-left { transform: translateX(calc(-100% - 6px)) }
```

把手偏移量要同步减去 EDGE_GAP（`-(HIT_W - EDGE_GAP)`），否则把手整体被推出视口 6px、
胶囊只剩一半。这两处必须一起改，只改一边就会出现"胶囊偏了"或"还漏一条边"。

### 收起态只能有把手，不能有任何卡片外壳

**这是"两层"问题的根因，改之前务必理解。**

位移必须是**完整 100%**：

```css
.oq-card.oq-edge-left { transform: translateX(-100%) }   /* ✅ 外壳完全出视口 */
.oq-card.oq-edge-left { transform: translateX(calc(-100% + 10px)) }  /* ❌ 留 10px */
```

留 N px 的做法看起来"正好露出把手"，但那 N px 里除了紫色胶囊，还有 `.oq-card` 的
**深色背景 + 1px 描边 + 14px 圆角**——视觉上就是"深色竖条 + 紫胶囊"两层。

正确做法是让外壳整体出去，把手挂在卡片**外侧**：

```css
.oq-edge-handle[data-side=left]  { right: -22px }  /* 卡片左移出去后，卡片右边界=视口左边缘 */
.oq-edge-handle[data-side=right] { left:  -22px }
```

偏移量 = 把手热区宽度，这样 22px 热区**全部**落在视口内。再补两条防漏：

- `.oq-card.oq-edge{background:transparent!important;border-color:transparent!important;box-shadow:none!important}`
  —— 即便整体移出，合成层的 1px 抗锯齿仍可能漏在视口边缘。
- `.oq-card.oq-edge{overflow:visible}` —— 基类是 `hidden`，会把挂在外面（负偏移）的把手裁掉。

单测 `贴边收起：卡片外壳必须整体移出视口，视口内只剩紫色把手` 锁住以上全部，
其中 `!/\dpx/` 这条专门拒绝"用 px 补偿留一条"的写法。

### 把手：视觉窄、热区宽

露出宽度 `EDGE_HANDLE_W = 10px`（≈ 8px 胶囊 + 1px 呼吸）。**不要把它当成热区宽度**：
`.oq-edge-handle` 实际 `width:22px` 并向卡片内侧偏移 12px，于是 10px 在视口内、
12px 在已推出视口的卡片内部——`pointer-events` 照样生效，点起来不费劲。

两条连带约束：

1. 收起态必须 `overflow:visible`。`.oq-card` 基类是 `overflow:hidden`（裁圆角与材质伪元素），
   会把外扩的热区裁掉一半。收起态内容已 `opacity:0`，不裁也看不出差别。
2. 悬停反馈**不要改宽度**。10px 露出区里胶囊一变宽就贴到视口边缘，看起来像"卡片又滑出来
   一点"。只变高（44→52px）+ 提亮即可。

这两条都有单测守着（热区宽度 > 露出宽度、收起态含 `overflow:visible`）。

### 四条不能违背的实现约束

1. **禁止用 `display:none` / `width:0` 收起**：卡片高度由 JS 量 `.oq-carousel` 的
   `active.scrollHeight` 写入（见自适应轮播高度 effect），元素不可见时量到 0，
   恢复后没有 deps 变化触发重测 → 塌成一条线。只用 `transform: translateX(...)`。
2. **拖拽 effect 依赖 `[hidden]`，闭包读 state 会读到首帧旧值**：所有在拖拽/悬停回调里
   读的 edge 状态必须走 `edgeOnRef` / `edgeStateRef`（每次渲染同步赋值）。
3. **关闭开关必须清 `LS_EDGE_STATE`**，否则窗口卡在把手条上而功能已关（无从展开）。
4. **收起前把卡片摆到对应边缘**、**`applyPos` 按停靠侧纠正 `left`**：否则展开会从半空
   或错误一侧滑出。

### 把手为什么是真实 DOM 而不是伪元素

需要独立承接 `click`（锁定展开）与 `mouseenter`（悬停展开）。伪元素的事件会冒泡到
`.oq-card` 本身，与拖拽的 `mousedown` 无法区分——而拖拽必须保留（用户靠拖拽把卡片拉出来）。

## 自定义区间（custom）

### 服务端裁剪是唯一真相来源

客户端**不做任何日期运算**，只把用户选的起止拼进查询串（`rangeQuery()`），
裁剪全部由 `resolveCustomWindow(from, to, now)` 在 host 侧完成，并把结果随 payload 的
`window: {from, to, days, clipped, reason}` 回传；客户端把它**回写日期控件**，
用户看到的就是真正查的那一段。

| 情况 | 处理 | `reason` |
|---|---|---|
| `from > to` | 自动交换 | `swapped` |
| `to > 今天` | 收到今天 | 含 `to-clamped` |
| `from < max(今天-90d, reset_at 所在日)` | 抬到最早可查日 | 含 `from-clamped` |
| 非法格式 / 不存在的日期 | **400 `bad-range`** | — |

不静默回落是刻意的：回落会让用户以为"选了但没生效"。
`parseLocalDay()` 必须做正则 + 反向校验（`new Date("2026-02-31")` 会静默归一化成 `03-03`）。

### `effMeterRange()` 的优先级：custom 最高

```
custom > heat/hour 的 90d 固定 > 用户选的固定档
```

⚠️ **不要反过来**。旧实现把 `if (chart === "heat") return "90d"` 写在最前，
无条件把 custom 压成 90d，结果"控件选了 10-01~10-07、明细表却是 90 天"。
固定档位在热力/时段下仍取 90 天（月份回看与时段样本量需要），但 custom 是用户显式
指定的窗口，必须贯穿总览/图表/排行/明细全部区块——热力/时段图在 custom 下只显示区间
内的天，区间外的格子为空，这是预期语义。

### 往既有条件分支加新入口时先确认分支不会整体替换

第一版把「自定义」加进 `pillGroup("范围", ...)`，但外层是
`(isHeat||isHour) ? <span>范围：近 90 天（图表固定）</span> : pillGroup(...)`——
热力/时段模式下整组 pills 被替换成一句文字，**新入口跟着一起消失**（用户实测反馈"我没看到"）。
现在任何形态都渲染 pills，热力/时段时传 `save=null` 走**只读态**（照常显示与高亮、
按钮 `disabled`、点击无效）并补一句说明。

## 逐日明细表与单日下钻

- **明细表**：数据源是 payload 的 `daily[]`，默认**展开**（收起态太隐蔽，用户反馈过）。
  列定义抽在模块级 `DETAIL_COLS` + 纯函数 `detailVal()`，供渲染与单测共用。
  - `freshInput` 必须算 `prompt - cache_read`（`prompt` 是"新输入 + 缓存读"的旧口径）
  - 合计行取 `totals` 而非 `sum(rows)`：窗口内可能有"只有工具调用、没有回复"的天
- **`daily[]` 的扩展列**：`topProject`（当日 token 最多的项目）、`avgMs`
  （`step/start → assistant/message` 墙钟均值，**无样本给 `null` 不给 0**——给 0 界面会
  显示"0ms"，与"没有测量"无法区分）。`avgMs` 的内存源是 `usage.perDayDur`，
  `hydrateFromDb` 用 `SUM(ms)/COUNT(*) ... GROUP BY day` 重建。
- **`GET /api/token-meter/day?date=YYYY-MM-DD`**（只读，不要 nonce）：24 小时分布 +
  当日汇总 + 模型/项目/渠道/工具 + 会话 Top10 + 当日调用（最多 100 条，走 `idx_events_day`）
  + 单日可靠性切片。**明细表点某行 = 热力图点某天 = 同一个 `renderDayDetail`**。
  错误码：`bad-date` / `future-date` / `out-of-retention`；空日返回全 0 而不是报错。

### 测试夹具的两个坑

- `resetUsage()` 必须把所有维度容器都清掉（`perDay/perModel/perProjectDay/perToolDay/
  perProviderDay/perHourDay/perSessionDay/perRelDay/perRetryDay/perDayDur/records`）。
  只清 `perDay/perModel/records` 时，新用例写进去的维度会污染后续用例——实测
  `dayDetail` 用例留下的 `proj-a` 把"工具/项目/渠道"用例的 `demo` 挤掉。
- `__resetAt` 是模块级状态。`enrichDimensions` 的 `reset_at` 回归用例会把它抬到"现在"，
  之后任何依赖"最早可查日"的用例都会算错。涉及可查下限的用例必须显式
  `T.setResetAtForTesting(0)`，不依赖执行顺序。
- **图表形态不共用**：悬浮窗迷你图只有 柱状/热力（`loadTmChart`），设置页多一个"折线"，
  放在同一个 key 会让"设置页选折线 → 悬浮窗按非 heat 即 bar 渲染"来回打架，
  因此设置页单开 `oq_settings_chart`（首次使用沿用旧的共享值）。
- **配置入口只在设置页**：悬浮窗是功能展示区，任何"设置/配置"性质的控件（包括图表形态切换）
  都不放在悬浮窗上。悬浮窗侧只保留 `loadTmChart()` 读取，写入一律走设置页
  「外观 → 小窗口图表」卡片（小窗口图表与设置页大图是**两个独立偏好**，互不影响）。两处靠 `opencode:tm-chart-changed`
  事件 + `storage` 事件联动，所以设置页一改，悬浮窗即时跟着变，无需悬浮窗自带入口。
  历史教训：曾为了让热力图能被发现，在悬浮窗「范围」pills 右侧加过一个 `柱 / 热` 小按钮，
  被用户指出属于"把配置塞进展示区"，已删除——不要为了"好发现"再往悬浮窗添加配置按钮。

## 补录缺失会话（importMissingSessions）

与 `repairProjects` 完全不同的操作，**不要混为一谈**：

| | 补齐历史维度 | 补录缺失会话 |
|---|---|---|
| 做什么 | 改已有行的 `project` 等列 | 把磁盘上整条缺失的会话摄入 |
| 会新增行吗 | **不会** | **会** |
| 会改总用量吗 | **不会** | **会** |
| 幂等依据 | 已填的行不再是 NULL | 按 `session_id` 判重 |
| 需要确认 | 直接点 | 先「统计待补录」→ 手输「补录」 |

### 预估口径必须与 computeUsage 完全一致

这是最容易错也最贵的一条。`computeUsage` 的 `totals.total` 是：

```
total = (inputTokens + cacheReadTokens) + outputTokens
```

第一版预览只算了 `inputTokens + outputTokens`，漏掉 cacheRead。agent 场景下
cacheRead 通常是大头（本机 6,675 万 tokens 里绝大部分是它），于是：

```
预览说  +15,918,265   （+8.0%）
实际    +66,750,788   （+33.5%）
```

差了 4 倍，预览完全失去意义。现在 preview 与 import 用同一个表达式，
实测预览 `266,084,217` = 实际 `266,084,217`，**差 0**。

回归保护：`test/host.test.mjs` 的「importMissing：预览只读…」把 cacheRead 从
任一处去掉都会立刻变红（已验证）。**改这两个函数时请一起改，并重跑该用例。**

### 空会话要跳过

只有配置类事件（`session` / `permission/preset` / `sandbox/mode` / `approval/policy`）
的会话文件没有用量，`usageEventsOf` 会返回空数组，因此不计入缺失列表。
本机 30 个"缺失"里有 3 个属于这类，真正的补录目标是 27 个——
界面上看到的数字应该是 27 而不是 30。

### 会话根目录

`sessionRoots()` 与 `scanFilesystemFallback` 同口径：只认本进程的 `DSH_HOME`，
另外补 `__homeStorages` 的上级（桌面版不设 `DSH_HOME` 环境变量）。
⚠️ 拼路径要逐段 `joinPath`，不能写 `joinPath(h, "profiles/web/sessions")`——
`joinPath` 按"任一参数是否含 `\\`"选分隔符，Windows 下会拼出混合分隔符。

## 补历史维度（repairProjects）

有一段时间实时路径只读 `session.cwd`，而 DSH 把 cwd 放在 `session.header.cwd`，
那批行落库时 `project` 全是 NULL（本机实测 1,124 行落进 `—` 桶）。
`repairProjects()` + 设置页「补齐历史维度」卡片负责按需补一次。

### 铁律：只 UPDATE，绝不新增行

**不要用 `enrichDimensions` 来做这件事。** 它走 `scanFilesystemFallback`，而那条路径
除了给 `__enrichSink` 收集维度，还会正常 `ingestEvent`——等于把磁盘上从未入库的会话
全部灌进账本。实测后果：

```
补齐前  3,186 行    总量 186,616,699
补齐后  6,972 行    ← "补项目"把总用量翻了一倍多
```

所以 `repairProjects` 只做：

```sql
UPDATE events SET project=? WHERE session_id=? AND (project IS NULL OR project='')
```

改完 `rebuildProjectPartitions` + `hydrateDimensionTables`，不碰任何计数列。
验收标准就两条：**行数不变、总量不变**（测试里都有断言）。

### cwd 的三级来源

1. `sessionQuery.readSession(id).session.cwd` —— 权威，无需解压；
2. 会话文件头的 `cwd` —— 要解压 zstd（`decompressMultiFrame`），只在 1 拿不到时用；
3. 目录名反解（`--D-code-foo--` → `D:\code\foo`）—— 最后兜底。

三级都拿不到的行保持 `—`，返回值里用 `projectNull` 如实告诉界面还剩多少行。

### 幂等

已补的行不再是 NULL，天然被 `WHERE` 排除，因此第二次执行 `updated=0`。
这让它可以安全重复点，不需要额外状态位。

## 回填代次闸门

清空账本必须能打断**正在进行中**的回填，两侧都要挡：

| 侧 | 位置 | 做法 |
|---|---|---|
| 写 | `flushDb` | 入口记 `__ledgerGen`，拿到写锁后再比一次，不一致 `ROLLBACK` 并丢弃整批 |
| 读 | `scanHistory` | 每个块边界 + 每次 `readSession` 返回后比一次，不一致立即中止 |
| 读 | `scanFilesystemFallback` | 接受 `genAtStart` 参数，每读一个文件比一次 |

只挡写入端是不够的：清空时若 `scanHistory` 正跑到一半，本轮 `cut` 是旧值，
剩余会话的事件时间戳都在它之后，会被正常摄入——库里就又有数据了。

验证方式：临时把 `scanHistory` 里两处 `genStale()` 判断改成 `false &&`，
`test/host.test.mjs` 的「扫描途中清空账本」应立即变红。改动这条逻辑后请重跑一次这个实验。

## 清空用量账本

独立于其它维护操作的一张卡片（设置页「维护 → 清空用量账本」Tab）。
设计与实现上有几条**不能省**的约束，都是踩过的坑：

### 语义

`clearUsageLedger(logger, { scope, cut, project, backup })`，三种范围：

| scope | 删什么 | 历史下限 |
|---|---|---|
| `all` | `events` 全清 + 7 张派生表全清 | `reset_at = now` |
| `before` | `events WHERE time < cut`，然后 `rebuildAllPartitions` | `reset_at = max(旧值, cut)` |
| `project` | `events WHERE project = ?`，然后 `rebuildAllPartitions` | 不动 `reset_at`，改用项目墓碑 |

`reset_at` 是"历史下限"：此后任何回填都跳过这一刻之前的历史，否则一次重启就会
把刚清掉的历史原样灌回来。

### 项目墓碑（`meta.suppress_projects`）

按项目清空**不能只删行**：会话文件还在，下一次重启的全量回填会把历史重新灌进来。
墓碑按"项目 + 清空时刻"生效，`ingestEvent` 入口据此拦掉该项目在清空时刻**之前**的事件；
清空之后的新活动必须照常记账（否则等于把这个项目永久拉黑）。

### 队列代次闸门（`__ledgerGen`）

`resetUsage` 清空内存容器时**必须同时倒空 `__eventsQueue`**，否则：
清空瞬间还在 50ms 防抖队列里的最后一批事件会在清空之后被 `flushDb` 写回
（实测清空后 `events=0`，300ms 后又变回 1，且永久残留）。
`flushDb` 因此记下入口代次，拿到写锁后再比一次，不一致就 `ROLLBACK` 并丢弃整批——
定时器到点、`beforeExit`/`exit` 钩子又 flush 一次，都写不回去。

### 失败必须是失败

旧实现是"报了假成功"级别的缺陷：DB 不可用时只 `logger.warn`，仍返回
`200 {ok:true, cleared:0}`，界面弹「已清空（0 行）」。用户以为清了，重启后数据全回来。
现在 DB 句柄丢失（且 `__dbPath` 存在）→ `ok:false, error:"store-unavailable"` → 端点 500。
**纯内存模式（`__dbPath` 为空）单独区分**：此时"清空内存"就是清空的全部，
如实 `ok:true` 但标 `persistent:false`。改这条时注意别把内存模式误判成失败。

### 快照

- 用 `VACUUM INTO`（SQLite 官方在线一致性快照），**必须在事务之前**执行
  （`cannot VACUUM from within a transaction`）。
- 清空前的快照里必须有数据，所以先拍快照再删；但那时还不知道"删了多少行"，
  所以 `.json` 旁注分两次写（`makeBackup` 写范围与时刻，`updateBackupSidecar` 删完补行数）。
- 文件名只到秒，同一秒内连续清空会撞车（`VACUUM INTO` 不覆盖已有文件）→
  同名就顺延 `-2`/`-3`…。这条是我端到端跑第二遍时才炸出来的。
- 只保留最近 10 份（`BACKUP_KEEP_MAX`），按 mtime 倒序裁。

### 破坏性端点的一次性 nonce

`localGuard` 在缺 `Sec-Fetch-Site` 头时是**放行**的（非浏览器请求正常情况），
因此本机任意进程一个空 `POST /api/token-meter/reset` 就能清库。
现在 `/reset` 要求 `x-reset-token` 头（或 `?token=`），令牌由
`POST /api/token-meter/reset-token` 下发，60s 有效、**用后即焚**（防重放）。

### 磁盘回收

`DELETE` 只把页放进空闲表，文件不会变小。清空后跑 `VACUUM` +
`wal_checkpoint(TRUNCATE)`；`VACUUM` 失败不算致命（数据已删），但要如实回报
`vacuum.ok:false`，不能假装回收了。

## 测试

```sh
npm run check    # 两个 bundle 的语法检查
npm test         # node:test：日历窗口 / 水位线去重 / 分档 / home 解析 / 小时桶窗口 / 归一化
                 #           区间口径 / 维度聚合与回填 / 实时窗口 / 清空账本（范围/墓碑/快照/nonce）
                 #           + 设置页"渲染冒烟"（真的把组件函数跑一遍）
```
CI（`.github/workflows/ci.yml`）在 push 与 PR 上跑同样两条命令，零依赖（`node:sqlite` 用 Node 内置）。

- `test/settings-render.test.mjs` 用一个最小 hook 运行时 + `jsx` 桩直接调用 `SettingsPanel`，
  并用桩 `fetch` 喂真实形状的 payload：设置页是 800+ 行的单文件组件，任何 undefined 字段
  都只会在"用户点开设置页"那一刻炸掉，语法检查抓不到。新增卡片/字段时请顺手加断言。
- 端到端复核（不依赖桌面壳）的做法：把真实 `token-meter.db` 复制到一个临时 `DSH_HOME`，
  对 `apply(fakeCtx)` 注册的路由直接发请求。这条路径能同时覆盖"老库 v3→v4 迁移 +
  维度回填 + 三张派生表重建"。
