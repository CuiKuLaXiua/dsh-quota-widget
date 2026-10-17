# 用量统计 tab：优化方向与功能增强调研（第二轮）

- 生成日期：2026-10-16
- 范围：设置页「用量与额度 → 用量统计」tab（**热力图本体本轮不动**，仅在"点击某日下钻"处做联动）
- 依据：逐块通读 `lib/client.js`(2146 行) / `lib/index.js`(1283 行) + 对本机运行实例（`127.0.0.1:19387`）与
  `~/.dsh/storages/token-meter.db`、`~/.dsh/sessions/**/*.jsonl.zstd` 的只读实测
- 状态：**调研稿，未改任何代码**

## 0. 实测基线（所有结论的证据来源）

| 项目 | 实测值 | 用途 |
|---|---|---|
| token-meter 端点 | `127.0.0.1:19387`，`store=db:C:\Users\sky\.dsh\storages\token-meter.db` | 已落盘，非内存降级 |
| `events` 表 | 15,251 行 / 56 个会话 / 2026-08-14 ~ 10-16 | 数据规模 |
| `daily_usage` | 37 行（`__system` + 真实模型行） | 派生口径 |
| events 汇总 | input 40.87M、output 3.77M、cache_read 833.43M、**cache_write = 0** | 口径与缓存写结论 |
| live 两次采样（间隔 20s，期间有真实对话活动） | `steps 180→184`、`toolCalls 242→256`、`llmMs +9635ms`，而 **`firstTokenCount` 始终 0** | 首 token 指标失效的直接证据 |
| 会话文件 | `<home>/sessions/<cwd 编码目录>/<session-id>/session.jsonl.zstd`，81 个 | 按项目聚合可行性 |
| 会话头字段 | `{type,version,id,createdAt,cwd,delegationDepth,agentPreset}`（实测 `cwd=D:\code\token-lens`） | 新维度来源 |
| `assistant/message.data.usage` | **只有 3 个字段**：`inputTokens` / `outputTokens` / `cacheReadTokens` | 无 cacheWrite |
| 单会话事件类型（18,152 行） | reasoning-chunks 9934、assistant/chunk 3763、tool-call-chunks 1655、text-chunks 860、tool/call 388、tool/result 388、step/start 317、step/end 317、assistant/message 316、turn/start 15、turn/end 15、request/header 9、llm/retry 2、compaction/* 3、command/done 2、session/title 3、approval/* 26、todo/write 2… | 可拓展维度 |
| `tool/call.data.name` 分布 | read 127 / edit 96 / pwsh 72 / grep 66 / job_output 22 / todo_write 2 / glob 1 / write 1 / web_search 1 | 工具排行可得 |
| `message.source.provider` | `opencode-go` / `deepseek-official`（**当前被丢弃**） | 额度归属 |
| `llm/retry.data` | `provider`/`mode`/`retry`/`policyKey`/`failure.code=TRANSPORT` | 失败统计 |
| `command/done.data.text` | `Compacted 572 history items (~420528 tokens)` | 压缩成本 |
| `session/title.data.title` | 可取（实测「你是这么模型」） | 会话可读名 |
| 客户端通信 | 设置页**无轮询**（只在 mount / 切范围 / 切图 / 手动刷新拉取），图表仅 `bar|heat` 两态，范围 `1d|7d|30d|all` | 交互与刷新结论 |

---

## 1. 现有区块的优化方向（除热力图外，逐块）

### A. 总览卡（`client.js:1648-1660`）

| # | 级别 | 问题（实测依据） | 建议 |
|---|---|---|---|
| A1 | 🔴 | **口径歧义**：「输入」= `input + cacheRead`（`index.js:1019/1021`，`client.js:1653`），旁边却并列一个「缓存读」。截图上「输入 611.12M」里约 585.74M（95.8%）其实是缓存读，真实新输入只有约 25.4M——用户极易误判 | 拆成「新输入 / 缓存读 / 输出」三段，上方加一条 100% 堆叠比例条 + 口径 tooltip；或把缓存读内联为「输入（含缓存 95%）」 |
| A2 | 🔴 | **缺最关键 KPI**：缓存命中率只能心算（实测 `cache_read/(input+cache_read)` ≈ 93%~96%，按窗口不同） | 新增「缓存命中率」chip + 迷你趋势，并显示相对新输入省下的量 |
| A3 | 🟡 | **缺步数**：`totals.steps` 宿主已下发（`index.js:1021`）但总览没展示；实时卡的 `live.steps` 语义不同（进程累计） | 总览补「步数」，并明确它与实时卡的差异 |
| A4 | 🟡 | **缺环比**：`prevTotals` 宿主已算并下发（`index.js:1022/1244`），设置页完全没用（仅悬浮窗用） | chip 上加 ↑/↓ 百分比徽标，含「上期无数据」态 |
| A5 | 🟡 | 七项等权平铺，token 量级与"次数"混排，没有主次 | 主指标（总 token / 命中率 / 估算花费）大字，次级小字分两行 |
| A6 | 🟢 | 无交互：chip 是纯 `span`，无 `title`、不可点击 | 让 chip 兼任"图例 + 筛选"：点击高亮图中对应堆叠段 / 过滤模型 |
| A7 | 🟢 | 空态：`meterData` 为空时仍渲染 7 个值为 `—` 的 chip（`client.js:1650`+`1925`） | 换骨架屏或空态文案 |

> 附带命名问题：`请求` 实为 `assistant/message` 条数（`index.js:243-247`），`轮次` 为 `turn/end` 条数；建议 tooltip 写清口径。

### B. 图表卡（`renderTokenMeterChart 1774-1827` / `renderDailyBars 1669-1696` / 分时 `1802-1819`）

| # | 级别 | 问题（行号） | 建议 |
|---|---|---|---|
| B1 | 🔴 | **视觉失真**：`Math.max(8, …)` 让 0 值/极小值也画 8px 柱（`1678`、`1807`），造成"当天有消耗"的假象；88px 高度 + 峰值归一使小柱子差异不可读 | 0 值不画柱（或画 2px 基线）；小值走 sqrt 尺度；或提供"线性/对数"切换 |
| B2 | 🔴 | **无纵轴刻度**：量级只能靠 hover 才知道；切换范围时比例尺随之变化，无法横向比较 | 加 2–3 条刻度线 + 顶部「峰值 xx」标注 |
| B3 | 🟡 | **只有堆叠柱**：无折线/面积/累计曲线，日维度看月趋势很吃力 | 增加折线/面积模式（pill 位置现成：`1917` 目前只有 bar/heat 两态，本来就叫「图表」） |
| B4 | 🟡 | 1d 分时把「按模型」塞进 tooltip 字符串（`1809-1810`），柱段只按 token 类型分 | 提供「按模型堆叠」开关（`hourly[].model` 已有） |
| B5 | 🟡 | **缓存写恒为 0**：宿主 `usage` 根本没有 `cacheWriteTokens`（实测 3 字段），DB `SUM(cache_write)=0` → 分时图第 1 段（`1812`）与图例第 4 项（`1824`）永远不可见 | 有值才渲染段与图例；并在 `DEVELOPMENT.md` 注明该字段当前不可得 |
| B6 | 🟡 | 按日柱的「主力模型」只取 `models[0]`（`1679`），其余丢弃（`daily[].models` 已降序，`index.js:1027`） | tooltip 列出 top2–3，或切换"按模型"堆叠 |
| B7 | 🟢 | 范围只有 1d/7d/30d/all，无显式 90d/自定义（宿主保留 90 天） | 加「近 90 天」与自定义起止日期，localStorage 记忆 |
| B8 | 🟢 | 柱体不可聚焦、无键盘访问；切图/切范围都重新 fetch（`1484-1485`），已拉到的数据不复用 | 补无障碍属性；同 range 内切图不再重复请求 |
| B9 | 🟢 | 「更新于」用的是**客户端本地时间**（`1478`/`1919`），忽略 `payload.updatedAt`（`index.js:1262`） | 显示服务端 `updatedAt` + "x 分钟前"，便于判断新鲜度 |

### C. 模型排行（`modelRank 1829-1850`）

| # | 级别 | 问题 | 建议 |
|---|---|---|---|
| C1 | 🟡 | 只用了 `total`；`models[]` 已带 `requests/input/output/cacheRead`（`index.js:1015`） | 支持按请求数/输出/缓存读排序 |
| C2 | 🟡 | **provider 被丢弃**：只用 `model`（`index.js:697/1015`），实测同名模型跨 provider（opencode-go / deepseek-official）被合并 → 额度与费用归属会错 | 采集 `(provider, model)` 二元组，或在名称/tooltip 标注 provider |
| C3 | 🟡 | top5 + 「其他 N 个」（`1840-1841`）不可展开、不可点选过滤 | 展开看全量；点击过滤图表 |
| C4 | 🟢 | 条宽百分比用 `Math.max(1, …)`（`1843`）→ 极小模型显示成 1%；透明度递减（`1846`）在 5 行后几乎无差别 | 显示真实比例（<1% 显示 `<1%`），名次用序号线 |
| C5 | 🟢 | 无趋势 | 每模型加 7 日 sparkline |

### D. 实时卡（`liveChips 1851-1860` + `index.js:1032`）

| # | 级别 | 问题 | 建议 |
|---|---|---|---|
| D1 | 🔴 | **首 token 指标失效**：20s 采样中 `steps`/`toolCalls`/`llmMs` 都在增长，而 `firstTokenCount` 恒为 0 → 页面上永远显示 `—`。会话文件里 `assistant/chunk` 100% 带 `turn/step`（3763 条，零缺失），故**不是字段缺失**，而是实时链路（`index.js:800-811`）没吃到事件 | 先加一行探测（打印 `Object.keys(event.data)` / 事件计数），确认实时流是否投递 `assistant/chunk`；修好前该 chip 应显示"本次启动无样本"而非 `—` |
| D2 | 🔴 | **"实时"名不副实**：`tokPerSec = live.outputTokens / live.llmMs * 1000`（`index.js:1032`+`719`）是**进程启动以来的累计均值**，不是瞬时速率 | 改标签为「平均生成速率（本次启动）」或改成滑动窗口（近 60s / 近 5 步）并标注窗口 |
| D3 | 🟡 | 无窗口、无重置：`live.*` 全为进程生命周期累计（`index.js:588-601`），切范围时数字不动 | 明确标注"本次启动"，或加时间窗与手动重置 |
| D4 | 🟡 | `llmMs` / `toolMs` 已下发但未用（`index.js:1032`）→ 实测 LLM 1.54M ms vs 工具 0.30M ms ≈ 84% / 16% | 加「LLM / 工具耗时占比」「平均每步耗时（llmMs/steps）」 |
| D5 | 🟡 | 无失败/重试信息：会话流有 `llm/retry`（含 `failure.code=TRANSPORT`） | 显示重试次数与 Top 原因，排查"流中断"时最有用 |

### E. 最近调用（`recordsList 1873-1888` + `index.js:720-721`）

| # | 级别 | 问题 | 建议 |
|---|---|---|---|
| E1 | 🟡 | 只有「输入 → 输出」两列；`records[].cacheRead` 已采集（`index.js:720`）却没显示；无耗时/工具数/状态/provider | 一行四段：时间 · 模型 · 新输入/缓存读/输出 · 耗时；失败/取消用颜色区分 |
| E2 | 🟡 | `sessionId` 被截成 8 位（`index.js:720`）→ 无法定位是哪个会话，而标题与 cwd 都可取（`session/title`、会话头 `cwd`） | 显示会话标题（回退 cwd 末段），支持复制 |
| E3 | 🟡 | 上限 50 条、不可筛选/排序/搜索/导出 | 加「仅失败」「按模型」「搜索」与导出 |
| E4 | 🟢 | 折叠用 `<details>`（`1882`），展开状态不记忆 | 记忆展开状态与筛选条件 |

### F. 顶栏与整页（`usagePanel 1910-1942`）

| # | 级别 | 问题 | 建议 |
|---|---|---|---|
| F1 | 🟡 | **设置页不轮询**（`1476-1485`）：打开面板看到的是快照，「更新于」停在打开那一刻 | 面板可见时 15–30s 低频轮询（复用 `version` 变更判断，B3 已具备），或「实时跟随」开关 |
| F2 | 🟢 | 存储提示只有「SQLite / 内存」（`1899-1909`）；`meta.last_scan_at` 宿主已写（`index.js:299`）却无处读 | 扩成"数据健康"一行：路径 + 库大小 + 事件数 + 最后回填时间 |
| F3 | 🟢 | 错误态只有一行红字（`1776`），无重试按钮、无骨架屏 | 加重试按钮 + 骨架屏 |
| F4 | 🟢 | 「维护」组只有重置配置/重置悬浮窗位置（`1988-1995`），**没有清空用量数据** | 加「清空/重建账本」（`DELETE` + 现成的 `rebuildAllPartitions`，可测） |
| F5 | 🟢 | 无导出/复制入口（confPanel 有 JSON 折叠，图表区没有） | CSV/JSON 导出 + 一键复制摘要 |
| F6 | 🟢 | **状态割裂**：`tmChartState` 与悬浮窗共用 `LS_TM_CHART`，但设置页 `saveTmChart` 不派发事件（对比 `saveTmLayout` 会派发）→ 切换不通知悬浮窗；范围则是两套独立 key（`oq_settings_range` vs `LS_RANGE`） | 统一为"全局视图偏好"，变更时派发事件 |
| F7 | 🟢 | 文案全中文硬编码 | 与上轮 E4 一并留到发布前做 i18n |

---

## 2. 功能增强与拓展（按"数据是否已在手"分三档）

### 第一档：数据已在手，纯前端/小改即可

1. **缓存效率面板**：命中率、缓存读 vs 新输入占比、按模型命中率（数据：`totals`/`models`）。
2. **环比与趋势**：`prevTotals` 已下发 → ↑↓% + 7/30 天迷你折线（`daily` 已有）。
3. **成本估算**：内置可编辑价目表（每 1M tokens 的 input/output/cache_read 三档）× 按模型用量 → ¥/$ 估算；进一步与「账号与余额」联动：额度消耗速率 + 预计耗尽时间（opencode quota 已给 `limit/used/percent`，`index.js:1125`）。
4. **效率指标**：tokens/轮、工具调用/轮、平均步耗时、LLM/工具耗时占比（`live` + `totals.steps` 全有）。
5. **交互下钻**：点模型排行 → 图表过滤该模型；点热力格 → 看那一天的分时（当前只能看今天）；点 chip → 高亮对应堆叠段。
6. **导出与复制**：当前视图导出 CSV/JSON；一键复制「今日摘要」文本。
7. **时间范围**：近 90 天 + 自定义起止（宿主 90d 窗口已支持）。
8. **图表形态**：折线/面积 + 累计曲线；堆叠维在「token 类型 / 模型」间切换。
9. **数据健康行 + 清空入口**（见 F2/F4）。

### 第二档：宿主加采集即可（字段实测可得，改动中等）

10. **工具排行**：`tool/call.data.name`（实测 read/edit/pwsh/grep/job_output…）+ 已有 `callId` 计时能力 → 工具次数/耗时/占比，甚至失败率。目前**完全缺失**，是用户最想知道的一类信息。
11. **按项目/工作区排行**：会话头 `cwd`（实测 `D:\code\token-lens`）+ `agentPreset` + `delegationDepth` → 「哪个项目最费 token」。fs 兜底路径本就在遍历 `<cwd 编码目录>`，两条路都能拿到。
12. **会话维度**：`session/title`（实测可取）→ 「Top 消耗会话」；「最近调用」显示标题，session_id 不再截 8 位。
13. **失败/重试/压缩统计**：`llm/retry`（provider/mode/retry/failure.code）、`compaction/*`、`command/done`("Compacted 572 items (~420528 tokens)") → 「重试 Top 原因」+「上下文压缩次数与被压缩 token 量」——真实成本黑洞，当前 0 覆盖。
14. **按 provider 切分**：`message.source.provider`（opencode-go / deepseek-official）→ 额度归属正确，解决同名模型跨 provider 合并问题。
15. **缓存写与首 token 的"要么修好、要么收口"**：cacheWrite 在宿主 usage 里不存在 → 建议删除这两个 UI 项而不是继续显示永不为真的图例；首 token 修好前不要占着主视觉位。
16. **真实"实时速率"**：修 `assistant/chunk` 链路 + 改滑动窗口，这张卡才名副其实。

### 第三档：需要新持久化/新能力（改动大，建议后置）

17. **按小时 × 按天持久化**（现在 `realtimeHourly` 只保 2 天）→ 支持任意历史日期的分时曲线、「一天中什么时候最费」。
18. **预算与告警**：日/月 token 预算、阈值提醒（面板内徽标，或复用宿主通知）。
19. **价目表维护**：自动同步 / 多币种 / 自定义 provider 计价。
20. 与官方 `ctx.tokenMeter` / 官方投影对齐：上轮 #13/E5 的触发条件仍未满足，**维持不做**。

---

## 3. 建议的落地批次（每批独立可验收、可回滚）

### 批次 1 —— 正确性与口径（P0）
| 项 | 改动点 | 验收 |
|---|---|---|
| 1.1 | 首 token：先探测实时 `assistant/chunk` 是否投递与字段；修好前显示"本次启动无样本" | 活跃对话 1 分钟后 `firstTokenCount > 0`，否则明示不可用 |
| 1.2 | 实时速率改口径与标签（窗口化或改名"平均生成速率·本次启动"） | 标签与数值语义一致 |
| 1.3 | 总览口径：新输入 / 缓存读 / 输出 三段 + 命中率 chip | 三段之和 = 总量；截图口径不再歧义 |
| 1.4 | 缓存写：有值才渲染段与图例 | 图例不再出现永不显示的项 |
| 1.5 | 图表：0 值不画 8px 假柱；加峰值标注/刻度 | 空日不显示柱；量级可读 |

### 批次 2 —— 信息密度与交互（P1）
| 项 | 改动点 | 验收 |
|---|---|---|
| 2.1 | 总览环比（`prevTotals`） | 1d/7d/30d 显示 ↑↓，all 隐藏 |
| 2.2 | 模型排行：排序维度 + provider 标注 + 点击过滤图表 | 5 个视图结果与改前一致 |
| 2.3 | 最近调用：cacheRead/耗时/会话标题 + 复制 | 单条信息完整 |
| 2.4 | 面板可见时低频轮询 + 相对时间 | 面板停留 1 分钟后数字自动更新 |
| 2.5 | 数据健康行 + 清空账本入口 | 清空后视图归零、DB 重建 |

### 批次 3 —— 新增维度（P2）
| 项 | 改动点 | 验收 |
|---|---|---|
| 3.1 | 工具排行（`tool/call.name` + 耗时） | 工具分布与实测 read/edit/pwsh 排序一致 |
| 3.2 | 按项目(cwd) / 会话排行 | 项目名可读，跨会话合并正确 |
| 3.3 | 重试 / 压缩统计 | 与 `llm/retry`、`compaction/*` 计数一致 |
| 3.4 | 按 provider 切分 + 成本估算 | 同名模型跨 provider 不再合并 |

### 批次 4 —— 工程化与体验收尾（P2/P3）
- 4.1 90d/自定义区间 + 折线/面积 + 按模型堆叠
- 4.2 导出 CSV/JSON + 复制摘要
- 4.3 视图偏好统一（设置页与悬浮窗共用 chart/range 并派发事件）
- 4.4 单测补齐：新增聚合（工具/项目/provider）纯函数、口径函数（`cacheHitRate`）、窗口边界回归

---

## 4. 明确不做 / 需先取证

- **不建议**在取证前改动 `assistant/chunk` 之外的实时逻辑（避免重演上轮"修出新 bug"，见 `plan-usage-optimization.md` §2.1）。
- `daily_usage` 的 `tools/turns/steps` 只落在 `model='__system'` 行（实测：`u2-flash` 行全为 0，`__system` 行 541/18/396）→ 若要「按模型的工具数/步数」，必须改聚合口径并重建分区（`rebuildAllPartitions` 已具备）。
- `cacheWriteTokens` 在宿主 usage 中不存在 → 不建议继续在 UI 暴露「缓存写」。
- 金额类展示依赖价目表；若不维护价目表，只做 token 相对量。
- 热力图本体本轮不动（配色/分档/富 tooltip 已于上轮完成）。

## 5. 需要你确认

1. 先做**批次 1（口径与正确性）**，还是先做你更想要的新维度（工具排行 / 项目排行）？
2. 「实时」卡的定位：本次启动累计，还是最近窗口（近 60s / 近 5 步）？要不要重置按钮？
3. 成本估算要不要（价目表：内置默认 + 可编辑）？
4. 是否接受新增采集带来的内存增长（按工具/项目/会话聚合需新增 3 个 Map，量级与现有 `perModel` 同阶）？
5. 是否需要我把某批次同步到 profile 目录供你重启验证（本轮未做任何代码改动、未提交 git）。
