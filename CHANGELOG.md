# Changelog

## [Unreleased]

### 用量统计外观：五模块 A/B/C 可切换（2026-10-17，详见 `docs/design-usage-ui.md`）

#### Added
- **每个模块三套风格，用户自选**，入口在「数据源与通用 → 用量统计外观」：
  总览（仪表盘/三色卡/一行）、图表（坐标系/摘要/极简）、排行（颁奖台/表格/列表）、
  实时（仪表/趋势/状态条）、最近调用（时间线/表格/Token 条）。
- 三个预设一键切全部：**专业监控**（A/A/B/B/B）、**轻卡片**（A/A/C/B/A）、**极简**（C/C/C/C/C）；
  自定义时显示「自定义」。
- 外观选择存 `localStorage["oq_usage_style"]`（不写插件配置、不影响悬浮窗），
  默认 `{overview:A, chart:A, rank:C, live:B, rec:A}`。
- 新增 CSS 层（约 90 条 `.oq-*` 规则）承载三种结构，全部走 `--dsw-alias-*` 主题变量，深浅色都适配。
- 实时 B 的 sparkline 使用前端环形缓冲（每次刷新追加 `rate60`，最多 20 点）。

#### Changed
- 排行的取数抽成 `rankItems()` + 三种渲染器，模型来源兼容「顶层 models」与「stats.models」。
- 图表的 1d 分时图也跟随风格：C 不画网格与峰值标注。
- `data-source` 维护组里重复的 `desc` 键合并为一条。

#### Fixed
- 重构时误删的 `renderMonthHeat`（热力图/月切换/点选下钻）已恢复，并补了点击回归测试。

### 用量统计 v3 改造（2026-10-17，schema v5，详见 `docs/plan-usage-v3.md`）

#### Added
- **会话排行**：新增 `daily_session` 派生表 + `session/title` 标题，payload 增加 `sessions[]`。
  实测 62 个会话里 Top8 占 70% 的 token，长尾极短。
- **时段热力图**（7 行 × 24 列）：新增 `daily_hour` 派生表（本地小时），payload 增加 `hours[]`；
  图表手册新增「时段」形态，并标注峰值时段（实测周五 17:00）。
- **可靠性落库**：`events.err` / `events.num` + `daily_reliability` / `daily_retry`，
  重试/压缩/被压缩 token/失败轮次/工具失败改为**区间口径**，重启不再归零。
- **热力图月份切换**：‹ › 回看近 3 个月（保留 90 天），点击某天展开当日明细条（含模型 Top3）。
- **折线图叠加曲线**：缓存命中率（黄虚线）+ 上期同长窗口（灰虚线，payload 新增 `prevDaily`）。
- **总览日均 chip** 与三段比例条的段内百分比标注。
- 渲染冒烟测试扩到 6 条（五个排行维度 + 四种图表形态），宿主单测覆盖新维度与重建幂等。

#### Fixed
- **环比失真**：`↑737%` 这类数字来自"绝对量环比 + 上期窗口覆盖不足"（本机数据 12 天，
  上期 30 天里只有 3 天有数据）。改为**日均比较**，且上期有效天数 < 窗口一半时
  显示「上期覆盖 x/N 天」而不是百分比。
- **首 token 恒「无样本」**：实时事件流不投递任何 chunk 类事件（`signalCount` 实测为 `{}`）。
  主指标改为「每步耗时 P50/P90」（`records[].durationMs`），首 token 降级到 tooltip。
- **清空账本后内存不归零**：`resetUsage()` 漏清 v5 的四个 Map（会话/时段/可靠性/重试），
  界面要等重启才归零。
- 复制失败仍提示成功（最近调用/诊断/摘要三处改为按 `copyText()` 返回值提示）。

#### Changed
- **排行卡合并**为「模型 | 会话 | 工具 | 项目 | 渠道」分段切换（此前 5 张卡纵向堆叠），
  选择记忆在 `oq_rank_tab`；设置页总高度明显下降。
- 热力图/时段图的数据源改为 **90 天**（否则无法回看前两个月）；范围 pills 在这两个模式下
  显示为「近 90 天（图表固定）」而不是整排消失。
- 「热力图固定取近 30 天」提示从**总览**卡标题移到图表卡；总览卡标题显示实际区间。
- 数据健康行重做：状态点 + 紧凑指标 + 「诊断」按钮（原来是一行 11px 灰字，几乎看不见）。
- 工具栏 `⇩/⧉` 改为「导出」「复制」文字按钮；「请求」改名「回复」并注明口径。

### 用量统计 v2 改造（2026-10-16，详见 `docs/plan-usage-v2.md`）

