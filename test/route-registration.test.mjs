// 路由注册生命周期的回归用例（node:test）。
//
// 背景（真实故障，2026-11-09）：管理页报
//   「用量与额度小窗 (dsh-quota-widget) 异常 · 原因: webserver: duplicate prefix route "/api/opencode"」
// 而功能看起来正常。根因是 apply() 里 15 条 register() 全是裸调用、disposer 被丢弃，
// 插件树重组时 apply() 再跑一遍 ⇒ 第二次 register 撞上第一次留下的条目并抛错。
// 那个抛错发生在 apply 尾部的同步段，于是「报异常」，但首次装载注册的路由仍在服务
// ⇒ 「功能正常」。
//
// 本文件锁住三件事：
//   ① 首次 apply 注册出预期的全部路由；
//   ② 未处置就二次 apply：不抛错（duplicate 降级为 warn），且路由数不翻倍；
//   ③ 正常卸载（跑 disposer）后再 apply：路由恢复，且**不产生** duplicate 警告
//      —— 证明是 ctx.effect 真的撤销了注册，而不是靠兜底吞错蒙混过去。
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// 隔离落盘：apply() 内部会异步 ensureDb/hydrate，不能让用例写进真实的 ~/.dsh。
const home = fs.mkdtempSync(join(tmpdir(), "dsh-quota-route-"));
process.env.DSH_HOME = home;

const { apply } = await import("../lib/index.js");

/** 造一个带真实 duplicate 语义的 WebServer 桩 + 能记账的 ctx。 */
function makeCtx() {
  const routes = new Map();   // `${kind}:${path}` -> spec
  const warnings = [];
  const effects = [];         // 每次 ctx.effect 的 disposer
  const webServer = {
    register(spec) {
      const key = `${spec.kind || "exact"}:${spec.path}`;
      if (routes.has(key)) {
        // 与宿主 @deepseek-ai/dsh-host-webserver 的措辞保持一致
        throw new Error(`webserver: duplicate ${spec.kind || "exact"} route "${spec.path}"`);
      }
      routes.set(key, spec);
      return () => { routes.delete(key); };
    },
  };
  const ctx = {
    get(name) {
      if (name === "webServer") return webServer;
      if (name === "logger") return { info() {}, warn: (m) => warnings.push(String(m)) };
      return undefined;
    },
    on() {},
    // 模拟 cordis：立即执行并记住 disposer，返回 dispose 函数
    effect(fn, label) {
      const dispose = fn();
      const wrapped = () => {
        if (typeof dispose === "function") dispose();
        const i = effects.indexOf(wrapped);
        if (i >= 0) effects.splice(i, 1);
      };
      effects.push(wrapped);
      void label;
      return wrapped;
    },
  };
  return {
    ctx,
    routes,
    warnings,
    disposeAll() { [...effects].forEach((d) => d()); },
  };
}

const EXPECTED = [
  "prefix:/api/opencode",
  "prefix:/api/deepseek",
  "prefix:/api/r4coder",
  "exact:/api/quota/ping",
  "exact:/api/token-meter/reset-preview",
  "exact:/api/token-meter/reset-token",
  "exact:/api/token-meter/backups",
  "exact:/api/token-meter/import-preview",
  "exact:/api/token-meter/import",
  "exact:/api/token-meter/enrich",
  "exact:/api/token-meter/reset",
  "exact:/api/token-meter/day",
  "exact:/api/token-meter",
  "exact:/api/token-meter/gateway",
  "exact:/api/token-meter/query",
];

test("首次 apply：15 条路由全部注册，且都在 ctx.effect 里托管", () => {
  const { ctx, routes } = makeCtx();
  apply(ctx);
  assert.equal(routes.size, EXPECTED.length);
  for (const key of EXPECTED) assert.ok(routes.has(key), `缺路由 ${key}`);
  // 关键回归点：没有一条是「裸注册」——全部经 effect 走了 disposer
  assert.equal(typeof ctx.effect, "function");
});

test("未处置就二次 apply：不抛错，路由数不翻倍，且给出 duplicate 警告", () => {
  const { ctx, routes, warnings } = makeCtx();
  apply(ctx);
  assert.equal(routes.size, EXPECTED.length);

  // 修复前这里必抛 webserver: duplicate prefix route "/api/opencode"
  assert.doesNotThrow(() => apply(ctx), "二次 apply 不得再抛出 duplicate 路由错误");
  assert.equal(routes.size, EXPECTED.length, "路由数必须仍是 15，不得叠加");
  assert.ok(
    warnings.some((w) => w.includes("跳过重复注册") && w.includes("/api/opencode")),
    `应留下 duplicate 降级警告，实际：${JSON.stringify(warnings)}`,
  );
});

test("正常卸载（跑 effect disposer）后再 apply：路由恢复且无 duplicate 警告", () => {
  const { ctx, routes, warnings, disposeAll } = makeCtx();
  apply(ctx);
  assert.equal(routes.size, EXPECTED.length);

  // 模拟宿主卸载插件：ctx.effect 的 disposer 全部执行 ⇒ 路由应被撤销
  disposeAll();
  assert.equal(routes.size, 0, "disposer 必须把路由全部撤掉（这是修复的核心）");

  const before = warnings.length;
  assert.doesNotThrow(() => apply(ctx));
  assert.equal(routes.size, EXPECTED.length);
  assert.equal(
    warnings.slice(before).filter((w) => w.includes("跳过重复注册")).length,
    0,
    "正常重载不应走 duplicate 兜底分支",
  );
});

test("登录 ctx.effect 存在但 register 抛非 duplicate 错误时仍向上抛（不掩盖真故障）", () => {
  const { ctx } = makeCtx();
  const boom = new Error("webserver: listen EADDRINUSE");
  ctx.get = (name) => (name === "webServer"
    ? { register() { throw boom; } }
    : name === "logger" ? { info() {}, warn() {} } : undefined);
  assert.throws(() => apply(ctx), /EADDRINUSE/);
});

test.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });
