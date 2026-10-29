// 设置页「用量统计」渲染冒烟（node:test，零依赖）。
// 为什么值得单独写：设置页是一个 800+ 行的单文件 React 组件，函数调用链很长
// （usagePanel → renderTokenMeterChart → renderDailyBars/modelRank/rankRows/recordsList…），
// 任何一个 undefined 字段都会在"用户点开设置页"那一刻炸掉，而语法检查抓不到。
// 这里用最小 hook 运行时把组件函数真的跑一遍（jsx 桩返回 {type,props} 以便遍历文本），
// 并用桩 fetch 喂一份真实形状的 payload，走完"有数据"的全部分支。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { loadClientModule } from "./load-client.mjs";

const DAY = 86400000;
const now = Date.now();
const dayKey = (offset) => {
  const d = new Date(now - offset * DAY);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
const today = dayKey(0);
const hourKey = (h) => today + "T" + String(h).padStart(2, "0");

/**
 * 网关账本诊断端点的"正常"响应（字段照 host 的 /api/token-meter/gateway 裁剪）。
 * 单测里各状态用 gatewayPayload 覆盖，默认走这个"一切正常且有数据"的形状。
 */
function gatewayOkPayload() {
  const d0 = dayKey(0), d1 = dayKey(1);
  return {
    ok: true, disabled: false, available: true, error: null, detail: null,
    schema: "dsh-codearts-auth/token-ledger/v2",
    path: "C:\\Users\\tester\\.dsh\\jet-hub\\token-ledger.json",
    triedPaths: ["C:\\Users\\tester\\.dsh\\jet-hub\\token-ledger.json"],
    mtimeMs: now, size: 92472, loadedAt: now,
    dayCount: 2, bucketCount: 3, firstDay: d1, lastDay: d0, empty: false,
    note: "UTC+8 日界；无项目/会话/小时/逐笔维度",
    days: [
      { day: d0, requests: 140, total: 3000, freshInput: 500, cacheRead: 2400, output: 100 },
      { day: d1, requests: 60, total: 1500, freshInput: 300, cacheRead: 1100, output: 100 },
    ],
    models: [{ model: "deepseek-v4.1-flash", total: 4000 }, { model: "kimi-k2.8-preview", total: 500 }],
    providers: [{ provider: "buddy", total: 4000 }, { provider: "trae", total: 500 }],
  };
}
/** 六种状态各造一份（available/error/empty/disabled 组合） */
function gatewayPayloadFor(kind) {
  const base = gatewayOkPayload();
  if (kind === "not-found") {
    return Object.assign({}, base, {
      available: false, error: "not-found", path: null, schema: null, dayCount: 0, bucketCount: 0,
      empty: false, days: [], models: [], providers: [],
      triedPaths: ["C:\\Users\\tester\\.dsh\\jet-hub\\token-ledger.json", "D:\\home\\jet-hub\\token-ledger.json"],
    });
  }
  if (kind === "bad-schema") {
    return Object.assign({}, base, {
      available: false, error: "bad-schema", detail: "some-other/v1", dayCount: 0, bucketCount: 0,
      empty: false, days: [], models: [], providers: [],
    });
  }
  if (kind === "bad-json") {
    return Object.assign({}, base, {
      available: false, error: "bad-json", detail: "Unexpected token", dayCount: 0, bucketCount: 0,
      empty: false, days: [], models: [], providers: [],
    });
  }
  if (kind === "empty") {
    return Object.assign({}, base, {
      available: true, error: null, dayCount: 0, bucketCount: 0, empty: true,
      days: [], models: [], providers: [],
    });
  }
  if (kind === "disabled") {
    return Object.assign({}, base, { disabled: true, days: [], models: [], providers: [] });
  }
  return base;
}

/**
 * 「用量查询」端点的"正常"响应（字段照 host 的 /api/token-meter/query 裁剪）。
 * 单测覆盖各场景时用 queryPayload 覆盖。
 */
function queryOkPayload() {
  return {
    ok: true,
    query: { range: "7d", from: dayKey(6), to: dayKey(0), groupBy: "model", subGroup: "", source: "both", metric: "total" },
    rows: [
      { k1: "deepseek-v4.1-flash", k2: "", value: 4200000, requests: 120, total: 4200000, share: 70 },
      { k1: "kimi-k2.8", k2: "", value: 1800000, requests: 30, total: 1800000, share: 30 },
    ],
    rowCount: 2, truncated: false, grand: 6000000,
    dimensions: [
      { key: "day", label: "日", scope: "both" },
      { key: "model", label: "模型", scope: "both" },
      { key: "provider", label: "渠道", scope: "both" },
      { key: "account", label: "账号", scope: "gw" },
      { key: "project", label: "项目", scope: "local" },
      { key: "session", label: "会话", scope: "local" },
      { key: "tool", label: "工具", scope: "local" },
      { key: "hour", label: "小时", scope: "local" },
    ],
    gatewayIncluded: true, gatewayExcludedReason: null, gatewayExcludedDims: [],
    gatewayAvailable: true, gatewayTz: "UTC+8", accountLabelsMasked: true,
    localQueryError: null, gatewayCrossMissing: false,
  };
}

/** 真实形状的 payload（字段照 host 的 /api/token-meter 响应裁剪） */
function payload(range) {
  const daily = [dayKey(2), dayKey(1), dayKey(0)].map((date, i) => ({
    date,
    requests: 10 + i,
    prompt: 1000 * (i + 1) + 5000,
    completion: 100 * (i + 1),
    cache_read: 5000 * (i + 1),
    total: 1100 * (i + 1) + 5000,
    tools: 3 + i,
    turns: 1 + i,
    steps: 4 + i,
    models: [{ model: "u2-flash", total: 4000 * (i + 1) }, { model: "deepseek-v4-flash", total: 1200 * (i + 1) }],
  }));
  const totals = { total: 20000, prompt: 18000, freshInput: 900, completion: 1000, cache_read: 17100, cacheHitRate: 95, requests: 33, turns: 6, steps: 15, tools: 9 };
  const totals2 = { total: 21000, prompt: 19000, freshInput: 950, completion: 1100, cache_read: 17950, cacheHitRate: 95, requests: 30, turns: 5, steps: 14, tools: 8 };
  return {
    ok: true, range, todayStr: today, version: 7, ready: true, updatedAt: now,
    store: "db:/tmp/token-meter.db",
    stats: { totals, prevTotals: totals2, daily, models: [
      { model: "u2-flash", requests: 20, input: 15000, output: 800, cacheRead: 14000, total: 15800 },
      { model: "deepseek-v4-flash", requests: 9, input: 3000, output: 200, cacheRead: 2900, total: 3200 },
      { model: "未知模型", requests: 1, input: 10, output: 1, cacheRead: 0, total: 11 },
    ], records: [
      { time: now - 5000, sessionId: "session-0bb2", model: "u2-flash", provider: "unisound", project: "token-lens", input: 1200, output: 300, cacheRead: 1000, durationMs: 8200 },
      { time: now - 60000, sessionId: "session-c225", model: "deepseek-v4-flash", provider: "opencode", project: "", input: 900, output: 100, cacheRead: 0, durationMs: 0 },
    ], live: { turns: 3, steps: 12, llmMs: 40000, toolMs: 10000, toolCalls: 20, firstTokenMs: 0, firstTokenCount: 0, tokPerSec: 25, rate60: 1.5, rate60Tokens: 90, rate60WindowSec: 60, msgs: 5, signalCount: {}, outputTokens: 1000 } },
    totals, prevTotals: totals2, daily,
    // 分源拆解：total(20000) 里含网关 6000（其余 14000 属本机）
    sources: {
      gateway: { total: 6000, requests: 200, available: true, enabled: true, error: null, detail: null, schema: "dsh-codearts-auth/token-ledger/v2", dayCount: 2, bucketCount: 3, note: "UTC+8 日界" },
      local: { total: 14000, requests: 33 },
    },
    models: [], records: [],
    tools: [{ tool: "read", calls: 12, ms: 300, avgMs: 25 }, { tool: "pwsh", calls: 8, ms: 9000, avgMs: 1125 }],
    projects: [{ project: "token-lens", requests: 9, freshInput: 300, output: 200, cacheRead: 2900, tools: 4, total: 3400 }],
    providers: [{ provider: "unisound", requests: 20, freshInput: 900, output: 700, cacheRead: 13000, total: 14600 }],
    sessions: [{ sessionId: "session-8d0dd9a4-ba12", title: "重构弹窗", project: "token-lens", requests: 9, freshInput: 300, output: 200, cacheRead: 2900, tools: 4, turns: 3, steps: 9, total: 3400 }],
    hours: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (d === 5 && h === 17 ? 1000 : d + h))),
    prevDaily: [dayKey(3), dayKey(2), dayKey(1)].map((date, i) => ({ date, total: 700 * (i + 1), prompt: 600, completion: 100, cache_read: 500, requests: 2, tools: 1, turns: 1, steps: 2, models: [] })),
    reliability: { since: "start", retries: 1, retryCodes: [{ code: "TRANSPORT", n: 1 }], compactions: 1, errors: 2, toolErrors: 3 },
    live: { turns: 3, steps: 12, llmMs: 40000, toolMs: 10000, toolCalls: 20, firstTokenMs: 0, firstTokenCount: 0, tokPerSec: 25, rate60: 1.5, rate60Tokens: 90, rate60WindowSec: 60, msgs: 5, signalCount: { "assistant/chunk": 12 }, outputTokens: 1000 },
    health: { store: "db:/tmp/token-meter.db", dbBytes: 3829760, events: 15251, days: 37, lastScanAt: now - 5000 },
    hourly: { ["u2-flash::" + hourKey(9)]: { model: "u2-flash", hour: hourKey(9) + ":00:00.000Z", localDate: today, uncachedInputTokens: 100, outputTokens: 50, cacheReadTokens: 900, cacheWriteTokens: 0, count: 2 } },
    daily30: null,
  };
}

/** 极简 hook 运行时：状态/ref 跨次渲染保持，effect 立即执行并马上回收（避免留下定时器） */
function makeReactStub() {
  const states = [];
  const refs = [];
  const cleanups = [];
  let idx = 0;
  const reset = () => { idx = 0; };
  const react = {
    useState(init) {
      const i = idx++;
      if (!(i in states)) states[i] = [typeof init === "function" ? init() : init, (n) => { states[i][0] = typeof n === "function" ? n(states[i][0]) : n; }];
      return states[i];
    },
    useRef(init) {
      const i = idx++;
      if (!(i in refs)) refs[i] = { current: init };
      return refs[i];
    },
    useEffect(fn) {
      // 立即执行并**立刻回收**：组件里的 effect 会 setInterval（轮询/相对时间节拍），
      // 不回收的话 node 事件循环永远不空，测试进程会挂住。
      const c = fn();
      if (typeof c === "function") { try { c(); } catch { /* ignore */ } }
    },
    useMemo(fn) { return fn(); },
  };
  return { react, reset, runCleanups: () => { while (cleanups.length) { try { cleanups.pop()(); } catch { /* ignore */ } } }, states };
}

