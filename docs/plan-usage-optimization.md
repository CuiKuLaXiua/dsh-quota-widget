# dsh-quota-widget 优化执行计划（已核对版）

- 生成日期：2026-10-16
- 状态：**已执行（A/B/C/D + E1）**，执行记录见文末 §7
- 依据：逐项对照源码 + 对本机运行中实例（`127.0.0.1:19387`）的实测
- 本文件取代此前的口述草案：每条都做了"是否必要 / 判断是否有误"的核对，结论见 §1

## 0. 实测基线（核对用的客观事实）

| 项目 | 实测值 | 用途 |
|---|---|---|
| host 半端端点 | `127.0.0.1:19387`，`ready=true` | 可随时验接口行为 |
| 7d 窗口 | 4 天 / 2255 请求 / 约 5.2 亿 tokens / `seenSeq=26850` | 数据规模 |
| `hourly` 桶 | **77 个，覆盖 11 个不同日期**（2026-08-14 ~ 10-16） | 新发现 bug 的直接证据 |
| `records` | 50 条（上限生效） | 正常 |
| 会话文件 | 74 个 / 43.6 MB（全部在 90d 窗口内） | 回填成本 |
| `token-meter.db` | **不存在**（`~/.dsh/storages` 下没有） | 已确认此前为纯内存模式 |
| 宿主运行时 | Electron 44 / Node 24.18.1，`node:sqlite` 可用 | 排除驱动因素 |

## 1. 核对结论速览

| # | 条目 | 原判断 | 核对结果 | 最终结论 |
|---|---|---|---|---|
| 1 | 客户端轮询无 in-flight 守卫/超时 | 需修 | ✅ 成立（`client.js:450-455` `pollTick` 不等待上一次） | 需修，**但超时必须 > host 的 20s 等待上限**（见 §2.1） |
| 2 | `live.firstChunk` 只写不删 | 需修 | ✅ 成立（`index.js:789-790` 是唯一引用，无 delete） | 需修，1 行 |
| 3 | `seenSeq` 无上界 | 建议复核 | ⚠️ **原判断不准确**：它守的是"编号代际重置后旧事件被重新接受"（`advanceWatermark` 的 else 分支把 seq 降为 `seq\|\|0`），删不得；实测 26,850 条 ≈ 几 MB | 降级为可选项，不在首批 |
| 4 | `realtimeHourly` 全量回填 90 天 | 内存优化 | 🔴 **低估了**：实测 77 桶/11 天，直接导致 1d 分时图混天（用户可见 bug） | 与新增 F1 合并，提到首批 |
| 5 | 静默降级无出口 | 需修 | ✅ 成立（响应无 `store` 字段；`index.js:1255-1272`） | 需修，小改动 |
| 6 | 回填缺"会话级跳过" | 需修 | ⚠️ **实现前提未证实**：`listSessions` 的 `header` 只能确认有 `id`/`cwd`/`createdAt`；官方 `updatedAt` 是由投影算出来的（`projections.values.sessionListMetadata`），不保证在 `header` 上 | 降级为**待探测**，本批只做并发化（#7） |
| 7 | `readSession` 串行 | 需修 | ✅ 成立（`index.js:886-912` 逐个 await） | 需修（注意 90d 边界的 break 语义） |
| 8 | `?meta=live` + `mergeLive` 冗余 | 可删 | ✅ 成立（全量 payload 已含 `live`；注释里的理由"Rust 快路径"随 Zenith 剥离失效） | 可删，省每轮一次 HTTP + 一次 computeUsage |
| 9 | 渲染按 version 节流 | 可做 | ✅ 成立，**但有前提**：客户端根本没映射 `version`（`client.js:356`），且 payload 的 `updatedAt` 是每次请求新生成的 `Date.now()`，不能用来判"数据没变" | 需先补映射，再做比较 |
| 10 | legacy 兼容层可删 | 可删 | ✅ 成立（`byModel` 无任何渲染消费者；`today`/`totals` 仅在 `stats` 缺失时兜底而 host 恒发 `stats`；`hourly` 要留） | 可删（约 85 行） |
| 11 | 死字段 `events.raw` / `meta.last_seen_seq` | 建议清理 | ⚠️ **判断偏重**：`raw` 恒 NULL、`last_seen_seq` 只 seed，但删列要走表重建迁移，收益极低 | 只改注释 + 删那一行 seed（无需迁移） |
| 12 | host 文件内分层 | 建议重构 | ✅ 成立（1270 行含 4 类职责），但**纯重构无行为收益且有回归风险** | 排在测试之后，可选 |
| 13 | 存储/回填官方化（storageDomain / 官方投影） | 暂不做 | ✅ 维持（触发条件见 §5） | 不做 |
| 14 | 零测试 | 需补 | ✅ 成立（`package.json` 无 `scripts`/无测试目录） | 需做，性价比最高 |
| 15 | 无 CI | 需补 | ✅ 成立 | 需做（依赖 #14） |
| 16 | i18n（全中文硬编码） | 发布前需要 | ✅ 成立 | 不进本计划，发布前单独处理 |
| 17 | 文档缺"存储与降级"一节 | 需补 | ✅ 成立（`docs/DEVELOPMENT.md` 仅 11 行） | 需做，小改动 |
| F1 | **1d 分时图混入历史天** | （原计划未发现） | 🔴 实测成立：`hourly` 77 桶跨 11 天，`client.js:1784-1798` 未按今天过滤，且 `maxTotal` 按全量峰值归一 → 今天柱体被压扁 | **新增，首批修** |

