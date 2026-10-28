# 让 dsh-quota-widget 监听 dsh-providers-hub 网关 Token 用量 —— 可行性调研与结论

> 调研对象：`d:/code/dsh-quota-widget`（本插件） + `D:/code/deepseek-harness-codearts`（`dsh-providers-hub`，含本机 OpenAI 网关）
> 调研方式：双仓源码通读 + 本机真实账本数据核对（2026-10-27）
> 结论先行：**可行，且当前的"看不见"是一个真实缺口（今日网关流量占全机 token 的 52%）。推荐走「宿主侧只读 `token-ledger.json` + 独立卡片展示」，不做账本合并。**

---

## 1. 结论摘要

| 问题 | 答案 |
|---|---|
| 网关的 token 用量被记录了吗？ | **被记录**，而且落盘、保留 90 天 |
| 会被本插件的 TokenMeter 自动统计到吗？ | **不会**。网关请求不产生 DSH 会话事件，TokenMeter 只有"会话"这一条摄入通路 |
| 可以跨插件读到吗？ | **可以**，唯一稳定入口是 `$DSH_HOME/jet-hub/token-ledger.json`（同进程、同 home，两个插件都在 `profiles/desktop` 的 bundle 列表里） |
| 数据细腻度够做现有的用量 UI 吗？ | **不够**。只有「日 × 渠道 × provider × 账号 × 模型」的聚合计数，**没有**项目 / 会话 / 小时 / 单笔明细 |
| 应该合并进 TokenMeter 账本吗？ | **不应该**（双重计数 + 日界口径不同 + 会被"清空账本"误伤）。应做成独立数据源 |
| 建议工作量 | 宿主 ~180 行 + 客户端 ~180 行 + 测试 ~120 行，无新增依赖、无构建步骤 |

---

## 2. 事实核查（带证据）

### 2.1 网关的用量确实进了 codearts 的持久化账本

链路（不是网关自己写的，而是绕了一圈回到统一记账层）：

```
POST /v1/chat/completions
  → server.ts:384  options.llm.stream(markGatewayChannel(generate))     ← 打上 Symbol 标记
  → llm-register-compat.ts:179  channelOfOptions() → channel='gateway'
  → llm-register-compat.ts:287  收 usage chunk
  → llm-register-compat.ts:325  在 finally 里 recordTokenUsage({channel, provider, model, accountId, ...})
  → token-ledger.ts:606         ledger.unshift(record)  // 内存，上限 500（TOKEN_LEDGER_LIMIT）
  → token-ledger-store.ts:280   FileLedgerStore.append → mergeDayEntry + scheduleFlush（1s 防抖）
  → token-ledger-store.ts:637   writeDays → $DSH_HOME/jet-hub/token-ledger.json（原子写 + 跨进程目录锁）
```

关键点：**网关流量与直连流量共用同一个写入口**，只靠 `channel` 字段区分（`'direct'` / `'gateway'`）。所以不存在"网关的那份没记"的问题。

### 2.2 本机真实数据：网关用量已经很大，且本插件完全没看到

`C:\Users\sky\.dsh\jet-hub\token-ledger.json`（schema `dsh-codearts-auth/token-ledger/v2`，90 天）：

```
桶键样例：gateway|buddy|buddy-ead1bded|deepseek-v4.1-flash
          direct|buddy|buddy-f108fa23|deepseek-v4.1-flash
```

按日合计（总量 = 未命中输入 + 缓存读 + 输出）：

| 日期 | gateway 请求 | gateway token | direct 请求 | direct token |
|---|---|---|---|---|
| 2026-10-21 | 290 | 32.6 M | 2608 | 590.2 M |
| 2026-10-22 | 103 | 14.6 M | 2190 | 391.5 M |
| 2026-10-23 | 62 | 10.8 M | 2447 | 566.6 M |
| 2026-10-26 | 345 | 38.3 M | 2491 | 479.9 M |
| **2026-10-27** | **709** | **250.7 M** | 1306 | 226.7 M |

对照本插件自己的库（`$DSH_HOME/storages/token-meter.db`，只读查询）：

```
2026-10-27  daily_usage 合计: requests=1301, input=2,900,725, output=1,349,896, cache_read=222,201,942
2026-10-27  codearts direct: requests=1306, (input+output+cacheRead)=226,748,735
```

