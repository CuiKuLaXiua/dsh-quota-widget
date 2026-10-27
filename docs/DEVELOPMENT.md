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