#### Added
- **三个新维度：工具 / 项目 / 渠道**（schema v4）。`events` 增补 `project` / `tool` / `ms` /
  `provider` 四列（`ALTER TABLE` 幂等升级），新增派生表 `daily_tool`、`daily_project`，
  并新增 `tools[]` / `projects[]` / `providers[]` 三个 payload 字段。设置页对应新增
  「工具排行」（按次数/耗时切换）、「项目排行」（按会话 cwd 归集）、「按渠道」三张卡。
  实测回填本机 90 天数据后：`read 2368 / pwsh 2003 / edit 1202 / grep 899`，
  项目 Top 为 `zenith / harmonycast / dsh-smart-commit / token-lens / ems资源包`。
- **缓存命中率与口径拆分**：`totals` 新增 `freshInput` / `cacheHitRate`，总览卡把
  「输入」拆成「新输入 / 缓存读 / 输出」三段并给出 100% 堆叠比例条（旧 `prompt` 口径保留，
  悬浮窗不受影响）。实测命中率 96.3%，旧 UI 上"输入 611M"里 95.8% 其实是缓存读。
- **环比**：设置页开始消费宿主一直在下发、却从没被用过的 `prevTotals`，总量/新输入/输出/请求
  都带 ↑↓ 百分比徽标。
- **折线/面积图 + 近 90 天区间**：图表形态从「柱状/热力」扩到「柱状/折线/热力」，
  区间白名单新增 `90d`（与 90 天保留窗口对齐）。
- **图表模型筛选**：点击模型排行某一行，柱状图/折线图/今日分时都只看该模型（再点取消）。
- **数据健康一行 + 清空用量账本**：设置页显示 库大小 / 账本行数 / 跨度 / 最后回填时间
  （点击复制诊断），维护组新增 `POST /api/token-meter/reset`（二次确认）——清空后写
  `meta.reset_at`，此后回填会跳过该时刻之前的历史，一次重启不会把刚清掉的数据灌回来。
- **导出与复制**：当前视图一键导出 CSV；一键复制摘要；「最近调用」点击某行即复制该条。
- **可靠性统计**：`llm/retry`（含 `failure.code`）、`compaction/end`、失败轮次、工具失败计数
  进入 payload 的 `reliability`，设置页在实时卡下方展示。
- **设置页渲染冒烟测试**（`test/settings-render.test.mjs`）：用最小 hook 运行时 + jsx 桩直接
  调用组件函数，喂真实形状的 payload，覆盖 有数据 / 三种图表形态 / 旧 host 缺字段 / 拉取失败。

#### Fixed
- **首 token 恒显示 `—`**：`assistant/chunk` 在会话文件里 100% 带 `turn/step`，但实时事件流
  并不保证投递它——实测活跃对话下 `firstTokenCount` 恒为 0 而 `steps`/`llmMs` 正常增长。
  现在对 4 类流式事件（`assistant/chunk` / `text-chunks` / `reasoning-chunks` /
  `tool-call-chunks`）广匹配，并把按事件名的分类计数 `live.signalCount` 下发：无样本时明确
  显示"无样本"并在 tooltip 里列出各事件名计数，便于一眼定位。
- **「实时」卡的速率名不副实**：`tokPerSec` 是进程启动至今、且只算 LLM 忙碌时间的累计均值，
  却被当成瞬时速率显示。新增 `live.rate60`（近 60s 输出 token ÷ 墙钟秒数）作为主指标，
  累计均值降为 tooltip。
- **图表 0 值画假柱**：`Math.max(8, …)` 让空白日也显示一根 8px 柱，看起来"有消耗"；
  改为 0 值只留 2px 基线且不配色，并补峰值标注与参考线。
- **缓存写永远为空段**：宿主 `usage` 只有 `inputTokens/outputTokens/cacheReadTokens`
  三个字段（实测 `cacheWrite` 恒 0），图例里那一段永远不会出现；改为有值才渲染。
- **「最近调用」重启后混入 `__system` 行**：hydrate 的查询没过滤 `type`，重启后列表里会出现
  一堆 "`__system` · 0 → 0"；现在只取 `assistant/message`。
- **「更新于」用的是客户端时间**：改为服务端 `updatedAt` 并显示「x 分钟前」。

#### Changed
- 「最近调用」补齐 缓存读 / 耗时 / 项目 三列（`records` 新增 `durationMs`，来自
  `step/start`→`assistant/message`），`sessionId` 从 8 位改 12 位。
- **范围偏好统一**：设置页与悬浮窗共用 `LS_RANGE` 并广播 `opencode:range-changed`
  （此前设置页另存 `oq_settings_range`，两个界面会显示不同时间段）。
