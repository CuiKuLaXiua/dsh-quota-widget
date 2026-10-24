# Changelog

## [Unreleased]

### 补录「磁盘上有、账本里没有」的会话

- **问题**：本机实测有 **27 个会话全在 90 天窗口内（最近 62 天）却完全不在账本里**——
  517 条回复、约 6,675 万 tokens 的用量从未被统计过（另外 3 个是只有配置元数据的空会话，
  正确跳过）。这些是清空账本、或某段时期回填没跑到时留下的空洞。
- **新增设置页「数据源与通用 → 补录缺失会话」**，与「补齐历史维度」并列但**语义完全不同**：
  - 补齐历史维度：只改已有行的列，**不动总量**；
  - 补录缺失会话：**会新增行、会让总量变大**，所以强制两步——先「统计待补录」看数字，
    再手输「补录」确认执行。
- **预览显示**：将新增几个会话、多少条回复、多少 tokens、占现有总量百分比、
  以及 `现总量 → 补录后总量` 的前后对照；可展开逐会话明细（项目 / 回复数 / tokens / 时间）。
- **幂等**：按 `session_id` 判重，已入库的整条跳过，重复执行 `sessions=0`。
- **代次闸门同样适用**：补录途中若清空账本，立即中止剩余会话。
- ⚠️ **预估口径踩过的坑**：最初预览只算 `inputTokens + outputTokens`，而
  `computeUsage` 的 `totals.total` 是 `(input + cacheRead) + output`。agent 场景下
  cacheRead 才是大头，于是预览说 **+15.9M**、执行后实际 **+66.7M**（差 4 倍），
  预估彻底失效。现在两处口径统一，实测预览 `266,084,217` = 实际 `266,084,217`（差 0），
  并补了断言锁死；把 cacheRead 去掉会让该测试立即变红（已验证）。

### 补齐历史维度（project 列为空）

- **「项目排行」里的 `—` 桶可以补上了**：有一段时间实时路径只读 `session.cwd`，而 DSH 把
  cwd 放在 `session.header.cwd`，那批行落库时 project 全是 NULL（本机实测 **1,124 行**
  落进 `—` 桶）。新增 `repairProjects()` 与设置页「数据源与通用 → 补齐历史维度」卡片，
  按需触发一次即可把它们归到真实项目。
- **只用 `UPDATE`，绝不新增行**：这是本次最重要的一条约束。最初的实现直接复用
  `enrichDimensions` 的 fs 扫描路径，结果 events **从 3,186 行涨到 6,972 行**——
  因为 `scanFilesystemFallback` 除了收集维度还会正常 `ingestEvent`，把磁盘上从未入库的
  会话顺带灌了进来。补项目不该改变总用量，所以现在只按 session_id 回填已有的行：
  实测行数 3,186 → 3,186、总量 186,616,699 → 186,616,699，`project=NULL` 1,124 → 0。
- **cwd 三级来源**：`sessionQuery.readSession().session.cwd`（权威）→ 会话文件头的
  `cwd`（需要解压 zstd，只在上一级拿不到时用）→ 目录名反解（`--D-code-foo--`）。
  三级都拿不到的行保持 `—`，界面会如实显示"仍缺 N 行"。
- **幂等**：第二次执行 `updated=0`，不会重复写入（已补的行不再是 NULL，天然被排除）。
- 走 POST + 一次性 nonce（它要重读会话元数据，是需要授权的重活），失败如实报错。

### 回填代次闸门（补齐 A4）

- **清空账本能打断"正在进行中"的回填**：此前只有写入端（`flushDb`）有代次闸门，
  读取端没有——用户在一次 `scanHistory` 跑到一半时点清空，本轮剩余会话仍会带着旧的
  `cut` 继续摄入。现在 `scanHistory` 在每个块边界、每次 `readSession` 返回后都比一次
  `__ledgerGen`，不一致立即中止；`scanFilesystemFallback` 也接受 `genAtStart`，
  每读一个文件比一次。
- 这条闸门真的有用：临时把两处 `genStale()` 判断关掉后，新增的回归测试立刻变红
  （清空后剩余会话被写回，库里非 0 行），恢复后转绿。

