// 浏览器半端纯函数单测（node:test）：热力分档与 1d 分时图的"今天"过滤。
import test from "node:test";
import assert from "node:assert/strict";

import { loadClientModule } from "./load-client.mjs";

// 需要一个能返回结构化元素的 jsx 桩：默认的 stubRequire 里 jsx/jsxs 直接返回 null，
// 那样任何"返回元素"的纯函数（如 ringEl）都拿不到东西可断言。
// 这里只替换 react/jsx-runtime，react 仍用最小桩。
const jsxStub = (type, props) => ({ type, props: props || {} });
const T = (await loadClientModule({
  requireStub: (name) => {
    if (name === "react") {
      return { useState: (v) => [v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useMemo: (f) => f() };
    }
    if (name === "react/jsx-runtime") return { jsx: jsxStub, jsxs: jsxStub, Fragment: {} };
    throw new Error("unexpected require: " + name);
  },
})).__testing;
const { HEAT_LV, heatLvOf, groupTodayHourBuckets, fmtTokens } = T;

// 悬浮窗图表形态的读写闭环：loadTmChart 只认 bar/heat，写入由设置页「小窗口图表」卡片驱动。
// 历史上这两个 key 拆开之后，悬浮窗的 save 函数变成了没人调用的死代码，
// 导致热力图在悬浮窗里永远不可达（只能停留在默认柱状）。
// 注意：写入入口只在设置页，悬浮窗本身是功能展示区、不放配置按钮（不要在这里加回按钮）。
test("loadTmChart / saveTmChart：默认柱状，热力图可写入并读回，非法值回落 bar", () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const { loadTmChart, saveTmChart } = T;
  assert.equal(typeof saveTmChart, "function", "悬浮窗必须有写入入口，否则热力图不可达");
  assert.equal(loadTmChart(), "bar", "无存储时默认柱状");
  saveTmChart("heat");
  assert.equal(loadTmChart(), "heat", "写入热力图后应能读回");
  saveTmChart("bar");
  assert.equal(loadTmChart(), "bar", "可切回柱状");
  mem.set("opencode_quota_tm_chart", "line");
  assert.equal(loadTmChart(), "bar", "悬浮窗只支持 bar/heat，非法值回落 bar");
  delete globalThis.localStorage;
});

test("悬浮窗与设置页的图表偏好互不干扰（两个独立 key）", () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const { loadTmChart, saveTmChart, loadSettingsChart, saveSettingsChart } = T;
  saveTmChart("heat");
  assert.equal(mem.get("opencode_quota_tm_chart"), "heat");
  assert.equal(mem.has("oq_settings_chart"), false, "悬浮窗不应写设置页的 key");
  saveSettingsChart("line");
  assert.equal(loadTmChart(), "heat", "设置页选折线不应把悬浮窗的热力图改掉");
  assert.equal(loadSettingsChart(), "line", "设置页读回自己的折线选择");
  delete globalThis.localStorage;
});

test("load-client：能从 client.js 取到 __testing 出口", () => {
  assert.equal(typeof heatLvOf, "function");
  assert.ok(HEAT_LV >= 5 && HEAT_LV <= 8, "档位数量应在合理区间，实际 " + HEAT_LV);
});

test("heatLvOf：0/负值/NaN 归为无数据档 0", () => {
  assert.equal(heatLvOf(0, [1, 2], true, 2), 0);
  assert.equal(heatLvOf(-5, [1, 2], true, 2), 0);
  assert.equal(heatLvOf(NaN, [1, 2], true, 2), 0);
});

test("heatLvOf：分位路径单调不减、取值落在 1..HEAT_LV、峰值必为最高档", () => {
  const vals = [5, 10, 20, 40, 80, 160, 320, 640, 1280, 2560];
  const lvs = vals.map((v) => heatLvOf(v, vals, true, 2560));
  for (const lv of lvs) assert.ok(lv >= 1 && lv <= HEAT_LV, "档位越界: " + lv);
  for (let i = 1; i < lvs.length; i++) assert.ok(lvs[i] >= lvs[i - 1], "应随用量单调不减: " + JSON.stringify(lvs));
  assert.equal(lvs[lvs.length - 1], HEAT_LV, "最大值应为最高档");
});

test("heatLvOf：同值样本落同一档（避免同日多格颜色不一）", () => {
  const vals = [10, 10, 30, 90];
  assert.equal(heatLvOf(10, vals, true, 90), heatLvOf(10, vals, true, 90));
});

test("heatLvOf：样本不足时走 sqrt 连续映射，2-3 个点也能拉开档位", () => {
  const lvSmall = heatLvOf(1, null, false, 100);
  const lvMid = heatLvOf(25, null, false, 100);
  const lvMax = heatLvOf(100, null, false, 100);
  assert.ok(lvSmall >= 1 && lvSmall <= HEAT_LV);
  assert.ok(lvSmall < lvMid && lvMid < lvMax, `应随用量递增: ${lvSmall},${lvMid},${lvMax}`);
  assert.equal(lvMax, HEAT_LV);
});

test("groupTodayHourBuckets：只保留当天小时桶，且按小时聚合多模型", () => {
  const today = "2026-10-16";
  const hourly = {
    "m-a::2026-10-16T09": { model: "m-a", hour: "2026-10-16T09:00:00.000Z", uncachedInputTokens: 10 },
    "m-b::2026-10-16T09": { model: "m-b", hour: "2026-10-16T09:00:00.000Z", uncachedInputTokens: 5 },
    "m-a::2026-10-16T10": { model: "m-a", hour: "2026-10-16T10:00:00.000Z", uncachedInputTokens: 7 },
    "m-a::2026-10-15T23": { model: "m-a", hour: "2026-10-15T23:00:00.000Z", uncachedInputTokens: 999 },
    "m-a::2026-08-14T01": { model: "m-a", hour: "2026-08-14T01:00:00.000Z", uncachedInputTokens: 999 },
  };
  const byHour = groupTodayHourBuckets(hourly, today);
  const hours = Object.keys(byHour).sort();
  assert.deepEqual(hours, ["2026-10-16T09:00:00.000Z", "2026-10-16T10:00:00.000Z"], "混入其它日期的小时桶: " + hours.join(","));
  assert.equal(byHour["2026-10-16T09:00:00.000Z"].length, 2, "同一小时应聚合多模型");
  assert.equal(byHour["2026-10-16T10:00:00.000Z"].length, 1);
});

test("groupTodayHourBuckets：空输入/无当天数据返回空对象（触发按日柱状图回落）", () => {
  assert.deepEqual(groupTodayHourBuckets(undefined, "2026-10-16"), {});
  assert.deepEqual(groupTodayHourBuckets({}, "2026-10-16"), {});
  assert.deepEqual(groupTodayHourBuckets({ "m::2026-10-01T01": { hour: "2026-10-01T01:00:00.000Z" } }, "2026-10-16"), {});
});