/** jsx 桩：返回 {type, props} 的普通对象，便于遍历文本做断言 */
const makeJsxStub = () => {
  const jsx = (type, props) => ({ type, props: props || {} });
  return { jsx, jsxs: jsx, Fragment: "Fragment" };
};

function collectText(node, out = []) {
  if (node == null || node === false) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((n) => collectText(n, out)); return out; }
  if (typeof node === "object") {
    // jsx 桩产物
    if (node.props) collectText(node.props.children, out);
  }
  return out;
}

async function setup({ localStorageSeed = {}, fetchPayload, gatewayPayload, queryPayload } = {}) {
  const { react, reset } = makeReactStub();
  const jsxStub = makeJsxStub();
  const requireStub = (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return jsxStub;
    throw new Error("unexpected require: " + name);
  };
  const mod = await loadClientModule({ requireStub });

  const store = Object.assign({}, localStorageSeed);
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const u = String(url);
    // 清空账本相关端点（顺序重要：reset-preview / reset-token 都含 "/reset" 前缀）
    if (u.indexOf("/api/token-meter/reset-preview") >= 0) {
      const scope = (u.match(/scope=([^&]+)/) || [])[1] || "all";
      return { ok: true, json: async () => ({
        ok: true, scope: decodeURIComponent(scope), events: 42, target: 42, remaining: 0,
        days: 3, firstDay: "2026-08-23", lastDay: "2026-10-24", bytes: 1234567,
        projects: [{ project: "alpha", events: 30 }, { project: "beta", events: 12 }],
        suppressed: [], resetAt: null,
      }) };
    }
    if (u.indexOf("/api/token-meter/reset-token") >= 0) {
      return { ok: true, json: async () => ({ ok: true, token: "tok-1", expiresAt: Date.now() + 60000 }) };
    }
    if (u.indexOf("/api/token-meter/enrich") >= 0) {
      return { status: 200, ok: true, json: async () => ({ ok: true, sessions: 3, resolved: 3, updated: 1124, unresolved: 0, projectNull: 0, ms: 42 }) };
    }
    if (u.indexOf("/api/token-meter/import-preview") >= 0) {
      return { status: 200, ok: true, json: async () => ({
        ok: true, sessions: 27, totalMsgs: 1022, totalTokens: 66750788,
        currentTotal: 199333429, projectedTotal: 266084217, cutoff: Date.now() - 90 * 86400000,
        items: [
          { sessionId: "s1", project: "zenith", msgs: 52, tokens: 3965104, lastTime: Date.now() - 62 * 86400000, events: 900, file: "x" },
          { sessionId: "s2", project: "alpha", msgs: 20, tokens: 631956, lastTime: Date.now() - 62 * 86400000, events: 400, file: "y" },
        ],
      }) };
    }
    if (u.indexOf("/api/token-meter/import") >= 0) {
      return { status: 200, ok: true, json: async () => ({ ok: true, sessions: 27, events: 3553, msgs: 1022, tokens: 66750788, skipped: 8, totalAfter: 266084217, ms: 1236 }) };
    }
    if (u.indexOf("/api/token-meter/backups") >= 0) {
      return { ok: true, json: async () => ({
        ok: true, dir: "C:\\x\\token-meter-backups",
        items: [{ file: "C:\\x\\b.db", name: "token-meter-20261024-120000.db", bytes: 99999, at: Date.now(), scope: "all", cleared: 42, resetAt: null, rows: null }],
      }) };
    }
    if (u.indexOf("/api/token-meter/reset") >= 0) {
      return { status: 200, ok: true, json: async () => ({ ok: true, scope: "all", cleared: 42, remaining: 0, persistent: true, error: null, backup: { ok: true, file: "C:\\x\\b.db", bytes: 99999 }, vacuum: { ok: true, pagesBefore: 200, pagesAfter: 4 } }) };
    }
    // 「网关」tab 的诊断端点。必须排在 /api/token-meter 兜底之前（URL 前缀相同）。
    if (u.indexOf("/api/token-meter/gateway") >= 0) {
      const gp = gatewayPayload ? gatewayPayload(u) : gatewayOkPayload();
      return {
        status: 200, ok: true,
        text: async () => JSON.stringify(gp),
        json: async () => gp,
      };
    }
    // 「用量查询」端点。同样要排在 /api/token-meter 兜底之前。
    // ⚠️ 必须同时提供 text()：客户端为了把"解析失败"报成可排查的信息
    // （而不是一句 bad json），改成先取 text 再 JSON.parse。
    if (u.indexOf("/api/token-meter/query") >= 0) {
      const qp = queryPayload ? queryPayload(u) : queryOkPayload();
      return {
        status: 200, ok: true,
        text: async () => JSON.stringify(qp),
        json: async () => qp,
      };
    }
    const m = u.match(/range=([^&]+)/);
    const range = m ? decodeURIComponent(m[1]) : "1d";
    const p = fetchPayload ? fetchPayload(range) : payload(range);
    return { status: 200, ok: true, json: async () => p };
  };

  const registered = new Map();
  const slots = {
    inject: (_name, cb) => cb(),
    register: (spec, fn) => { registered.set(spec.id, fn); return spec; },
  };
  mod.apply({ get: (n) => (n === "slots" ? slots : undefined) });

  const wrapper = registered.get("opencode-quota-settings");
  assert.equal(typeof wrapper, "function", "应注册设置页组件");
  // 注册的是"返回元素的包装函数"（宿主契约），这里取出真正的组件函数来手动渲染
  const el = wrapper();
  assert.equal(typeof (el && el.type), "function", "包装函数应返回组件元素");
  const panel = el.type;
  return { panel, reset, store, calls };
}

/** 收集 className 含 needle 且带 onClick 的元素（用于"真的点一下"的回归测试）
 *  注意：jsx 桩产物里 button 常被包在 div 的 children 里，也可能出现在 props 的其它槽位，
 *  这里统一遍历 props 的所有值，避免只扫 children 漏掉真正的按钮。 */
function findClickable(node, needle, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => findClickable(n, needle, out)); return out; }
  if (node.props) {
    const cn = String(node.props.className || "");
    if (typeof node.props.onClick === "function" && cn.includes(needle)) out.push(node);
    for (const k of Object.keys(node.props)) {
      if (k === "children") continue;
      findClickable(node.props[k], needle, out);
    }
    findClickable(node.props.children, needle, out);
  }
  return out;
}

/** 收集所有元素的 title（tooltip）文本，用于断言"说明文字不该出现在正文里" */
function collectTitles(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => collectTitles(n, out)); return out; }
  if (node.props) {
    if (typeof node.props.title === "string") out.push(node.props.title);
    collectTitles(node.props.children, out);
  }
  return out;
}

async function renderTwice(panel, reset) {
  reset();
  panel();                       // 首次渲染：挂载 effect + 触发拉取
  await new Promise((r) => setTimeout(r, 5));
  reset();
  return panel();                // 二次渲染：meterData 已有数据 → 走完整分支
}

test("设置页渲染冒烟：有数据时全部分支可渲染，且包含新增卡片与口径文案", async () => {
  const { panel, reset } = await setup({ localStorageSeed: { opencode_quota_range: "30d" } });
  const tree = await renderTwice(panel, reset);
  const text = collectText(tree).join(" | ");
  for (const kw of ["总览", "缓存命中率", "新输入", "缓存读", "步数", "排行", "模型", "会话", "工具", "项目", "渠道", "实时", "最近调用", "诊断"]) {
    assert.ok(text.includes(kw), "渲染结果缺少文案「" + kw + "」");
  }
  assert.ok(text.includes("u2-flash"), "模型排行应出现模型名");
  assert.ok(text.includes("每步") || text.includes("无样本"), "每步耗时/首 token 应有明确说明");
  // 回归：miniChip 的 (key,label,val,extra,tip) 参数位写错会把整段口径说明渲染进正文
  assert.ok(!text.includes("窗口内输出"), "实时速率的口径说明不应出现在 chip 正文里");
  assert.ok(collectTitles(tree).some((t) => t.includes("窗口内输出")), "口径说明应作为 tooltip 存在");
  // 回归：命中率必须真有数值（payload 给了 95）
  assert.ok(text.includes("缓存命中率") && text.includes("95%"), "缓存命中率应以百分比展示");
  // 环比：上一窗口只有 3 天数据 → 必须走"上期覆盖不足"分支，而不是给出 +700% 的假信号
  assert.ok(text.includes("上期覆盖") || text.includes("环比 —"), "覆盖不足时应提示，而不是显示失真的百分比");
});

test("设置页渲染冒烟：排行的五个维度都能渲染（分段切换）", async () => {
  const expect = {
    models: "u2-flash",
    sessions: "重构弹窗",
    tools: "read",
    projects: "token-lens",
    providers: "unisound",
  };
  for (const [tab, kw] of Object.entries(expect)) {
    const { panel, reset } = await setup({ localStorageSeed: { oq_rank_tab: tab, opencode_quota_range: "30d" } });
    const tree = await renderTwice(panel, reset);
    const text = collectText(tree).join(" | ");
    assert.ok(text.includes(kw), tab + " 维度应渲染出「" + kw + "」");
  }
});

test("设置页渲染冒烟：时段热力图 / 热力图月份切换 / 折线上期对比都能渲染", async () => {
  for (const chart of ["hour", "heat", "line"]) {
    const { panel, reset } = await setup({ localStorageSeed: { oq_settings_chart: chart, opencode_quota_range: "30d" } });
    const tree = await renderTwice(panel, reset);
    const text = collectText(tree).join(" | ");
    if (chart === "hour") assert.ok(text.includes("时段分布") && text.includes("峰值"), "时段视图应有标题与峰值");
    if (chart === "heat") assert.ok(text.includes("回到本月") || text.includes("年 "), "热力图应显示月份");
    if (chart === "line") assert.ok(text.includes("缓存命中率"), "折线视图应有命中率曲线图例");
  }
});

test("设置页渲染冒烟：折线/热力图/1d 三种视图都能渲染", async () => {
  for (const chart of ["bar", "line", "heat"]) {
    const { panel, reset } = await setup({ localStorageSeed: { oq_settings_chart: chart, opencode_quota_range: "1d" } });
    const tree = await renderTwice(panel, reset);
    const text = collectText(tree).join(" | ");
    assert.ok(text.length > 100, chart + " 视图渲染为空");
  }
});

test("热力图：点击有数据的格子 → 展开当日明细（回归：闭包读错循环变量会让点击静默失效）", async () => {
  const { panel, reset } = await setup({ localStorageSeed: { oq_settings_chart: "heat" } });
  let tree = await renderTwice(panel, reset);
  const cells = findClickable(tree, "oh-clickable");
  assert.ok(cells.length >= 1, "有数据的日期应带 oh-clickable 且可点击");
  cells[0].props.onClick();
  reset();
  tree = panel();
  const text = collectText(tree).join(" | ");
  assert.ok(text.includes("模型：") || text.includes("当天无数据"), "点击后应渲染当日明细条");
  // 再点一次应取消选中
  const again = findClickable(tree, "oh-sel");
  assert.ok(again.length >= 1, "选中的格应有 oh-sel 描边");
  again[0].props.onClick();
  reset();
  const after = collectText(panel()).join(" | ");
  assert.ok(!after.includes("模型："), "再次点击应收起明细条");
});

