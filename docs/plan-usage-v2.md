# dsh-quota-widget 用量统计改造执行计划（v2）

- 生成日期：2026-10-16
- 输入：`docs/plan-usage-enhancement.md`（调研稿）
- 状态：**已执行（批次 1–4 全部落地）**，执行记录见文末 §7
- 前置事实：本机运行实例的 `lib/index.js` 与仓库**哈希一致**（`34EEC1355526BD57710FF8334E1F1E8A`），
  即下面所有"实测问题"都是当前代码的真实行为，不是旧版本残留

## 0. 复核结论（对调研稿的修正）

| 调研稿条目 | 复核结果 | 最终做法 |
|---|---|---|
| 首 token 恒为 0，根因"字段缺失" | ❌ 修正：会话文件里 `assistant/chunk` 100% 带 `turn/step`（3763 条零缺失），且实时流里 `step/start`+`step/end` 明确投递（`llmMs` 增长）。**根因应为实时事件流不投递 chunk 类事件**（落盘文件里有、事件流里没有） | 不押注单一事件名：改为"步内首个产出信号"广匹配（`assistant/chunk` / `text-chunks` / `reasoning-chunks` / `tool-call-chunks`）+ **诊断计数**（按事件类型分别计数并下发），修好后自然有值，修不好也能自证 |
| `live.tokPerSec` 语义 | ✅ 成立：进程启动至今的累计均值（`outputTokens/llmMs`），非瞬时 | 新增 60s 滑动窗口速率作为主指标，累计值降为 tooltip |
| 总览「输入」含缓存读 | ✅ 成立（`index.js:1019/1021`） | 拆 `新输入/缓存读/输出` 三段 + 命中率，保留旧字段不破坏悬浮窗 |
| `cacheWrite` 恒 0 | ✅ 成立（宿主 usage 无该字段，DB `SUM(cache_write)=0`） | 客户端有值才渲染段与图例 |
| 工具名/项目/provider 可得 | ✅ 成立（`tool/call.data.name`、会话头 `cwd`、`message.source.provider`） | 批次 3 实现 |
| 金额估算 | ⚠️ 降级：无权威价目表，硬编码价格会误导 | **本轮不做**，只做 provider 切分（token 维度） |

## 1. 设计：数据模型与契约

### 1.1 Schema v4（`SCHEMA_VERSION: "3" → "4"`）

| 变更 | 语句 | 说明 |
|---|---|---|
| `events.project` | `ALTER TABLE events ADD COLUMN project TEXT`（SQLite 原生 ADD COLUMN，无需重建） | 项目维度事实源 |
| 新派生表 `daily_tool` | `(day, tool, calls, ms, updated_at)`，PK`(day,tool)`，`WITHOUT ROWID` | 工具维度 |
| 新派生表 `daily_project` | `(day, project, requests, input, output, cache_read, tools, sessions, updated_at)`，PK`(day,project)`，`WITHOUT ROWID` | 项目维度 |
| 索引 | `idx_events_project(project)` | 项目维度查询 |

- 迁移：`db_version !== "4"` → `ALTER TABLE`（`PRAGMA table_info` 判存在，幂等）→ 建新表 → `rebuildAllPartitions` →
  写 `db_version='4'`。失败回滚 + warn（沿用现有事务写法）。
- 派生表重建与 `daily_usage` 同节奏：`rebuildAllPartitions` 与 `flushDb` 内 `rebuildPartitionsInRange` 一起重建三张派生表。

### 1.2 新增内存结构（`usage` 内）

