# Changelog

## [Unreleased]

### Fixed
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

### Changed
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
