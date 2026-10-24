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

test("pruneMemoryState：裁掉过期会话的 seenSeq / 水位线 / stepStart / toolStart，保留活跃会话", () => {
  const DAY2 = 86400000;
  T.resetUsage();
  const now = Date.now();
  // 两个 100 天前的死会话
  for (const sid of ["old-a", "old-b"]) {
    for (let i = 0; i < 200; i++) T.seenSeq.add(sid + ":" + i);
    T.liveSeqs.set(sid, { seq: 200, time: now - 100 * DAY2 });
    T.sessionMeta.set(sid, { project: sid });
    T.sessionTitles.set(sid, sid);
  }
  // 一个活跃会话
  for (let i = 0; i < 200; i++) T.seenSeq.add("live-c:" + i);
  T.liveSeqs.set("live-c", { seq: 200, time: now });
  T.sessionMeta.set("live-c", { project: "c" });
  // 未配对的 step/tool 开始时间
  for (let i = 0; i < 50; i++) T.usage.live.stepStart.set("old-a:1:" + i, now - 100 * DAY2);
  for (let i = 0; i < 50; i++) T.usage.live.stepStart.set("live-c:1:" + i, now);
  for (let i = 0; i < 50; i++) T.usage.live.toolStart.set("dead" + i, { t: now - 100 * DAY2, name: "read" });
  for (let i = 0; i < 50; i++) T.usage.live.toolStart.set("fresh" + i, { t: now, name: "read" });

  const before = { seq: T.seenSeq.size, steps: T.usage.live.stepStart.size, tools: T.usage.live.toolStart.size };
  assert.equal(before.seq, 600);
  assert.equal(before.steps, 100);
  assert.equal(before.tools, 100);

  const res = T.pruneMemoryState(now, { info() {} }, true);
  assert.ok(!res.skipped, "首次调用不应被节流");
  assert.equal(T.liveSeqs.size, 1, "死会话的水位线应被删除");
  assert.ok(T.liveSeqs.has("live-c"), "活跃会话必须保留");
  assert.equal(T.seenSeq.size, 200, "只剩下活跃会话的 seenSeq");
  assert.ok(T.seenSeq.has("live-c:5"));
  assert.ok(!T.seenSeq.has("old-a:5"), "死会话的 seenSeq 应被删除");
  assert.equal(T.usage.live.stepStart.size, 50, "只保留未过期的 stepStart");
  assert.equal(T.usage.live.toolStart.size, 50, "只保留未过期的 toolStart");
  assert.ok(!T.sessionMeta.has("old-a"), "死会话的 sessionMeta 也应释放");
  assert.ok(!T.sessionTitles.has("old-b"));

  // 节流：5 分钟内重复调用直接跳过
  const res2 = T.pruneMemoryState(now + 1000, { info() {} });
  assert.ok(res2.skipped, "5 分钟内应被节流");
  T.resetUsage();
});

test("pruneMemoryState：按 day 键裁掉窗口外的维度天，且不改变 1d/7d/30d/90d 读数", () => {
  const DAY2 = 86400000;
  T.resetUsage();
  const now = Date.now();
  // 200 天 × 3 会话：远超 90 天保留窗口
  for (let d = 0; d < 200; d++) {
    const t = now - (200 - d) * DAY2;
    for (let s = 0; s < 3; s++) {
      T.ingestEvent("sess-" + d + "-" + s, {
        type: "assistant/message", time: t,
        data: { turn: 1, step: 1, message: { source: { model: "m" + (d % 5), provider: "p" } }, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0 } },
      });
    }
  }
  assert.equal(T.usage.perDay.size, 200, "构造 200 天，内存里应有 200 个天键");
  const before = {
    "1d": T.computeUsage("1d").totals.total,
    "7d": T.computeUsage("7d").totals.total,
    "30d": T.computeUsage("30d").totals.total,
    "90d": T.computeUsage("90d").totals.total,
  };

  // force 绕过 5 分钟节流：上一个测试可能刚跑过 prune，节流状态会跨测试残留
  T.pruneMemoryState(now, { info() {} }, true);

  // 只保留 90 天（与 DB 侧 pruneExpired 的口径一致）
  assert.ok(T.usage.perDay.size <= 91 && T.usage.perDay.size >= 89, "裁到约 90 天，实际 " + T.usage.perDay.size);
  assert.equal(T.usage.perHourDay.size, T.usage.perDay.size, "perHourDay 同步裁剪");
  // 关键：窗口内读数一个都不能变
  for (const k of Object.keys(before)) {
    assert.equal(T.computeUsage(k).totals.total, before[k], k + " 窗口读数被裁剪改变了");
  }
  T.resetUsage();
});

// ===== 维度回填（enrichDimensions）：分批 + reset_at 语义 =====

/** 造一个带 events 的内存库，并返回 (db, ctx, 事件数)。
 *  注意：库里每个会话的 events 用**该会话自己的 seq**（与 sessionQuery 返回一致），
 *  因为 UPDATE ... WHERE seq=? AND session_id=? 靠这两个键定位。 */