test("groupTodayHourBuckets：按 localDate 过滤，UTC+8 下本地凌晨的桶不再被丢（回归）", () => {
  // 旧 host 用 UTC 打 hour 键：本地 2026-10-24 03:00 的桶键是 2026-10-23T19Z，
  // 只按 hour.slice(0,10) 过滤会把本地 00:00–07:59 整段丢掉（实测 24 小时里只剩 16 个）。
  // 现在优先用服务端下发的 localDate，因此凌晨桶也必须保留。
  const today = "2026-10-24";
  const hourly = {
    // 本地 00:00（UTC 前一天 16:00）
    "m-a::2026-10-23T16": { model: "m-a", hour: "2026-10-23T16:00:00.000Z", localDate: today, uncachedInputTokens: 1 },
    // 本地 03:00（UTC 前一天 19:00）—— 旧实现丢掉的典型样本
    "m-a::2026-10-23T19": { model: "m-a", hour: "2026-10-23T19:00:00.000Z", localDate: today, uncachedInputTokens: 2 },
    // 新 host 的本地键形态
    "m-a::2026-10-24T11": { model: "m-a", hour: "2026-10-24T11:00:00", localDate: today, uncachedInputTokens: 3 },
    // 真正的昨天：不能混进来
    "m-a::2026-10-23T15": { model: "m-a", hour: "2026-10-23T15:00:00.000Z", localDate: "2026-10-23", uncachedInputTokens: 999 },
  };
  const byHour = groupTodayHourBuckets(hourly, today);
  assert.equal(Object.keys(byHour).length, 3, "本地今天的 3 个桶都要保留，实际：" + Object.keys(byHour).join(","));
  const total = Object.values(byHour).reduce((a, list) => a + list.reduce((x, v) => x + v.uncachedInputTokens, 0), 0);
  assert.equal(total, 6, "昨天那笔 999 不能计入");
});

test("groupTodayHourBuckets：旧 host 无 localDate 时退回键日期段（向后兼容）", () => {
  const hourly = {
    "m::2026-10-16T09": { model: "m", hour: "2026-10-16T09:00:00.000Z", uncachedInputTokens: 10 },
    "m::2026-10-15T09": { model: "m", hour: "2026-10-15T09:00:00.000Z", uncachedInputTokens: 20 },
  };
  const byHour = groupTodayHourBuckets(hourly, "2026-10-16");
  assert.deepEqual(Object.keys(byHour), ["2026-10-16T09:00:00.000Z"]);
});

test("fmtTokens：0/无效值不显示为数字", () => {
  assert.equal(fmtTokens(0), "0");
  assert.equal(fmtTokens(null), "—");
  assert.equal(fmtTokens("abc"), "—");
});

// ── 悬浮面板材质（classic / liquid / acrylic / paper）──
// 材质只影响外观，但"读回什么"决定了渲染出的类名（.oq-card m-<x>）。
// 默认必须是 classic（材质层引入之前的原背板），老用户升级后观感不变；
// 非法值也必须落回 classic，否则会挂上一个不存在的类名（面板退回无材质底）。
test("loadPanelMaterial：默认经典背板，其余为可选项，非法值回落经典", () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const fired = [];
  globalThis.window = { dispatchEvent: (e) => fired.push(e && e.type) };
  const { loadPanelMaterial, savePanelMaterial, PANEL_MATERIALS } = T;

  assert.deepEqual(PANEL_MATERIALS, ["classic", "liquid", "acrylic", "paper"]);
  assert.equal(PANEL_MATERIALS[0], "classic", "经典必须是默认（列表首项）");
  assert.equal(loadPanelMaterial(), "classic", "无存储时默认经典背板");

  for (const m of PANEL_MATERIALS) {
    fired.length = 0;
    savePanelMaterial(m);
    assert.equal(loadPanelMaterial(), m, "应能读回 " + m);
    assert.ok(fired.includes("opencode:material-changed"), "保存后应广播材质变更事件");
  }

  // 老版本可能存过 liquid 之外的值；这里只验证"非法值"回落
  mem.set("oq_panel_material", "frosted-glass");
  assert.equal(loadPanelMaterial(), "classic", "非法材质应回落经典");
  savePanelMaterial("frosted-glass");
  assert.equal(mem.get("oq_panel_material"), "classic", "非法值不应写进 localStorage");

  delete globalThis.localStorage;
  delete globalThis.window;
});

// ── Live 徽标的判定 ────────────────────────────────────────────────────────
// 背景（用户可见的缺陷）：悬浮窗右上角的 Live 要等十几秒才亮。
// 根因是判据写成 tokPerSec>0，而 tokPerSec 的分母 llmMs 只在 step/end 累加——
// 首条回复跑完之前恒为 0。这里锁住"有迹象就亮"，并防止再退回单一条款。
test("LIVE_JUDGE：step 在跑就立刻亮（不必等 step/end 累出 llmMs）", () => {
  const { LIVE_JUDGE } = T;
  const now = Date.now();
  // 首条回复进行中：还没有任何 assistant/message（tokPerSec 仍为 0），但 step 未结束
  const live = { activeSteps: 1, lastActiveAt: now, rate60: 0, tokPerSec: 0 };
  assert.equal(LIVE_JUDGE({ updatedAt: now }, live), true, "activeSteps>0 必须立即判活");
});

test("LIVE_JUDGE：近期有任意实时事件也算活（lastActiveAt 窗口）", () => {
  const { LIVE_JUDGE, ACTIVE_TTL_MS } = T;
  const now = Date.now();
  const fresh = { activeSteps: 0, lastActiveAt: now - 1000, rate60: 0, tokPerSec: 0 };
  assert.equal(LIVE_JUDGE({ updatedAt: now }, fresh), true);
  const stale = { activeSteps: 0, lastActiveAt: now - ACTIVE_TTL_MS - 1000, rate60: 0, tokPerSec: 0 };
  assert.equal(LIVE_JUDGE({ updatedAt: now }, stale), false, "超出活动窗口应熄灭");
});

test("LIVE_JUDGE：陈旧快照一律不亮（避免打开面板就显示上次的活动）", () => {
  const { LIVE_JUDGE, SNAPSHOT_TTL_MS } = T;
  const now = Date.now();
  const live = { activeSteps: 2, lastActiveAt: now, rate60: 9, tokPerSec: 5 };
  assert.equal(LIVE_JUDGE({ updatedAt: now - SNAPSHOT_TTL_MS - 1000 }, live), false);
  assert.equal(LIVE_JUDGE({ updatedAt: now }, live), true);
});