### 清空用量账本：从"一个按钮"重做为可判断、可回退、可限范围的操作

#### Fixed（这条链路上原本有 4 个真实缺陷，其中 2 个是"说了假话"级别）
- **清空后的数据会「回魂」**：`resetUsage()` 清了 9 个内存容器，唯独没清
  `__eventsQueue`——而 `flushDb()` 的 50ms 防抖定时器与 `beforeExit`/`exit` 钩子都还在。
  实测：清空瞬间 `events = 0`，**300ms 后变回 1**，且永久残留（`reset_at` 只拦回填，
  不拦写入——实测清空后仍能写入 10 天前的事件，`computeUsage("all")` 立刻返回 5500）。
  现在清空时倒空队列并递增 `__ledgerGen`，`flushDb` 入口记代次、拿到写锁后再比一次，
  不一致整批作废（定时器到点、退出钩子再 flush 都写不回去）。
- **库不可用时界面报「已清空（0 行）」**：旧实现 `catch` 里只 `logger.warn`，
  仍 `return cleared`（= 0）→ 端点回 `200 {ok:true}`。用户以为清了，重启后数据全回来。
  现在 `clearUsageLedger()` 返回结构化结果，DB 句柄丢失（且 `__dbPath` 存在）→
  `ok:false, error:"store-unavailable"`，端点回 500，界面显示失败原因。
  纯内存模式（`__dbPath` 为空）单独区分：如实 `ok:true` 但标 `persistent:false`。
- **清空不回收磁盘**：`DELETE` 只把页放进空闲表，文件不缩小（实测 82 页 → `VACUUM` 后 2 页）。
  真实库清空后页数 90 → 25、文件 0.35 → 0.10 MB。现在清空后 `VACUUM` +
  `wal_checkpoint(TRUNCATE)`，失败则降级为只 checkpoint 并如实回报 `vacuum.ok:false`。
- **同一秒内连续两次清空，第二次被整个阻断**（我在端到端时才发现）：快照文件名只到秒，
  `VACUUM INTO` 遇到同名文件报 `output file already exists`，被 `strictBackup`
  当成备份失败 → 整次清空拒绝执行。现在同名就顺延 `-2`/`-3`…，并补了回归测试。

#### Added
- **清空前自动快照**：`VACUUM INTO <storages>/token-meter-backups/token-meter-<时间戳>.db`
  （SQLite 官方的在线一致性快照，不需要停写），旁边写一份 `.json` 旁注记录范围/行数/时刻。
  只保留最近 10 份。快照是**完整可打开的库**（实测清空后从快照仍读到 2840 行）。
- **按范围清空**（`scope` 参数）：
  - `all` —— 全清，`reset_at` = 现在；
  - `before` —— 只清 `time < cut` 的部分（保留最近 N 天），`reset_at` 推到 `cut`；
  - `project` —— 只清某个项目，**不移动 `reset_at`**，改用 `meta.suppress_projects` 墓碑。
- **项目墓碑**：按项目清空若只删行，下一次重启的会话文件回填会把历史原样灌回来
  （文件还在）。墓碑按"项目 + 清空时刻"生效：该项目**清空之前**的事件不再摄入，
  清空之后的新活动照常记账（两条都有断言）。
- **清空预览**：`GET /api/token-meter/reset-preview` 返回将删行数 / 剩余行数 /
  全库日期跨度 / 库文件大小 / 项目候选。设置页「统计」按钮把数字显示在确认区
  （`将删除 2,840 行 · 剩余 0 行 · 2026-08-23 → 2026-10-24`）。
- **快照列表**：`GET /api/token-meter/backups` + 设置页「账本快照」卡片，
  显示文件名 / 大小 / 时间 / 范围 / 删除行数 / 目录。
- **一次性 nonce**：破坏性端点先 `POST /api/token-meter/reset-token` 取令牌
  （60s 有效、用后即焚），再带着它调 `/reset`。`localGuard` 在缺 `Sec-Fetch-Site`
  时是放行的，此前本机任意进程一个空 POST 就能清库。