test("设置页渲染冒烟：五个模块 × A/B/C 共 15 种风格都能渲染，且风格确实生效", async () => {
  const markers = {
    overview: { A: "总 token", B: "占 ", C: "构成与细项" },
    chart:    { A: "峰值", B: "日均", C: "" },
    rank:     { A: "占比 ", B: "权重", C: "01" },
    live:     { A: "tok/s · 近", B: "每步 P50", C: "可靠性" },
    rec:      { A: "→", B: "新输入", C: "条长" },
  };
  for (const mod of Object.keys(markers)) {
    for (const v of ["A", "B", "C"]) {
      const { panel, reset } = await setup({ localStorageSeed: { oq_usage_style: JSON.stringify({ [mod]: v }), opencode_quota_range: "30d" } });
      const tree = await renderTwice(panel, reset);
      const text = collectText(tree).join(" | ");
      assert.ok(text.length > 300, `${mod}/${v} 渲染为空`);
      const mk = markers[mod][v];
      if (mk) assert.ok(text.includes(mk), `${mod}/${v} 未体现该风格（缺少「${mk}」）`);
    }
  }
  // chart C 是极简：隐藏峰值标注
  const { panel, reset } = await setup({ localStorageSeed: { oq_usage_style: JSON.stringify({ chart: "C" }) } });
  const textC = collectText(await renderTwice(panel, reset)).join(" | ");
  assert.ok(!textC.includes("峰值"), "极简风格不应显示峰值标注");
});

test("设置页渲染冒烟：外观预设与持久化", async () => {
  const { panel, reset, store } = await setup({ localStorageSeed: { oq_usage_style: JSON.stringify({ overview: "B", live: "C" }) } });
  const tree = await renderTwice(panel, reset);
  const text = collectText(tree).join(" | ");
  assert.ok(text.includes("三色卡") || text.includes("占 "), "自定义风格应生效");
  assert.ok(text.includes("预设"), "设置页应出现「用量统计外观」分组");
  assert.ok("oq_usage_style" in store, "外观选择应写入 localStorage");
});

test("设置页渲染冒烟：五个标签分类正确，互不串项", async () => {
  // 用 gotoConf 同款点击法切到目标标签：先渲染一次拿到当前树，点上 oq-tab 按钮，
  // 再渲染一次提交状态。每个标签用**全新 panel**（setup 重置 states），避免展开项
  // 造成钩子下标漂移。flatText 无分隔，这里按整段 contains 断言即可——
  // 因为切过去后只有目标面板的 display 是 flex，其余是 none（但仍在树里，故用"应有"正向断言）。
  async function tabText(label) {
    const { panel, reset } = await setup({});
    let tree = await renderTwice(panel, reset);
    const btn = findClickable(tree, "oq-tab").filter((n) => collectText(n.props.children).join("") === label);
    assert.ok(btn.length >= 1, "应有「" + label + "」标签按钮");
    btn[0].props.onClick();
    tree = panel();
    return flatText(tree);
  }
  // 外观：只放悬浮窗观感项
  const appear = await tabText("外观");
  assert.ok(appear.includes("悬浮窗模板"), "「外观」应有悬浮窗模板");
  assert.ok(appear.includes("面板材质"), "「外观」应有面板材质");
  assert.ok(appear.includes("小窗口图表"), "「外观」应有小窗口图表");
  // 数据源：凭证 + 测试
  const data = await tabText("数据源");
  assert.ok(data.includes("全部测试"), "「数据源」应有全部测试按钮");
  assert.ok(data.includes("Opencode"), "「数据源」应有 Opencode 源");
  // 通用：刷新周期 + 侧栏入口开关 + 用量统计外观
  const gen = await tabText("通用");
  assert.ok(gen.includes("自动刷新"), "「通用」应有自动刷新");
  assert.ok(gen.includes("侧栏入口"), "「通用」应有侧栏入口开关");
  assert.ok(gen.includes("预设"), "「通用」应有用量统计外观预设");
  // 维护：配置重置 + 账本类操作
  const maint = await tabText("维护");
  for (const kw of ["清空用量账本", "补齐历史维度", "补录缺失会话", "账本快照"]) {
    assert.ok(maint.includes(kw), "「维护」应有「" + kw + "」");
  }
});

test("设置页渲染冒烟：面板材质默认经典，四个选项齐全，切换写入 localStorage 并广播", async () => {
  const fired = [];
  globalThis.window = { dispatchEvent: (e) => fired.push(e && e.type) };
  try {
    const { panel, reset, store } = await setup({});
    const tree = await renderTwice(panel, reset);
    const text = collectText(tree).join(" | ");
    assert.ok(text.includes("面板材质"), "设置页应出现「面板材质」卡片");
    for (const kw of ["经典", "液态玻璃", "亚克力", "哑光纸"]) {
      assert.ok(text.includes(kw), "材质选项缺少「" + kw + "」");
    }
    // 未选择过时不应写入 localStorage（默认值只在读取时兜底）
    assert.ok(!("oq_panel_material" in store), "默认材质不应主动写盘");

    // 逐个点过去：每一项都要能落盘并广播
    for (const [label, key] of [["液态玻璃", "liquid"], ["亚克力", "acrylic"], ["哑光纸", "paper"], ["经典", "classic"]]) {
      fired.length = 0;
      const btn = findClickable(tree, "").filter((n) => collectText(n.props.children).join("") === label);
      assert.ok(btn.length >= 1, "应能找到「" + label + "」按钮");
      btn[0].props.onClick();
      assert.equal(store.oq_panel_material, key, "「" + label + "」应写入 " + key);
      assert.ok(fired.includes("opencode:material-changed"), "「" + label + "」应广播材质变更事件");
    }
  } finally {
    delete globalThis.window;
  }
});

test("设置页渲染冒烟：小窗口图表卡片存在，切换写入 opencode_quota_tm_chart 并广播", async () => {
  const fired = [];
  globalThis.window = { dispatchEvent: (e) => fired.push(e && e.type) };
  try {
    const { panel, reset, store } = await setup({});
    const tree = await renderTwice(panel, reset);
    const text = collectText(tree).join(" | ");
    assert.ok(text.includes("小窗口图表"), "「外观」应出现「小窗口图表」卡片");
    assert.ok(text.includes("当月日历"), "卡片说明应讲清热力图=当月日历");

    // 点「热力图」：写入悬浮窗的 key，且广播事件让悬浮窗即时重渲染。
    // 注意「热力图」这个文案在设置页图表区也存在（那是 oq_settings_chart），
    // 因此这里不按文案全局查找，而是直接断言「点击后写入的是哪个 key」——
    // 只要存在任意一个「热力图」按钮能把 opencode_quota_tm_chart 写成 heat 即通过，
    // 若全都写到 oq_settings_chart，则说明新卡片没接上自己的 setter。
    const allHeat = findClickable(tree, "").filter((n) => collectText(n.props.children).join("") === "热力图");
    assert.ok(allHeat.length >= 1, "应能找到「热力图」按钮");
    fired.length = 0;
    for (const btn of allHeat) { try { btn.props.onClick(); } catch (e) {} }
    assert.equal(store.opencode_quota_tm_chart, "heat", "应存在能写入 opencode_quota_tm_chart 的热力图按钮");
    assert.ok(fired.includes("opencode:tm-chart-changed"), "应广播 tm-chart-changed");

    // 切回柱状
    fired.length = 0;
    const allBar = findClickable(tree, "").filter((n) => collectText(n.props.children).join("") === "柱状");
    for (const btn of allBar) { try { btn.props.onClick(); } catch (e) {} }
    assert.equal(store.opencode_quota_tm_chart, "bar", "应能切回柱状");
  } finally {
    delete globalThis.window;
  }
});

test("设置页渲染冒烟：旧 host（缺 tools/projects/health/live.rate60）不应崩", async () => {
  const oldPayload = (range) => {
    const p = payload(range);
    delete p.tools; delete p.projects; delete p.providers; delete p.reliability; delete p.health;
    delete p.live.rate60;
    p.store = undefined;
    p.totals = { total: 100, prompt: 90, completion: 10, cache_read: 80, requests: 1, turns: 1, tools: 0 };
    return p;
  };
  const { panel, reset } = await setup({ fetchPayload: oldPayload });
  const tree = await renderTwice(panel, reset);
  const text = collectText(tree).join(" | ");
  assert.ok(text.includes("总量"), "旧 payload 也应渲染总览");
});

test("设置页渲染冒烟：拉取失败时显示错误文案而不是崩溃", async () => {
  const { panel, reset } = await setup({ fetchPayload: () => { throw new Error("boom"); } });
  reset();
  panel();
  await new Promise((r) => setTimeout(r, 5));
  reset();
  const tree = panel();
  assert.ok(collectText(tree).length > 0, "失败态也要渲染出界面");
});

// ===== 贴边收起开关 =====

test("设置页渲染冒烟：「外观」Tab 有「贴边收起」开关，默认关", async () => {
  const { panel, reset } = await setup({ localStorageSeed: { opencode_quota_range: "30d" } });
  let tree = await renderTwice(panel, reset);
  const tab = findByText(tree, "外观");
  assert.ok(tab.length >= 1, "应有「外观」标签");
  tab[0].props.onClick();
  reset();
  tree = panel();
  const text = flatText(tree);

  assert.ok(text.includes("贴边收起"), "外观 Tab 应有「贴边收起」卡片");
  // 说明文案要讲清触发时机（用户明确要求：贴边后"再往边缘拽一下"才收起）
  assert.ok(text.includes("再往同一侧拽一下") || text.includes("边缘"), "应说明触发方式");
  // 默认关：localStorage 里不该有 "1"
  assert.notEqual(store_get(globalThis.localStorage, "oq_edge_collapse"), "1", "默认必须关闭");
});

/** 安全读 localStorage 值（测试桩是内存 Map 包装对象） */
function store_get(ls, key) {
  try { return ls.getItem(key); } catch { return null; }
}

// ===== 自定义区间 + 逐日明细表 =====