test("LIVE_JUDGE：旧 host（无 activeSteps/lastActiveAt 字段）退回 tokPerSec 判定", () => {
  const { LIVE_JUDGE } = T;
  const now = Date.now();
  assert.equal(LIVE_JUDGE({ updatedAt: now }, { tokPerSec: 12 }), true, "旧 host 仍要能亮");
  assert.equal(LIVE_JUDGE({ updatedAt: now }, { tokPerSec: 0 }), false);
  assert.equal(LIVE_JUDGE({ updatedAt: now }, null), false, "无 live 数据不亮");
  assert.equal(LIVE_JUDGE(null, { tokPerSec: 1 }), false, "无 payload 不亮");
});

test("LIVE_JUDGE：rate60>0 也算活（近 60s 有输出）", () => {
  const { LIVE_JUDGE } = T;
  const now = Date.now();
  assert.equal(LIVE_JUDGE({ updatedAt: now }, { activeSteps: 0, lastActiveAt: 0, rate60: 3.5, tokPerSec: 0 }), true);
});

// ── 对话活动的 DOM 锚点 ────────────────────────────────────────────────────
// 旧选择器 [data-role="assistant"] / .assistant 在 DSH 0.2.1 上命中 0 次
// （聊天行只有 data-chat-flow-key / data-chat-flow-kind，类是 CSS Modules 哈希），
// 导致 armFast 从不触发、轮询永远停在空闲 15s。这里锁住必须包含真实锚点。
test("ACTIVITY_SEL：必须匹配宿主真实的聊天行标记", () => {
  const { ACTIVITY_SEL } = T;
  assert.equal(typeof ACTIVITY_SEL, "string");
  for (const sel of ['data-chat-flow-key', 'data-chat-flow-kind', 'data-slot="conversation.chat.node"']) {
    assert.ok(ACTIVITY_SEL.includes(sel), "活动检测必须包含宿主锚点 " + sel);
  }
});

// ── 自定义区间 ────────────────────────────────────────────────────────────
test("RANGE_KEYS：包含 custom，且 RANGES 的固定档位不变（悬浮窗仍只认固定档）", () => {
  const { RANGE_KEYS } = T;
  assert.ok(RANGE_KEYS.includes("custom"), "custom 必须在白名单里，否则 loadRange 会把它丢掉");
  for (const k of ["1d", "7d", "30d", "90d", "all"]) assert.ok(RANGE_KEYS.includes(k));
});

test("rangeQuery：custom 带 from/to，其它档位不带（避免 host 收到无用参数）", () => {
  const { rangeQuery } = T;
  assert.equal(rangeQuery("7d"), "range=7d");
  assert.equal(
    rangeQuery("custom", { from: "2026-10-01", to: "2026-10-07" }),
    "range=custom&from=2026-10-01&to=2026-10-07",
  );
  // 没有 custom 对象时不能抛错、也不能拼出 from=undefined
  assert.equal(rangeQuery("custom"), "range=custom");
});

test("loadCustomRange / saveCustomRange：默认近 7 天，非法存储值回落默认，写入可读回", () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const { loadCustomRange, saveCustomRange, defaultCustomRange, localDayStrOf, LS_CUSTOM_RANGE } = T;

  const dft = loadCustomRange();
  assert.equal(dft.from, defaultCustomRange().from, "无存储时用默认区间");
  assert.equal(dft.to, defaultCustomRange().to);
  // 默认区间是 7 天（含首尾）
  const span = Math.round((new Date(dft.to + "T00:00:00") - new Date(dft.from + "T00:00:00")) / 86400000) + 1;
  assert.equal(span, 7);

  saveCustomRange({ from: "2026-09-01", to: "2026-09-15" });
  assert.deepEqual(loadCustomRange(), { from: "2026-09-01", to: "2026-09-15" });
  assert.ok(mem.has(LS_CUSTOM_RANGE));

  // 损坏的 JSON / 非法日期必须回落默认，不能把 undefined 塞进请求
  mem.set(LS_CUSTOM_RANGE, "{not json");
  assert.equal(loadCustomRange().from, defaultCustomRange().from);
  mem.set(LS_CUSTOM_RANGE, JSON.stringify({ from: "2026/09/01", to: "x" }));
  assert.equal(loadCustomRange().from, defaultCustomRange().from);

  assert.equal(localDayStrOf(new Date(2026, 0, 5).getTime()), "2026-01-05", "必须补零");
  delete globalThis.localStorage;
});

// ── 逐日明细表的列取值 ────────────────────────────────────────────────────
test("detailVal：新输入必须从 prompt 里减掉缓存读（这是最容易算错的一列）", () => {
  const { detailVal } = T;
  // prompt = 新输入 + 缓存读（host 旧口径）
  const row = { date: "2026-10-26", total: 1100, requests: 3, prompt: 1000, cache_read: 900, completion: 100 };
  assert.equal(detailVal(row, "freshInput"), 100, "1000-900=100，不能直接用 prompt");
  assert.equal(detailVal(row, "cacheRead"), 900);
  assert.equal(detailVal(row, "output"), 100);
  assert.equal(detailVal(row, "total"), 1100);
  assert.equal(detailVal(row, "requests"), 3);
  assert.equal(detailVal(row, "date"), "2026-10-26");
});

test("detailVal：avgMs/topProject 缺失时给出可排序的稳定值（不返回 undefined）", () => {
  const { detailVal } = T;
  const bare = { date: "2026-10-26", total: 0 };
  assert.equal(detailVal(bare, "avgMs"), null, "没有耗时要能区分'未测量'");
  assert.equal(detailVal(bare, "topProject"), "");
  assert.equal(detailVal(null, "total"), 0, "空行也不能抛错");
  const full = { date: "2026-10-26", avgMs: 2500, topProject: "demo" };
  assert.equal(detailVal(full, "avgMs"), 2500);
  assert.equal(detailVal(full, "topProject"), "demo");
});

// ── 贴边收起（方案 A：把手条）────────────────────────────────────────────
// 触发时机是用户明确指定的："贴边后**再往边缘拽一下**才吸入"，不是松手就收起。
test("贴边收起：默认关闭，开启后能读回", () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const { loadEdgeCollapse, saveEdgeCollapse, LS_EDGE_COLLAPSE } = T;
  assert.equal(loadEdgeCollapse(), false, "默认必须是关（老用户升级观感不变）");
  saveEdgeCollapse(true);
  assert.equal(mem.get(LS_EDGE_COLLAPSE), "1");
  assert.equal(loadEdgeCollapse(), true);
  saveEdgeCollapse(false);
  assert.equal(loadEdgeCollapse(), false);
  delete globalThis.localStorage;
});

test("贴边收起：关闭开关必须顺手清掉「已收起」状态（否则窗口卡在把手条上）", () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const { saveEdgeCollapse, saveEdgeState, loadEdgeState, LS_EDGE_STATE } = T;
  saveEdgeState({ edge: "right" });
  assert.deepEqual(loadEdgeState(), { edge: "right" });
  saveEdgeCollapse(true);
  saveEdgeState({ edge: "left" });
  saveEdgeCollapse(false);
  assert.equal(mem.has(LS_EDGE_STATE), false, "关闭功能时 LS_EDGE_STATE 必须被移除");
  assert.equal(loadEdgeState(), null);
  delete globalThis.localStorage;
});

