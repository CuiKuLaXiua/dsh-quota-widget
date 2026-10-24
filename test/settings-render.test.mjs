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

/** 收集 className 含 needle 且带 onClick 的元素（用于"真的点一下"的回归测试） */
function findClickable(node, needle, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => findClickable(n, needle, out)); return out; }
  if (node.props) {
    const cn = String(node.props.className || "");
    if (typeof node.props.onClick === "function" && cn.includes(needle)) out.push(node);
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
    assert.ok(text.includes("小窗口图表"), "「数据源与通用」应出现「小窗口图表」卡片");
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
