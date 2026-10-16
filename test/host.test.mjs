// Host 半端纯函数与查询的单测（node:test）。
// 覆盖的都是近期 bug 高发区：本地日口径、日历窗口边界、水位线去重/代际重置、
// home 路径两级解析、小时桶回填窗口、三家额度的响应归一化。
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { __testing as T } from "../lib/index.js";

const pad2 = (n) => String(n).padStart(2, "0");
const DAY = 86400000;
function dayKeyAt(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
/** 造一天的聚合（input/output 直接给 total = input+output 口径） */
function seedDay(day, model, input, output, extra = {}) {
  const agg = Object.assign(T.emptyAgg(), { requests: 1, input, output }, extra);
  agg.total = agg.input + agg.output;
  T.usage.perDay.set(day, agg);
  let m = T.usage.perModel.get(model);
  if (!m) { m = new Map(); T.usage.perModel.set(model, m); }
  m.set(day, Object.assign({}, agg));
}
function resetUsage() {
  T.usage.perDay.clear();
  T.usage.perModel.clear();
  T.usage.records.length = 0;
}

test("dayKeyOf：本地日补零口径", () => {
  const ts = new Date(2026, 0, 5, 9, 30).getTime(); // 本地 2026-01-05
  assert.equal(T.dayKeyOf(ts), "2026-01-05");
  const ts2 = new Date(2026, 11, 31, 23, 59).getTime();
  assert.equal(T.dayKeyOf(ts2), "2026-12-31");
});

test("emptyAgg/mergeAgg：total 恒等于 input+output", () => {
  const a = T.emptyAgg();
  assert.deepEqual(a, { requests: 0, input: 0, output: 0, cacheRead: 0, tools: 0, turns: 0, steps: 0, total: 0 });
  const b = Object.assign(T.emptyAgg(), { requests: 2, input: 10, output: 5, cacheRead: 3, turns: 1 });
  T.mergeAgg(a, b);
  T.mergeAgg(a, b);
  assert.equal(a.requests, 4);
  assert.equal(a.input, 20);
  assert.equal(a.output, 10);
  assert.equal(a.cacheRead, 6);
  assert.equal(a.total, 30); // input+output，不含 cacheRead
});

test("computeUsage：1d 窗口只算本地今天，今天没数据要计 0", () => {
  resetUsage();
  seedDay(dayKeyAt(0), "m-a", 100, 20);
  seedDay(dayKeyAt(1), "m-a", 999, 999);
  const s = T.computeUsage("1d");
  assert.equal(s.daily.length, 1);
  assert.equal(s.daily[0].date, dayKeyAt(0));
  assert.equal(s.totals.total, 120);
  assert.equal(s.totals.requests, 1);
  assert.equal(s.prevTotals.total, 1998); // 前一天作为环比基数

  resetUsage();
  seedDay(dayKeyAt(1), "m-a", 999, 999); // 今天无数据
  const s2 = T.computeUsage("1d");
  assert.equal(s2.daily.length, 0);
  assert.equal(s2.totals.total, 0);
  assert.equal(s2.prevTotals.total, 1998);
  resetUsage();
});

test("computeUsage：7d/30d 窗口含首日、排除窗口外，prevTotals 取上一窗口", () => {
  resetUsage();
  seedDay(dayKeyAt(0), "m-b", 1, 0);
  seedDay(dayKeyAt(6), "m-b", 1, 0);
  seedDay(dayKeyAt(7), "m-b", 100, 0);   // 落入 prev 窗口
  seedDay(dayKeyAt(13), "m-b", 100, 0);  // 落入 prev 窗口
  seedDay(dayKeyAt(14), "m-b", 1000, 0); // 两个窗口都不含

  const s7 = T.computeUsage("7d");
  assert.equal(s7.daily.length, 2);
  assert.equal(s7.totals.total, 2);
  assert.equal(s7.prevTotals.total, 200);

  const s30 = T.computeUsage("30d");
  assert.equal(s30.daily.length, 5);
  assert.equal(s30.totals.total, 1202);
  assert.equal(s30.prevTotals, null); // 30d 的上一窗口在 60d 内，本用例无数据
  resetUsage();
});

test("computeUsage：all 覆盖全部且排除 __system 模型", () => {
  resetUsage();
  seedDay(dayKeyAt(400), "m-c", 7, 3);
  seedDay(dayKeyAt(0), "__system", 0, 0);
  const s = T.computeUsage("all");
  assert.equal(s.daily.length, 2);
  assert.deepEqual(s.models.map((m) => m.model), ["m-c"]);
  assert.equal(s.totals.total, 10);
  resetUsage();
});

test("水位线：seq 代际重置（seq 回落但时间前进）必须放行", () => {
  const sid = "sess-reset";
  T.liveSeqs.delete(sid);
  const mk = (seq, time) => ({ seq, time, type: "assistant/message", data: { usage: { inputTokens: 1 } } });

  assert.equal(T.shouldSkipEvent(sid, mk(100, 1000)), false);
  T.advanceWatermark(sid, mk(100, 1000));
  // 同一事件重复到达 → 跳过
  assert.equal(T.shouldSkipEvent(sid, mk(100, 1000)), true);
  // 更大 seq → 放行
  assert.equal(T.shouldSkipEvent(sid, mk(101, 1000)), false);
  T.advanceWatermark(sid, mk(101, 1000));
  // 代际重置：seq 落到 1，但时间前进 → 必须放行（否则会丢掉整个新世代）
  assert.equal(T.shouldSkipEvent(sid, mk(1, 5000)), false);
  T.advanceWatermark(sid, mk(1, 5000));
  assert.equal(T.liveSeqs.get(sid).time, 5000);
  // seq 未前进 + 时间更旧 → 跳过
  assert.equal(T.shouldSkipEvent(sid, mk(1, 4000)), true);
  // 新世代里 seq 前进即视为新事件（即使时间戳更早）→ 放行
  assert.equal(T.shouldSkipEvent(sid, mk(2, 4999)), false);
  T.liveSeqs.delete(sid);
});

test("seenSeq 复合键：只有 (sessionId, seq) 相同才算重复", () => {
  assert.equal(T.seenKey("a", 1), "a:1");
  assert.notEqual(T.seenKey("a", 1), T.seenKey("b", 1));
});

test("resolveDbPath：env 优先 → 注入的 storages 兜底 → null（fail-closed）", () => {
  const oldEnv = process.env.DSH_HOME;
  try {
    process.env.DSH_HOME = "C:\\home1";
    assert.equal(T.resolveDbPath("C:\\home2\\storages"), T.joinPath("C:\\home1", "storages/token-meter.db"));
    delete process.env.DSH_HOME;
    assert.equal(T.resolveDbPath("C:\\home2\\storages"), T.joinPath("C:\\home2\\storages", "token-meter.db"));
    assert.equal(T.resolveDbPath(null), null); // 两级都拿不到 → 内存模式
  } finally {
    if (oldEnv === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldEnv;
  }
});

test("synthesizeSeq：无 seq 事件的合成键稳定且落在负数区", () => {
  const ev = { session_id: "s1", time: 123, type: "assistant/message", model: "m", input: 1, output: 2 };
  const a = T.synthesizeSeq(ev);
  const b = T.synthesizeSeq(Object.assign({}, ev));
  assert.equal(a, b);
  assert.ok(a < 0);
  assert.notEqual(a, T.synthesizeSeq(Object.assign({}, ev, { output: 3 })));
});

test("normalize*：三家额度响应归一化", () => {
  const oc = T.normalizeOpencode({ data: { quota: { limit: 1000, used: 250 } } });
  assert.equal(oc.limit, 1000);
  assert.equal(oc.used, 250);
  assert.equal(oc.remaining, 750);
  assert.equal(oc.percent, 25);

  const ds = T.normalizeDeepSeek({ balance_infos: [{ currency: "cny", total_balance: "12.5" }, { currency: "usd", total_balance: "3" }] });
  assert.equal(ds.cny.total, 12.5);
  assert.equal(ds.usd.total, 3);

  const r4 = T.normalizeR4Coder({ plan: { package_name: "Pro", total_usd: 100, remaining_usd: 40 }, wallet: { balance_usd: 5 } });
  assert.equal(r4.plan, "Pro");
  assert.equal(r4.used, 60);
  assert.equal(r4.percent, 60);
  assert.equal(r4.extra, "Wallet $5.00");
});

test("cleanModel：unknown 变体归到「其他」，muse 拼写归一", () => {
  assert.equal(T.cleanModel("unknown"), "其他");
  assert.equal(T.cleanModel("unk"), "其他");
  assert.equal(T.cleanModel("muse-park"), "muse-spark");
  assert.equal(T.cleanModel("deepseek-flash"), "deepseek-flash");
});

test("hydrateHourlyBuckets：只回填保留窗口内的小时桶（1d 分时图混天的根因）", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE events(seq INTEGER, time INTEGER NOT NULL, day TEXT NOT NULL, session_id TEXT NOT NULL, model TEXT NOT NULL, input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL, raw TEXT, PRIMARY KEY(seq, session_id));`);
  const ins = db.prepare("INSERT INTO events(seq,time,day,session_id,model,input,output,cache_read,cache_write,type,raw) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
  const now = Date.now();
  const today = T.dayKeyOf(now);
  const oldDay = T.dayKeyOf(now - 10 * DAY);
  ins.run(1, now, today, "s1", "m-a", 10, 2, 0, 0, "assistant/message", null);
  ins.run(2, now - 10 * DAY, oldDay, "s1", "m-b", 99, 99, 0, 0, "assistant/message", null);
  ins.run(3, now, today, "s1", "__system", 0, 0, 0, 0, "turn/end", null);

  T.realtimeHourly.clear();
  const n = T.hydrateHourlyBuckets(db, now);
  assert.equal(n, 1, "只应回填今天这一小时桶");
  const keys = [...T.realtimeHourly.keys()];
  assert.equal(keys.length, 1);
  assert.ok(keys[0].startsWith("m-a::" + today), "窗口外的 10 天前桶不应被回填：" + keys.join(","));
  T.realtimeHourly.clear();
  db.close();
});