test("贴边收起：edgeState 只认 left/right，非法值一律当展开", () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const { loadEdgeState, saveEdgeState, LS_EDGE_STATE } = T;
  assert.equal(loadEdgeState(), null, "无存储时是展开态");
  for (const bad of ['{"edge":"top"}', '{"edge":""}', "not json", "[]", '{"edge":null}']) {
    mem.set(LS_EDGE_STATE, bad);
    assert.equal(loadEdgeState(), null, "非法状态应回落到展开：" + bad);
  }
  saveEdgeState({ edge: "left" });
  assert.deepEqual(loadEdgeState(), { edge: "left" });
  // 传 null 等价于"取消收起"
  saveEdgeState(null);
  assert.equal(loadEdgeState(), null);
  delete globalThis.localStorage;
});

// ── 这两个 bug 都导致"开关打开了但拽了没反应"，必须有测试钉住 ──
test("edgeCardClass：oq-edge-open 与收起态互斥（否则 transform 被永久压成 none）", () => {
  const { edgeCardClass } = T;
  const base = "oq-card m-classic";

  // 未开启 / 未收起 → 不加任何 edge 类
  assert.equal(edgeCardClass(base, { on: false, state: { edge: "left" }, open: false, locked: false }), base);
  assert.equal(edgeCardClass(base, { on: true, state: null, open: false, locked: false }), base);

  // 真收起 → 有 oq-edge + 侧别，**且绝对不能有 oq-edge-open**
  const c1 = edgeCardClass(base, { on: true, state: { edge: "left" }, open: false, locked: false });
  assert.ok(c1.includes("oq-edge "), "应包含 oq-edge");
  assert.ok(c1.includes("oq-edge-left"));
  assert.ok(!c1.includes("oq-edge-open"), "收起态绝不能挂 oq-edge-open，否则 transform:none 会盖掉 translateX（实测 bug）");

  const c2 = edgeCardClass(base, { on: true, state: { edge: "right" }, open: false, locked: false });
  assert.ok(c2.includes("oq-edge-right") && !c2.includes("oq-edge-open"));

  // 悬停展开 / 锁定展开 → 加 oq-edge-open
  const c3 = edgeCardClass(base, { on: true, state: { edge: "left" }, open: true, locked: false });
  assert.ok(c3.includes("oq-edge-open"), "悬停展开应加 oq-edge-open");
  const c4 = edgeCardClass(base, { on: true, state: { edge: "right" }, open: false, locked: true });
  assert.ok(c4.includes("oq-edge-open"), "锁定展开也应加 oq-edge-open");
});

test("edgePullVerdict：armAt 不能每帧重置（旧实现在每帧写当前鼠标 x，pushed 恒为 0）", () => {
  const { edgePullVerdict, EDGE_PULL_TRIGGER } = T;
  const geo = { width: 260, viewport: 1200, gap: 6, trigger: EDGE_PULL_TRIGGER };

  // 第 1 帧：刚贴到左边缘，x=100，记录锚点
  let s = edgePullVerdict(null, Object.assign({}, geo, { left: 6, x: 100 }));
  assert.equal(s.armEdge, "left");
  assert.equal(s.armAt, 100);
  assert.equal(s.collapse, false, "刚贴边不应立刻吸入");

  // 第 2 帧：继续往左推 5px（鼠标 x=95），仍未到阈值
  s = edgePullVerdict(s, Object.assign({}, geo, { left: 6, x: 95 }));
  assert.equal(s.armAt, 100, "锚点必须保持 100，不能被重置成 95");
  assert.equal(s.collapse, false);

  // 第 3 帧：推到 x=80，累计 20px ≥ 18 → 吸入
  s = edgePullVerdict(s, Object.assign({}, geo, { left: 6, x: 80 }));
  assert.equal(s.collapse, true, "累计位移必须能触发吸入（这正是实测失败的那个 bug）");
});

test("edgePullVerdict：未贴边不吸入；离开边缘后锚点重置", () => {
  const { edgePullVerdict, EDGE_PULL_TRIGGER } = T;
  const geo = { width: 260, viewport: 1200, gap: 6, trigger: EDGE_PULL_TRIGGER };

  // 卡片在中间，往左猛推也不应吸入
  let s = edgePullVerdict(null, Object.assign({}, geo, { left: 400, x: 500 }));
  assert.equal(s.armEdge, null);
  assert.equal(s.collapse, false, "未贴边时不能吸入（否则斜拖路过边缘会误触发）");

  // 贴左边缘建立锚点
  s = edgePullVerdict(null, Object.assign({}, geo, { left: 6, x: 300 }));
  assert.equal(s.armAt, 300);
  // 离开边缘（left 变 200）→ 锚点清除
  s = edgePullVerdict(s, Object.assign({}, geo, { left: 200, x: 260 }));
  assert.equal(s.armEdge, null);
  assert.equal(s.armAt, null);
  // 再次贴边 → 重新计时，不应拿旧锚点算位移
  s = edgePullVerdict(s, Object.assign({}, geo, { left: 6, x: 250 }));
  assert.equal(s.armAt, 250, "重新贴边必须重新计时");
  assert.equal(s.collapse, false);
});

test("edgePullVerdict：贴右边缘时方向相反（往右推才吸入）", () => {
  const { edgePullVerdict, EDGE_PULL_TRIGGER } = T;
  const geo = { width: 260, viewport: 1200, gap: 6, trigger: EDGE_PULL_TRIGGER };
  const rightLeft = 1200 - 260 - 6;   // 934

  let s = edgePullVerdict(null, Object.assign({}, geo, { left: rightLeft, x: 1000 }));
  assert.equal(s.armEdge, "right");
  assert.equal(s.collapse, false);
  // 往左推（远离边缘）不应吸入
  s = edgePullVerdict(s, Object.assign({}, geo, { left: rightLeft - 40, x: 960 }));
  assert.equal(s.armEdge, null, "离开右边缘后不再是贴边态");
  // 回到右边缘再往右推
  s = edgePullVerdict(null, Object.assign({}, geo, { left: rightLeft, x: 1000 }));
  s = edgePullVerdict(s, Object.assign({}, geo, { left: rightLeft, x: 1025 }));
  assert.equal(s.collapse, true, "右边缘往右推 25px 应吸入");
});