两者几乎逐位吻合 ⇒ **本插件的 TokenMeter ≡ codearts 账本里的 `direct` 那一半**；`gateway` 那一半（今天 709 次请求、250.7 M token，占全机总量 **52.5%**）在本插件里**一行都没有**。

> ⚠️ 这同时意味着：现在小窗显示的"今日总量"在网关被大量使用的日子里会**少报一半**。这个功能不只是"多一个数据源"，也是修正一个真实的计量缺口。

### 2.3 为什么 TokenMeter 天然看不到网关流量

本插件的三条摄入通路全部围绕 DSH 会话：

| 通路 | 位置 | 为什么覆盖不到网关 |
|---|---|---|
| `ctx.on("session/event")` | `lib/index.js:3220` | 网关请求**根本不建会话**，直接 `ctx.llm.stream` |
| `ctx.get("sessionQuery")` | `lib/index.js:1692/1880` | 同上，无会话可查 |
| 扫 `sessions/**.jsonl` | `lib/index.js:1584/2156` | 同上，磁盘上没有这些会话文件 |

`session/event` 的 `assistant/message` 事件带 `data.usage`（`lib/index.js:1263-1285`），这是本插件唯一的 token 来源。网关链路不经过 agent/session，因此没有任何事件产生。

### 2.4 两条候选读取链路（都实测可用）

| | A. 读文件（推荐） | B. 调 Jet Hub RPC |
|---|---|---|
| 入口 | `$DSH_HOME/jet-hub/token-ledger.json` | `connection.rpc.call('/api','jet-hub',{method:'usage.tokenLedgerHistory',payload:{…}})` |
| 证据 | `token-ledger-store.ts:59/761` | `jet-hub-rpc.ts:3533` 注册 `/api/jet-hub`；方法名在 `:7998/8018/8032` |
| 数据 | 90 天日聚合（重启保留） | `usage.tokenLedgerHistory` = 日聚合树；`usage.tokenLedger` = **内存 500 条明细**（含 ttft/tps/error） |
| 依赖 | 只需文件存在 | 需 codearts 已安装、已激活、RPC 通道可用 |
| 客户端改动 | 无（宿主读、宿主出接口） | 需给客户端加 `@deepseek-ai/dsh-client-connection` 注入并 `ctx.get("connection")` |
| 粒度 | 日 × provider × 账号 × 模型 | 明细可到**单笔**（时间戳/ttft/tps/是否上报 usage） |
| 一致性 | 1s 防抖内可能落后最多 1 秒 | 内存读，实时 |
| 破坏风险 | 只读，无（**绝不能写**） | 只读方法，无 |

**注意**：网关（`127.0.0.1:8326`）自己**没有**任何用量端点 —— 只有 `/v1/models`、`/v1/reasoning-efforts`、`/v1/chat/completions`、`/v1/responses`（`openai-gateway/server.ts:467-485`）。想"直接问网关"这条路不存在，能取到 key 也没用。这一点我实测确认过：网关在跑（`GET /v1/models` 返回 401 = 需要 Bearer，属预期）。

### 2.5 进程/路径关系（决定读取是否可行）

- 两个插件**装在同一个 profile**：`~/.dsh/profiles/desktop/package.json` 的 `bundles` 同时含 `dsh-quota-widget` 与 `dsh-providers-hub`（都是 `link:` 本地目录）⇒ **同一个 DSH 进程、同一个 home**。
- codearts 的 home 解析优先级（`jet-hub-store.ts:1378`）：
  `DSH_JET_HUB_STATE_DIR` → `ctx.get('profileContext').home` → `$DSH_HOME` → `~/.dsh`
- 本插件现有的 home 解析（`lib/index.js:122-136`）：
  `$DSH_HOME` → `ctx.get("dshHomePath")("storages")` 的上级
- ⚠️ **两者顺序不同**：桌面版若设了 `profileContext.home` 且 ≠ `$DSH_HOME`，本插件会读错目录。所以不能只写一条路径，要给**候选列表 + schema 校验**（见 §4.2）。
- codearts **没有** `ctx.provide` 任何用量服务（全仓 `ctx.provide` 只有 `accountPool` / `officeaceAuth`），所以 `ctx.get('tokenLedger')` 那条"最优雅"的路**不存在**。

---

## 3. 数据契约（读之前必须知道的坑）

`token-ledger.json` 结构：