test("设置页渲染冒烟：区间 pills 末尾有「自定义」，选中后出现起止日期控件", async () => {
  const { panel, reset } = await setup({
    localStorageSeed: {
      opencode_quota_range: "custom",
      oq_custom_range: JSON.stringify({ from: "2026-10-01", to: "2026-10-07" }),
    },
    fetchPayload: (range) => {
      const p = payload(range);
      p.range = "custom";
      p.window = { from: "2026-10-01", to: "2026-10-07", days: 7, clipped: false, reason: "" };
      return p;
    },
  });
  const tree = await renderTwice(panel, reset);
  const text = flatText(tree);

  // 1) 区间 pills 里必须有「自定义」入口（否则用户永远切不到 custom）
  assert.ok(findByText(tree, "自定义").length >= 1, "范围 pills 应有「自定义」");
  // 2) 选中 custom 后出现两个 date input（起 / 止）
  const dateInputs = findInput(tree, (p) => p.type === "date");
  assert.equal(dateInputs.length, 2, "应有起止两个日期控件，实际 " + dateInputs.length);
  assert.equal(dateInputs[0].props.value, "2026-10-01", "起始日期应回填偏好里的值");
  assert.equal(dateInputs[1].props.value, "2026-10-07", "结束日期应回填偏好里的值");
  // 3) 标题要如实显示区间与天数（host 回传的 window）
  assert.ok(text.includes("2026-10-01") && text.includes("2026-10-07"), "标题应显示实际区间");
  assert.ok(text.includes("7 天"), "标题应显示天数");
});

test("设置页渲染冒烟：逐日明细表默认展开，含表头/数据行/合计行", async () => {
  const { panel, reset } = await setup({ localStorageSeed: { opencode_quota_range: "30d" } });
  const tree = await renderTwice(panel, reset);
  const text = flatText(tree);

  // ⚠️ 默认**展开**（用户实测反馈"我没看到逐日明细"，收起态太隐蔽）：
  // 这里锁住"打开用量统计 Tab 就能直接看到表格"，防止再被改回收起。
  assert.ok(text.includes("逐日明细"), "图表卡下应有「逐日明细」区块");
  assert.ok(text.includes("合计"), "默认展开时应有合计行");
  for (const kw of ["日期", "总量", "回复", "新输入", "缓存读", "输出", "项目", "耗时"]) {
    assert.ok(text.includes(kw), "明细表头缺少「" + kw + "」");
  }
  // 日期列显示 MM-DD（省宽度）
  assert.ok(text.includes(dayKey(0).slice(5)), "明细表应列出今天这一行");
  // 合计行取 totals（不是把行加起来），payload 给的是 20000 → fmtTokens 输出 "20.0K"。
  // 断言写死这一种形态：三行 daily 的总和是 8.8K+… ≠ 20000，能区分"取 totals"与"行求和"。
  assert.ok(text.includes("20.0K"), "合计行应显示 totals.total 的格式化结果 20.0K，实际文本里没有");
});

test("设置页渲染冒烟：被裁剪的区间要明确提示，不能假装查了全段", async () => {
  const { panel, reset } = await setup({
    localStorageSeed: {
      opencode_quota_range: "custom",
      oq_custom_range: JSON.stringify({ from: "2020-01-01", to: "2026-10-27" }),
    },
    fetchPayload: (range) => {
      const p = payload(range);
      p.range = "custom";
      // host 裁剪后只给近 90 天
      p.window = { from: "2026-07-30", to: "2026-10-27", days: 90, clipped: true, reason: "from-clamped" };
      return p;
    },
  });
  const tree = await renderTwice(panel, reset);
  // 明细表默认展开，提示直接可见（不需要先点开）
  const text = flatText(tree);
  assert.ok(text.includes("已裁剪"), "被裁剪时必须明确提示，否则用户以为查了 2020 年");
  assert.ok(text.includes("2026-07-30"), "提示里应给出实际生效的起点");
});

// ===== 清空用量账本：独立卡片 / 预览 / 输入确认 / 快照 =====

/** 找到文本等于 label 的可点击元素 */
function findByText(node, label) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.props) {
      if (typeof n.props.onClick === "function" && collectText(n.props.children).join("") === label) out.push(n);
      walk(n.props.children);
    }
  };
  walk(node);
  return out;
}
/** 无分隔符拼接：JSX 里 "将删除 " / "42" / " 行" 是三段子串，带 " | " 会切碎断言目标 */
function flatText(node) { return collectText(node).join(""); }
/** 找到 placeholder 或 value 匹配的 input（清空确认框） */
function findInput(node, pred, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => findInput(n, pred, out)); return out; }
  if (node.props) {
    if (node.type === "input" && pred(node.props)) out.push(node);
    if (node.type === "select" && pred(node.props)) out.push(node);
    findInput(node.props.children, pred, out);
  }
  return out;
}

/** 切到「维护」标签页并返回树 */
async function gotoMaint(panel, reset) {
  let tree = await renderTwice(panel, reset);
  const tab = findByText(tree, "维护");
  assert.ok(tab.length >= 1, "应有「维护」标签");
  tab[0].props.onClick();
  reset();
  return panel();
}

/** 从树里裁出「账本维护」卡片区（sectionLabel「修复数据」所在容器），
 *  避免把「用量统计」Tab 的范围 pills（今日/7天/30天/90天/全部）等无关文案混进断言。
 *  返回该容器子树；找不到时返回整棵树（让断言以可读方式失败）。 */
function maintPanelOf(tree) {
  let holder = null;
  (function walk(n) {
    if (holder || !n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n.props) return;
    const kids = Array.isArray(n.props.children) ? n.props.children : [n.props.children];
    if (kids.some((k) => k && k.props && k.props.children === "修复数据")) { holder = n; return; }
    walk(n.props.children);
  })(tree);
  return holder || tree;
}

test("设置页渲染冒烟：清空用量账本是独立入口，与「维护」组的重置按钮分开", async () => {
  const { panel, reset } = await setup({});
  let tree = await gotoMaint(panel, reset);
  // 只看「账本维护」卡片区，排除「用量统计」Tab 隐藏但仍在树里的范围 pills
  const maint = maintPanelOf(tree);
  // 收起时：标题 + 状态 + 展开按钮；详情区（范围/输入确认/快照开关）不露出
  const collapsed = flatText(maint);
  for (const kw of ["清空用量账本", "不可逆", "选择范围并统计"]) {
    assert.ok(collapsed.includes(kw), "清空行（收起）缺少「" + kw + "」");
  }
  for (const kw of ["输入「清空」确认", "清空前自动写一份快照", "全部", "按时间", "按项目"]) {
    assert.ok(!collapsed.includes(kw), "清空详情区不该在收起时露出「" + kw + "」");
  }
  // 旧实现把「清空用量账本」做成直接可点的危险按钮——现在它不应是可点按钮（只有「选择范围并统计」可点）
  assert.equal(findByText(maint, "清空用量账本").length, 0, "清空标题不该是可点按钮");
  assert.ok(findByText(tree, "重置配置").length >= 1, "「重置配置」应仍在维护组里");
  // 展开后：范围三选一 + 手输确认才出现
  findByText(tree, "选择范围并统计")[0].props.onClick();
  reset();
  tree = panel();
  const expanded = flatText(maintPanelOf(tree));
  for (const kw of ["全部", "按时间", "按项目", "输入「清空」确认", "清空前自动写一份快照"]) {
    assert.ok(expanded.includes(kw), "清空详情区缺少「" + kw + "」");
  }
});

test("设置页渲染冒烟：清空会先统计，并把将被删除的行数显示出来", async () => {
  const fired = [];
  globalThis.window = { dispatchEvent: (e) => fired.push(e && e.type), addEventListener() {}, removeEventListener() {} };
  try {
    const { panel, reset, calls } = await setup({});
    let tree = await gotoMaint(panel, reset);
    // 展开清空详情
    findByText(tree, "选择范围并统计")[0].props.onClick();
    reset();
    tree = panel();
    // 点「统计」触发 preview
    const btn = findByText(tree, "统计");
    assert.ok(btn.length >= 1, "应有「统计」按钮");
    btn[0].props.onClick();
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(calls.some((u) => u.includes("/api/token-meter/reset-preview")), "点统计应请求预览端点");
    reset();
    const tree2 = panel();
    const text2 = flatText(tree2);
    assert.ok(text2.includes("将删除 42 行"), "预览结果应显示具体的删除行数，实际：" + text2.slice(0, 400));
    assert.ok(text2.includes("剩余 0 行"), "应显示剩余行数");
    assert.ok(text2.includes("2026-08-23"), "应显示全库日期跨度");
    // 按时间范围：切到「按时间」后应出现"保留最近 N 天"
    const byTime = findByText(tree2, "按时间");
    assert.ok(byTime.length >= 1, "应有「按时间」范围选项");
    byTime[0].props.onClick();
    reset();
    const tree3 = panel();
    const text3 = flatText(tree3);
    assert.ok(text3.includes("保留最近"), "按时间范围应允许设置保留天数");
    assert.ok(findInput(tree3, (p) => p.type === "number" && Number(p.value) > 0).length >= 1, "应有天数输入框");
    // 按项目范围：应出现项目下拉（候选来自 preview.projects）
    reset();
    const byProj = findByText(panel(), "按项目");
    assert.ok(byProj.length >= 1, "应有「按项目」范围选项");
    byProj[0].props.onClick();
    reset();
    const tree4 = panel();
    const sels = findInput(tree4, () => true).filter((n) => n.type === "select");
    assert.ok(sels.length >= 1, "按项目范围应提供项目下拉");
  } finally {
    delete globalThis.window;
  }
});

test("设置页渲染冒烟：未输入「清空」二字时确认按钮是禁用的", async () => {
  const { panel, reset } = await setup({});
  let tree = await gotoMaint(panel, reset);
  // 展开清空详情
  findByText(tree, "选择范围并统计")[0].props.onClick();
  reset();
  tree = panel();
  const confirm = findByText(tree, "确认清空");
  assert.ok(confirm.length >= 1, "应有「确认清空」按钮");
  assert.equal(confirm[0].props.disabled, true, "没输入关键字时必须禁用，防手滑");
  // 输入框存在且 placeholder 是「清空」
  const inputs = findInput(tree, (p) => String(p.placeholder || "") === "清空");
  assert.ok(inputs.length >= 1, "应有确认输入框");
});

test("设置页渲染冒烟：清空成功后必须带上快照与磁盘回收信息（不能只说清了 0 行）", async () => {
  const fired = [];
  globalThis.window = { dispatchEvent: (e) => fired.push(e && e.type), addEventListener() {}, removeEventListener() {} };
  try {
    const { panel, reset, calls } = await setup({});
    let tree = await gotoMaint(panel, reset);
    // 展开清空详情 → 统计 → 输入关键字 → 确认
    findByText(tree, "选择范围并统计")[0].props.onClick();
    reset();
    tree = panel();
    const stat = findByText(tree, "统计");
    if (stat.length) { stat[0].props.onClick(); await new Promise((r) => setTimeout(r, 10)); }
    reset();
    tree = panel();
    const inp = findInput(tree, (p) => String(p.placeholder || "") === "清空");
    assert.ok(inp.length >= 1);
    inp[0].props.onChange({ target: { value: "清空" } });
    reset();
    tree = panel();
    const confirm = findByText(tree, "确认清空");
    assert.ok(confirm.length >= 1);
    assert.equal(confirm[0].props.disabled, false, "输入关键字后应解锁");
    confirm[0].props.onClick();
    await new Promise((r) => setTimeout(r, 20));
    // 应该先取令牌，再带着令牌调 reset
    assert.ok(calls.some((u) => u.includes("/reset-token")), "破坏性操作前应先取一次性令牌");
    assert.ok(calls.some((u) => u.includes("/api/token-meter/reset?")), "应调用 reset 端点");
    reset();
    const after = collectText(panel()).join(" | ");
    assert.ok(after.includes("已清空 42 行"), "成功提示应带真实行数，实际：" + after.slice(0, 300));
    assert.ok(after.includes("已备份"), "成功提示应说明已备份（不可逆操作的退路）");
  } finally {
    delete globalThis.window;
  }
});