| 结构 | 键 | 值 | 来源 |
|---|---|---|---|
| `perToolDay` | `tool` → Map(day → {calls, ms}) | 调用次数、累计耗时 | `tool/call`（name）+ `tool/result`（耗时） |
| `perProjectDay` | `project` → Map(day → agg+{sessions:Set}) | 与 `emptyAgg` 同口径 | `assistant/message`（记 cwd） |
| `perProviderDay` | `provider` → Map(day → agg) | 同上 | `assistant/message.source.provider` |
| `sessionMeta` | `sid` → `{project, provider}` | 会话 → 项目/渠道映射 | `session/event` 的 session 对象 / `listSessions().header.cwd` / fs 目录名解码 |
| `live.outputs60` | 数组 `[{t, tokens}]`（上限 200 条，超 60s 淘汰） | 60s 窗口速率 | `assistant/message` |
| `live.stepFirstSeen` | `sid:turn:step` → `{t, kind}` | 首产出信号 | 4 类 chunk 事件广匹配 |
| `live.signalCount` | `{kind: n}` | 事件流诊断 | 同上 |
| `live.retryCount` / `live.retryCodes` / `live.compactions` / `live.errors` / `live.toolErrors` | 计数 | 可靠性 | `llm/retry` / `compaction/end` / `turn/end(reason=error)` / `tool/result(isError)` |

### 1.3 payload 契约（`GET /api/token-meter`，新增字段，旧字段全部保留）

```
health: { store, dbBytes, dbPath, events, days, lastScanAt, ready }
totals: { …原字段, freshInput, cacheHitRate, steps }
tools:    [{ tool, calls, ms, avgMs }]                      // 按 calls 降序，最多 20
projects: [{ project, requests, input, output, cacheRead, total, tools, sessions }]
providers:[{ provider, requests, input, output, cacheRead, total }]
reliability:{ retries, retryCodes:[{code,n}], compactions, errors, toolErrors }
live: { …原字段, rate60, rate60Tokens, signalCount, msgs }
records:[{ time, sessionId(12), model, provider, project, input, output, cacheRead, durationMs }]
range: "1d"|"7d"|"30d"|"90d"|"all"
```

- `range` 白名单新增 `90d`（与保留窗口 `USAGE_KEEP_MS` 对齐）。
- 新增端点 `POST /api/token-meter/reset`：清空 `events` / 三张派生表 + `usage.perDay/perModel/records/perToolDay/perProjectDay/perProviderDay` + 重置水位线与 `ready`，返回 `{ok:true, cleared:{events:n}}`。

### 1.4 客户端状态（`SettingsPanel` 内）

| 状态 | 用途 |
|---|---|
| `tmSortState`（模型排行排序：`total`/`requests`/`cacheRead`） | 批次 2 |
| `tmToolSortState`（工具排行：`calls`/`ms`） | 批次 3 |
| `tmModelFilter`（点击排行选中的模型，`""` 为全部） | 批次 2 |
| `meterUpdAt` 记 `payload.updatedAt`（服务端时间） + 每秒 tick 计算"x 分钟前" | 批次 2 |
| 面板可见时 20s 轮询（`version` 未变则跳过 `setState`） | 批次 2 |

## 2. 批次任务（每批独立可验收、可回滚）

### 批次 1 —— 口径与正确性（P0）

| 项 | 改动点（文件） | 验收标准 |
|---|---|---|
| 1.1 首 token 广匹配 + 自证 | `index.js`：`stepFirstSeen` 命中 4 类 chunk 事件，`signalCount` 分类计数；`live` 输出 `signalCount`。`client.js`：无样本显示「无样本」，tooltip 列出各信号计数 | 跑一轮真实对话后：若有信号则显示 `≈N ms`；若仍无信号，tooltip 能看出事件名，可定位 |
| 1.2 实时速率窗口化 | `index.js`：`live.outputs60` 数组 + `rate60`；`client.js`：主显示「近1分钟 x tok/s」，tooltip 显示窗口 token 数与累计均值 | 停止对话 60s 后速率自动回落（不是恒定值） |
| 1.3 总览口径重做 | `index.js`：`totals.freshInput`/`cacheHitRate`；`client.js`：三段 100% 堆叠条 + 命中率 chip + 步数 chip + 环比徽标 | 三段之和 = 总量；截图那组数字不再歧义 |
| 1.4 缓存写收敛 | `client.js`：`cacheWrite>0` 才渲染柱段与图例项 | 图例不再出现永不显示的项 |
| 1.5 图表失真修复 | `client.js`：0 值不画 8px 假柱（画 2px 基线）、柱顶峰值标注、3 条横向网格线 | 空日不显示柱体；量级可读 |

### 批次 2 —— 信息密度与交互（P1）