```jsonc
{
  "schema": "dsh-codearts-auth/token-ledger/v2",
  "days": {
    "2026-10-27": {
      "gateway|buddy|buddy-ead1bded|deepseek-v4.1-flash": {
        "requests": 140, "reportedRequests": 140,
        "inputTokens": 528916, "outputTokens": 64269,
        "cacheReadTokens": 38102400, "cacheWriteTokens": 0,
        "reasoningTokens": 18914, "errors": 0,
        "ttftSumMs": 413291, "ttftCount": 140,
        "tpsSum": 36117.7, "tpsCount": 140,
        "tpsHistogram": { "79": 1, "84": 6, ... }   // 稀疏对数直方图，可整段丢弃
      }
    }
  }
}
```

必须遵守的六条：

1. **只取 `channel === 'gateway'` 的桶**。`direct` 那一半和本插件自己的库重复，取进来就是双重计数。
2. **日键是 UTC+8 固定日界**（`token-ledger.ts:534 utc8DayKey`），本插件的 `dayKeyOf`（`lib/index.js:1183`）是**本机时区**。本机是 `China Standard Time` 所以一致；换到别的时区就会错位 —— 需要在 UI 上标注"网关口径：UTC+8"，或做一次显式换算（推荐前者，改动小且不骗人）。
3. **桶键转义不可逆**：`|` 被替成 `/`（`token-ledger.ts:899`）。解析只做 `split('|')` 要求恰好 4 段；模型名里带 `/`（`vendor/model`）是**正常**的，不要以为是脏数据。
4. **`schema` 必须校验**。历史上有 v1→v2 升级；不认识就整段忽略并提示"版本不兼容"，不要硬解析。
5. **字段可能被手工编辑成脏值**：所有数值按 `Number()` + 非负 + 取整钳制（对齐 `token-ledger-store.ts:75 storedNumber` 的口径）。
6. **同目录有 `token-ledger.json.lock` 目录**（跨进程写锁）和可能的 `.corrupt-*` 留档 —— 只读主文件时按名字精确匹配，别 glob。

---

## 4. 推荐方案

### 4.1 一句话

**宿主侧新增一个只读数据源 `jetHub`：解析 `jet-hub/token-ledger.json`，只取 `gateway` 渠道，按日/模型/provider 聚合成与本插件现有 `agg` 同构的形状，通过独立路由 `/api/token-meter/jet-hub` 下发；客户端在「数据源」里加一个默认关闭的开关，打开后小窗多一张独立卡片。**

### 4.2 宿主侧设计（`lib/index.js`）

新增（建议集中放在 `resolveDbPath` 附近，~line 122 之后）：

```js
// 候选 home（对齐 codearts 的优先级；只读，绝不写）
function jetHubHomeCandidates(ctx){
  const out=[];
  const push=(p)=>{ if(p && !out.includes(p)) out.push(p); };
  push(process.env.DSH_JET_HUB_STATE_DIR);
  try{ const pc=ctx.get("profileContext"); if(pc && pc.home) push(String(pc.home)); }catch(e){}
  push(process.env.DSH_HOME);
  try{ const hp=ctx.get("dshHomePath"); if(typeof hp==="function"){ const h=hp(); if(h) push(String(h)); } }catch(e){}
  push(joinPath(homedir(), ".dsh"));
  return out;
}

// 解析 + 归一（纯函数，进 __testing）
function normalizeJetHubLedger(doc){   // → {ok, schema, days:[{day, totals:{requests,input,output,cacheRead,errors}, models:[...], providers:[...]}]}
  // 只留 channel==='gateway'；split('|') 4 段；数值钳制；丢 tpsHistogram
}

// 读文件（按 mtime+size 缓存，避免 15s 轮询重复 parse）
function readJetHubLedger(ctx, logger){ ... }
```

新路由（插在 `lib/index.js:3568` 之后、`/api/token-meter` 之前，与其它 13 条同款风格）：

```js
webServer.register({
  kind: "exact",
  path: "/api/token-meter/jet-hub",
  handler: async (req, res) => {
    if (!localGuard(req, res)) return;                       // 必守
    if (req.method !== "GET") { json(res,405,{ok:false,error:"method not allowed"}); return; }
    const range = ...;                                        // 复用 RANGE_VALUES / resolveCustomWindow
    json(res,200,{ ok:true, available, path, schema, days, totals, models, providers, note:"UTC+8 日界" });
  }
});
```