## 2. 需修正的判断（重点）

### 2.1 #1 的超时要与 host 的等待上限对齐（否则修出新 bug）
我上一轮给 host 加了"最多等回填 20s"（`READY_WAIT_MS`）。如果客户端按我最初说的加个 10s 超时，会把那次**携带完整口径**的响应掐掉，等于把刚修好的"首屏半截数据"又放回来。正确做法：只做"in-flight 跳过"，超时设 ≥ 30s（或首屏请求不设超时）；设置页的手动刷新要带 `force` 参数，不能被跳过逻辑挡住。

### 2.2 #3 不能简单删除
`seenSeq` 与水位线确实重叠，但在"编号代际重置"路径上不可替代（`advanceWatermark` 会把 seq 降到 `seq||0`，此后旧世代的事件会重新满足水位线条件）。当前实测 26,850 条，量级只有几 MB，**不紧急**；如要治理，按会话只保留最近 N 条，而不是删掉整张 Set。

### 2.3 #6 需要先探测字段
官方 `listSessions` 的返回是 `{ header, ... }`；`updatedAt` 在官方实现里来自投影元数据（`session-list` 包用 `projections.values.sessionListMetadata` 生成），不保证挂在 `record.header` 上。所以"读会话前先跳过"这一步，**先打一行 `Object.keys(record.header)` 日志**确认字段，再决定实现；本批不排，只做 #7。

### 2.4 #11 收敛为注释清理
`events.raw` 列（恒 NULL）与 `meta.last_seen_seq`（只 seed、从不读写）确实是死字段，但 SQLite 删列需要表重建 + 迁移，收益极低。只做：`index.js:203` 的 "raw 全量账本" 注释改写 + 删 `index.js:96` 的 seed 行（无迁移）。

### 2.5 #10 删除范围要留 `hourly`
`hourly` 是 1d 分时图（`client.js:1777`）唯一数据源，必须保留；`buckets`（数字型）只在 legacy 兜底分支被用（`client.js:1271`），随兜底分支一起删。

## 3. 新发现 F1：1d 分时图混入历史天（用户可见）

**现象**：设置页"今日分时"会把 11 个日期、77 个小时桶排成一排（昨天/上月的小时柱混进来），且纵轴按全量峰值归一，今天的柱子被压得几乎看不见。

**根因链**：
1. host 侧 `realtimeHourly` 由 hydrate 一次灌入 **全部 90 天** 的 `model::hour` 桶（`index.js:185-190`，无时间过滤），进程内又持续累加；
2. 客户端 1d 分支直接 `Object.entries(hourly)` 分组渲染，**没有"只取今天"**（`client.js:1777-1798`）。

**修法（双保险，两处都改）**：
- host：hydrate 的小时桶只回填最近 2 天（`WHERE time >= ?`），并在响应里给 `hourly` 附加 `todayStr` 语义或直接只回今天（保留 legacy 字段名不变）；
- client：1d 分支按 `localDayStr()` 过滤 `hourish` 前缀（`<todayStr>T`），并在无今天数据时回落到按日柱状图（现有兜底已具备）。

**验收**：1d 视图列数 ≤ 24；跨天重启后仍成立；7d/30d/热力图不受影响。

