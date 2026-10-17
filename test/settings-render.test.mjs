// 设置页「用量统计」渲染冒烟（node:test，零依赖）。
// 为什么值得单独写：设置页是一个 800+ 行的单文件 React 组件，函数调用链很长
// （usagePanel → renderTokenMeterChart → renderDailyBars/modelRank/rankRows/recordsList…），
// 任何一个 undefined 字段都会在"用户点开设置页"那一刻炸掉，而语法检查抓不到。
// 这里用最小 hook 运行时把组件函数真的跑一遍（jsx 桩返回 {type,props} 以便遍历文本），
// 并用桩 fetch 喂一份真实形状的 payload，走完"有数据"的全部分支。
import test from "node:test";
import assert from "node:assert/strict";

import { loadClientModule } from "./load-client.mjs";

const DAY = 86400000;
const now = Date.now();
const dayKey = (offset) => {
  const d = new Date(now - offset * DAY);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
const today = dayKey(0);
const hourKey = (h) => today + "T" + String(h).padStart(2, "0");

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
    models: [], records: [],
    tools: [{ tool: "read", calls: 12, ms: 300, avgMs: 25 }, { tool: "pwsh", calls: 8, ms: 9000, avgMs: 1125 }],
    projects: [{ project: "token-lens", requests: 9, freshInput: 300, output: 200, cacheRead: 2900, tools: 4, total: 3400 }],
    providers: [{ provider: "unisound", requests: 20, freshInput: 900, output: 700, cacheRead: 13000, total: 14600 }],
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

async function setup({ localStorageSeed = {}, fetchPayload } = {}) {
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
    if (String(url).indexOf("/api/token-meter/reset") >= 0) return { ok: true, json: async () => ({ ok: true, cleared: 3 }) };
    const m = String(url).match(/range=([^&]+)/);
    const range = m ? decodeURIComponent(m[1]) : "1d";
    const p = fetchPayload ? fetchPayload(range) : payload(range);
    return { ok: true, json: async () => p };
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
  for (const kw of ["总览", "缓存命中率", "新输入", "缓存读", "环比" in {} ? "" : "步数", "模型排行", "工具排行", "项目排行", "按渠道", "实时", "最近调用", "数据："]) {
    if (!kw) continue;
    assert.ok(text.includes(kw), "渲染结果缺少文案「" + kw + "」");
  }
  assert.ok(text.includes("read"), "工具排行应出现工具名 read");
  assert.ok(text.includes("token-lens"), "项目排行应出现项目名");
  assert.ok(text.includes("unisound"), "按渠道应出现 provider 名");
  assert.ok(text.includes("近60秒速率"), "实时卡应显示窗口速率");
  assert.ok(text.includes("样本 0 次") || text.includes("无样本"), "首 token 无样本时应明示，而不是只显示 —");
});

test("设置页渲染冒烟：折线/热力图/1d 三种视图都能渲染", async () => {
  for (const chart of ["bar", "line", "heat"]) {
    const { panel, reset } = await setup({ localStorageSeed: { oq_settings_chart: chart, opencode_quota_range: "1d" } });
    const tree = await renderTwice(panel, reset);
    const text = collectText(tree).join(" | ");
    assert.ok(text.length > 100, chart + " 视图渲染为空");
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