接口形状建议**故意不塞进** `/api/token-meter`：那条响应的体积和 `READY_WAIT` 语义已经很敏感（`lib/index.js:3595-3601`），多一个可选数据源不该让它变慢或引入新的失败面。

`__testing` 追加 `normalizeJetHubLedger / jetHubHomeCandidates / readJetHubLedger`（`lib/index.js:3663`）。

### 4.3 客户端设计（`lib/client.js`）

改动点（与既有"六处"范式对齐）：

1. `defaultProviders()`（line 17）：加 `jetHub:{enabled:false}`（**默认关**，符合"可选功能"）。
2. `loadConfig()`（19-35）：老配置补默认。
3. 新增 `fetchJetHub(range)`（放在 `fetchR4Coder` 之后，line 1165 后）。
4. 轮播 `slides.push`（line 1768 附近）：`if(cfg.providers.jetHub && cfg.providers.jetHub.enabled) slides.push({key:"jetHub", label:"网关用量", data:jhData[0], has:…})`，**排在 tokenMeter 之后**（它不是"本机会话用量"的替代，是补充）。
5. `renderSlide` 加 `s.key==="jetHub"` 分支（紧邻 `s.key==="tokenMeter"`，line 2291）：卡片内容 = 今日/所选区间总量 + 请求数 + 按 provider 的迷你条形 + 「UTC+8 口径」角标。
6. 设置页「数据源」面板（line 4760-4773）：加一条 `providerSummary("jetHub", …)`。它的 `providerForm` 要特殊处理 —— **没有 token / baseUrl**，只应展示：开关、只读的实际文件路径、文件状态（存在/不存在/schema 版本/桶数）、以及一句"只读，不会修改对方数据"。
7. `doTest` / `applyTestOut`（line 2603-2628）：`jetHub` 的测试 = 打一次新路由，把 `available` + `buckets` 归一成"正常 / 未安装（文件不存在）"。

更省事的替代：**不做卡片，只在现有 tokenMeter 卡片底部加一行"另有网关 N 次 / X token（UTC+8）"**，改动可压到 ~40 行。如果只是想"看得见"，这条性价比最高。

### 4.4 明确不要做的三件事

1. **不要写进 `token-meter.db`**。理由：① `direct` 已经在库里，合并即双计；② 本插件的 `events` 表以 `(seq, session_id)` 为主键、按会话幂等去重，网关记录没有会话与 seq，塞进去要造伪会话，破坏"可补录 / 可按项目清空 / 可回填维度"这一整套语义；③ 会污染"清空账本"的语义（清了本机账本，网关数字还在，用户会以为没清干净）。
2. **不要改 `token-ledger.json`**（哪怕只是想加个时间戳）。它有跨进程目录锁 + 增量合并写 + 损坏留档，第三方写入是最高风险动作。
3. **不要把 `direct` 桶也展示出来再和本插件求和**。同一笔用量会以两个不同口径出现（本插件按 `assistant/message` 计、codearts 按请求计，实测差 5/1301），并排显示两个"总量"只会制造困惑。

---

## 5. 能力边界（必须写进 UI 或 README，否则会被误解）

用文件链路，网关数据**只能支持**：

- ✅ 按日总量（今天 / 7d / 30d / 90d / 自定义区间 —— 区间过滤在本插件侧做）
- ✅ 按模型、按 provider（17 个渠道之一）、按账号 id 的聚合
- ✅ 请求数、失败数、平均首字用时、平均 TPS（`ttftSumMs/ttftCount`、`tpsSum/tpsCount` 现成）
- ❌ 项目归属（无字段）
- ❌ 会话下钻、单日 24 小时分布（无小时桶）
- ❌ 单笔明细表 / CSV 导出到逐笔（只有日聚合）
- ❌ 实时"正在对话"心跳（网关不产生事件流）

想补齐明细/实时，只能走 **RPC B**（`usage.tokenLedger` 的 500 条内存明细），代价是耦合对方 RPC 契约 + 客户端要多注入 `connection`。建议**v1 只做文件链路**，把"明细"留作 v2 的可选项。

---

