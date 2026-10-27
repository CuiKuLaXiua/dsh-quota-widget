// 浏览器半端纯函数单测（node:test）：热力分档与 1d 分时图的"今天"过滤。
import test from "node:test";
import assert from "node:assert/strict";

import { loadClientTesting } from "./load-client.mjs";

const T = await loadClientTesting();
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

test("DETAIL_COLS：列定义覆盖用户选的三类（基础/拆分/扩展）", () => {
  const { DETAIL_COLS } = T;
  const keys = DETAIL_COLS.map((c) => c[0]);
  for (const k of ["date", "total", "requests", "freshInput", "cacheRead", "output", "topProject", "avgMs"]) {
    assert.ok(keys.includes(k), "明细表必须包含列 " + k);
  }
  // 每列都要有中文表头（表头为空会让用户看不懂）
  for (const c of DETAIL_COLS) assert.ok(c[1] && c[1].length > 0, c[0] + " 缺表头");
});