// ── 动效不变量（用户反馈"吸附和弹出动画设计很差"）──
// 根因：left/bottom 与 transform 两套过渡同时跑，各自计时与缓动不同 → 视觉上"抖一下再滑"。
// 这些断言直接检查 CSS 文本，防止再把过渡加回 left/bottom。
test("动效：收起/展开的过渡只挂在 transform 上，left/bottom 不得有过渡", () => {
  const css = T.__EDGE_CSS_PROBE;
  assert.ok(Array.isArray(css) && css.length > 0, "__EDGE_CSS_PROBE 应导出贴边相关 CSS 规则");
  const text = css.join("\n");

  // 1) 位移规则本身不能带 transition（transition 统一由 .oq-edge 声明）
  for (const side of ["left", "right"]) {
    const m = text.match(new RegExp("\\.oq-card\\.oq-edge-" + side + "\\{([^}]*)\\}"));
    assert.ok(m, "应有 .oq-card.oq-edge-" + side + " 规则");
    assert.ok(m[1].includes("translateX"), side + " 侧必须用 translateX 位移");
    assert.ok(!m[1].includes("transition"), side + " 侧规则不得自带 transition（会与 .oq-edge 的重复）");
  }

  // 2) 任何贴边相关规则都不得给 left/bottom 加过渡
  assert.ok(!/transition:[^;}]*\bleft\b/.test(text), "禁止给 left 加过渡（两套动画会互相拉扯）");
  assert.ok(!/transition:[^;}]*\bbottom\b/.test(text), "禁止给 bottom 加过渡（两套动画会互相拉扯）");

  // 3) 收起与展开必须是两条不同的缓动（收束 vs 拉出）
  const edgeRule = text.match(/\.oq-card\.oq-edge\{([^}]*)\}/);
  const openRule = text.match(/\.oq-card\.oq-edge-open\{([^}]*)\}/);
  assert.ok(edgeRule && edgeRule[1].includes("cubic-bezier"), "收起应有明确缓动");
  assert.ok(openRule && openRule[1].includes("cubic-bezier"), "展开应有明确缓动");
  assert.notEqual(edgeRule[1], openRule[1], "收起与展开的过渡不应完全相同（要有方向感差异）");

  // 4) 必须有 will-change，避免每帧重绘 backdrop-filter
  assert.ok(edgeRule[1].includes("will-change:transform"), "收起态应提升合成层");
});

test("把手：可触区必须大于胶囊（细视觉 + 大好点）", () => {
  const text = T.__EDGE_CSS_PROBE.join("\n");
  // 只匹配独立的 .oq-edge-handle{...}（行首），排除
  // ".oq-card... .oq-edge-handle{pointer-events:auto}" 这类组合选择器
  const handle = text.match(/(?:^|\n)\.oq-edge-handle\{([^}]*)\}/);
  assert.ok(handle, "应有独立的 .oq-edge-handle 规则");
  const hitW = Number((handle[1].match(/width:(\d+)px/) || [])[1]);
  assert.ok(!isNaN(hitW), "热区宽度应为具体 px，实际 " + handle[1]);
  assert.ok(hitW > T.EDGE_CAPSULE_W,
    "热区宽度(" + hitW + ") 必须大于胶囊宽度(" + T.EDGE_CAPSULE_W + ")，否则细胶囊点不到");
  assert.equal(hitW, T.EDGE_HANDLE_HIT_W, "CSS 的热区宽度应与常量一致");

  // 收起态必须放开 overflow：把手挂在卡片外侧，overflow:hidden 会把它整个裁掉
  const hidden = text.match(/\.oq-card\.oq-edge:not\(\.oq-edge-open\)\{([^}]*)\}/);
  assert.ok(hidden && hidden[1].includes("overflow:visible"),
    "收起态必须 overflow:visible，否则挂在卡片外侧的把手被裁掉");
});

// 用户截图指出"怎么有两层"：深色卡片外壳 + 紫色胶囊叠在一起。
// 根因是收起时卡片只移出"100% - 把手宽"，那几 px 里除了胶囊还有卡片背景/描边/圆角。
test("贴边收起：卡片外壳必须整体移出视口，视口内只剩紫色把手", () => {
  const text = T.__EDGE_CSS_PROBE.join("\n");

  // 1) 位移必须是完整 100%，不能留任何 px 在外（留了就会看到深色外壳边缘）
  for (const side of ["left", "right"]) {
    const m = text.match(new RegExp("\\.oq-card\\.oq-edge-" + side + "\\{([^}]*)\\}"));
    assert.ok(m, "应有 .oq-edge-" + side + " 规则");
    // 注意：位移里含 calc(...)，用 .* 贪婪匹配到行尾的右括号（[^)]* 会在 calc 的
    // 第一个右括号处截断，导致表达式残缺）
    const tx = m[1].match(/translateX\((.*)\)/);
    assert.ok(tx, side + " 侧应有 translateX");
    // 位移必须是「整卡宽 + EDGE_GAP」：卡片收起前 left=EDGE_GAP，只 -100% 时右边界会
    // 停在 x=EDGE_GAP，那几 px 就是用户看到的"残留侧边"。所以必须是 -100% 再减一个 gap。
    const expr = tx[1].replace(/\s/g, "");
    const sign = side === "left" ? "-" : "";
    assert.ok(
      expr === "calc(" + sign + "100%-" + T.EDGE_GAP + "px)" || expr === "calc(" + sign + "100%+" + T.EDGE_GAP + "px)",
      side + " 位移必须是「整卡宽 + EDGE_GAP」才能完全退出视口，实际 " + expr
    );
    // 关键：不能是"留一条"的写法（-100% + Npx 会露出卡片外壳形成'两层'）
    assert.ok(!/100%\+10px/.test(expr) && !/100%-10px/.test(expr),
      "位移不能是 -100% + 固定 px（那正是'漏边'的来源），实际 " + expr);
  }

  // 2) 把手必须挂在卡片外侧，且偏移要保证"胶囊左边缘距视口 = EDGE_GAP"。
  //    X = EDGE_GAP + CARD_BORDER_W + (CAPSULE_W + HIT_W)/2
  //    两处历史误差：① 少算胶囊自身宽度的一半（差 1px）
  //                  ② 漏掉卡片的 1px 透明 border（absolute 定位的包含块是 padding box）
  const off = T.EDGE_GAP + T.CARD_BORDER_W + (T.EDGE_CAPSULE_W + T.EDGE_HANDLE_HIT_W) / 2;
  const l = text.match(/\.oq-edge-handle\[data-side=left\]\{([^}]*)\}/);
  const r = text.match(/\.oq-edge-handle\[data-side=right\]\{([^}]*)\}/);
  assert.ok(l && l[1].includes("right:-" + off + "px"),
    "左停靠把手偏移应为 right:-" + off + "px，实际 " + (l && l[1]));
  assert.ok(r && r[1].includes("left:-" + off + "px"),
    "右停靠把手偏移应为 left:-" + off + "px，实际 " + (r && r[1]));

  // 3) 几何自洽：按该偏移反推胶囊左边缘到视口的距离，必须正好等于 EDGE_GAP。
  //    包含块是 padding box（右边界在 -CARD_BORDER_W），所以要先减去 border。
  const capLeft = (off - T.CARD_BORDER_W) - (T.EDGE_HANDLE_HIT_W - T.EDGE_CAPSULE_W) / 2 - T.EDGE_CAPSULE_W;
  assert.equal(capLeft, T.EDGE_GAP,
    "胶囊左边缘距视口应为 EDGE_GAP(" + T.EDGE_GAP + "px)，按偏移 " + off + "px 反推得到 " + capLeft);

  // 3) 透明/无阴影/无模糊必须**只作用于真收起态**（:not(.oq-edge-open)）
  const hiddenRule = text.match(/\.oq-card\.oq-edge:not\(\.oq-edge-open\)\{([^}]*)\}/);
  assert.ok(hiddenRule, "应有 .oq-card.oq-edge:not(.oq-edge-open) 规则");
  for (const decl of ["background:transparent", "box-shadow:none", "backdrop-filter:none"]) {
    assert.ok(hiddenRule[1].includes(decl),
      "收起态必须包含 " + decl + "，否则会残留外壳或模糊带，实际 " + hiddenRule[1]);
  }

  // ⚠️ 关键回归：这些"隐形"声明绝不能写在 .oq-card.oq-edge 这种"收起+展开都命中"的规则里。
  // 上一版就是这样：展开时卡片没有背景色，只剩 backdrop-filter:blur() → 用户看到毛玻璃，
  // 要再点一下（类名变化）才恢复。
  const commonRule = text.match(/\.oq-card\.oq-edge\{([^}]*)\}/);
  assert.ok(commonRule, "应有共用规则 .oq-card.oq-edge");
  for (const bad of ["background:transparent", "box-shadow:none", "backdrop-filter:none", "border-color:transparent"]) {
    assert.ok(!commonRule[1].includes(bad),
      "共用规则里不能有 " + bad + "（会让展开态也隐形，出现毛玻璃），实际 " + commonRule[1]);
  }
});

