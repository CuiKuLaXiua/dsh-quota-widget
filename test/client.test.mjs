// 浏览器半端纯函数单测（node:test）：热力分档与 1d 分时图的"今天"过滤。
import test from "node:test";
import assert from "node:assert/strict";

import { loadClientTesting } from "./load-client.mjs";

const T = await loadClientTesting();
const { HEAT_LV, heatLvOf, groupTodayHourBuckets, fmtTokens } = T;

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