function makeEnrichFixture(sessionCount, eventsPerSession) {
  const db = new DatabaseSync(":memory:");
  db.exec(T.SCHEMA_DDL);
  const now = Date.now();
  const ins = db.prepare("INSERT INTO events(seq,time,day,session_id,model,input,output,cache_read,cache_write,type,raw,project,tool,ms,provider,err,num) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (let s = 0; s < sessionCount; s++) {
    for (let k = 0; k < eventsPerSession; k++) {
      // seq 从 2 起（与 readSession 返回的 assistant/message 的 seq=2 对齐）
      ins.run(2 + k, now - 1000, T.dayKeyOf(now), "sess-" + s, "m", 10, 1, 0, 0, "assistant/message", null, null, null, 0, null, 0, 0);
    }
  }
  const headers = [];
  for (let s = 0; s < sessionCount; s++) headers.push({ header: { id: "sess-" + s, cwd: "D:\\code\\proj-" + s, createdAt: now - 1000 } });
  const ctx = {
    get: (n) => (n === "sessionQuery" ? {
      listSessions: async () => headers,
      readSession: async (id) => ({
        session: { id },
        events: [
          { seq: 1, time: now - 500, type: "step/start", data: { turn: 1, step: 0 } },
          { seq: 2, time: now - 100, type: "assistant/message", data: { turn: 1, step: 0, message: { source: { provider: "prov" } }, usage: { inputTokens: 1, outputTokens: 1 } } },
        ],
      }),
    } : undefined),
  };
  T.setDbForTesting(db);
  T.usage.perDay.set(T.dayKeyOf(now), Object.assign(T.emptyAgg(), { requests: 1, total: 11 }));
  return { db, ctx, now };
}

test("enrichDimensions：按会话分批落库，结果与一次性写完全一致（分批改造的核心）", async () => {
  T.resetUsage();
  // 60 个会话 > ENRICH_BATCH_SESSIONS(24)，必然走多批
  const { db, ctx } = makeEnrichFixture(60, 3);
  const logs = [];
  const applied = await T.enrichDimensions(ctx, { info: (m) => logs.push(m), warn: (m) => logs.push("W:" + m) });

  // 每个会话贡献 1 个 pair（assistant/message），共 60 条
  assert.equal(applied, 60, "应更新 60 行，实际 " + applied);
  const withProject = db.prepare("SELECT COUNT(*) n FROM events WHERE project IS NOT NULL AND project<>''").get().n;
  const withProvider = db.prepare("SELECT COUNT(*) n FROM events WHERE provider IS NOT NULL AND provider<>''").get().n;
  assert.equal(withProject, 60, "每个会话的 project 都要补上");
  assert.equal(withProvider, 60, "provider 也要补上");
  // 分批证据：日志里 batches 应 > 1
  const batchLine = logs.find((l) => l.includes("batches="));
  assert.ok(batchLine, "应有汇总日志");
  const m = batchLine.match(/batches=(\d+)/);
  assert.ok(m && Number(m[1]) > 1, "60 个会话应分成多批写入，实际 " + (m && m[1]));
  // 幂等：第二次直接返回 0
  const again = await T.enrichDimensions(ctx, { info() {}, warn() {} });
  assert.equal(again, 0, "dims_backfill=1 后不得重复回填");
  db.close();
  T.setDbForTesting(null);
  T.resetUsage();
});

test("enrichDimensions：点过「清空账本」(reset_at) 后仍能回填，不被 cut 全量拦住", async () => {
  T.resetUsage();
  const { db, ctx, now } = makeEnrichFixture(3, 2);
  // 模拟用户点过清空账本：reset_at = 现在（比所有会话的 createdAt 都新）。
  // 注意不能用 T.resetUsage()——它会把 perDay 清空，随后 enrich 走"空库跳过"分支，
  // 测不到我们要测的那条路径。这里直接把 __resetAt 抬到当前时刻。
  db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES('reset_at',?)").run(String(now));
  T.setResetAtForTesting(now);
  T.usage.perDay.set(T.dayKeyOf(now), Object.assign(T.emptyAgg(), { requests: 1, total: 11 }));
  const applied = await T.enrichDimensions(ctx, { info() {}, warn() {} });
  // 关键回归：旧实现把 reset_at 塞进 cut，导致 cut > 所有 createdAt，
  // 第一个会话就 break → 整轮回填一条都不处理，而 dims_backfill 仍被置 1。
  assert.ok(applied > 0, "reset_at 之后仍必须补历史维度，实际更新 " + applied + " 行");
  const withProject = db.prepare("SELECT COUNT(*) n FROM events WHERE project IS NOT NULL AND project<>''").get().n;
  assert.ok(withProject > 0, "project 维度不能被清空账本永久锁死");
  db.close();
  T.setDbForTesting(null);
  T.setResetAtForTesting(0);
  T.resetUsage();
});

// ===== v4 新增：区间口径 / 维度聚合 / 实时速率 / 维度回填 =====

