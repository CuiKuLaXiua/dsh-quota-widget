// 主题适配的回归用例（node:test）。
//
// 背景（真实故障，2026-11-09）：用户把 DSH 切到浅色皮肤后反馈
//   「设置页和悬浮面板都没有适配浅色系」—— 外壳是浅色，但插件的 tab 条、
//   范围选择条、悬浮窗整体仍是黑底。
//
// 根因不是配色表写错，而是 **CSS 声明位置错**：
//   宿主把 --dsw-alias-* 定义在 <body> 上（body[data-ds-dark-theme] 切换深浅）。
//   本插件曾把整套 --oq-* 挂到 :root 上。自定义属性在**声明处**求值，
//   于是 var(--dsw-alias-bg-layer-2, #1a1a1f) 在 <html> 那层求值时 body 的值
//   还不存在 → 每个 color-mix 都退回写死的深色兜底 → 浅色下整页仍是黑的。
//
// 本文件锁住四条不变量（前三条是这次修的，第四条防回归）：
//   ① 宿主变量派生必须命中 body，不能只写 :root；
//   ② 浅色覆盖挂在 body:not([data-ds-dark-theme])，不用 prefers-color-scheme；
//   ③ 浅色分支必须真的翻转 hero 带与热力色阶；
//   ④ 不得残留写死的深色外壳（菜单、减少动效降级）。
import test from "node:test";
import assert from "node:assert/strict";

import { loadClientTesting } from "./load-client.mjs";

const T = await loadClientTesting();
const css = String(T.__CSS_TEXT);
assert.ok(css.length > 1000, "CSS 文本应可被探测到（__CSS_TEXT）");

/** 取某条选择器之后、到配对右花括号为止的规则体（本文件的规则都不嵌套）。 */
function ruleBody(selector) {
  const i = css.indexOf(selector);
  if (i < 0) return "";
  const open = css.indexOf("{", i);
  const close = css.indexOf("}", open);
  if (open < 0 || close < 0) return "";
  return css.slice(open + 1, close);
}

test("宿主变量派生必须命中 body，不能只挂 :root", () => {
  // 「从 --dsw-alias-* 派生 --oq-canvas」这条映射必须存在
  const mapIdx = css.search(/--oq-canvas:color-mix/);
  assert.ok(mapIdx >= 0, "应存在从 --dsw-alias-* 派生 --oq-canvas 的规则");

  // 找出声明它的那条选择器（往前找最近的 { ）
  const braceIdx = css.lastIndexOf("{", mapIdx);
  const selectorStart = css.lastIndexOf("\n", braceIdx) + 1;
  const selector = css.slice(selectorStart, braceIdx);

  assert.ok(
    selector.includes("body"),
    `派生宿主变量的规则必须命中 body，实际选择器：${JSON.stringify(selector.trim())}`,
  );
  assert.ok(
    !/^\s*:root\s*\{/.test(selector),
    "不能在 :root 上派生宿主变量（声明处求值，拿不到 body 的值）",
  );
});

test("浅色覆盖挂在 body:not([data-ds-dark-theme])，不用 prefers-color-scheme", () => {
  assert.ok(
    css.includes("body:not([data-ds-dark-theme])"),
    "必须用宿主的 body[data-ds-dark-theme] 作为明暗信号",
  );
  assert.ok(
    !css.includes("prefers-color-scheme"),
    "不得用 prefers-color-scheme 判断 DSH 主题（那是操作系统偏好，与宿主主题可不同步）",
  );
});

test("浅色分支必须翻转 hero 带与热力色阶", () => {
  const light = ruleBody("body:not([data-ds-dark-theme]){");
  assert.ok(light.length > 0, "浅色覆盖块应存在且非空");

  // hero 带：深色主题的暖黑底 + 奶白字必须在浅色分支被换掉
  assert.ok(light.includes("--oq-hero-bg:"), "浅色分支必须给 hero 带另一套底色");
  assert.ok(!light.includes("#181715"), "浅色分支不得沿用深色 hero 底 #181715");
  assert.ok(light.includes("--oq-hero-ink:"), "浅色分支必须给 hero 带另一套文字色");

  // 热力色阶：浅底上必须反向（h0 最淡、h6 最浓）
  assert.ok(/--bmon-h0:#ece4d1/i.test(light), "浅色 h0 必须是浅暖色");
  assert.ok(/--bmon-h6:#574194/i.test(light), "浅色 h6 必须是深紫");
});

test("不得残留写死的深色外壳", () => {
  // 玻璃系右键菜单：浅色下会是唯一一块黑板
  assert.ok(
    !/rgba\(20,\s*21,\s*29/.test(css),
    "玻璃系右键菜单不得写死深色底 rgba(20,21,29,…)",
  );
  // 减少动效降级路径：曾写死两段深色渐变
  assert.ok(
    !/rgba\(32,\s*32,\s*44/.test(css) && !/rgba\(38,\s*40,\s*52/.test(css),
    "prefers-reduced-motion 的实色降级必须从 --oq-* 派生，不能写死深色",
  );
});

test("纸张材质仍自带浅色语义变量（不依赖宿主主题）", () => {
  // m-paper 是"自带一套浅色"的材质，深色主题下也不能白底白字。
  // 这次改动没碰它，但它是浅色适配的另一半，一并锁住防回归。
  const paper = css.match(/\.oq-overlay\.m-paper\{[^}]*\}/);
  assert.ok(paper, "应存在 .oq-overlay.m-paper 的变量覆盖块");
  assert.ok(
    paper[0].includes("--dsw-alias-label-primary:"),
    "纸张材质必须就地覆盖 --dsw-alias-label-primary",
  );
  assert.ok(
    paper[0].includes("--bmon-h0:"),
    "纸张材质必须自带一套浅色热力阶",
  );
});