#### Changed
- **「清空用量账本」从「维护」组独立成卡**：与「重置配置」「重置悬浮窗位置」混排时，
  三者同一行、同一个 3 秒确认窗——后果量级完全不匹配，一次误点就可能删掉整本记录。
  现在它独占一张卡（红色描边 + 「不可逆」徽标），且**必须手输「清空」二字**才解锁确认按钮；
  范围内没有可删记录时直接拦住，不再弹"已清空 0 行"这种无意义成功。
- 界面文案明确"只删本插件自己的统计，会话文件本身不受影响"与"历史下限"语义。
- 测试：host 46 → **56**（回魂、假成功、按项目+墓碑、按时间+reset_at、预览、
  参数校验、VACUUM 回收、nonce 一次性、快照可读、快照文件名撞车），
  settings-render 11 → **17**（独立成卡、预览数字、禁用态、成功带备份/回收信息、
  host 报错不得显示成功、快照列表）。client 13 不变。
  当前全绿：**host 56/56、client 13/13、settings-render 17/17**。
  （补 A4 与 project 修复后又加到 host 62 / settings-render 19，见上面两节。）

### 口径与稳定性修复（2026-10-24，一轮全面分析后的收口）

#### Fixed
- **内存泄漏：四个容器在长期运行的桌面进程里只增不减**（同时修了我在上一轮引入的两个缺陷）：
  - `seenSeq`：每个摄入过的事件一条 `sid:seq`，此前只在用户点"清空账本"时清空。
    实测注入 10 万事件 = 10 万条，无上限；
  - `live.stepStart` / `live.toolStart`：靠 `step/end`、`tool/result` 配对删除，
    但**中断的步骤/工具调用永远等不到配对事件**（用户切走、点停止、进程崩溃），
    实测 5000 个未配对 `step/start` 会让容器停在 5000 条；
  - `usage.perDay` / `perHourDay` / `perSessionDay` 等维度容器：DB 侧 `pruneExpired` 只留 90 天，
    内存侧却从不裁剪，实测 200 天历史会全部留在内存里。
    新增 `pruneMemoryState()`：按 90 天保留窗口裁掉过期会话的水位线 / `seenSeq` /
    未配对的 step、tool 起始记录 / 各维度中窗口外的天。**已验证窗口内读数一字不变**
    （1d/7d/30d/90d 完全相同，只有 `all` 缩小到 90 天，与 DB 保留口径对齐）。
    调用点：`flushDb` 之后 + 10 分钟一次的 `unref()` 定时器（内存模式与长期无事件时也能跑）。
- **`live.*` 口径判定从"比较事件时间"改为"调用方显式声明"**（修我上一轮引入的误判）：
  上一轮用 `time < LIVE_SINCE` 区分回填与实时，但回填是**启动后 1.2s 才异步跑**的，
  这期间用户真实发出的消息时间戳同样早于启动时刻 → 被误判为历史、实时计数漏计；
  系统时钟回拨也会整段误判。现在回填路径（`scanHistory` / fs 兜底 / `enrichDimensions` /
  `backfillExtra`）显式传 `{ live: false }`，实时事件流不传，语义明确且不受时钟影响。
- **热更新后全局钩子仍指向旧闭包**（修我上一轮引入的泄漏）：`window.__oqHeatReset` 原先只在
  第一次 `apply()` 时赋值，插件热更新（DSH 客户端支持，实测改完即可生效）后它仍调用**旧实例**
  的 `heatTipHide`/`flushPendingHeat`，既操作已卸载的 DOM 节点，又拖住旧闭包不让回收。
  现在每次 `apply` 都重新赋值（监听器仍只装一次，实测连跑 3 次 apply 时
  scroll/visibilitychange/pagehide 各只有 1 个监听器，而钩子已指向最新实例）。
- **悬浮窗的图表切换按钮会触发两遍渲染**：`saveTmChart()` 已广播 `tm-chart-changed` 且本组件
  已监听，按钮里额外的 `tick++` 是重复的，去掉。（该按钮随后整体删除，见下条。）

#### Changed
- 测试：host 41 → 44 条（新增内存裁剪、维度裁剪不改窗口读数、实时事件不被时钟误杀），
  client 13 / settings-render 11 不变。当前全绿：**host 44/44、client 13/13、settings-render 11/11**。
  （后续「清空用量账本」改造又加到 host 56 / settings-render 17，见上节。）

