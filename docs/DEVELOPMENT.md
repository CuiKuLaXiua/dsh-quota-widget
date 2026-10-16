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

## 测试

```sh
npm run check    # 两个 bundle 的语法检查
npm test         # node:test：日历窗口 / 水位线去重 / 分档 / home 解析 / 小时桶窗口 / 归一化
```
CI（`.github/workflows/ci.yml`）在 push 与 PR 上跑同样两条命令，零依赖（`node:sqlite` 用 Node 内置）。