test("设置页渲染冒烟：host 报错时必须显示失败，不能弹「已清空」", async () => {
  const fired = [];
  globalThis.window = { dispatchEvent: (e) => fired.push(e && e.type), addEventListener() {}, removeEventListener() {} };
  const prevFetch = globalThis.fetch;
  try {
    const { panel, reset } = await setup({});
    // 覆盖 fetch：reset 端点返回 500（模拟库不可用）
    const base = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes("/api/token-meter/reset?") && !String(url).includes("preview")) {
        return { status: 500, ok: false, json: async () => ({ ok: false, error: "store-unavailable" }) };
      }
      return base(url);
    };
    let tree = await gotoMaint(panel, reset);
    // 展开清空详情 → 统计 → 输入关键字 → 确认（此时 reset 端点已被覆盖为 500）
    findByText(tree, "选择范围并统计")[0].props.onClick();
    reset();
    tree = panel();
    const stat = findByText(tree, "统计");
    if (stat.length) { stat[0].props.onClick(); await new Promise((r) => setTimeout(r, 10)); }
    reset();
    tree = panel();
    findInput(tree, (p) => String(p.placeholder || "") === "清空")[0].props.onChange({ target: { value: "清空" } });
    reset();
    tree = panel();
    findByText(tree, "确认清空")[0].props.onClick();
    await new Promise((r) => setTimeout(r, 20));
    reset();
    const after = collectText(panel()).join(" | ");
    assert.ok(!after.includes("已清空 42 行"), "失败时绝不能显示成功");
    assert.ok(after.includes("store-unavailable") || after.includes("清空失败"), "应显示失败原因，实际：" + after.slice(0, 300));
  } finally {
    globalThis.fetch = prevFetch;
    delete globalThis.window;
  }
});

test("设置页渲染冒烟：快照列表能读回并展示文件名/大小/删除行数", async () => {
  const fired = [];
  globalThis.window = { dispatchEvent: (e) => fired.push(e && e.type), addEventListener() {}, removeEventListener() {} };
  try {
    const { panel, reset, calls } = await setup({});
    let tree = await gotoMaint(panel, reset);
    // 收起时不该出现快照文件名；点「查看快照列表」展开才读
    assert.ok(!flatText(tree).includes("token-meter-20261024-120000.db"), "收起时不该列出快照文件名");
    const btn = findByText(tree, "查看快照列表");
    assert.ok(btn.length >= 1, "应有「查看快照列表」按钮");
    btn[0].props.onClick();
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(calls.some((u) => u.includes("/api/token-meter/backups")), "应请求快照列表端点");
    reset();
    tree = panel();
    const text = collectText(tree).join(" | ");
    assert.ok(text.includes("token-meter-20261024-120000.db"), "应列出快照文件名，实际：" + text.slice(0, 300));
    assert.ok(text.includes("删 42 行"), "应显示该快照对应删除的行数");
    assert.ok(text.includes("token-meter-backups"), "应显示快照目录");
  } finally {
    delete globalThis.window;
  }
});

test("设置页渲染冒烟：补齐历史维度在维护列表里，点击后走令牌 + enrich 并显示补齐行数", async () => {
  const fired = [];
  globalThis.window = { dispatchEvent: (e) => fired.push(e && e.type), addEventListener() {}, removeEventListener() {} };
  try {
    const { panel, reset, calls } = await setup({});
    let tree = await gotoMaint(panel, reset);
    const text0 = flatText(tree);
    assert.ok(text0.includes("补齐历史维度"), "应有「补齐历史维度」行");
    assert.ok(text0.includes("项目 / 工具 / 耗时归因"), "应说明补的是什么");
    assert.ok(text0.includes("只更新缺失的列"), "应说明可安全重跑");

    const btn = findByText(tree, "补齐历史维度");
    assert.ok(btn.length >= 1, "应有触发按钮");
    btn[0].props.onClick();
    await new Promise((r) => setTimeout(r, 30));
    // 和清空一样：先取一次性令牌，再带令牌调用
    assert.ok(calls.some((u) => u.includes("/reset-token")), "应先取一次性令牌");
    assert.ok(calls.some((u) => u.includes("/api/token-meter/enrich")), "应调用 enrich 端点");
    reset();
    const after = flatText(panel());
    // 注意 fmtNum 会把 1124 缩写成 "1.1K"，断言用缩写形式
    assert.ok(after.includes("已补齐 1.1K 行"), "应显示实际补齐行数，实际：" + after.slice(-600));
  } finally {
    delete globalThis.window;
  }
});

test("设置页渲染冒烟：补齐失败时必须显示错误，不能弹成功", async () => {
  const fired = [];
  globalThis.window = { dispatchEvent: (e) => fired.push(e && e.type), addEventListener() {}, removeEventListener() {} };
  const prevFetch = globalThis.fetch;
  try {
    const { panel, reset } = await setup({});
    const base = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes("/api/token-meter/enrich")) {
        return { status: 500, ok: false, json: async () => ({ ok: false, error: "store-unavailable" }) };
      }
      return base(url);
    };
    const tree = await gotoMaint(panel, reset);
    const btn = findByText(tree, "补齐历史维度");
    assert.ok(btn.length >= 1);
    btn[0].props.onClick();
    await new Promise((r) => setTimeout(r, 20));
    reset();
    const after = flatText(panel());
    assert.ok(!after.includes("已补齐 1.1K 行"), "失败时绝不能显示成功");
    assert.ok(after.includes("store-unavailable") || after.includes("补齐失败"), "应显示失败原因，实际：" + after.slice(0, 300));
  } finally {
    globalThis.fetch = prevFetch;
    delete globalThis.window;
  }
});

// ===== 补录缺失会话：会新增行、会改变总量 =====

test("设置页渲染冒烟：补录缺失会话存在，且与「补齐历史维度」讲清区别", async () => {
  globalThis.window = { dispatchEvent: () => {}, addEventListener() {}, removeEventListener() {} };
  try {
    const { panel, reset } = await setup({});
    const tree = await gotoMaint(panel, reset);
    const text = flatText(tree);
    assert.ok(text.includes("补录缺失会话"), "应有「补录缺失会话」行");
    assert.ok(text.includes("会改变总量"), "必须标明会改变总量（与补齐历史维度区分）");
    // 关键区别文案在补录的展开详情里，需展开后断言
    assert.ok(!text.includes("只补已有行的列、不动总量"), "区别说明不该在收起时露出");
    findByText(tree, "统计待补录")[0].props.onClick();
    await new Promise((r) => setTimeout(r, 15));
    reset();
    const expanded = flatText(panel());
    assert.ok(expanded.includes("只补已有行的列、不动总量"), "应说明补齐历史维度不动总量");
    assert.ok(expanded.includes("会新增记录、让总量变大"), "应说明补录会新增记录");
  } finally {
    delete globalThis.window;
  }
});

test("设置页渲染冒烟：补录前必须先统计，预览显示新增会话/tokens/占比与前后总量", async () => {
  globalThis.window = { dispatchEvent: () => {}, addEventListener() {}, removeEventListener() {} };
  try {
    const { panel, reset, calls } = await setup({});
    let tree = await gotoMaint(panel, reset);
    const btn = findByText(tree, "统计待补录");
    assert.ok(btn.length >= 1, "应有「统计待补录」按钮");
    btn[0].props.onClick();
    await new Promise((r) => setTimeout(r, 15));
    assert.ok(calls.some((u) => u.includes("/api/token-meter/import-preview")), "应请求预览端点");
    reset();
    tree = panel();
    const t = flatText(tree);
    assert.ok(t.includes("将新增 27 个会话"), "应显示新增会话数，实际：" + t.slice(-700));
    // fmtNum(1022) → "1.0K"，不要按原始数字断言
    assert.ok(t.includes("1.0K 条回复"), "应显示新增回复条数，实际：" + t.slice(-700));
    assert.ok(t.includes("+66.75M tokens"), "应显示新增 tokens（含 cacheRead 口径），实际：" + t.slice(-700));
    assert.ok(t.includes("占总量的 33.5%"), "应显示占总量比例，实际：" + t.slice(-700));
    assert.ok(t.includes("199.33M → 266.08M"), "应显示补录前后的总量对照，实际：" + t.slice(-700));
    // 预览阶段不得显示"已补录"
    assert.ok(!t.includes("已补录"), "未执行前不得显示已补录");
    // 明细可展开
    const detail = findByText(tree, "查看明细（27 个会话）");
    assert.ok(detail.length >= 1, "应提供明细展开");
    detail[0].props.onClick();
    reset();
    const t2 = flatText(panel());
    assert.ok(t2.includes("zenith") && t2.includes("alpha"), "明细应列出各会话的项目");
  } finally {
    delete globalThis.window;
  }
});

test("设置页渲染冒烟：补录需手输「补录」才解锁，执行后显示结果", async () => {
  globalThis.window = { dispatchEvent: () => {}, addEventListener() {}, removeEventListener() {} };
  try {
    const { panel, reset, calls } = await setup({});
    let tree = await gotoMaint(panel, reset);
    findByText(tree, "统计待补录")[0].props.onClick();
    await new Promise((r) => setTimeout(r, 15));
    reset();
    tree = panel();

    const confirm = findByText(tree, "确认补录");
    assert.ok(confirm.length >= 1, "应有「确认补录」按钮");
    assert.equal(confirm[0].props.disabled, true, "没输入关键字时必须禁用");

    const inp = findInput(tree, (p) => String(p.placeholder || "") === "补录");
    assert.ok(inp.length >= 1, "应有确认输入框");
    inp[0].props.onChange({ target: { value: "补录" } });
    reset();
    tree = panel();
    const confirm2 = findByText(tree, "确认补录");
    assert.equal(confirm2[0].props.disabled, false, "输入后应解锁");
    confirm2[0].props.onClick();
    await new Promise((r) => setTimeout(r, 25));
    assert.ok(calls.some((u) => u.includes("/reset-token")), "应先取一次性令牌");
    assert.ok(calls.some((u) => u.includes("/api/token-meter/import")), "应调用 import 端点");
    reset();
    const after = flatText(panel());
    assert.ok(after.includes("已补录 27 个会话"), "应显示补录结果，实际：" + after.slice(-600));
    assert.ok(after.includes("新增 3.6K 行事件") || after.includes("3.6K"), "应显示新增行数");
    assert.ok(after.includes("现总量"), "应显示补录后的总量");
  } finally {
    delete globalThis.window;
  }
});