## 6. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 对方私有文件格式变更（v1→v2 已发生过一次） | 中 | 校验 `schema` 前缀 + `days` 形状；不匹配就 `available:false` 并给出原因，绝不全屏报错 |
| home 目录解析不一致（`profileContext.home` ≠ `$DSH_HOME`） | 中 | 候选列表按 codearts 同序尝试，取**第一个能解析出合法账本**的；把最终使用的路径回显到设置页 |
| 大文件解析开销 | 低 | 现在 92 KB / 11 天；90 天满量估 300–500 KB，parse 约 2 ms。仍按 `mtime+size` 缓存，命中直接返回聚合结果 |
| 多 profile / 多实例共享同一 home ⇒ 数字里含别人的用量 | 低-中 | 与 codearts 自己的行为一致（它也是 home 级）；UI 注明"本机 codearts 插件账本（多 profile 共享）" |
| 隐私：桶键里含账号 id（如 `buddy-ead1bded`） | 中 | 默认**只展示 provider 名称**，账号 id 折叠/掩码（复用 `maskToken` 的思路） |
| 对方未安装 ⇒ 功能静默失效 | 低 | `available:false` + 设置页一行"未找到 Jet Hub 账本（未安装 dsh-providers-hub？）" |
| 时区口径差异 | 低（本机） | 卡片上标「UTC+8 日界」；不试图伪造本地日界 |
| 与 `dsh-providers-hub` 卸载/重命名（历史上改过一次包名） | 低 | 只依赖文件路径，不依赖包名 —— 这本身是"读文件"相对"调 RPC"的优势 |

---

## 7. 实施清单（可直接照做）

**宿主 `lib/index.js`**
1. `jetHubHomeCandidates(ctx)` / `normalizeJetHubLedger(doc)` / `readJetHubLedger(ctx, logger)` —— 插在 `resolveDbPath` 之后（line 136 附近）。
2. 路由 `/api/token-meter/jet-hub`（GET，`localGuard` 首行）—— 插在 line 3568 之后。
3. `__testing` 追加三个纯函数（line 3663+）。
4. （可选）`/api/quota/ping` 的 `providers` 追加 `"jet-hub"`（line 3390）。

**客户端 `lib/client.js`**
5. `defaultProviders()` / `loadConfig()` 补 `jetHub:{enabled:false}`（line 17-35）。
6. `fetchJetHub()`（line 1165 后）+ `jhData` 状态（line 1209 附近）。
7. 轮播 push（line 1768）+ 渲染分支（line 2291 旁）。
8. 「数据源」面板条目 + 专用表单（line 4760-4773）。
9. `doTest` / `applyTestOut`（line 2603-2628）。

**测试**
10. `test/host.test.mjs` 新分节：临时 home + 手写账本夹具，断言
    ① `direct|` 桶被排除；② 非法 `schema` ⇒ `available:false`；③ 坏 JSON 不抛、降级；④ 数值钳制（负数/NaN/字符串）；⑤ 模型名含 `/` 不被误拆。
11. `test/settings-render.test.mjs`：`setup().fetch` 桩加该端点 shape，断言新卡片渲染与开关默认关。

**文档**
12. `README.md`「支持的数据源」加一行 + 「数据链路与隐私」补一段：**只读对方账本、不写、不含对话内容、只含日聚合计数**。
13. `CHANGELOG.md` 一条。

**工作量**：宿主 ~180 行、客户端 ~180 行（精简版 ~40 行）、测试 ~120 行。无新依赖、无构建步骤（本仓是"手写即产物"）。

---

## 8. 一句话回答"能不能"

**能。** 网关的 token 用量已经被 codearts 完整记账并落盘到 `$DSH_HOME/jet-hub/token-ledger.json`（按 `channel: 'gateway'` 可与直连分离），两个插件同进程同 home，本插件宿主侧只读解析即可，不需要改对方一行代码、不需要走网关端口、不需要新增依赖。

代价是两件事想清楚：
1. **它只能是"日聚合 × 模型/provider"这一档粒度** —— 想复刻现在的项目/会话/小时/明细视图，必须改走对方 RPC 并接受契约耦合；
2. **它与现有 TokenMeter 是并列关系而不是可合并关系** —— 一旦合并进同一个库，双重计数、口径错位、清空语义三件事会同时出问题。

顺带一个副产品：这个功能会顺手修掉一个**已经在发生的少报** —— 网关被大量使用的日子（如今日），小窗显示的"今日总量"只有真实值的一半左右。