test("hourKeyOf：小时键取本地时区（与 dayKeyOf 同口径），不再用 UTC", () => {
  // 本地 2026-10-24 03:00 → 键必须是 2026-10-24T03，而不是 toISOString 给出的 10-23T19
  const t = new Date(2026, 9, 24, 3, 0, 0).getTime();
  assert.equal(T.hourKeyOf(t), "2026-10-24T03");
  assert.equal(T.hourKeyOf(t).slice(0, 10), T.dayKeyOf(t), "小时键的日期段必须等于本地日");
  // 23:xx 也不能越到次日
  const t2 = new Date(2026, 9, 24, 23, 59, 0).getTime();
  assert.equal(T.hourKeyOf(t2), "2026-10-24T23");
  assert.equal(T.hourKeyOf(NaN), "");
});

test("ingestEvent：realtimeHourly 的桶切到本地小时，且 localDate 可用于按本地日过滤", () => {
  T.resetUsage();
  T.realtimeHourly.clear();
  const local = new Date(2026, 9, 24, 3, 30, 0).getTime(); // 本地凌晨 3:30（UTC 前一天 19:30）
  T.ingestEvent("s1", { type: "assistant/message", seq: 1, time: local, data: { turn: 1, step: 1, message: { source: { model: "m", provider: "p" } }, usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0 } } });
  const keys = [...T.realtimeHourly.keys()];
  assert.equal(keys.length, 1);
  assert.equal(keys[0], "m::2026-10-24T03", "桶键必须是本地小时：" + keys.join(","));
  const bucket = T.realtimeHourly.get(keys[0]);
  assert.equal(bucket.localDate, "2026-10-24");
  assert.equal(bucket.hour, "2026-10-24T03:00:00", "hour 不带 Z，客户端按本地时间解析才得到 03:00");
  T.realtimeHourly.clear();
  T.resetUsage();
});