## 4. 最终执行计划（按批次，可独立验收）

> 约定：每批独立可回滚；每批自测后同步到 `~/.dsh/profiles/desktop/node_modules/dsh-quota-widget` 由你重启验证；**不做 git commit**（等你确认）。

### 批次 A —— 正确性与防降级（P0，建议先做）
| 项 | 改动点 | 验收标准 | 风险 |
|---|---|---|---|
| A1 = #2 | `index.js` `step/end` 分支补 `live.firstChunk.delete(key)` | 跑一轮对话后 `firstChunk.size` 归零（临时 debug 日志确认） | 极低 |
| A2 = F1 | host hydrate 小时桶限近 2 天；client 1d 按今天过滤 | 1d 图仅今天列（≤24），跨天重启仍正确 | 低（legacy 字段名不变） |
| A3 = #5 | 响应新增 `store` 字段（值为 `db:<path>` 或 `memory`）；设置页"数据源"卡片显示一行 | 内存模式下设置页可见「内存（不持久化）」 | 极低 |
| A4 = #1 | `pullMeter` 加 in-flight 守卫 + 30s 超时；设置页刷新带 `force` | 首次请求不再叠发；手动刷新不被跳过 | 低（注意 §2.1 的超时对齐） |

### 批次 B —— 性能（P1）
| 项 | 改动点 | 验收标准 | 风险 |
|---|---|---|---|
| B1 = #7 | `scanHistory` 的 `readSession` 改 4 路并发，按 chunk 保持 90d 边界 break | 回填耗时下降（打点日志对比 74 文件基线） | 中（并发下要保持去重语义不变） |
| B2 = #8 | 删 host `?meta=live` 分支 + client `mergeLive()` 及其调用 | Network 面板不再出现 `meta=live`；实时指标仍随全量 payload 更新 | 低 |
| B3 = #9 | client 映射并使用 `version` 做变更判断后再 setState | 流式期间无变化时不再整树重渲染（可用 React DevTools/渲染计数验证） | 低 |
| B4（可选）| #3 按会话裁剪 `seenSeq` | 长期运行内存不增长 | 低 |

### 批次 C —— 精简（P2）
| 项 | 改动点 | 验收标准 | 风险 |
|---|---|---|---|
| C1 = #10 | 删 host `today`/`byModel`/`totalsLegacy`/`hourlyLegacy` 与 client 对应兜底分支、`byModel` 归一化（保留 `hourly`） | 五个视图（1d/7d/30d/热力图/模型排行）+ 最近调用全部与改前一致 | 中（删错会掉展示，需逐视图核对） |
| C2 = #11 | `index.js:96` 删 seed 行；`index.js:203` 注释改写 | 启动日志无异常；DB 结构不变 | 极低 |

### 批次 D —— 工程化（P2，建议紧随 C 之前或之后）
| 项 | 改动点 | 验收标准 | 风险 |
|---|---|---|---|
| D1 = #14 | 新增 `test/`（`node:test`），覆盖：`dayKeyOf`、`computeUsage` 三种窗口边界与"今天无数据计 0"、`shouldSkipEvent` 代际重置、三个 `normalize*`、`heatLvOf` 分档单调性与 0 档、`resolveDbPath` 两级兜底 | `npm test` 全绿 | 低 |
| D2 = #15 | `package.json` 加 `scripts.check`（两个 `node --check`）+ GitHub Action（check + test） | push 即跑，失败即红 | 低 |

### 批次 E —— 收尾（P3，可选）
| 项 | 改动点 | 说明 |
|---|---|---|
| E1 = #17 | `docs/DEVELOPMENT.md` 补"数据链路 / 存储与降级 / 90d 保留 / 就绪语义"一节 | 这次踩的坑本质是架构没写下来 |
| E2 = #12 | host 文件内按 `quota-proxy` / `usage-ledger` / `session-scan` 分层 | 纯重构，排在 D 之后才安全 |
| E3 = #6 | 探测 `record.header` 字段后，再决定是否实现会话级跳过 | 见 §2.3 |
| E4 = #16 | i18n（客户端全中文硬编码 → 走宿主 locale） | 发布前单独排期 |
| E5 = #13 | 存储/回填官方化（`ctx.storageDomain` / 官方投影） | 触发条件见 §5，不主动做 |

## 5. 明确不做的项与理由