| 项 | 改动点 | 验收标准 |
|---|---|---|
| 2.1 模型排行增强 | `client.js`：排序切换 + 请求数 + provider 标注 + 点击过滤图表（`tmModelFilter`） | 5 个视图数据与改前一致；点模型后图表只显示该模型 |
| 2.2 最近调用增强 | `index.js`：`records` 增 `durationMs/provider/project/sessionId(12)`；`client.js`：显示缓存读、耗时、渠道，点击复制整行 | 单条信息完整、可复制 |
| 2.3 面板刷新体验 | `client.js`：20s 轮询（`version` 判变更）+ 「更新于 x 分钟前」 | 面板停留 1 分钟后数字自动更新 |
| 2.4 数据健康与清空 | `index.js`：`health` 字段 + `POST /api/token-meter/reset`；`client.js`：健康行 + 「维护」组「清空用量账本」（二次确认） | 清空后视图归零，DB 文件大小回落 |

### 批次 3 —— 新维度（P2）

| 项 | 改动点 | 验收标准 |
|---|---|---|
| 3.1 工具排行 | host：`perToolDay` + `daily_tool` + payload `tools[]`；client：新卡片（按次数/耗时切换） | 工具分布与实测 read/edit/pwsh/grep 排序一致 |
| 3.2 项目排行 | host：`sessionMeta` + `events.project` + `daily_project` + payload `projects[]`；client：新卡片 | 项目名可读（cwd 末段），跨会话正确合并 |
| 3.3 可靠性统计 | host：`retries/retryCodes/compactions/errors/toolErrors`；client：折叠卡 | 与 `llm/retry`、`compaction/*` 计数一致 |
| 3.4 provider 切分 | host：`perProviderDay` + payload `providers[]`；client：模型排行加「按渠道」开关 | 同名模型跨 provider 不再合并 |

### 批次 4 —— 体验收尾（P2/P3）

| 项 | 改动点 | 验收标准 |
|---|---|---|
| 4.1 区间与图型 | `90d` 区间 pill；折线/面积模式（SVG） | 90 天柱体数 ≤ 90；折线与柱状图数据一致 |
| 4.2 导出与复制 | CSV 导出当前视图、一键复制摘要 | 导出内容与界面数字一致 |
| 4.3 视图偏好统一 | `saveTmChart` 派发 `opencode:tm-chart-changed`；设置页范围与悬浮窗共用 `LS_RANGE` | 设置页切图表后悬浮窗同步 |
| 4.4 单测补齐 | `test/host.test.mjs` / `test/client.test.mjs` 新增：`cacheHitRate`、`rangeWindowKeys("90d")`、`perTool/perProject` 合并、60s 窗口、`projectFromCwd`、`resetUsage` | `npm run check && npm test` 全绿 |

## 3. 明确不做（附理由）

- **金额/成本估算**：无权威价目表，硬编码或让用户填都易误导；本轮只做 provider 切分。
- **按小时×按天持久化**：需要新表 + 回填窗口重设计，收益低于风险，留给下一轮。
- **`daily_usage` 按模型的 tools/turns/steps**：现口径只在 `model='__system'` 行（实测确认），要改得改 PK 与聚合语义，
  本轮工具/步数走独立的 `daily_tool`，不动旧口径。
- **i18n / 官方 `ctx.storageDomain` 迁移**：沿用上一轮结论（发布前 / 触发条件未到）。

## 4. 风险与约束

| 风险 | 对策 |
|---|---|
| Schema 迁移失败导致老库不可用 | `ALTER TABLE` + `PRAGMA table_info` 幂等判断；失败 `ROLLBACK` + warn；新表缺失时读路径全部 `try/catch` 容错（缺表 = 该维度为空） |
| 实时事件名猜测错误 | 全部走"广匹配 + 诊断计数"，任一事件名命中即可；不押注单一名字 |
| 客户端改动破坏悬浮窗 | 悬浮窗消费的字段（`totals/daily/hourly/live/byModel` 等）只增不改；`usageChips` 等设置页专用函数独立改造 |
| 客户端超时与 host 等待 | 沿用 30s > `READY_WAIT_MS(20s)` 约束，不改 |
| 排行/图表新增状态与旧 localStorage 冲突 | 新 key 统一 `oq_settings_*` 前缀，读取时校验白名单值 |

