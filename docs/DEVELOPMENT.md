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
GET /api/token-meter?range=1d|7d|30d|all[&withChart=1]  → computeUsage() 现算现发
```

- 日期口径一律"本地日"（`dayKeyOf()` = `getFullYear/getMonth/getDate`），DB 侧裁剪用
  `strftime(...,'localtime')` 与之一致。
- 去重靠"每会话水位线 `liveSeqs{sessionSeq,time}` + 复合键 `seenSeq`"：`seq` 只在会话内唯一，
  且存在编号代际重置（历史全局大 seq ↔ 新会话小 seq），所以比较时必须叠时间；`seenSeq`
  守的是"重置后旧事件被重新接受"那条路径，不能只留水位线。
- `realtimeHourly` 只服务客户端 1d 分时图，回填窗口是 `HOURLY_KEEP_MS`（2 天），
  客户端还会按本地日再过滤一次（历史实现两边都没收口，分时图曾混入 11 天共 59 列）。

## 存储与降级（踩过坑，务必先读）

- 账本：`<DSH home>/storages/token-meter.db`（`node:sqlite`，WAL，`SCHEMA_VERSION` 驱动迁移）。
  两张表：`events`（幂等账本，PK `(seq, session_id)`，`INSERT OR IGNORE`）+
  `daily_usage`（派生缓存，PK `(day, model)`，flush 时按受影响天整分区重建，不 `+=` 累加）。
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

`SCHEMA_VERSION = "4"` 起，`events` 增补 `project` / `tool` / `ms` / `provider` 四列
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
  再重建两张派生表并重新 hydrate，最后置 `dims_backfill=1`。实测本机 14.7k 条事件约 4s。
- **渠道维度不落派生表**：`perProviderDay` 在 hydrate 时按 `(day, provider)` 直接聚合 `events`，
  新事件实时累加（同名模型跨渠道是两笔账，旧实现只留 `model` 会把它们合并）。
- **`daily_usage` 的 `tools/turns/steps` 仍只落在 `model='__system'` 行**（历史口径，未动）：
  要按模型看工具/步数请用 `daily_tool` / `tools[]`，不要指望 `daily_usage` 的模型行。

### 清空用量账本

`POST /api/token-meter/reset` 清空 `events` 与三张派生表，并写 `meta.reset_at`；
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

- **范围**（1d/7d/30d/90d/all）由设置页与悬浮窗**共用** `LS_RANGE`，变更时广播
  `opencode:range-changed`，两边都监听（此前设置页另存 `oq_settings_range`，两个界面
  会显示不同时间段）。
- **图表形态不共用**：悬浮窗迷你图只有 柱状/热力（`loadTmChart`），设置页多一个"折线"，
  放在同一个 key 会让"设置页选折线 → 悬浮窗按非 heat 即 bar 渲染"来回打架，
  因此设置页单开 `oq_settings_chart`（首次使用沿用旧的共享值）。

## 测试

```sh
npm run check    # 两个 bundle 的语法检查
npm test         # node:test：日历窗口 / 水位线去重 / 分档 / home 解析 / 小时桶窗口 / 归一化
                 #           区间口径 / 维度聚合与回填 / 实时窗口 / 清空账本
                 #           + 设置页"渲染冒烟"（真的把组件函数跑一遍）
```
CI（`.github/workflows/ci.yml`）在 push 与 PR 上跑同样两条命令，零依赖（`node:sqlite` 用 Node 内置）。

- `test/settings-render.test.mjs` 用一个最小 hook 运行时 + `jsx` 桩直接调用 `SettingsPanel`，
  并用桩 `fetch` 喂真实形状的 payload：设置页是 800+ 行的单文件组件，任何 undefined 字段
  都只会在"用户点开设置页"那一刻炸掉，语法检查抓不到。新增卡片/字段时请顺手加断言。
- 端到端复核（不依赖桌面壳）的做法：把真实 `token-meter.db` 复制到一个临时 `DSH_HOME`，
  对 `apply(fakeCtx)` 注册的路由直接发请求。这条路径能同时覆盖"老库 v3→v4 迁移 +
  维度回填 + 三张派生表重建"。