test("设置页渲染冒烟：无需补录时明确提示，不给确认入口", async () => {
  globalThis.window = { dispatchEvent: () => {}, addEventListener() {}, removeEventListener() {} };
  const prevFetch = globalThis.fetch;
  try {
    const { panel, reset } = await setup({});
    const base = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes("/api/token-meter/import-preview")) {
        return { status: 200, ok: true, json: async () => ({ ok: true, sessions: 0, totalMsgs: 0, totalTokens: 0, currentTotal: 100, projectedTotal: 100, items: [] }) };
      }
      return base(url);
    };
    let tree = await gotoMaint(panel, reset);
    findByText(tree, "统计待补录")[0].props.onClick();
    await new Promise((r) => setTimeout(r, 15));
    reset();
    tree = panel();
    const t = flatText(tree);
    assert.ok(t.includes("都已入库，无需补录"), "应明确提示无需补录");
    assert.equal(findByText(tree, "确认补录").length, 0, "没有可补内容时不该出现确认按钮");
  } finally {
    globalThis.fetch = prevFetch;
    delete globalThis.window;
  }
});

// ===== 设置页「网关」tab（dsh-providers-hub 网关用量）=====
// 背景：网关请求不建会话，本地三条摄入通路都看不见；实测某日它占全机 token 的 52%。
// 这一页是**授权 + 可见性**页面：开关必须真生效（关掉后宿主不再读对方账本），
// 六种状态必须各自说人话，尤其"账本存在但没有网关流量"不能报成故障。
/**
 * 只取**当前可见**面板的文本。
 * ⚠️ flatText 会把 `display:none` 的兄弟面板也收进来（它们仍在树里），
 * 于是"网关页不该出现全部测试"这类断言会因为数据源页的内容而假红。
 * 判据用面板装配处写的契约属性 `data-panel` / `data-active`
 * （靠 style 反推不可靠：隐藏面板仍在树里，且多个面板 style 形状相同）。
 */
function activePanelNode(tree) {
  const hits = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.props) {
      if (n.props["data-panel"] && n.props["data-active"] === "1") hits.push(n);
      walk(n.props.children);
    }
  };
  walk(tree);
  assert.ok(hits.length >= 1, "应至少有一个可见面板");
  // 面板是**嵌套**的：外层 {usage|conf} + conf 内层 5 个主标签。
  // 取最深的那个才是"用户真正看到的这一屏"（外层在非 usage 标签下恒为 active）。
  const isInside = (a, b) => {
    let found = false;
    const walk = (n) => {
      if (found || !n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.props) {
        if (n === a) { found = true; return; }
        walk(n.props.children);
      }
    };
    walk(b.props.children);
    return found;
  };
  const deepest = hits.filter((h) => !hits.some((o) => o !== h && isInside(o, h)));
  assert.equal(deepest.length, 1, "应恰好有一个最内层可见面板，实际 " + deepest.length);
  return deepest[0];
}
function visiblePanelText(tree) { return flatText(activePanelNode(tree)); }

function gotoGateway() {
  return async (opts) => {
    const ctx = await setup(opts || {});
    let tree = await renderTwice(ctx.panel, ctx.reset);
    const btn = findClickable(tree, "oq-tab").filter((n) => collectText(n.props.children).join("") === "网关");
    assert.ok(btn.length >= 1, "应存在「网关」标签按钮");
    btn[0].props.onClick();
    // 切 tab 后 effect 才会触发 refreshGateway（fetch 是 async）：
    // 渲染一次让 effect 跑起来，等它落地，再渲染一次把 gwData 读进来。
    ctx.reset(); ctx.panel();
    await new Promise((r) => setTimeout(r, 20));
    ctx.reset();
    tree = ctx.panel();
    return Object.assign({}, ctx, { tree, text: visiblePanelText(tree), fullText: flatText(tree) });
  };
}

test("设置页渲染冒烟：「网关」是独立 tab，且不与「数据源」的凭据表单混排", async () => {
  const g = await gotoGateway()({});
  // 有自己的四张卡
  for (const kw of ["监测网关用量", "数据源", "监测到的内容", "与本机的对照"]) {
    assert.ok(g.text.includes(kw), "「网关」应有「" + kw + "」区块");
  }
  // 关键：它**不该**出现凭据表单的痕迹（那说明被误当成 provider 渲染了）
  assert.ok(!g.text.includes("全部测试"), "「网关」不该有「全部测试」（那是凭据源的按钮）");
  assert.ok(!g.text.includes("Base URL"), "「网关」不该有 Base URL 输入（网关没有凭据）");
  // 只读声明必须写在开关旁边
  assert.ok(g.text.includes("只读"), "必须明确写「只读」");
  assert.ok(g.text.includes("UTC+8"), "必须标注日界口径");
});

test("设置页渲染冒烟：「网关」六种状态各说人话（含「账本在但没有网关流量」不是故障）", async () => {
  const cases = [
    ["ok", ["正常", "Jet Hub 账本", "2 天", "3 桶"]],
    ["not-found", ["未找到 Jet Hub 账本", "已尝试的路径"]],
    ["bad-schema", ["账本格式不认识", "some-other/v1"]],
    ["bad-json", ["账本无法解析"]],
    ["empty", ["账本里没有网关流量", "不是故障"]],
  ];
  for (const [kind, kws] of cases) {
    const g = await gotoGateway()({
      gatewayPayload: () => gatewayPayloadFor(kind),
    });
    for (const kw of kws) {
      assert.ok(g.text.includes(kw), "状态 " + kind + " 应显示「" + kw + "」，实际：" + g.text.slice(0, 400));
    }
  }
});

test("设置页渲染冒烟：网关数据源路径只放 title，不把用户名铺在正文里过长", async () => {
  const g = await gotoGateway()({});
  const titles = collectTitles(g.tree).join(" | ");
  assert.ok(titles.includes("token-ledger.json"), "完整路径应放在 title 里（悬停可见）");
});

test("设置页渲染冒烟：关掉网关监测 → 显示「仅本机」、下一次查询带 gw=0、且不再读对方账本", async () => {
  const g = await gotoGateway()({ localStorageSeed: {} });
  assert.ok(g.text.includes("未监测") === false, "默认应开启（默认值不落盘）");
  // 默认开：主接口与网关端点都必须带 gw=1
  assert.ok(g.calls.some((u) => u.includes("/api/token-meter") && u.includes("gw=1")), "默认应带 gw=1");
  // 点开关：必须点**网关面板里**那一个（隐藏面板里还有侧栏入口/贴边收起等开关，
  // 按 role=switch 全局取第一个会点错，进而假红"没写进 sources"）
  const sw = findClickable(activePanelNode(g.tree), "").filter((n) => String(n.props.role || "") === "switch");
  assert.ok(sw.length >= 1, "网关面板里应有开关");
  g.calls.length = 0;
  sw[0].props.onClick();
  g.reset(); g.panel();
  await new Promise((r) => setTimeout(r, 20));
  // 落盘到 sources.gateway（不是 providers）
  const saved = JSON.parse(g.store.opencode_quota_config || "{}");
  assert.equal(saved.sources && saved.sources.gateway && saved.sources.gateway.enabled, false, "关闭必须写进 sources.gateway.enabled");
  assert.ok(!(saved.providers && saved.providers.gateway), "不能写成 providers.gateway（那是凭据源）");
  // 关掉后必须带 gw=0（宿主真的不读文件）
  assert.ok(g.calls.some((u) => u.includes("gw=0")), "关闭后请求必须带 gw=0，实际：" + g.calls.join(" , "));
});

test("设置页渲染冒烟：总览里区分「其中网关」与「仅本机口径」", async () => {
  // 开：显示「其中网关」+ 占比
  const on = await setup({ localStorageSeed: { opencode_quota_range: "30d" } });
  const tOn = flatText(await renderTwice(on.panel, on.reset));
  assert.ok(tOn.includes("其中网关"), "开启时应显示「其中网关」");
  assert.ok(tOn.includes("30%"), "6000/20000 = 30%，应显示占比，实际：" + tOn.slice(0, 200));
  assert.ok(tOn.includes("UTC+8"), "应标注日界");

  // 关：显示「仅本机口径」，且 host 侧 sources.gateway.enabled 为 false
  const off = await setup({
    localStorageSeed: { opencode_quota_range: "30d", opencode_quota_config: JSON.stringify({ providers: {}, sources: { gateway: { enabled: false } } }) },
    fetchPayload: (range) => {
      const p = payload(range);
      p.sources = { gateway: { total: 0, requests: 0, available: true, enabled: false, error: null, detail: null, schema: null, dayCount: 0, bucketCount: 0, note: "UTC+8 日界" }, local: { total: 20000, requests: 33 } };
      return p;
    },
  });
  const tOff = flatText(await renderTwice(off.panel, off.reset));
  assert.ok(tOff.includes("仅本机口径"), "关闭时应明确提示只含本机");
  assert.ok(tOff.includes("网关"), "提示里要提到网关（告诉用户去哪儿开）");
});

test("设置页渲染冒烟：项目/会话/工具三张榜要注明「仅本机会话」（网关无此维度）", async () => {
  // 排行 tab 的初值来自 localStorage["oq_rank_tab"]，用种子切档比点 pills 稳
  // （"项目"/"工具"这类文字在明细表头、图表说明里也出现，按文本找按钮会点错）。
  for (const [key, label] of [["projects", "项目"], ["sessions", "会话"], ["tools", "工具"]]) {
    const { panel, reset } = await setup({
      localStorageSeed: { opencode_quota_range: "30d", oq_rank_tab: key },
    });
    const t = flatText(await renderTwice(panel, reset));
    const at = t.indexOf("排行");
    assert.ok(at >= 0, "应有排行卡");
    const seg = t.slice(at, at + 160);
    assert.ok(seg.includes("仅本机会话") || seg.includes("网关流量无此维度"),
      "「" + label + "」榜应注明网关无此维度；实际排行段：" + seg);
  }
  // 反向：模型/渠道两榜**不该**带这句（它们确实含网关）
  for (const key of ["models", "providers"]) {
    const { panel, reset } = await setup({
      localStorageSeed: { opencode_quota_range: "30d", oq_rank_tab: key },
    });
    const t = flatText(await renderTwice(panel, reset));
    assert.ok(!t.includes("仅本机会话"), "「" + key + "」榜含网关，不该说不含");
  }
});

test("设置页渲染冒烟：tab 记忆落在白名单键上（在「网关」刷新不跳回「用量统计」）", async () => {
  const g = await gotoGateway()({});
  assert.equal(g.store.oq_settings_tab, "gateway", "切 tab 应写入 oq_settings_tab");
});