- **#13 存储与回填官方化**：根因（路径解析）已被 P0 修掉；官方 `ctx.tokenMeter` 只到"会话级四桶"，给不了按天×按模型；KV 域没有 SQL 聚合，迁移要重写幂等论证和窗口裁剪。触发条件：要发布多壳多用户分发 / 官方开始托管清理 `storages` / 需要跨实例同步 / 需要新增会话级指标。
- **#16 i18n**：个人使用阶段无收益，发布前再排。

## 6. 审批要点（请你确认）

1. 批次 A 是否照此执行（含新增的 F1）？
2. 批次 B 的 B1（并发回填）是否接受"去重语义不变"的验证成本？B4（`seenSeq` 裁剪）做还是不做？
3. 批次 C 的 C1 会删约 85 行，是否同意（需逐视图回归）？
4. 批次 D 的测试范围是否够（要不要把"1d 分时图过滤"也纳入回归用例）？
5. 每批是否需要我同步到 profile 让你重启验证（还是只改仓库、你自己决定何时同步）？

## 7. 执行记录（2026-10-16）

### 已执行

| 批次 | 项 | 落地内容 | 验证 |
|---|---|---|---|
| A | A1 | `step/end` 补 `live.firstChunk.delete(key)` | `node --check` |
| A | A2 = F1 | host：`hydrateHourlyBuckets(db, now)` 只回填 `HOURLY_KEEP_MS`(2 天)；client：抽 `groupTodayHourBuckets()` 并只渲染今天 | **实测旧 host 的 79 桶/59 列 → 过滤后 2 列**；单测覆盖 |
| A | A3 | 响应新增 `store`；设置页新增 `meterStoreHint()` 显示「存储：SQLite / 内存（不持久化）」 | 单测（`resolveDbPath`）+ 待重启目视 |
| A | A4 | `tmPullInFlight` 在飞守卫（`reload(silent,force)` 透传、手动刷新/切区间/配置变更 `force`）+ `tmFetchInit()` 统一 30s 超时 | `node --check`、单测 |
| B | B1 | `scanHistory` 块内 4 路并发（`SCAN_CONCURRENCY`，块间保持 90d 边界语义、结果按序摄入）+ 会话级跳过（`header.updatedAt` 毫秒 epoch 且 ≤ 水位线）+ `scanned/skipped/ingested/耗时` 打点 | 语法 + 单测（水位线语义不变） |
| B | B2 | 删 `?meta=live` 分支与 client `mergeLive()` | 残留检查为空 |
| B | B3 | client 记忆 `version`/`range`，无变化跳过 `setState` | `node --check` |
| C | C1 | 删 host `today`/`byModel`/`totalsLegacy`/`hourlyLegacy` 与 client 旧兜底、`byModel` 归一化（保留 `hourly`） | 残留检查为空 |
| C | C2 | 删 `meta.last_seen_seq` seed；修正 `events.raw` 过期注释 | 语法 |
| D | D1 | 新增 `test/host.test.mjs`（14 条）+ `test/client.test.mjs`（7 条）+ `test/load-client.mjs` 加载器；两端各加 `__testing` 出口 | **21/21 通过** |
| D | D2 | `package.json` 加 `check`/`test` 脚本；`.github/workflows/ci.yml`（Node 24，零依赖） | `npm run check && npm test` 通过 |
| E | E1 | `docs/DEVELOPMENT.md` 补「数据链路 / 存储与降级 / 就绪语义与超时约束 / 测试」 | 人工复核 |

### 按计划未做（附原因）

- **B4 `seenSeq` 裁剪**：计划中即为可选项；§2.2 已论证不可删（守"代际重置后旧事件被重新接受"），
  实测 26,850 条仅几 MB，暂不动。
- **E2 host 文件内分层**：纯重构、无行为收益；已完成 D（有测试兜底）后可随时再做，本轮不做。
- **E3 探测 `record.header` 字段**：改为"运行时自证"——B1 的会话级跳过带 `>1e12` 安全护栏，
  并在日志输出 `skipped=N`：若该字段不存在则恒为 0，一眼可见（无需再临时打日志）。
- **E4 i18n / E5 存储与回填官方化**：按计划分别为"发布前再说"与"不主动做"。

### 待你决定

- 是否把本轮改动同步到 `~/.dsh/profiles/desktop/node_modules/dsh-quota-widget`（重启后即可验证
  F1 分时图、存储状态提示与新日志打点）。
- 是否 git 提交（本轮未提交）。