## 5. 验证清单

1. `npm run check`（两端语法）与 `npm test`（新增用例全绿）
2. 本机实例实测：`/api/token-meter?range=1d|7d|30d|90d|all` 字段齐全、`health.dbBytes>0`、
   `tools[]` 首项与实测 read/edit/pwsh 排序一致、`projects[]` 出现 `token-lens` / `dsh-quota-widget` 等真实 cwd
3. 设置页目视：总览三段、命中率、环比、90d、折线、工具/项目排行、可靠性、健康行、清空账本
4. 悬浮窗回归：三个 provider 卡片与 TokenMeter 轮播显示与改前一致

## 6. 交付物

- `lib/index.js`、`lib/client.js`（改动主体）
- `test/host.test.mjs`、`test/client.test.mjs`（新增用例）
- `docs/DEVELOPMENT.md`（补 schema v4 / 新维度采集 / 事件名广匹配一节）
- **不做 git commit**（按惯例等你确认；是否同步到 profile 目录由你决定）

## 7. 执行记录（2026-10-16）

### 7.1 落地内容

| 批次 | 落地内容 |
|---|---|
| 1.1 | `index.js`：`SIGNAL_EVENT_TYPES` 广匹配 + `live.signalCount` 分类计数；`client.js`：无样本时显示「无样本」，tooltip 列出各事件名计数 |
| 1.2 | `index.js`：`live.outputs60` 样本 + `rateOverWindow()` → `live.rate60/rate60Tokens/rate60WindowSec`；`client.js`：主指标改「近 60 秒速率」，累计均值降为 tooltip |
| 1.3 | `index.js`：`totals.freshInput` / `cacheHitRate`、`prevTotals` 补 `freshInput/cacheRead/output`；`client.js`：`overviewBlock()` 三段 100% 堆叠条 + 命中率/新输入/缓存读/输出/步数 chip + 环比徽标 |
| 1.4 | `client.js`：`hasWrite` 为真才渲染缓存的柱段与图例项 |
| 1.5 | `client.js`：`barHeightFor()` 取代 `Math.max(8,…)`（0 值只留 2px 基线且不配色）+ 峰值标注 + 参考线（`.oq-chart-grid`） |
| 2.1 | `modelRank()` 重写：排序（总量/请求/缓存读）、真实百分比（<1% 显示 `<1%`）、点击某模型 → 图表过滤（`tmModelFilter`，柱状/折线/1d 分时都生效） |
| 2.2 | `index.js`：`records` 增 `durationMs`（step/start→消息）/`provider`/`project`，`sessionId` 12 位，且 hydrate 时只取 `assistant/message`（此前会把 `__system` 的 0→0 行混进列表）；`client.js`：显示 缓存读/耗时/项目，点击复制整行 |
| 2.3 | `client.js`：面板可见时 20s 轮询（`version` 未变则跳过 setState）、「更新于」用**服务端** `updatedAt` + 「x 分钟前」节拍 |
| 2.4 | `index.js`：`dbHealthSnapshot()`（库大小/账本行数/跨度/最后回填）+ `POST /api/token-meter/reset` + `meta.reset_at` 语义；`client.js`：`healthLine()` 一行（可点击复制诊断）+ 维护组「清空用量账本」（二次确认） |
| 3.1 | `index.js`：`perToolDay` + `daily_tool` + payload `tools[]`（含 `avgMs`）；`client.js`：工具排行卡（按次数/耗时切换） |
| 3.2 | `index.js`：`sessionMeta`（session.cwd → header.cwd → 目录名兜底）+ `events.project` + `daily_project` + payload `projects[]`；`client.js`：项目排行卡 |
| 3.3 | `index.js`：`live.retries/retryCodes/compactions/errors/toolErrors` → payload `reliability`；`client.js`：实时卡下方可靠性一行 |
| 3.4 | `index.js`：`perProviderDay` + `events.provider`（不另建派生表，hydrate 时按 `(day,provider)` 聚合）+ payload `providers[]`；`client.js`：按渠道卡 |
| 4.1 | 新增 `90d` 区间（host 白名单 + 客户端 pill）+ 折线/面积图（SVG，`renderLineChart`） |
| 4.2 | 工具栏「导出 CSV」「复制摘要」；`downloadText` / `copyText` 带降级实现 |
| 4.3 | **按实现调整**：范围统一到 `LS_RANGE`（派发 `opencode:range-changed`，悬浮窗同步）；图表形态**改用设置页专用 key** `oq_settings_chart`（原计划"共用 LS_TM_CHART"会让设置页的折线把悬浮窗迷你图带歪） |
| 4.4 | `test/host.test.mjs` +14 条（区间/口径/维度聚合/回填/实时窗口/清空）、`test/client.test.mjs` 增至覆盖新纯函数、**新增 `test/settings-render.test.mjs`（4 条渲染冒烟）** |