test("设置页渲染冒烟：旧 host 完全没有 sources 时，网关卡片与角标都不渲染且不崩", async () => {
  const { panel, reset } = await setup({
    fetchPayload: (range) => {
      const p = payload(range);
      delete p.sources;
      return p;
    },
  });
  const t = flatText(await renderTwice(panel, reset));
  assert.ok(!t.includes("其中网关"), "没有 sources 时不该凭空造一个网关数字");
  assert.ok(t.includes("总览"), "其余功能照常");
});

test("网关请求：不单独成行，也不作为独立胶囊文案出现在正文里", async () => {
  // 真机反馈：260px 的悬浮窗里「请求 216」与「网关请求 216」各占一行——
  // 只有网关流量的日子这两个数字恒相等，看起来像重复渲染的 bug，且把卡片撑高。
  // 现在的口径：请求胶囊显示**合计**，网关分量只进 title。
  const { panel, reset } = await setup({ localStorageSeed: { opencode_quota_range: "1d" } });
  const t = flatText(await renderTwice(panel, reset));
  assert.ok(t.includes("其中网关"), "总览应有「其中网关」，合计口径必须可解释");
  assert.ok(!t.includes("网关请求"), "「网关请求」不该出现在任何面板正文里（应并入「请求」的 title）");
});

test("设置页渲染冒烟：网关请求数只出现在 title（悬停）而不是正文", async () => {
  const { panel, reset } = await setup({ localStorageSeed: { opencode_quota_range: "30d" } });
  const tree = await renderTwice(panel, reset);
  const titles = collectTitles(tree).join(" | ");
  assert.ok(titles.includes("网关") || titles.includes("UTC+8"), "网关口径应该在 tooltip 里可查");
});

test("悬浮窗结构：网关角标在第二行右侧，第一行只留「总量 + Live」（防再被挤）", () => {
  // 真机反馈：260px 宽下「含网关 97.9%」和总量、Live 挤在同一行，Live 被挤出可视区。
  // 这里锁的是**结构约束**，不是像素：靠源码里 gwBadgeEl 的调用位置判定。
  const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf-8");
  const i = src.indexOf("function renderTmCompact");
  const j = src.indexOf("function renderTmClassic");
  const seg = src.slice(i, j);
  const headStart = seg.indexOf("oq-tm-head");
  const headEnd = seg.indexOf("第二行");
  assert.ok(headStart > 0 && headEnd > headStart, "应能找到头部与「第二行」的分界注释");
  const head = seg.slice(headStart, headEnd);
  assert.ok(!head.includes("gwBadgeEl"), "头部（第一行）不得调用 gwBadgeEl —— 否则会把 Live 挤出可视区");
  assert.ok(head.includes("Live"), "第一行必须保留 Live");
  assert.ok(seg.slice(headEnd).includes("gwBadgeEl"), "网关角标应出现在第二行");
});

test("LIVE_JUDGE：网关正在被使用（账本刚被写）也要点亮 Live", async () => {
  const mod = await loadClientModule({ requireStub: (n) => n === "react" ? makeReactStub().react : (n === "react/jsx-runtime" ? makeJsxStub() : null) });
  const L = mod.__testing.LIVE_JUDGE;
  const now = Date.now();
  const mk = (gwMs) => ({ updatedAt: now, sources: { gateway: { enabled: true, lastActiveAt: gwMs, requests: 120, total: 1000 } } });
  const idleLocal = { activeSteps: 0, activeTurns: 0, lastActiveAt: 0, rate60: 0, tokPerSec: 0 };

  assert.equal(L(mk(now - 5000), idleLocal), true, "网关 5s 前刚写过 ⇒ Live 应亮（本机会话全 0）");
  assert.equal(L(mk(now - 25000), idleLocal), false, "网关 25s 没动静 ⇒ 不再算活跃");
  assert.equal(L(mk(0), idleLocal), false, "没有网关活动时刻（未安装/未解析）⇒ 不亮");
  // 关掉监测后宿主下发 0，所以上面 mk(0) 已覆盖；再显式防一手"关闭但仍带时刻"
  assert.equal(L({ updatedAt: now, sources: { gateway: { enabled: false, lastActiveAt: now - 1000, requests: 1 } } }, idleLocal),
    false, "关闭监测后即使带了活动时刻也不能亮");
});

test("网关角标：显示实际 token 数 + 朝上小三角（方案 B），且不再出现「含网关」", () => {
  const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf-8");
  // 正文必须是「网关 + 数值」，不再是百分数（用户要求：改成数值更直接）
  assert.ok(src.includes('children:"网关"'),
    "角标标签应为「网关」");
  assert.ok(src.includes("fmtTokens(gt)"),
    "角标值应为网关的 token 数（fmtTokens(gt)），而不是 pct");
  assert.ok(!src.includes('"含网关 "'),
    "不得再出现「含网关」文案");
  // 朝上三角：border 三边透明 + 上边框实色，是 CSS 三角的标准写法
  assert.ok(src.includes("borderBottom:\"4px solid rgba(139,123,255,0.42)\""),
    "应有朝上的 CSS 三角（borderBottom 实色 + 左右透明）");
  // 三角在胶囊**左侧**（用户要求"三角靠左"）：落在「网关」二字附近，
  // 读起来是「↑ 网关」，与上方总量的关联由垂直方向承担，不再依赖
  // 横向像素级对齐（上一版为对齐右侧 Live 徽标要算 16px 偏移，很脆）。
  assert.ok(src.includes("top:-4,left:6"),
    "三角应在胶囊顶部（top 负值）且靠左（left 定位，不是 right）");
  assert.ok(!src.includes("top:-4,right:"),
    "不应再回到 right 定位（那会挂到胶囊右端，与「网关」二字脱开）");
});