- **图表形态偏好分离**：悬浮窗迷你图只有 柱状/热力 两态，设置页多一个"折线"，继续共用
  `LS_TM_CHART` 会让"设置页选折线 → 悬浮窗按非 heat 即 bar 渲染"来回打架，
  因此设置页改用 `oq_settings_chart`（首次使用沿用旧的共享值）。
- 设置页新增 20s 低频轮询（`version` 未变则跳过 `setState`）：此前只在挂载/切区间/切图时拉，
  打开面板看到的是"打开那一刻"的快照。
- `docs/DEVELOPMENT.md` 补「v4 用量维度」「实时指标的口径与自证」「视图偏好」三节。

### 上一轮（用量优化执行计划，详见 `docs/plan-usage-optimization.md`）

#### Fixed
- **1d"今日分时"混入历史天**（用户可见）：host 的 `realtimeHourly` 由 hydrate 无条件聚合 90 天小时桶
  （实测 77 桶跨 11 天），客户端 1d 分支又没按今天过滤 —— 分时图会画出 59 列跨 11 天、纵轴按全量
  峰值归一，今天的柱子被压得几乎看不见。现在 host 只回填 `HOURLY_KEEP_MS`（2 天）窗口，客户端
  再用 `groupTodayHourBuckets()` 按本地日过滤，两侧都收口。
- **`live.firstChunk` 内存泄漏**：key 为 `session:turn:step`，此前只写不删，长时间运行 + 每次启动
  全量回填都会持续增长；现在在 `step/end` 一并清理。
- 存储降级不再静默：`/api/token-meter` 新增 `store` 字段（`db:<路径>` / `memory`），设置页"用量统计"
  面板显示一行「存储：SQLite / 内存（不持久化）」，避免"启动慢/数据不对"再次无从定位。

- 桌面版持久化从未生效：`resolveDbPath()` 只认 `process.env.DSH_HOME`，而官方桌面版不设该环境变量
  （host 内部按 `DSH_HOME || ~/.dsh` 解析），于是插件静默降级成纯内存——每次启动全量重扫会话、
  首屏还只有半截聚合。现在改为 env 优先 + 宿主 loader 提供的 `dshHomePath` 服务兜底
  （`ctx.get("dshHomePath")("storages")`），两级都不可用才 warn 并降级内存模式。
- 启动首屏用量偏小、十几秒后才"自己变对"：`/api/token-meter` 的就绪等待写成了
  `!usage.ready && usage.perDay.size===0`，第一个会话一摄入 `perDay` 就非空，回填还在跑就把
  "半截聚合"当结果返回。现在改成回填未结束就等它（`scanHistoryOnce` 的 in-flight 门把并发请求
  收敛到同一次扫描），并加 `READY_WAIT_MS = 20s` 上限，避免 sessionQuery 卡住时把数据接口一起拖死。

#### Changed
- 启动/常驻性能：`scanHistory` 的 `readSession` 由串行改为 **4 路并发**（`SCAN_CONCURRENCY`，块间仍保持
  `createdAt` 降序的 90 天边界语义，结果按原顺序摄入以保证去重与水位线推进的确定性）；并新增
  **会话级跳过**——会话最后一次活动时间（`header.updatedAt`，仅接受毫秒级 epoch）≤ 已记录水位线时
  直接跳过 `readSession`，这是"启动后增量 catch-up / 反复重扫"的主要开销来源；日志新增
  `scanned/skipped/ingested/耗时` 打点便于验证。
- 删除冗余的 `?meta=live` 轻量链路（host 分支 + client `mergeLive()`）：其存在理由是"Rust 快路径不携带
  live"，随 Zenith 剥离已失效；全量 payload 本就含 `live`，删掉后每个轮询周期少一次 HTTP + 一次
  `computeUsage`。
- 客户端按 `version` 跳过无变化的重渲染：payload 的 `updatedAt` 是 host 每次现取 `Date.now()`，
  不能用于判"数据没变"；改用 `usage.version`（事件级自增）比较后再 `setState`，流式期间 5s 一次的
  轮询不再把热力图/柱状图/donut 整棵树重渲染。
- 客户端轮询新增在飞守卫与统一超时：上一发未回时跳过本次**轮询**（手动刷新/切区间/配置变更带
  `force` 放行），并把 token-meter 请求超时统一为 30s（必须大于 host 的 `READY_WAIT_MS` 20s，
  否则会把携带完整口径的响应掐掉）。
- 删除 legacy 兼容层（约 85 行）：host 的 `today` / `byModel` / `totalsLegacy` / `hourlyLegacy`
  与 client 对应的兜底分支、`byModel` 归一化。依据：`byModel` 无任何渲染消费者；`today`/`totals`
  仅在 `stats` 缺失时兜底而 host 恒发 `stats`；`hourly` 保留（1d 分时图唯一数据源）。