// ── 胶囊视觉与动效（用户反馈"颜色淡了一点"，并要求加动效）──
test("胶囊：底色/描边必须够实（旧的 0.42 中部 + 0.18 描边看起来像半截）", () => {
  const text = T.__EDGE_CSS_PROBE.join("\n");
  const cap = text.match(/\.oq-edge-handle::before\{([^}]*)\}/);
  assert.ok(cap, "应有胶囊本体规则");

  // 底色取"中间亮度"：既不能像最初 0.10/0.42 那样淡到像半截（用户第一次反馈），
  // 也不能像 0.72/0.92 那样深成实心紫（用户第二次反馈"太深了"）。
  // 判定用区间：两端 0.35~0.60，中部 0.65~0.85。
  const alphas = [...cap[1].matchAll(/rgba\(152,140,255,([\d.]+)\)/g)].map((m) => Number(m[1]));
  assert.ok(alphas.length >= 2, "渐变两端应使用 rgba(152,140,255,α)，实际 " + cap[1]);
  for (const a of alphas) {
    assert.ok(a >= 0.35 && a <= 0.6, "渐变两端不透明度应在 0.35~0.6，实际 " + a);
  }
  const core = cap[1].match(/rgba\(133,118,244,([\d.]+)\)/);
  assert.ok(core, "渐变中部应使用 rgba(133,118,244,α)，实际 " + cap[1]);
  const coreA = Number(core[1]);
  assert.ok(coreA >= 0.65 && coreA <= 0.85, "渐变中部不透明度应在 0.65~0.85，实际 " + coreA);

  // 描边：弱于 0.55（太深），强于 0.18（太淡）
  const ring = cap[1].match(/0 0 0 1px rgba\(164,152,255,([\d.]+)\)/);
  assert.ok(ring, "描边应使用 rgba(164,152,255,α)，实际 " + cap[1]);
  const ringA = Number(ring[1]);
  assert.ok(ringA >= 0.3 && ringA <= 0.5, "描边不透明度应在 0.3~0.5，实际 " + ringA);
});

test("动效：呼吸改 box-shadow（不是 opacity），且短线会张开", () => {
  const text = T.__EDGE_CSS_PROBE.join("\n");

  // 1) 呼吸必须动 box-shadow 的强度/半径；旧的只改 opacity 0.86↔1，视觉上等于静止
  const pulse = text.match(/@keyframes oqEdgePulse\{[\s\S]*?\}\}/);
  assert.ok(pulse, "应有 oqEdgePulse 关键帧（含两段）");
  assert.ok(pulse[0].includes("box-shadow"), "呼吸必须改变 box-shadow（改 opacity 幅度太小看不出来）");
  assert.ok(/0 2px \d+px/.test(pulse[0]), "呼吸应同时改变外发光半径");

  // 2) 短线必须真的"张开"：高度变化，而不只是透明度
  // 注意：keyframes 内部有 0%,100%{} 50%{} 两段花括号，用 [^}]* 会在第一个 } 处截断，
  // 必须取到整条 keyframes（到下一个顶层规则为止）
  const grip = text.match(/@keyframes oqEdgeGrip\{[\s\S]*?\}\}/);
  assert.ok(grip, "应有 oqEdgeGrip 关键帧（含两段）");
  assert.ok(/height:\s*\d+px/.test(grip[0]), "短线张开必须改 height（仅改 opacity 看不出'张开'）");
  const hs = [...grip[0].matchAll(/height:(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(hs.length >= 2, "应至少两段 height 取值，实际 " + hs.join("/"));
  assert.ok(Math.max(...hs) - Math.min(...hs) >= 4, "张开幅度应 >=4px，实际 " + hs.join("/"));

  // 3) 两条循环动画只在真收起态跑（展开态卡片已出来，不需要再提示）
  const pulseRule = text.match(/\.oq-card\.oq-edge:not\(\.oq-edge-open\) \.oq-edge-handle::before\{([^}]*)\}/);
  assert.ok(pulseRule && pulseRule[1].includes("oqEdgePulse"), "呼吸应限定在收起态");
  const gripRule = text.match(/\.oq-card\.oq-edge:not\(\.oq-edge-open\) \.oq-edge-handle::after\{([^}]*)\}/);
  assert.ok(gripRule && gripRule[1].includes("oqEdgeGrip"), "张开应限定在收起态");
});