### 7.2 验证结果

- `npm run check` + `npm test`：**41/41 通过**（0 失败）。
- 沙箱端到端（把真实 `token-meter.db`(v3) 复制到临时 `DSH_HOME`，对 `apply(fakeCtx)` 注册的路由直接发请求）：
  - `DB v3 -> v4: rebuilt daily_usage partitions from events in 25ms`
  - `dims backfill via fs: pairs=14718 applied=14568 in 3958ms`（`meta.dims_backfill=1`）
  - `daily_tool` Top：`read 2368 / pwsh 2003 / edit 1202 / grep 899`（与直接读会话文件统计的分布一致）
  - `daily_project` Top：`zenith / harmonycast / dsh-smart-commit / token-lens / ems资源包 / codebuddy cn`（大小写已合并）
  - `providers`：`unisound / stepfun / buddy / deepseek-account / r4 / opencode`（此前同名模型跨渠道被合并）
  - `totals.cacheHitRate=96.3`、`reliability.errors=26 / toolErrors=118`、`records[0]` 带 `durationMs/provider/project`
  - `range=90d` 正常、非法 range 回落 `7d`、`POST /api/token-meter/reset` 清掉 24423 行且视图归零

### 7.3 与计划的偏差

- **4.3**：见上（图表 key 从"共用"改为"分离"），理由已写进 `docs/DEVELOPMENT.md`。
- **首 token**：广匹配后发现——实时事件流只投递 `assistant/chunk` 与否无法从代码判定，
  故保留"广匹配 + 分类计数"的自证设计；沙箱回填路径实测 `assistant/chunk` 有效
  （`firstTokenCount=2430`、`signalCount.assistant/chunk=27627`）。
- **`usage.live` 的重置**：`resetUsage()` 会一并清零实时计数，这是"清空账本"应有之意。

### 7.3.1 执行中额外修掉的两处（不在原计划内）

- **空库不做维度回填**：首次安装时 `perDay.size === 0`，紧随其后的全量扫描本就会把
  `project/tool/ms/provider` 随事件写入，再单跑一遍回填等于把启动 I/O 翻倍。
  现在空库直接置 `dims_backfill=1`。沙箱实测（空库 + 81 个真实会话文件）：
  单次扫描 3.9s 即得到 `tools` Top = `read/pwsh/edit/grep/glob`、`providers` =
  `unisound/stepfun/buddy/...`，与"先迁移再回填"两条路的数值一致。
- **项目维度的工具数**：`ingestEvent` 的 `tool/result` 分支只累加到 `perDay`，
  漏了 `perProjectDay`，导致"刚全量扫完、还没重启 hydrate"时项目卡的工具数恒为 0，
  与重启后不一致；已补齐，并让 `computeUsage` 把 `tools>0` 也算作"该窗口有活动"。

### 7.4 未做（维持 §3）

金额估算、按小时×按天持久化、`daily_usage` 按模型的 tools/turns/steps 口径改造、i18n、
官方 `ctx.storageDomain` 迁移。

### 7.5 待你决定

- 是否把本轮改动同步到 `~/.dsh/profiles/desktop/node_modules/dsh-quota-widget`
  （重启桌面端后即可看到新卡片与 v4 迁移日志）。
- 是否 git 提交（本轮**未提交**）。