- **悬浮窗的热力图模式无法进入**（用户可见，反馈自实机）：两轮之前把"范围"与"图表形态"两个
  localStorage key 拆开（`opencode_quota_tm_chart` 给悬浮窗、`oq_settings_chart` 给设置页）时，
  只保留了悬浮窗侧的**读取**函数 `loadTmChart()`，`saveTmChart()` 从此没有任何调用点，
  成了死代码——悬浮窗永远停在默认 `bar`，热力图在设置页能选、在悬浮窗里不可达。
  入口补在**设置页**的「数据源与通用 → 小窗口」组：一张「小窗口图表」卡片（柱状 / 热力图），
  与「面板材质」「自动刷新」并列，复用 `saveTmChart()` 并广播 `opencode:tm-chart-changed`，
  悬浮窗监听该事件即时重渲染（跨标签页另由 `storage` 事件兜底）。
  热力图所需 30 天数据本来就由 `pullMeter(..., withChart=true)` 一直携带，无需额外请求。
  补了 3 条单测锁住"读写闭环"、"两个 key 互不干扰"与"设置页卡片写入的是悬浮窗的 key"，
  防止再次退化成单侧死代码。
- **悬浮窗上不该出现配置按钮**（用户纠正，实机反馈）：上一轮为了让热力图能被发现，
  在悬浮窗「范围」pills 右侧加了个 `柱 / 热` 切换按钮——这是设计错误。悬浮窗是**功能展示区**，
  设置、配置类操作统一收敛在设置页，两者不混。该按钮（及 `oq-chart-toggle` 样式钩子、
  随形态变化的 tooltip 文案）整段删除，`renderTmCompact` 现在只读 `loadTmChart()`。
  测试同步：`client.test.mjs` 的读写在注释里标明"写入入口只在设置页，不要在这里加回按钮"，
  断言仍走 `saveTmChart()` 而非 UI 点击，因此删按钮不影响用例；设置页卡片的渲染冒烟
  （settings-render 11/11）保持不变。
- **1d 分时图丢掉本地 00:00–07:59 共 8 小时**（用户可见）：Host 用 `toISOString()` 打 **UTC** 小时键，
  客户端却按**本地日**过滤（`hour.slice(0,10) !== localDay`），UTC+8 下凌晨的桶日期段落到前一天，
  被整段丢弃（构造全天 24 小时实测只剩 16 列）。现在统一为本地小时：
  新增 `hourKeyOf()`，`realtimeHourly` 的键与 `hour` 字段都用本地值（不再带 `Z`）；
  `hydrateHourlyBuckets` 的 SQL 补 `'localtime'`（此前与 `rebuildHourPartitions` 的 localtime 口径不一致，
  重启前后、分时图与时段热力图各说一套）；桶内新增 `localDate`，客户端优先按它过滤，
  旧 host 缺该字段时退回键的日期段（向后兼容）。
- **轮次恒为 0**：`turns` 只统计 `turn/end`，而真实会话文件里只有 `turn/start`（本机 732 条记录、
  0 条 `turn/end`），界面上出现"步数 202 / 轮次 0"。改为按 `turn/start` 计数，`turn/end` 仍单独
  用于失败轮次与可靠性口径；三处派生表重建同步改口径，并新增 `applyLegacyTurnFallback()`
  为"整天没有 turn/start"的旧数据退回按 `turn/end` 计数。
- **"项目排行"对活跃会话恒为空**：实时路径只读 `session.cwd`，而 DSH 把 cwd 放在
  **`session.header.cwd`**。实测当日 134 条回复全部落 `—` 桶，只有重启重扫会话文件那条路能补上。
  现在按 `header.cwd` → 顶层 `cwd` 兜底，并顺带从 `header.title` 取一次标题。
- **`live.*` 被历史回填污染**：`live` 口径写的是"本次进程启动至今"，但回填与实时走同一个
  `ingestEvent`。实测 30 条 10 天前的事件就能让 `live.msgs=31`、`outputTokens=3001`。
  新增 `LIVE_SINCE` 闸门，早于启动时刻的事件只进账本与维度聚合，不推进 live 计数
  （`stepStart` / `toolStart` 这类配对缓存不受影响，否则回填出的工具名与耗时会变空）。