test("hydrateHourlyBuckets：从 events 回填的小时键同样是本地时区（SQL 带 localtime）", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE events(seq INTEGER, time INTEGER NOT NULL, day TEXT NOT NULL, session_id TEXT NOT NULL, model TEXT NOT NULL, input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL, raw TEXT, PRIMARY KEY(seq, session_id));`);
  const ins = db.prepare("INSERT INTO events(seq,time,day,session_id,model,input,output,cache_read,cache_write,type,raw) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
  const local = new Date(2026, 9, 24, 3, 30, 0).getTime();
  ins.run(1, local, T.dayKeyOf(local), "s1", "m-a", 10, 2, 0, 0, "assistant/message", null);
  T.realtimeHourly.clear();
  T.hydrateHourlyBuckets(db, local + 1000);   // 窗口 = 最近 2 天，锚点必须跟着数据日期走
  const keys = [...T.realtimeHourly.keys()];
  assert.equal(keys.length, 1);
  assert.equal(keys[0], "m-a::2026-10-24T03", "回填键必须是本地小时：" + keys.join(","));
  T.realtimeHourly.clear();
  db.close();
});

test("rangeSpec：区间 → 当前/上期窗口天数（90d 无上期，all 不设窗口）", () => {
  assert.deepEqual(T.rangeSpec("1d"), { cur: 1, prev: 1 });
  assert.deepEqual(T.rangeSpec("7d"), { cur: 7, prev: 7 });
  assert.deepEqual(T.rangeSpec("30d"), { cur: 30, prev: 30 });
  assert.deepEqual(T.rangeSpec("90d"), { cur: 90, prev: 0 });
  assert.deepEqual(T.rangeSpec("all"), { cur: 0, prev: 0 });
  assert.deepEqual(T.rangeSpec("垃圾值"), { cur: 0, prev: 0 });
  assert.ok(T.RANGE_VALUES.includes("90d"), "白名单应包含 90d");
});

test("cacheHitRate：无输入返回 null，其余按 cacheRead/(输入+缓存读) 取一位小数", () => {
  assert.equal(T.cacheHitRate(0, 0), null);
  assert.equal(T.cacheHitRate(100, 900), 90);
  assert.equal(T.cacheHitRate(1, 2), 66.7);
  assert.equal(T.cacheHitRate(0, 500), 100);
});

test("computeUsage：90d 窗口覆盖 90 天数据，且不给 prevTotals", () => {
  resetUsage();
  seedDay(dayKeyAt(0), "m-a", 10, 1);
  seedDay(dayKeyAt(89), "m-a", 20, 2);
  seedDay(dayKeyAt(90), "m-a", 999, 999); // 窗口外（第 91 天）
  const s = T.computeUsage("90d");
  assert.equal(s.totals.freshInput, 30);
  assert.equal(s.prevTotals, null);
});

test("computeUsage：totals 拆出新输入/缓存读并给出命中率（旧 prompt 口径保持不变）", () => {
  resetUsage();
  seedDay(dayKeyAt(0), "m-a", 100, 20, { cacheRead: 900 });
  const s = T.computeUsage("1d");
  assert.equal(s.totals.freshInput, 100, "freshInput 不含缓存读");
  assert.equal(s.totals.prompt, 1000, "prompt 仍是 输入+缓存读（悬浮窗依赖）");
  assert.equal(s.totals.total, 1020);
  assert.equal(s.totals.cacheHitRate, 90);
});

test("computeUsage：工具/项目/渠道三个维度按窗口裁剪", () => {
  resetUsage();
  const inDay = dayKeyAt(0);
  const outDay = dayKeyAt(60);
  T.usage.perToolDay.set("read", new Map([[inDay, { calls: 3, ms: 30 }], [outDay, { calls: 5, ms: 50 }]]));
  T.usage.perProjectDay.set("demo", new Map([[inDay, Object.assign(T.emptyAgg(), { requests: 2, input: 10, output: 1, cacheRead: 5 })]]));
  T.usage.perProviderDay.set("unisound", new Map([[inDay, Object.assign(T.emptyAgg(), { requests: 2, input: 10, output: 1, cacheRead: 5 })]]));
  const s = T.computeUsage("7d");
  assert.equal(s.tools.length, 1);
  assert.equal(s.tools[0].tool, "read");
  assert.equal(s.tools[0].calls, 3, "窗口外的 60 天前调用不应计入");
  assert.equal(s.tools[0].avgMs, 10);
  assert.equal(s.projects[0].project, "demo");
  assert.equal(s.projects[0].total, 16);
  assert.equal(s.providers[0].provider, "unisound");
  resetUsage();
});

test("rateOverWindow：只累计近 60s 的样本，分母是墙钟秒数", () => {
  T.usage.live.outputs60.length = 0;
  const now = Date.now();
  T.usage.live.outputs60.push({ t: now - 1000, tokens: 30 });
  T.usage.live.outputs60.push({ t: now - 30000, tokens: 30 });
  T.usage.live.outputs60.push({ t: now - 90000, tokens: 600 }); // 窗口外
  const r = T.rateOverWindow(now);
  assert.equal(r.tokens, 60);
  assert.equal(r.perSec, 1); // 60 / 60s
  T.usage.live.outputs60.length = 0;
});

test("projectFromCwd / decodeSessionDirName：cwd 取末段并小写，目录名可还原", () => {
  assert.equal(T.projectFromCwd("D:\\code\\Zenith"), "zenith");
  assert.equal(T.projectFromCwd("d:/code/token-lens/"), "token-lens");
  assert.equal(T.projectFromCwd(""), "");
  assert.equal(T.projectFromCwd(null), "");
  // 目录名编码：`-` = 分隔符，`~XXXX` = UTF-16 码元。注意它不可逆——
  // 字面连字符与分隔符都写成 `-`，所以 `--D-code-token-lens--` 只能还原成
  // D/code/token/lens、取末段得 "lens"。这只是"会话头没有 cwd"时的兜底猜测，
  // 正常路径用会话头里的权威 cwd（见 scanFilesystemFallback / enrichDimensions），
  // 目录名只在解析到 session 头之前临时用一下。
  assert.equal(T.projectFromCwd(T.decodeSessionDirName("--D-code-token-lens--")), "lens");
  assert.equal(T.projectFromCwd(T.decodeSessionDirName("--D-code-tmp~0020dir--")), "tmp dir");
  assert.equal(T.projectFromCwd(T.decodeSessionDirName("--D-MyProject-ems~8D44~6E90~5305--")), "ems资源包");
  assert.equal(T.decodeSessionDirName("not-encoded"), "");
});

test("noteProject/projectOf：空值不覆盖已有项目名", () => {
  T.sessionMeta.clear();
  T.noteProject("s-a", "D:\\code\\demo");
  assert.equal(T.projectOf("s-a"), "demo");
  T.noteProject("s-a", "");
  assert.equal(T.projectOf("s-a"), "demo", "空 cwd 不应把已有项目名抹掉");
  assert.equal(T.projectOf("s-unknown"), "");
  T.sessionMeta.clear();
});

test("ingestEvent：回填路径传 {live:false} 时不进 live.*（live 口径 = 本次进程启动至今）", () => {
  T.resetUsage();
  const now = Date.now();
  const old = now - 10 * DAY;
  // 30 条 10 天前的历史，显式声明为回填（回填路径都这么调）
  for (let i = 0; i < 30; i++) {
    T.ingestEvent("hist", { type: "assistant/message", seq: i + 1, time: old + i * 1000, data: { turn: 1, step: 1, message: { source: { model: "m", provider: "p" } }, usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500 } } }, { live: false });
  }
  assert.equal(T.usage.live.msgs, 0, "历史回填不得计入本次启动的实时计数");
  assert.equal(T.usage.live.outputTokens, 0);
  assert.equal(T.usage.live.outputs60.length, 0, "60s 速率窗口也不应收历史样本");
  // 实时路径不传 opts
  T.ingestEvent("live", { type: "assistant/message", seq: 1, time: now, data: { turn: 1, step: 1, message: { source: { model: "m", provider: "p" } }, usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0 } } });
  assert.equal(T.usage.live.msgs, 1, "实时事件推进 live");
  assert.equal(T.usage.live.outputTokens, 1);
  // 但账本口径不受影响：历史照样算进 perDay
  assert.equal(T.computeUsage("all").totals.requests, 31);
  T.resetUsage();
});

test("ingestEvent：实时事件即使时间戳早于启动时刻也计入 live（回填期间/时钟回拨都不能误杀）", () => {
  T.resetUsage();
  const now = Date.now();
  // 回填是启动后 1.2s 才异步跑的：这期间用户真实发出的消息，时间戳同样早于启动时刻。
  // 若按"time < 启动时刻"判断就整段漏计；现在由调用方声明，实时路径一律计入。
  T.ingestEvent("s1", { type: "assistant/message", seq: 1, time: now - 5 * 60 * 1000, data: { turn: 1, step: 1, message: { source: { model: "m", provider: "p" } }, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0 } } });
  assert.equal(T.usage.live.msgs, 1, "5 分钟前的实时消息仍应计入 live（旧的按时间判断会漏计）");
  assert.equal(T.usage.live.outputTokens, 20);
  // 时钟回拨 1 小时
  T.resetUsage();
  T.ingestEvent("s2", { type: "assistant/message", seq: 1, time: Date.now() - 3600 * 1000, data: { turn: 1, step: 1, message: { source: { model: "m", provider: "p" } }, usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0 } } });
  assert.equal(T.usage.live.msgs, 1, "系统时钟回拨后实时事件仍应计入");
  T.resetUsage();
});

test("ingestEvent：轮次按 turn/start 计（turn/end 常缺失），失败轮次仍走 turn/end", () => {
  T.resetUsage();
  const t = Date.now();
  // 真实会话文件形态：有 turn/start，没有 turn/end
  T.ingestEvent("s1", { type: "turn/start", seq: 1, time: t, data: { turn: 1 } });
  T.ingestEvent("s1", { type: "step/start", seq: 2, time: t + 1, data: { turn: 1, step: 1 } });
  T.ingestEvent("s1", { type: "step/end", seq: 3, time: t + 2, data: { turn: 1, step: 1 } });
  let s = T.computeUsage("1d");
  assert.equal(s.totals.turns, 1, "只有 turn/start 时轮次也必须为 1（此前恒为 0）");
  assert.equal(s.totals.steps, 1);
  // 失败轮次：turn/end 带 reason.kind=error
  T.ingestEvent("s1", { type: "turn/end", seq: 4, time: t + 3, data: { reason: { kind: "error" } } });
  s = T.computeUsage("1d");
  assert.equal(s.totals.turns, 1, "turn/end 不得把轮次重复计一遍");
  assert.equal(s.reliability.errors, 1, "失败轮次仍来自 turn/end.reason.kind=error");
  T.resetUsage();
});

test("computeUsage：models[] 下发 freshInput，且 total = input + output（input 已含缓存读）", () => {
  T.resetUsage();
  const t = Date.now();
  T.ingestEvent("s1", { type: "assistant/message", seq: 1, time: t, data: { turn: 1, step: 1, message: { source: { model: "m1", provider: "p" } }, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 900 } } });
  const m = T.computeUsage("1d").models[0];
  assert.equal(m.freshInput, 100, "freshInput 是新输入，不含缓存读");
  assert.equal(m.input, 1000, "input 是含缓存读的 prompt 口径");
  assert.equal(m.cacheRead, 900);
  assert.equal(m.total, m.input + m.output, "total 不能把 cacheRead 再加一遍（会翻倍）");
  assert.equal(m.total, 1020);
  assert.equal(m.total, T.computeUsage("1d").totals.total, "模型行总量应与 totals 对齐");
  T.resetUsage();
});

test("ingestEvent：assistant/message 同时进模型/渠道/项目维度，并记录耗时与窗口样本", () => {
  T.resetUsage();
  T.noteProject("s1", "D:\\code\\demo-app");
  const t = Date.now();
  T.ingestEvent("s1", { type: "step/start", seq: 1, time: t - 1000, data: { turn: 1, step: 1 } });
  T.ingestEvent("s1", {
    type: "assistant/message", seq: 2, time: t,
    data: { turn: 1, step: 1, message: { source: { provider: "opencode-go", model: "deepseek-v4-flash" } }, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 900 } },
  });
  const s = T.computeUsage("1d");
  assert.equal(s.totals.freshInput, 100);
  assert.equal(s.totals.cache_read, 900);
  assert.equal(s.totals.cacheHitRate, 90);
  assert.equal(s.providers[0].provider, "opencode-go");
  assert.equal(s.projects[0].project, "demo-app");
  assert.equal(s.records[0].durationMs, 1000, "耗时 = assistant/message - step/start");
  assert.equal(s.records[0].provider, "opencode-go");
  assert.equal(s.records[0].project, "demo-app");
  assert.equal(T.usage.live.msgs, 1);
  assert.equal(T.usage.live.outputs60.length, 1);
  assert.equal(T.rateOverWindow(t).perSec, 0.3, "20 tokens / 60s");
  T.sessionMeta.clear();
  T.resetUsage();
});

test("ingestEvent：tool/call → tool/result 配对出工具名与耗时，并计入 daily_tool 同口径的内存维度", () => {
  T.resetUsage();
  const t = Date.now();
  T.ingestEvent("s1", { type: "tool/call", seq: 1, time: t, data: { turn: 1, step: 1, callId: "c1", name: "pwsh" } });
  T.ingestEvent("s1", { type: "tool/result", seq: 2, time: t + 400, data: { turn: 1, step: 1, message: { source: { callId: "c1" }, content: [{ type: "tool-result" }] } } });
  const s = T.computeUsage("1d");
  assert.equal(s.tools.length, 1);
  assert.equal(s.tools[0].tool, "pwsh", "工具名应来自 tool/call.data.name");
  assert.equal(s.tools[0].calls, 1);
  assert.equal(s.tools[0].ms, 400);
  assert.equal(s.totals.tools, 1);
  assert.equal(T.usage.live.toolCalls, 1);
  T.resetUsage();
});

test("ingestEvent：项目维度也计入工具调用（与 daily_project.tools 口径一致）", () => {
  T.resetUsage();
  T.noteProject("s1", "D:\\code\\demo-app");
  const t = Date.now();
  T.ingestEvent("s1", { type: "tool/call", seq: 1, time: t, data: { callId: "c1", name: "grep" } });
  T.ingestEvent("s1", { type: "tool/result", seq: 2, time: t + 5, data: { message: { source: { callId: "c1" } } } });
  const s = T.computeUsage("1d");
  assert.equal(s.projects[0].project, "demo-app");
  assert.equal(s.projects[0].tools, 1, "项目维度的工具数应与 daily_project.tools 一致");
  T.sessionMeta.clear();
  T.resetUsage();
});

test("ingestEvent：工具失败被计入 toolErrors，失败轮次被计入 errors", () => {
  T.resetUsage();
  const t = Date.now();
  T.ingestEvent("s1", { type: "tool/call", seq: 1, time: t, data: { callId: "c9", name: "read" } });
  T.ingestEvent("s1", { type: "tool/result", seq: 2, time: t + 10, data: { message: { source: { callId: "c9" }, isError: true } } });
  T.ingestEvent("s1", { type: "turn/end", seq: 3, time: t + 20, data: { turn: 1, reason: { kind: "error", error: { message: "TRANSPORT" } } } });
  assert.equal(T.usage.live.toolErrors, 1);
  assert.equal(T.usage.live.errors, 1);
  T.resetUsage();
});

test("ingestEvent：步内首个产出信号广匹配 + 分类计数（首 token 的自证手段）", () => {
  T.resetUsage();
  const t = Date.now();
  T.ingestEvent("s1", { type: "step/start", seq: 1, time: t, data: { turn: 1, step: 1 } });
  // tool-call-chunks 不算首 token 样本（只是开始吐工具调用）
  T.ingestEvent("s1", { type: "tool-call-chunks", seq: 2, time: t + 10, data: { turn: 1, step: 1 } });
  assert.equal(T.usage.live.firstTokenCount, 0);
  // text-chunks 命中 → 记录首 token 延迟
  T.ingestEvent("s1", { type: "text-chunks", seq: 3, time: t + 250, data: { turn: 1, step: 1 } });
  assert.equal(T.usage.live.firstTokenCount, 1);
  assert.equal(T.usage.live.firstTokenSum, 250);
  assert.equal(T.usage.live.signalCount["tool-call-chunks"], 1);
  assert.equal(T.usage.live.signalCount["text-chunks"], 1);
  // 同一步再来一个信号不重复计数
  T.ingestEvent("s1", { type: "assistant/chunk", seq: 4, time: t + 300, data: { turn: 1, step: 1 } });
  assert.equal(T.usage.live.firstTokenCount, 1);
  assert.equal(T.usage.live.signalCount["assistant/chunk"], 1);
  const live = T.computeUsage("1d").live;
  assert.equal(live.firstTokenCount, 1);
  assert.equal(live.firstTokenMs, 250);
  T.resetUsage();
});

test("ingestEvent：重试与上下文压缩计数（可靠性）", () => {
  T.resetUsage();
  const t = Date.now();
  T.ingestEvent("s1", { type: "llm/retry", seq: 1, time: t, data: { failure: { code: "TRANSPORT" } } });
  T.ingestEvent("s1", { type: "llm/retry", seq: 2, time: t + 1, data: { failure: { code: "TRANSPORT" } } });
  T.ingestEvent("s1", { type: "compaction/end", seq: 3, time: t + 2, data: {} });
  const rel = T.computeUsage("1d").reliability;
  assert.equal(rel.retries, 2);
  assert.equal(rel.compactions, 1);
  assert.deepEqual(rel.retryCodes, [{ code: "TRANSPORT", n: 2 }]);
  T.resetUsage();
});

test("rebuildToolPartitions/rebuildProjectPartitions：从 events 幂等重建，未知工具落 '—'", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(T.SCHEMA_DDL);
  const now = Date.now();
  const day = T.dayKeyOf(now);
  const ins = db.prepare("INSERT INTO events(seq,time,day,session_id,model,input,output,cache_read,cache_write,type,raw,project,tool,ms,provider) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  ins.run(1, now, day, "s1", "__system", 0, 0, 0, 0, "tool/result", null, "demo", "read", 25, null);
  ins.run(2, now, day, "s1", "__system", 0, 0, 0, 0, "tool/result", null, "demo", null, 0, null);
  ins.run(3, now, day, "s1", "u2-flash", 100, 20, 900, 0, "assistant/message", null, "demo", null, 500, "unisound");
  T.rebuildToolPartitions(db, now);
  T.rebuildProjectPartitions(db, now);
  T.rebuildToolPartitions(db, now); // 再跑一次：结果必须不变（整分区重建语义）
  const tools = db.prepare("SELECT tool, calls, ms FROM daily_tool ORDER BY calls DESC, tool").all();
  assert.equal(tools.length, 2);
  assert.equal(tools[0].tool, "read");
  assert.equal(tools[0].calls, 1);
  assert.equal(tools[0].ms, 25);
  assert.equal(tools[1].tool, "—", "没有工具名的历史行应落 '—' 桶");
  const proj = db.prepare("SELECT project, requests, input, output, cache_read, tools FROM daily_project").all();
  assert.equal(proj.length, 1);
  assert.equal(proj[0].project, "demo");
  assert.equal(proj[0].requests, 1);
  assert.equal(proj[0].input, 100);
  assert.equal(proj[0].cache_read, 900);
  assert.equal(proj[0].tools, 2);
  db.close();
});

test("resetUsage：清空内存账本并把实时计数归零（mem 模式）", () => {
  T.setDbForTesting(null);
  T.noteProject("s1", "D:\\code\\demo");
  seedDay(dayKeyAt(0), "m-a", 10, 1);
  T.usage.perToolDay.set("read", new Map([[dayKeyAt(0), { calls: 1, ms: 1 }]]));
  T.usage.live.toolCalls = 5;
  T.usage.live.msgs = 3;
  T.resetUsage();
  assert.equal(T.usage.perDay.size, 0);
  assert.equal(T.usage.perToolDay.size, 0);
  assert.equal(T.usage.perProjectDay.size, 0);
  assert.equal(T.usage.perProviderDay.size, 0);
  assert.equal(T.usage.live.toolCalls, 0);
  assert.equal(T.usage.live.msgs, 0);
  assert.equal(T.sessionMeta.size, 0);
  assert.equal(T.computeUsage("1d").totals.total, 0);
});

test("dbHealthSnapshot：无库时降级为 memory 且不抛异常", () => {
  T.setDbForTesting(null);
  const h = T.dbHealthSnapshot();
  assert.equal(h.store, "memory");
  assert.equal(h.events, null);
});

// ===== v5 新增：会话 / 时段 / 可靠性 =====

test("computeUsage：totals.days / prevTotals.days 给出窗口内的覆盖天数（环比按日均的前置）", () => {
  resetUsage();
  seedDay(dayKeyAt(0), "m-a", 10, 1);
  seedDay(dayKeyAt(1), "m-a", 10, 1);
  seedDay(dayKeyAt(2), "m-a", 10, 1);
  seedDay(dayKeyAt(8), "m-a", 30, 3); // 上一窗口只覆盖 1 天
  const s = T.computeUsage("7d");
  assert.equal(s.totals.days, 3);
  assert.equal(s.prevTotals.days, 1);
});

test("computeUsage：sessions 按会话聚合，并带上标题/项目（标题来自 session/title 事件）", () => {
  T.resetUsage();
  T.noteProject("s-a", "D:\\code\\demo");
  const t = Date.now();
  T.ingestEvent("s-a", { type: "session/title", seq: 1, time: t, data: { title: "重构弹窗" } });
  T.ingestEvent("s-a", { type: "assistant/message", seq: 2, time: t, data: { turn: 1, step: 1, message: { source: { provider: "unisound", model: "u2-flash" } }, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 900 } } });
  T.ingestEvent("s-b", { type: "assistant/message", seq: 3, time: t, data: { turn: 1, step: 1, message: { source: { provider: "unisound", model: "u2-flash" } }, usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0 } } });
  const s = T.computeUsage("1d");
  assert.equal(s.sessions.length, 2);
  assert.equal(s.sessions[0].sessionId, "s-a");
  assert.equal(s.sessions[0].title, "重构弹窗");
  assert.equal(s.sessions[0].project, "demo");
  assert.equal(s.sessions[0].total, 1010); // 新输入 100 + 输出 10 + 缓存读 900
  T.sessionMeta.clear();
  T.sessionTitles.clear();
  T.resetUsage();
});

test("computeUsage：hours 是 7×24 矩阵，按本地星期/小时累计", () => {
  T.resetUsage();
  const t = new Date(2026, 9, 17, 15, 30).getTime(); // 本地 2026-10-17 15:30（周六）
  T.ingestEvent("s1", { type: "assistant/message", seq: 1, time: t, data: { turn: 1, step: 1, message: { source: { model: "m", provider: "p" } }, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0 } } });
  // ⚠️ 必须用 all：hours 按 day 归集，而 1d/7d/30d 的窗口是"以本地今天为终点"的日历窗口。
  // 这里摄入的是固定历史日 2026-10-17，用 1d 去读，一旦运行日期不是那天就恒为 0
  //（此前正是因此长期失败，被误记为"本机环境问题"）。范围与数据日期解耦才不依赖运行时钟。
  const s = T.computeUsage("all");
  assert.equal(s.hours.length, 7);
  assert.equal(s.hours[0].length, 24);
  assert.equal(s.hours[6][15], 110, "周六 15 点应为 100+10");
  const sum = s.hours.reduce((a, row) => a + row.reduce((x, y) => x + y, 0), 0);
  assert.equal(sum, 110);
  T.resetUsage();
});

test("computeUsage：hours 在数据落在今天时也能被 1d 读到（日历窗口与星期矩阵不冲突）", () => {
  T.resetUsage();
  const now = new Date();
  T.ingestEvent("s1", { type: "assistant/message", seq: 1, time: now.getTime(), data: { turn: 1, step: 1, message: { source: { model: "m", provider: "p" } }, usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 0 } } });
  const s = T.computeUsage("1d");
  assert.equal(s.hours[now.getDay()][now.getHours()], 10, "今天的用量应落在对应星期/小时格");
  T.resetUsage();
});

test("ingestEvent：可靠性三类事件进 perRelDay/perRetryDay，并可被 daily_reliability 重建", () => {
  T.resetUsage();
  const t = Date.now();
  T.ingestEvent("s1", { type: "llm/retry", seq: 1, time: t, data: { failure: { code: "TRANSPORT" } } });
  T.ingestEvent("s1", { type: "llm/retry", seq: 2, time: t, data: { failure: { code: "TIMEOUT" } } });
  T.ingestEvent("s1", { type: "compaction/end", seq: 3, time: t, data: {} });
  T.ingestEvent("s1", { type: "command/done", seq: 4, time: t, data: { kind: "success", text: "Compacted 572 history items (~420,528 tokens)." } });
  const rel = T.computeUsage("1d").reliability;
  assert.equal(rel.since, "range");
  assert.equal(rel.retries, 2);
  assert.equal(rel.compactions, 1);
  assert.equal(rel.compactedTokens, 420528);
  assert.deepEqual(rel.retryCodes.map((x) => x.code).sort(), ["TIMEOUT", "TRANSPORT"]);
  T.resetUsage();
});

test("rebuildSession/Hour/ReliabilityPartitions：从 events 幂等重建", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(T.SCHEMA_DDL);
  const now = Date.now();
  const day = T.dayKeyOf(now);
  const hour = new Date(now).getHours();
  const ins = db.prepare("INSERT INTO events(seq,time,day,session_id,model,input,output,cache_read,cache_write,type,raw,project,tool,ms,provider,err,num) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  ins.run(1, now, day, "s1", "m", 100, 10, 900, 0, "assistant/message", null, "demo", null, 500, "unisound", 0, 0);
  ins.run(2, now, day, "s1", "__system", 0, 0, 0, 0, "tool/result", null, "demo", "read", 20, null, 1, 0);
  ins.run(3, now, day, "s1", "__system", 0, 0, 0, 0, "turn/start", null, "demo", null, 0, null, 0, 0);
  ins.run(4, now, day, "s1", "__system", 0, 0, 0, 0, "turn/end", null, "demo", null, 0, null, 1, 0);
  ins.run(5, now, day, "s1", "__system", 0, 0, 0, 0, "llm/retry", "TRANSPORT", "demo", null, 0, null, 0, 0);
  ins.run(6, now, day, "s1", "__system", 0, 0, 0, 0, "compaction/end", null, "demo", null, 0, null, 0, 0);
  ins.run(7, now, day, "s1", "__system", 0, 0, 0, 0, "command/done", null, "demo", null, 0, null, 0, 420528);
  T.rebuildSessionPartitions(db, now);
  T.rebuildHourPartitions(db, now);
  T.rebuildReliabilityPartitions(db, now);
  T.rebuildReliabilityPartitions(db, now); // 再跑一次：结果必须不变
  const sess = db.prepare("SELECT session_id, requests, input, cache_read, tools, turns FROM daily_session").all();
  assert.equal(sess.length, 1);
  assert.equal(sess[0].requests, 1);
  assert.equal(sess[0].tools, 1);
  assert.equal(sess[0].turns, 1);
  const hrs = db.prepare("SELECT hour, requests FROM daily_hour").all();
  assert.equal(hrs.length, 1);
  assert.equal(Number(hrs[0].hour), hour);
  const rel = db.prepare("SELECT retries, compactions, compacted_tokens, errors, tool_errors FROM daily_reliability").all();
  assert.equal(rel.length, 1);
  assert.equal(rel[0].retries, 1);
  assert.equal(rel[0].compactions, 1);
  assert.equal(rel[0].compacted_tokens, 420528);
  assert.equal(rel[0].errors, 1);
  assert.equal(rel[0].tool_errors, 1);
  const codes = db.prepare("SELECT code, n FROM daily_retry").all();
  assert.equal(codes.length, 1);
  assert.equal(codes[0].code, "TRANSPORT");
  db.close();
});