test("动效：吸入时播放一次性脉动，且不影响 3px 对齐", () => {
  const text = T.__EDGE_CSS_PROBE.join("\n");
  const snap = text.match(/@keyframes oqEdgeSnapRing\{[\s\S]*?\}\}/);
  assert.ok(snap, "应有 oqEdgeSnapRing 关键帧（吸入一次性反馈）");

  // 必须用 box-shadow 扩散，**不能用 transform:scale**——缩放会让胶囊离开调好的 3px 基准
  assert.ok(snap[0].includes("box-shadow"), "一次性脉动应用 box-shadow 扩散");
  assert.ok(!snap[0].includes("transform"), "一次性脉动不能用 transform（会破坏 3px 间距对齐）");
  assert.ok(/0 0 0 \d+px/.test(snap[0]), "应通过 spread 半径向外扩散");

  // 只播一次（不是 infinite）
  const snapRule = text.match(/\.oq-edge-handle\.oq-edge-snap::before\{([^}]*)\}/);
  assert.ok(snapRule, "应有 .oq-edge-snap 规则");
  assert.ok(!snapRule[1].includes("infinite"), "吸附脉动必须只播一次");
  assert.ok(snapRule[1].includes(" 1"), "吸附脉动 animation-iteration-count 应为 1");
});

// 用户反馈"hover 触发范围能不能缩小到胶囊，而不是整个面板宽度"。
// 根因：onMouseEnter 绑在 .oq-card（260px）上，卡片虽整体移出视口，但仍保留 260px 命中区。
test("hover：收起态命中区只到把手，不是整个面板宽度", () => {
  const text = T.__EDGE_CSS_PROBE.join("\n");

  // 1) 收起态卡片必须 pointer-events:none（否则 260px 全宽都会响应 hover）
  const hidden = text.match(/\.oq-card\.oq-edge:not\(\.oq-edge-open\)\{([^}]*)\}/);
  assert.ok(hidden, "应有收起态规则");
  assert.ok(hidden[1].includes("pointer-events:none"),
    "收起态卡片必须 pointer-events:none，否则整个面板宽度都会触发 hover");

  // 2) 把手要显式收回 pointer-events（父级 none 需要子级 auto 才能被命中）
  assert.ok(/\.oq-card\.oq-edge:not\(\.oq-edge-open\) \.oq-edge-handle\{[^}]*pointer-events:auto/.test(text),
    "收起态必须给把手单独开 pointer-events:auto，否则点不到");

  // 3) 展开态不能被 none 影响（否则卡片出来后依然点不动）
  const open = text.match(/\.oq-card\.oq-edge-open\{([^}]*)\}/);
  assert.ok(open, "应有展开态规则");
  assert.ok(!open[1].includes("pointer-events:none"),
    "展开态不能继承 pointer-events:none，否则展开后卡片点不动");
});

// 用户重启后实测："鼠标移到面板原本占据的区域滑动（距离胶囊较远）还是会弹出"。
// 只关卡的 pointer-events 无效——真正的 260px 命中盒是它的父级 .oq-overlay。
test("hover：overlay 本身也要按收起态收紧（它才是 260px 命中盒）", () => {
  const text = T.__EDGE_CSS_PROBE.join("\n");
  assert.ok(/\.oq-overlay\.oq-overlay--collapsed\{[^}]*pointer-events:none/.test(text),
    "必须有一条 .oq-overlay--collapsed{pointer-events:none} 规则，" +
    "否则卡片收起后 overlay 仍盖住面板原区域、整片都能触发 hover");
});

test("hover：把手纵向热区不得撑满整张卡片（否则胶囊上下很远也会触发）", () => {
  const text = T.__EDGE_CSS_PROBE.join("\n");
  const handle = text.match(/(?:^|\n)\.oq-edge-handle\{([^}]*)\}/);
  assert.ok(handle, "应有独立的 .oq-edge-handle 规则");
  const decl = handle[1];

  // 旧实现 top:0;bottom:0 → 高度等于卡片高度（~200px）
  assert.ok(!/top:0;bottom:0/.test(decl.replace(/\s/g, "")),
    "把手不得用 top:0;bottom:0 撑满卡片高度，实际 " + decl);
  assert.ok(decl.includes("height:" + T.EDGE_CAPSULE_H + "px"),
    "把手热区高度应等于胶囊高度 " + T.EDGE_CAPSULE_H + "px，实际 " + decl);
  assert.ok(decl.includes("top:50%"), "把手应纵向居中，实际 " + decl);
});

test("动效：内容淡出比位移快，且展开态内容不延迟淡入（否则先露空白）", () => {
  const text = T.__EDGE_CSS_PROBE.join("\n");
  // 收起：内容 0.12s 淡出（远快于 0.42s 位移）——"内容先退场、空壳再滑出去"
  const bodyOut = text.match(/\.oq-card\.oq-edge \.oq-body\{([^}]*)\}/);
  assert.ok(bodyOut, "应有收起态内容规则");
  const outSec = Number((bodyOut[1].match(/opacity ([\d.]+)s/) || [])[1]);
  assert.ok(outSec > 0 && outSec <= 0.2, "内容淡出应在 0.2s 内，实际 " + outSec);

  // 展开：内容淡入不得带 delay（会先露一片空白，像卡住）
  const bodyIn = text.match(/\.oq-card\.oq-edge-open \.oq-body\{([^}]*)\}/);
  assert.ok(bodyIn, "应有展开态内容规则");
  assert.ok(!/\d+s\s+\d/.test(bodyIn[1].replace(/opacity/g, "")) || !/ease \d/.test(bodyIn[1]),
    "展开态内容淡入不应带延迟，实际：" + bodyIn[1]);
});

test("贴边间距：EDGE_GAP 单一来源，CSS 不得写死 px（改一处即全局生效）", () => {
  const { EDGE_GAP, EDGE_HANDLE_HIT_W } = T;
  assert.equal(typeof EDGE_GAP, "number");
  assert.ok(EDGE_GAP >= 0 && EDGE_GAP <= 12, "贴边间距应在 0~12px，实际 " + EDGE_GAP);

  const text = T.__EDGE_CSS_PROBE.join("\n");

  // 1) 位移公式必须是 -(100% + EDGE_GAP)：这一项错了就会漏边（留 EDGE_GAP 宽的一条）
  const left = text.match(/\.oq-card\.oq-edge-left\{([^}]*)\}/);
  assert.ok(left && left[1].includes("-100% - " + EDGE_GAP + "px"),
    "位移必须减掉当前 EDGE_GAP(" + EDGE_GAP + "px)，实际 " + (left && left[1]));

  // 2) 把手偏移必须是 -(EDGE_GAP + (CAPSULE_W + HIT_W)/2)：这一项错了胶囊会偏离目标间距
  const hl = text.match(/\.oq-edge-handle\[data-side=left\]\{([^}]*)\}/);
  const expectOff = EDGE_GAP + T.CARD_BORDER_W + (T.EDGE_CAPSULE_W + EDGE_HANDLE_HIT_W) / 2;
  assert.ok(hl && hl[1].includes("right:-" + expectOff + "px"),
    "把手偏移必须随 EDGE_GAP 联动（right:-" + expectOff + "px），实际 " + (hl && hl[1]));

  // 3) overlay 默认 left 也必须由 EDGE_GAP 推导（首屏位置要与吸附落点一致）
  const overlay = text.match(/\.oq-overlay\{([^}]*)\}/);
  assert.ok(overlay && overlay[1].includes("left:" + EDGE_GAP + "px"),
    "overlay 默认 left 必须等于 EDGE_GAP，实际 " + (overlay && overlay[1]));
});