- **`models[]` 字段歧义**：`input` 已含缓存读、`total = input + output`，但只下发
  `input/cacheRead` 会让消费方按名字相加得到翻倍的总量。新增 `freshInput`（= 新输入，不含缓存读），
  与 `totals.freshInput` 同名同义；客户端总量兜底抽成 `totalsTotalOf()`，旧 host 缺 `prompt` 时
  用 `freshInput + cache_read + completion` 计算。
- **设置页每敲一个字符触发 3 个上游请求**：`onInput` → `update()` → 广播 `opencode:config-changed`
  → 悬浮窗 `reload()` → `Promise.all([opencode, deepseek, r4coder])`。粘贴 40 位 key ≈ 120 个请求。
  新增 `update(patch, {quiet:true})`：本地状态与 localStorage 仍即时写入，只有"广播 + 重置退避"
  被推迟到输入停顿 600ms（`onBlur` 立即 flush）。
- **悬停标志泄漏导致轮询数据冻结**：`isHeatHovering` 只在 `heatTipHide()` 复位，组件卸载
  （关小窗 / 切材质重注册）时无人调用，标志永远为 true，`pendingTmData` 持续缓存而
  `flushPendingHeat()` 再不执行。新增全局 `window.__oqHeatReset`，在 `visibilitychange`（隐藏）、
  `pagehide` 与重新 apply 时强制复位并冲掉缓存。
- **GSAP 加载无在飞记忆**：CDN 不可达时每次调用都 `appendChild` 一个新 `<script>`，
  而调用点有三个在轮询/渲染路径上。改为"共享等待者队列 + 失败冷却 5 分钟"：
  实测 100 次调用只发 1 个请求，50 个调用方全部收到 `null` 回调、走纯 CSS 降级。
- **顶层 scroll 监听重复叠加**：`apply()` 作用域的滚动监听既不移除也无幂等位，
  插件重载/HMR 每次再装一个。改用 `window.__oqHeatScrollBound` 保证全局只装一次。
- **必红的时间炸弹测试**：`test/host.test.mjs` 用硬编码 2026-10-17 摄入却读 `computeUsage("1d")`
  （窗口是"本地今天"），只能在写入当天通过。改为 `range:"all"` 并补一条"数据落在今天时
  1d 也能读到"的用例。**此前 CHANGELOG 把它记为"本机环境问题、与改动无关"是错的**，
  它在本机与 CI 上都会稳定失败。

#### Changed
- **`enrichDimensions` 改为按会话分批落库**（`ENRICH_BATCH_SESSIONS = 24`）：旧实现把 90 天内
  所有会话的事件都攒进一个 `pairs` 数组，读完才写，内存峰值与"历史事件总数"成正比
  （几十万行时明显卡顿）。现在每读满 N 个会话就落库并释放，峰值只与 N 个会话相关；
  单批 UPDATE 再按 `ENRICH_MAX_PAIRS_PER_TXN = 150` 切分，避免超过 SQLite 老版本
  999 个绑定变量的上限。派生表重建仍放在全部批次之后统一做一次，避免中途得到半截结果。
  实测真实账本 2.4k 条事件 / 7 会话：**8ms、applied=1584 行、daily_project 重建 9 行**。
- **点过「清空账本」会让维度回填永久失效**（本次排查 `enrichDimensions` 时发现的真 bug）：
  回填下限原本写成 `Math.max(now - 90d, __resetAt)`，而 `reset_at` 是"清空账本的时刻"，
  于是用户一旦清过账本，`cut` 就等于清空时刻，**所有更早创建的会话都被判为越界**。
  更糟的是循环用的是 `break`（依赖 listSessions 的 createdAt 降序），第一个会话就终止整轮，
  而 `dims_backfill` 仍被置 1 —— 结果 `project` / `tool` / `ms` / `provider` 四个维度永久为空，
  且因为标记已置 1 再也不会重试。现在读取下限只用保留窗口（`reset_at` 的语义是"哪些事件算数"，
  由 UPDATE 的幂等性保证，不该用来决定"哪些会话要读"），循环改 `continue`。
  新增 2 条测试：分批结果与一次性写一致（60 会话 > 24，断言 batches>1）、
  `reset_at` 之后仍能回填。