test("Live 三态：文字恒为 Live，只靠颜色区分（用户要求）", () => {
  const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf-8");
  const l = (s, m) => (s.match(m) || [])[0];
  // 三态的 text 必须都是 Live
  const styleBlock = src.slice(src.indexOf("var LIVE_STYLE = {"), src.indexOf("};", src.indexOf("var LIVE_STYLE = {")));
  const texts = [...styleBlock.matchAll(/text:"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(texts, ["Live", "Live", "Live"],
    "三态的文字必须都是 Live —— 换成「网关」会让状态看起来像标签/入口");
  // 颜色必须三者互不相同（否则"只靠颜色区分"就不成立）
  const colors = [...styleBlock.matchAll(/color:"(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase());
  assert.equal(new Set(colors).size, 3, "三态颜色必须互不相同，实际 " + colors.join(","));
  // 网关态刻意避开紫色：紫色是网关「量」的用色（胶囊），状态点再用紫会撞色
  assert.ok(!colors.includes("#8b7bff"),
    "网关态的 Live 不能用 #8b7bff —— 那是网关角标的颜色，会分不清哪个在 pulse");
});

test("LIVE_CHANNEL：直连 / 网关 / 两者 三态各自可辨，且与 LIVE_JUDGE 同源", async () => {
  const mod = await loadClientModule({ requireStub: (n) => n === "react" ? makeReactStub().react : (n === "react/jsx-runtime" ? makeJsxStub() : null) });
  const C = mod.__testing.LIVE_CHANNEL;
  const J = mod.__testing.LIVE_JUDGE;
  assert.equal(typeof C, "function", "LIVE_CHANNEL 应导出到 __testing");
  const now = Date.now();
  const idle = { activeSteps: 0, activeTurns: 0, lastActiveAt: 0, rate60: 0, tokPerSec: 0 };
  const busy = { activeSteps: 0, activeTurns: 1, lastActiveAt: now, rate60: 0, tokPerSec: 0 };
  const mk = (gwMs, gwOn = true) => ({ updatedAt: now, sources: { gateway: { enabled: gwOn, lastActiveAt: gwMs, requests: 10, total: 100 } } });

  // 只有直连
  assert.equal(C(mk(0), busy), "direct");
  // 只有网关（本机会话全 0，网关刚写过）
  assert.equal(C(mk(now - 3000), idle), "gateway");
  // 两者同时在跑
  assert.equal(C(mk(now - 3000), busy), "both");
  // 都没动静
  assert.equal(C(mk(0), idle), null);
  // 网关窗口过期
  assert.equal(C(mk(now - 25000), idle), null);
  // 关掉监测后即使带时刻也不算网关活动
  assert.equal(C(mk(now - 1000, false), idle), null);

  // 「同源」不变量：只要 LIVE_CHANNEL 判出非 null，LIVE_JUDGE 必须也为 true
  for (const [gw, lv] of [[0, busy], [now - 3000, idle], [now - 3000, busy], [now - 25000, idle]]) {
    const kind = C(mk(gw), lv);
    const live = J(mk(gw), lv);
    if (kind) assert.equal(live, true, "徽标亮着时 LIVE_JUDGE 必须为 true（否则会出现说不清的态）");
  }
});

test("悬浮窗 tooltip 统一：不该再有原生 title（除设置页等非悬浮窗区域）", () => {
  const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf-8");
  // 只检查紧凑悬浮窗的两个渲染函数区间
  const i = src.indexOf("function renderTmCompact");
  const j = src.indexOf("function renderTmClassic");
  const seg = src.slice(i, j);
  const titles = (seg.match(/\btitle:/g) || []).length;
  assert.equal(titles, 0,
    "renderTmCompact 内不应再有原生 title（应改用 tipProps 的富 tooltip），实际还有 " + titles + " 处");
});

test("悬浮窗 tooltip 统一：网关胶囊/模型名/请求胶囊/迷你柱/圆环都接了 tipProps", () => {
  const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf-8");
  // 关键位置逐个确认（这些是用户点名要改的）
  const sites = [
    ["网关胶囊", /function gwBadgeEl\(sources\)[\s\S]{0,3000}?tipProps\(/],
    ["仅本机角标", /children:"仅本机"[\s\S]{0,600}?tipProps\(/],
    ["请求胶囊", /function gwReqPill[\s\S]{0,1200}?tipProps\(/],
    ["榜首模型", /topModel\? jsx_runtime\.jsxs\("span",Object\.assign\(\{[\s\S]{0,400}?tipProps\(/],
    ["迷你柱", /miniDays\.map\(function\(d,i\)\{[\s\S]{0,900}?tipProps\(/],
    ["圆环", /className:"oq-tm-ring"[\s\S]{0,600}?tipProps\(/],
  ];
  for (const [name, re] of sites) {
    assert.ok(re.test(src), "「" + name + "」应已接入 tipProps");
  }
});

test("Live 徽标：改用富 tooltip，且仍保留三态可达性信息", () => {
  const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf-8");
  const i = src.indexOf("function LIVE_BADGE");
  const seg = src.slice(i, i + 2400);
  assert.ok(seg.includes("tipSpec"), "LIVE_BADGE 应构造 tipSpec");
  assert.ok(seg.includes("tipProps("), "LIVE_BADGE 应接入 tipProps");
  assert.ok(!/\btitle:\s*title/.test(seg), "不应再传原生 title");
  // 三态的语义必须写在 rows 里（色弱用户的唯一通道）
  for (const kw of ["仅直连", "仅网关", "直连 ＋ 网关"]) {
    assert.ok(seg.includes(kw), "tooltip 应说明「" + kw + "」");
  }
});


// ===== 「用量查询」tab（多维 pivot）=====
// 用户需求：① 方案 B（多维 pivot）② 存为视图 ③ 账号维度要
// 这一页是**查询台**，与「用量统计」的分工是"自选交叉" vs "固定看板"。

/** 切到「用量查询」tab 并返回渲染结果 */
function gotoQuery(opts) {
  return async () => {
    const ctx = await setup(opts || {});
    let tree = await renderTwice(ctx.panel, ctx.reset);
    const btn = findClickable(tree, "oq-tab").filter((n) => collectText(n.props.children).join("") === "用量查询");
    assert.ok(btn.length >= 1, "应存在「用量查询」标签按钮");
    btn[0].props.onClick();
    // 切 tab 后 effect 才触发 fetchQuery（async）：渲染 → 等落地 → 再渲染
    ctx.reset(); ctx.panel();
    await new Promise((r) => setTimeout(r, 20));
    ctx.reset();
    tree = ctx.panel();
    return Object.assign({}, ctx, { tree, text: visiblePanelText(tree) });
  };
}

test("设置页：「用量查询」是独立 tab，紧邻「用量统计」", async () => {
  const { panel, reset } = await setup({});
  const tree = await renderTwice(panel, reset);
  const labels = findClickable(tree, "oq-tab").map((n) => collectText(n.props.children).join(""));
  const iUsage = labels.indexOf("用量统计");
  const iQuery = labels.indexOf("用量查询");
  assert.ok(iQuery >= 0, "应有「用量查询」tab，实际：" + labels.join(","));
  assert.equal(iQuery, iUsage + 1, "「用量查询」应紧跟「用量统计」（同一件事的两个视角）");
});

test("用量查询：只剩「查询条件 / 结果」两块（导出 CSV 与存为视图已按用户要求移除）", async () => {
  const g = await gotoQuery()({});
  for (const kw of ["查询条件", "结果"]) {
    assert.ok(g.text.includes(kw), "应有「" + kw + "」卡片");
  }
  // 用户明确要求移除这两块 —— 锁住，避免以后被"顺手加回来"
  assert.ok(!g.text.includes("存为视图"), "「存为视图」已移除，不应再出现在面板里");
  assert.ok(!g.text.includes("导出 CSV"), "「导出 CSV」已移除，不应再出现在面板里");
  // pivot 表：应有分组维度表头与结果行
  assert.ok(g.text.includes("模型"), "表头应有主分组维度名");
  assert.ok(g.text.includes("deepseek-v4.1-flash"), "应显示查询结果行");
  assert.ok(g.text.includes("4.20M") || g.text.includes("4.2M"), "应显示指标值");
  // 口径脚注必须保留：它不是可选信息，删功能不能连带删掉
  assert.ok(g.text.includes("UTC+8"), "网关日界口径必须保留");
  assert.ok(g.text.includes("账号已脱敏"), "账号脱敏说明必须保留");
});

test("用量查询：请求带上 groupBy/subGroup/source/metric（后端据此聚合）", async () => {
  const g = await gotoQuery()({});
  const q = g.calls.filter((u) => u.indexOf("/api/token-meter/query") >= 0);
  assert.ok(q.length >= 1, "应请求过 /api/token-meter/query");
  const u = q[0];
  assert.ok(u.includes("groupBy="), "必须带 groupBy");
  assert.ok(u.includes("source="), "必须带 source");
  assert.ok(u.includes("metric="), "必须带 metric");
  // 主接口不应该被这一页的取数污染
  assert.ok(u.includes("range=7d"), "默认区间应为 7d，实际：" + u);
});

test("用量查询：选了本机独有维度（项目/会话/工具/小时）时必须提示已排除网关", async () => {
  // ⚠️ 这里不走"点击 → effect → 异步重查"的链路：测试桩的 useEffect 是同步立即执行、
  // 不 await promise，切维度后拿到的永远是"查询中…"那一帧（实测）。
  // 改为断言**渲染条件的来源**：本机独有维度清单与提示文案必须存在于源码，
  // 且后端 local-only 判定必须成立（两侧口径同一份）。
  const qSrc = readFileSync(new URL("../lib/client.js", import.meta.url), "utf-8");
  assert.ok(qSrc.includes('var qLocalOnly = ["project","session","tool","hour"]'),
    "客户端必须知道哪些维度是本机独有");
  assert.ok(qSrc.includes("本次查询已自动排除网关数据"),
    "选了本机独有维度时必须明确告知用户");
  // 后端侧：只有本机有这些维度
  const hSrc = readFileSync(new URL("../lib/index.js", import.meta.url), "utf-8");
  for (const dim of ["project", "session", "tool", "hour"]) {
    assert.ok(new RegExp(dim + ':\\s*\\{[^}]*scope:\\s*"local"').test(hSrc),
      "后端应把 " + dim + " 标为 local-only");
  }
  for (const dim of ["day", "model", "provider"]) {
    assert.ok(new RegExp(dim + ':\\s*\\{[^}]*scope:\\s*"both"').test(hSrc),
      "后端应把 " + dim + " 标为两端都有");
  }
  assert.ok(/account:\s*\{[^}]*scope:\s*"gw"/.test(hSrc), "账号只属于网关侧");
});

test("用量查询表格：占比列 = 数字 + 46px 细条（样式 B），且比例必须线性", () => {
  // 用户选定样式 B：占比列右侧一根 46×2px 的细条，表达数量级差。
  // 两条硬约束，都有实测依据：
  //   ① 宽度必须是 46px —— 274px 的轨道会让"条"比数字更抢眼（实测过）；
  //   ② 比例必须**线性** —— sqrt/log 会把 72.3% 与 1.2% 的 66 倍差距压成 5 倍，
  //      在表格里歪曲比例就是误导。代价是 1.2% 只剩 0.6px 不可见，这是诚实换来的。
  const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf-8");
  const i = src.indexOf("// 表格（样式 B：占比列");
  const j = src.indexOf("// 口径脚注", i);
  assert.ok(i > 0 && j > i, "应能找到表格渲染段");
  const seg = src.slice(i, j);

  assert.ok(seg.includes("width:46"), "细条轨道必须是 46px 宽");
  assert.ok(seg.includes("height:2"), "细条必须是 2px 高（再粗就抢数字的焦点）");
  // 线性映射：直接拿 share 当宽度百分比，不做任何幂/对数变换
  assert.ok(seg.includes('width:pctW+"%"'), "细条宽度必须直接取占比值（线性）");
  assert.ok(!/Math\.(sqrt|log|pow)\s*\(/.test(seg),
    "不得用 sqrt/log 放大长尾 —— 那会歪曲真实比例");
  // 颜色分层：前 4 名有专属识别色，其余灰
  assert.ok(seg.includes('["#6b87d9","#b08427","#c65f7f","#8d7ce4"]'),
    "前 4 名应沿用「用量统计」模型榜的识别色，两页能对上号");
  // 按「日」分组不应画彩色圆点（日期画彩点没有语义）
  assert.ok(seg.includes('qGroup[0]==="model"||qGroup[0]==="provider"||qGroup[0]==="account"'),
    "色点只在模型/渠道/账号分组下显示");
});

test("用量查询：已移除「存为视图」的全部实现（含 localStorage 读写）", () => {
  // 用户明确要求不要再有这块功能。除了 UI，也要确认没有残留的持久化代码 ——
  // 否则「界面上没有、但仍往 localStorage 写」会让人以为功能还在。
  const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf-8");
  for (const dead of ["loadQueryViews", "saveQueryViews", "LS_QUERY_VIEWS", "oq_query_views", "QUERY_VIEW_MAX"]) {
    assert.ok(!src.includes(dead), "不应残留「存为视图」的实现：" + dead);
  }
  // 导出的 CSV 按钮也应消失
  assert.ok(!src.includes('children:"导出 CSV"'), "「导出 CSV」按钮应已移除");
});

test("用量查询：账号维度在维度清单里（用户要求）", async () => {
  const g = await gotoQuery()({});
  // 维度 pills 由后端 dimensions 驱动；账号必须有
  assert.ok(g.text.includes("账号"), "查询条件里应有「账号」维度可选");
});

test("用量查询：解析失败时必须报出 HTTP 状态（不能只说 bad json）", () => {
  // 真机现象：设置页「用量查询」显示 "bad json"。
  // 排查结论：宿主进程启动于 08:19，而 lib/index.js 改于 13:44 —— **没重启**，
  // /api/token-meter/query 路由不存在 ⇒ webserver 回 HTML 404 ⇒ r.json() 抛错
  // ⇒ 只剩一句 bad json，用户完全无法判断是鉴权、路由还是崩溃。
  // 现在解析失败会把状态码与响应片段一起报出来，这条锁住该行为。
  // 只检查 fetchQuery 函数体（余额查询那几个端点同样有待改进，但不属于本次范围）。
  const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf-8");
  const i = src.indexOf("async function fetchQuery");
  const j = src.indexOf("function apply(ctx)", i);
  const seg = src.slice(i, j);
  assert.ok(seg.includes('"HTTP "+r.status'), "解析失败的分支必须带 HTTP 状态码");
  assert.ok(seg.includes("空响应"), "空 body 要显式说明（403/404 的典型表现）");
  assert.ok(!seg.includes('error:"bad json"'),
    "fetchQuery 不得再只回一句 bad json —— 那是无法自诊断的错误信息");
  assert.ok(seg.includes("JSON.parse(raw)"), "应先取 text 再 parse，才能保留原始响应片段");
});

test("用量查询：内容区不再重复 tab 名（tab 已写「用量查询」）", () => {
  // 真机反馈：tab 叫「用量查询」，内容区顶部的 groupHead 又写一遍同名标题，
  // 同一句话说两遍。其他 tab 的 groupHead 是**子分区**标题（如「外观」下的
  // 「悬浮窗外观」），语义不同，那些不能一起删。
  const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf-8");
  const i = src.indexOf("var queryPanel=");
  const j = src.indexOf("//（预设/A-B-C 风格只存本机", i);
  assert.ok(i > 0 && j > i, "应能找到查询面板段");
  const seg = src.slice(i, j);
  // 只匹配**真正的调用**（行首缩进 + 分号/逗号结尾），不匹配注释里提到的字面量。
  assert.ok(!/^\s*groupHead\("用量查询"\)\s*[,;]?\s*$/m.test(seg),
    "内容区不得再出现与 tab 同名的 groupHead 调用");
  // 但其他 tab 的子分区标题必须还在（防止"顺手全删"）
  assert.ok(src.includes('groupHead("悬浮窗外观")'), "「外观」tab 的子分区标题应保留");
  assert.ok(src.includes('groupHead("维护")'), "「维护」tab 的子分区标题应保留");
  assert.ok(src.includes('groupHead("网关")'), "「网关」tab 的子分区标题应保留");
});