- 清理死字段与过期注释：删掉只 seed 从不读写的 `meta.last_seen_seq`；`events.raw` 恒为 NULL，
  列保留但注释不再声称"raw 全量账本"（删列需表重建迁移，收益极低）。
- 工程化：新增 `test/` 单测（21 条，覆盖日历窗口边界/水位线代际重置/home 两级解析/小时桶窗口/
  热力分档/1d 今天过滤/三家额度归一化）、`npm run check` + `npm test` 脚本与 GitHub Actions CI；
  host 与 client 各增加一个只暴露纯函数的 `__testing` 出口。
- `docs/DEVELOPMENT.md` 补齐"数据链路 / 存储与降级（含 home 两级解析与静默降级坑）/
  就绪语义与客户端超时的约束关系 / 测试"章节。
- 修正安装文档：README 的 Web 安装命令原为 `add dsh-quota-widget`（依赖 npm registry，
  而本包未发布，实测 404），改为 `add github:CuiKuLaXiua/dsh-quota-widget`；补"git 源默认取 main
  最新提交、可用 `#tag` 固定"与"无构建步骤、无需 allowBuilds"说明；`docs/PUBLISHING.md` 补
  两种分发形态对照（GitHub 源 vs npm 源）与发版顺序（改 version → 打 tag → push）。
  另修正 README 中设置入口文案为「用量与额度」。
- 热力色阶配色调整（只换色，未动质感与尺寸）：6 档由蓝紫系改到品牌紫（`#8b7bff`）一族——
  暗色 `#c8c6ee → #a9a4e6 → #8b83dd → #7066cf → #5749ba → #443699`，浅色
  `#d9d4f0 → #c1b8e6 → #a699d8 → #8a79c6 → #7059b0 → #574194`，按感知均匀取值，
  相邻档更易分辨；"少=浅、多=深"的方向与界面说明保持一致。
- 设置入口更名：`settings.section` 导航文案由「额度查询」改为「用量与额度」（与「账号与余额」
  并列，覆盖 Token 用量统计 + Opencode / DeepSeek / R4Coder 额度）；`locale/*.json` 的
  `meta.title` 同步为「用量与额度小窗 / Quota & Usage Widget」。
- 设置入口图标不再沿用宿主的兜底齿轮：宿主 `ui-settings-general` 的 `navIcon(id)` 只认
  account / models / agent-presets / plugins / archived-sessions，未知 id 一律给齿轮，而
  `settings.section` 的注册项只有 id/order/label（无 icon 字段），插件无法声明自己的图标。
  现在按导航行文案精确匹配后只加一个标记属性（不替换、不改写 React 拥有的节点），再由
  CSS 隐藏齿轮、用 mask 自绘"半圆仪表盘"字形（与 `icon.svg` 的环+指针同族）。
- 悬浮窗贴边留白统一为 6px（`EDGE_GAP`）：拖拽硬边界、松手贴边吸附、初始停靠位置三处
  共用同一数值。旧实现吸附写 12px（左侧还会去对齐 DSH 侧栏会话列表 `.qDHVXG_list` 的
  左边缘，而侧栏自身有 12px 内边距），贴边后离窗口边缘偏大，且松手瞬间会从 6px 硬边界
  "弹"到 12px。底部初始停靠仍为 80px（让出底部输入区）。
- 修正热力图配色方向：旧实现"用量越多颜色越浅"（暗色主题最高档 `#82a1ea` 泛白），
  与设置页说明"颜色越深代表当天 Token 消耗越多"相反，看起来用量最多的一天反而最淡。
  现统一为"用量越多颜色越深"——暗色主题为 灰蓝浅色 → 饱和深蓝紫，浅色主题为 淡紫 → 深紫，
  且最高档与"无数据"底色（`--bmon-h0`）保持明显差异。
- 热力图档位由 4 档扩展为 6 档（`--bmon-h1`~`--bmon-h6`，含"无数据"档共 7 个色块），
  分档阈值等比细分；悬停提示的档位色点与设置页图例同步扩展。
- 两处热力图（悬浮小窗 / 设置页）的分档逻辑抽为共用的 `heatLvOf()` + `HEAT_LV`，
  避免同一阈值各写一份后跑偏。

## [0.1.0] - 2026-08

### Added
- 初始公开版本：从 Zenith 内置插件提取为独立 DSH 标准插件 `dsh-quota-widget`
- 支持 Opencode / DeepSeek / R4Coder 额度查询
- 支持 TokenMeter 用量统计与持久化（`$DSH_HOME/storages/token-meter.db`）
- 可拖拽悬浮小窗、迷你态/收起态、明暗主题适配
- 标准 bundle 安装：`dsh plugin --profile web add dsh-quota-widget`