test("贴边收起：把手尺寸与拖拽阈值在可用区间内", () => {
  const { EDGE_CAPSULE_W, EDGE_HANDLE_HIT_W, EDGE_PULL_TRIGGER, EDGE_HOVER_OUT_MS, EDGE_CARD_OUT_PCT } = T;
  // 胶囊要细（视觉轻），热区要够大（好点）
  assert.ok(EDGE_CAPSULE_W >= 6 && EDGE_CAPSULE_W <= 12,
    "胶囊宽度应在 6~12px，实际 " + EDGE_CAPSULE_W);
  assert.ok(EDGE_HANDLE_HIT_W >= 16 && EDGE_HANDLE_HIT_W <= 32,
    "热区宽度应在 16~32px，实际 " + EDGE_HANDLE_HIT_W);
  assert.ok(EDGE_HANDLE_HIT_W > EDGE_CAPSULE_W, "热区必须大于胶囊，否则细胶囊点不到");
  // 卡片必须完整移出视口：不是 100 就会在视口里留下深色外壳边缘（"两层"）
  assert.equal(EDGE_CARD_OUT_PCT, 100, "卡片收起位移必须是完整 100%");
  assert.ok(EDGE_PULL_TRIGGER >= 8 && EDGE_PULL_TRIGGER <= 40, "吸入阈值应在 8~40px，实际 " + EDGE_PULL_TRIGGER);
  assert.ok(EDGE_HOVER_OUT_MS >= 200 && EDGE_HOVER_OUT_MS <= 1200, "悬停收回延迟应在 200~1200ms，实际 " + EDGE_HOVER_OUT_MS);
});

// ── 缓存命中率圆环（SVG）────────────────────────────────────────────────
// 旧实现是 28px conic-gradient：环宽 4px、数字 8px、硬切端点、单一平色、无底槽。
test("圆环：尺寸/环宽/字号在合理区间（环不能太细也不能太粗）", () => {
  const { RING_SIZE, RING_STROKE, RING_GAP } = T;
  assert.ok(RING_SIZE >= 32 && RING_SIZE <= 40, "直径应在 32~40px，实际 " + RING_SIZE);
  // 下界防"太细"（旧版 4px 环在小直径上像点框），上界防"太粗"（6px 被用户指出太粗）
  assert.ok(RING_STROKE >= 3 && RING_STROKE <= 5,
    "环宽应在 3~5px（6px 太粗、4px 配 28px 直径太细），实际 " + RING_STROKE);
  // 环占面积 ≈ 1 - (1-2s/d)^2，用内孔比例间接校验"视觉粗细"
  const innerRatio = (RING_SIZE - 2 * RING_STROKE) / RING_SIZE;
  assert.ok(innerRatio >= 0.68, "内孔应占直径 >=68%（否则环显粗），实际 " + innerRatio.toFixed(3));

  // 缺口必须与环宽解耦：环变细时缺口不能跟着变窄，否则 99% 又和 100% 分不清
  assert.ok(RING_GAP >= 4, "缺口应 >=4px，实际 " + RING_GAP);
  assert.notEqual(RING_GAP, RING_STROKE, "缺口不应等于环宽（必须解耦）");

  const css = T.__EDGE_CSS_PROBE.join("\n");
  assert.ok(/\.oq-tm-ring b\{[^}]*font-size:12px/.test(css),
    "圆环数字字号应为 12px，实际 " + css.slice(0, 400));
  // 旧的内孔伪元素必须已删除（SVG 自带内孔，留着会盖住环）
  assert.ok(!css.includes("oq-tm-ring::after"), "旧 ::after 内孔规则应已删除");
});

test("圆环：99% 必须留可见缺口，只有 100% 才闭合", () => {
  const { ringEl } = T;
  // ringEl 返回 jsx 桩对象；取第二个 circle（进度弧）的 stroke-dasharray
  const dashOf = (pct) => {
    const root = ringEl(pct, { id: "t" });
    const circles = [];
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.type === "circle") circles.push(n.props);
      if (n.props && n.props.children) walk(n.props.children);
    };
    walk(root);
    // circles[0] = 底槽，circles[1] = 进度弧
    return circles.length > 1 ? circles[1]["stroke-dasharray"] : null;
  };

  // 100% → 整圈（dash == gap == 周长，视觉闭合）
  const d100 = dashOf(100);
  assert.ok(d100, "100% 应有进度弧");
  const [len100, gap100] = d100.split(" ").map(Number);
  assert.ok(Math.abs(len100 - gap100) < 0.01, "100% 应画满整圈，实际 " + d100);

  // 99% → 必须比"理论弧长"短一截，留出可见缺口
  const d99 = dashOf(99);
  const [len99, gap99] = d99.split(" ").map(Number);
  const c = len100;                       // 周长（100% 时 dash == c）
  const ideal99 = c * 0.99;               // 理论弧长
  const gapPx = ideal99 - len99;          // 实际让出的缺口
  assert.ok(gapPx >= 4,
    "99% 必须留 >=4px 缺口（否则与 100% 视觉无法区分），实际缺口 " + gapPx.toFixed(2) + "px");

  // 0% → 不应画弧（dash 为 0 或负，被 clamp 到 0）
  const d0 = dashOf(0);
  if (d0) assert.equal(Number(d0.split(" ")[0]), 0, "0% 不应画弧，实际 " + d0);
});

test("圆环：无数据（null）不画进度弧，只留底槽", () => {
  const { ringEl } = T;
  const root = ringEl(null, { id: "t" });
  const circles = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === "circle") circles.push(n.props);
    if (n.props && n.props.children) walk(n.props.children);
  };
  walk(root);
  assert.equal(circles.length, 1, "无数据时应只有底槽一个 circle，实际 " + circles.length);
  assert.ok(circles[0].stroke.includes("rgba(255,255,255"), "底槽应为淡白轨道");
});

test("DETAIL_COLS：列定义覆盖用户选的三类（基础/拆分/扩展）", () => {
  const { DETAIL_COLS } = T;
  const keys = DETAIL_COLS.map((c) => c[0]);
  for (const k of ["date", "total", "requests", "freshInput", "cacheRead", "output", "topProject", "avgMs"]) {
    assert.ok(keys.includes(k), "明细表必须包含列 " + k);
  }
  // 每列都要有中文表头（表头为空会让用户看不懂）
  for (const c of DETAIL_COLS) assert.ok(c[1] && c[1].length > 0, c[0] + " 缺表头");
});