- `package.json` 新增 `engines.node >= 22.5.0`（`node:sqlite` 的真实起始版本）与
  `test:host` / `test:client` 分开的脚本；README 的 "Node >= 22" 更正为 ">= 22.5"，
  并注明桌面版自带 Node 24 运行时。
- `docs/DEVELOPMENT.md` 更正：`SCHEMA_VERSION` 为 `"5"`（原写 4）、表数量（1 事实源 + 1 元信息 +
  7 派生表，原写"两张"）、区间白名单补 `90d`、清空账本删 7 张派生表（原写三张），
  并新增"小时口径必须是本地"一节。
- 测试：host 34 → 46 条（小时键本地化、回填不进 live、轮次口径、models 字段语义、
  内存裁剪、实时不被时钟误杀、维度回填分批与 reset_at 语义），
  client 9 → 13 条（UTC+8 凌晨桶回归、旧 host 无 localDate 的兼容、
  小窗图表读写闭环），settings-render 10 → 11 条（「小窗口图表」卡片写入正确 key）。
  当前全绿：**host 46/46、client 13/13、settings-render 11/11**。

### 悬浮面板材质：经典（默认）+ 液态玻璃 / 亚克力 / 哑光纸（2026-10-21，样板见 `docs/mockups/panel-materials.html`）

#### Added
- 悬浮小窗新增「材质」外观层，四档可选，入口在「数据源与通用 → 面板材质」：
  **经典**（默认，= 材质层引入前的原背板）、
  **液态玻璃**（低半径模糊 + 指针跟随镜面高光 + 渐变描边）、
  **亚克力**（38px 强模糊 + feTurbulence 噪点，景深最强）、
  **哑光纸**（不透明暖白 + 纸纹，零背景模糊）。
- 材质选择存 `localStorage["oq_panel_material"]`（不写插件配置），默认 `classic`；
  切换通过 `opencode:material-changed` 事件即时生效，跨标签页另有 `storage` 兜底。
- `docs/mockups/panel-materials.html`：10 款材质样板页（首张为默认经典背板），可切明暗主题与
  4 种背景（编辑器 / 照片 / 极光 / 浅色），支持 `?theme=light&bg=photo` 固定一组便于截图对照。

#### Changed
- **默认外观未变**：老用户升级后仍是原背板。`classic` 直接复用基础 `.oq-card` 的
  `--dsw-alias-bg-layer-2` / `--dsw-alias-border-l1` / `--dsw-shadow-lv3` / `blur(10px)`，
  只把材质层借用的 `::before` / `::after` 关掉（`content:none`），
  computed style 与"无材质类"逐项比对一致（背景、边框、阴影、模糊、圆角、尺寸全部相同）。
- 玻璃系材质在作用域内覆盖 `--dsw-alias-bg-layer-*`：`renderTmCompact` 的瓦片与
  DeepSeek 余额行用的是*内联* `background`，只写类选择器盖不住，否则玻璃面板里会嵌着不透明的深色砖。
- 亮色主题（`prefers-color-scheme: light`）为玻璃系单独一套底色/描边/内阴影，
  避免深色玻璃底叠深色文字；`prefers-reduced-motion` 下玻璃系退回实色渐变，省掉每帧模糊开销。
- 哑光纸自带浅色语义变量与热力色阶（深色主题下不会白底白字），并覆盖柱槽 / 网格线 / 进度槽 /
  时间线 / 环形进度轨道等硬编码白色的部件。

#### 已知
- ~~`test/host.test.mjs:478`（hours 7×24 矩阵按本地星期累计）在本机失败，
  与本次改动无关（只改了 `lib/client.js`，host 侧未动；断言期望周六 15 点为 110、实得 0）。~~
  **【2026-10-24 更正】** 该结论是错的：测试用硬编码的 2026-10-17 摄入，却读 `computeUsage("1d")`
  （窗口为"本地今天"），因此只能在写入当天通过，之后在本机与 CI 上都稳定失败。
  已在 [Unreleased] 的"口径与稳定性修复"里改为 `range:"all"` 并补回归用例。

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
