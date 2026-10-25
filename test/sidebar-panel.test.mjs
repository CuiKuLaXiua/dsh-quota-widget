// 左侧栏「用量与额度」全局面板（DSH v0.2.1-rc.3 sidebar.panellist + main 席位）测试。
// 重点锁三件事：
// 1) 席位未声明时挂起、声明后执行——依赖官方 ui-renderer 的 inject 时序语义；
//    写成无条件同步注册会把「等待旧版 DSH 席位」这一核心兼容行为测没。
// 2) sidebar.panellist 与 main 两个席位按官方契约配对注册（main 的 key === panellist 的 id），
//    缺一半面板就打不开。
// 3) 图标组件遵循侧栏图标契约（接收 {size}，返回 svg），页面组件复用 SettingsPanel 且能完整渲染。
import test from "node:test";
import assert from "node:assert/strict";

import { loadClientModule } from "./load-client.mjs";
import { makeReactStub, makeJsxStub } from "./react-stub.mjs";

/** 收集 {type,props} 树的文本 */
function collectText(node, out = []) {
  if (node == null || node === false) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((n) => collectText(n, out)); return out; }
  if (node && node.props) collectText(node.props.children, out);
  return out;
}

/**
 * 席位声明桩：inject 一律先挂起，declare(name) 时执行该席位上等待的回调。
 * 与真实环境唯一简化：真实环境里"已声明的席位"会让 inject 同步执行，这里统一
 * 走 declare 触发（时序结论等价：都保证"声明先于注册"）。
 */
function makeSlotsHarness() {
  const waiters = new Map(); // name -> [回调]（席位未声明时的挂起队列）
  const declared = new Set(); // 已声明的席位
  const registrations = new Map(); // name -> [{spec, body}]
  return {
    registrations,
    declare(name) {
      declared.add(name);
      const list = waiters.get(name) || [];
      waiters.set(name, []);
      for (const cb of list) cb();
    },
    inject(name, cb) {
      // 对齐真实 ui-renderer 语义：席位已声明 → 回调同步执行；未声明 → 挂起等待，
      // declare 时补执行。disposer 撤销"该次注入注册的条目"（真实实现里回调把
      // register 的 disposer 交回 ctx.effect，销毁连带撤条目）。本插件的注入是
      // 每个席位的唯一来源，disposer 直接清空该席位条目即可精确对应。
      if (declared.has(name)) {
        cb();
      } else {
        if (!waiters.has(name)) waiters.set(name, []);
        waiters.get(name).push(cb);
      }
      return () => {
        registrations.set(name, []);
      };
    },
    register(spec, body) {
      const list = registrations.get(spec.name) || [];
      list.push({ spec, body });
      registrations.set(spec.name, list);
      return spec;
    },
  };
}

function stubEnv({ documentStub, windowExtras, localStorageSeed } = {}) {
  const store = Object.assign({}, localStorageSeed || {});
  const localStorageStub = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  globalThis.localStorage = localStorageStub;
  // window 桩默认带真实的监听器注册表：saveXxx() 广播的事件要能触发
  // 插件自己装的同窗口监听器（侧栏开关的撤销/恢复依赖这条链路）。
  const listeners = new Map(); // type -> Set<fn>
  const windowStub = Object.assign({
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { const s = listeners.get(type); if (s) s.delete(fn); },
    dispatchEvent(e) { const s = listeners.get(e && e.type); if (s) for (const fn of [...s]) { try { fn(e); } catch { /* ignore */ } } return true; },
  }, windowExtras);
  globalThis.window = windowStub;
  if (documentStub) globalThis.document = documentStub;
  return {
    store,
    windowStub,
    cleanup() {
      delete globalThis.window;
      delete globalThis.localStorage;
      if (documentStub) delete globalThis.document;
    },
  };
}

async function setupApply(opts = {}) {
  const { react, reset, runCleanups } = makeReactStub({ keepEffects: !!opts.keepEffects });
  const jsxStub = makeJsxStub();
  const requireStub = (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return jsxStub;
    throw new Error("unexpected require: " + name);
  };
  const mod = await loadClientModule({ requireStub });
  const slots = makeSlotsHarness();
  const env = stubEnv(opts);
  mod.apply({ get: (n) => (n === "slots" ? slots : undefined) });
  return { mod, slots, react, reset, runCleanups, ...env };
}

/** 深度渲染：宿主元素照抄，函数组件元素就地调用展开（QuotaPanelPage → SettingsPanel） */
function renderDeep(node, depth = 0) {
  if (depth > 8 || node == null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => renderDeep(n, depth + 1));
  if (typeof node.type === "function") {
    return renderDeep(node.type(node.props || {}), depth + 1);
  }
  if (node.props && node.props.children !== undefined) {
    return { type: node.type, props: { ...node.props, children: renderDeep(node.props.children, depth + 1) } };
  }
  return node;
}

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

test("侧栏面板：席位未声明时 inject 挂起，不注册任何席位条目", async () => {
  const { slots, cleanup } = await setupApply();
  try {
    assert.equal((slots.registrations.get("sidebar.panellist") || []).length, 0, "席位未声明时不应注册 panellist");
    assert.equal((slots.registrations.get("main") || []).length, 0, "席位未声明时不应注册 main");
  } finally {
    cleanup();
  }
});

test("侧栏面板：声明席位后注册，且 panellist id 与 main key 按官方契约配对", async () => {
  const { mod, slots, cleanup } = await setupApply();
  try {
    slots.declare("sidebar.panellist");
    slots.declare("main");
    const panelList = slots.registrations.get("sidebar.panellist") || [];
    const mains = slots.registrations.get("main") || [];
    assert.equal(panelList.length, 1, "panellist 应恰好注册一条");
    assert.equal(mains.length, 1, "main 应恰好注册一条");
    const listSpec = panelList[0].spec;
    const mainSpec = mains[0].spec;
    assert.equal(listSpec.name, "sidebar.panellist");
    assert.equal(mainSpec.name, "main");
    assert.equal(listSpec.id, mod.__testing.PANEL_ID, "图标行 id 应为插件命名空间 id");
    assert.equal(mainSpec.key, listSpec.id, "main 的 key 必须与 panellist 的 id 同值（官方配对契约）");
    assert.ok(listSpec.label, "图标行应提供 label");
    // 官方侧栏把「插件」面板固定在 order 0；本面板应排在其后，不抢官方入口的位置
    assert.ok(listSpec.order > 0, "第三方面板 order 应大于官方默认（0）");
  } finally {
    cleanup();
  }
});

test("侧栏面板：延迟声明（先 apply 后席位就绪）同样生效——HMR/组合顺序无关", async () => {
  const { slots, cleanup } = await setupApply();
  try {
    // apply 已在 setup 中先行执行（挂起）；现在席位才就绪
    slots.declare("sidebar.panellist");
    slots.declare("main");
    assert.equal((slots.registrations.get("sidebar.panellist") || []).length, 1, "延迟声明后应补注册");
    assert.equal((slots.registrations.get("main") || []).length, 1, "延迟声明后应补注册 main");
  } finally {
    cleanup();
  }
});

test("侧栏面板：用户开关默认开；关闭后撤销两条注册，重新打开恢复", async () => {
  const { mod, slots, cleanup } = await setupApply();
  try {
    slots.declare("sidebar.panellist");
    slots.declare("main");
    assert.equal(mod.__testing.loadSidebarEntry(), true, "默认应显示侧栏入口");
    assert.equal((slots.registrations.get("sidebar.panellist") || []).length, 1);
    assert.equal((slots.registrations.get("main") || []).length, 1);
    // 关闭：广播事件 → 撤销两条注册
    mod.__testing.saveSidebarEntry(false);
    assert.equal(mod.__testing.loadSidebarEntry(), false, "关闭应写盘");
    assert.equal((slots.registrations.get("sidebar.panellist") || []).length, 0, "关闭后应撤销 panellist 注册");
    assert.equal((slots.registrations.get("main") || []).length, 0, "关闭后应撤销 main 注册");
    // 重新打开：恢复注册
    mod.__testing.saveSidebarEntry(true);
    assert.equal((slots.registrations.get("sidebar.panellist") || []).length, 1, "重开应恢复 panellist 注册");
    assert.equal((slots.registrations.get("main") || []).length, 1, "重开应恢复 main 注册");
    // 恢复的注册仍满足配对契约
    assert.equal(slots.registrations.get("main")[0].spec.key, slots.registrations.get("sidebar.panellist")[0].spec.id);
  } finally {
    cleanup();
  }
});

test("侧栏面板：开关关闭时启动（LS 预置 0）不注册任何席位条目，重开后恢复", async () => {
  const { mod, slots, cleanup } = await setupApply({
    localStorageSeed: { oq_sidebar_entry_enabled: "0" },
  });
  try {
    slots.declare("sidebar.panellist");
    slots.declare("main");
    assert.equal(mod.__testing.loadSidebarEntry(), false, "预置 0 应读到关闭态");
    assert.equal((slots.registrations.get("sidebar.panellist") || []).length, 0, "关闭态启动不应注册 panellist");
    assert.equal((slots.registrations.get("main") || []).length, 0, "关闭态启动不应注册 main");
    // 运行中重开 → 恢复注册
    mod.__testing.saveSidebarEntry(true);
    assert.equal((slots.registrations.get("sidebar.panellist") || []).length, 1, "重开应恢复 panellist 注册");
    assert.equal((slots.registrations.get("main") || []).length, 1, "重开应恢复 main 注册");
  } finally {
    cleanup();
  }
});

test("侧栏面板：图标组件按官方契约渲染 SVG（接收 {size, active}，currentColor 跟随行态）", async () => {
  const { slots, cleanup } = await setupApply();
  try {
    slots.declare("sidebar.panellist");
    slots.declare("main");
    const entry = slots.registrations.get("sidebar.panellist")[0];
    // 官方侧栏 PanelRow 以 {size, active} 调用图标（展开态 16px，窄轨 18px）
    const wide = entry.body({ size: 16, active: false });
    assert.equal(wide.type, "svg", "wide 态应渲染 svg 图标");
    assert.equal(wide.props.width, 16, "wide 态图标应为 16px");
    const rail = entry.body({ size: 18, active: true });
    assert.equal(rail.props.width, 18, "窄轨态图标应为 18px");
    assert.equal(rail.props.stroke, "currentColor", "图标应跟随行态颜色（currentColor）");
    assert.ok(rail.props["aria-hidden"], "装饰图标应带 aria-hidden");
    const fallback = entry.body({});
    assert.equal(fallback.props.width, 18, "缺 size 时应兜底 18px");
  } finally {
    cleanup();
  }
});

test("侧栏面板：页面组件完整渲染（标题 + 悬浮窗开关 + 设置页五标签），开关可写回 localStorage", async () => {
  // 面板页会拉 /api/token-meter；给一个「无数据」响应即可（失败分支已有专门测试覆盖）
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: false, error: "stub" }) });
  const dispatched = [];
  const { slots, reset, store, cleanup } = await setupApply({
    windowExtras: { dispatchEvent: (e) => dispatched.push(e && e.type) },
    documentStub: {
      documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute() {}, dataset: {} }),
      head: { appendChild() {} },
      body: { appendChild() {} },
      addEventListener() {},
      removeEventListener() {},
    },
  });
  try {
    slots.declare("sidebar.panellist");
    slots.declare("main");
    const page = slots.registrations.get("main")[0];
    // 官方 main 席位契约：注册的是组件本身（ui-plugin-manager 的 PluginManagerPage 同款），
    // 调用即执行组件（react 桩下 hook 立即可用），返回宿主元素树
    assert.equal(typeof page.body, "function", "main 席位应注册组件本身");
    reset();
    const rendered = page.body();
    assert.ok(String(rendered.props.className || "").includes("oq-page"), "容器应带面板页壳类");
    const tree = renderDeep(rendered); // 就地展开内层的 SettingsPanel 组件元素
    const text = collectText(tree).join(" | ");
    assert.ok(text.includes("用量与额度"), "应有页标题「用量与额度」");
    assert.ok(text.includes("悬浮窗"), "页头应有悬浮窗显隐切换");
    // 复用 SettingsPanel：五个标签与关键卡片文案都应出现
    for (const kw of ["用量统计", "外观", "数据源", "通用", "维护", "面板材质", "清空用量账本"]) {
      assert.ok(text.includes(kw), "页面应包含设置页内容「" + kw + "」");
    }
    // 页头的悬浮窗开关：点击应写回 localStorage（联动 saveWidgetEnabled）
    const toggle = findByText(tree, "悬浮窗显示中");
    assert.ok(toggle.length === 1, "应有「悬浮窗显示中」开关按钮");
    toggle[0].props.onClick();
    assert.equal(store.opencode_quota_widget_enabled, "0", "点击开关应隐藏悬浮窗（写 0）");
    // 面板与悬浮窗互不隐藏：挂载/卸载不得派发任何"隐藏悬浮窗"类事件。
    // （历史教训两连：CSS display:none 会让轮播高度量成 0 且关掉后无人重测；
    // 事件抑制位则让"点侧栏入口 → 悬浮窗消失"违反直觉。联动已整体移除。）
    assert.ok(!dispatched.includes("opencode:panel-widget-suppressed"), "面板挂载不得派发 suppress 事件（联动已移除）");
    assert.ok(!dispatched.includes("opencode:panel-widget-restore"), "面板卸载不得派发 restore 事件（联动已移除）");
  } finally {
    delete globalThis.fetch;
    cleanup();
  }
});

test("侧栏面板：QuotaWidget 显隐只由用户开关决定（面板事件已不存在，悬浮窗不受侧栏影响）", async () => {
  // 回归：曾经的面板联动（CSS display:none → 事件抑制位）两版都出过实机问题。
  // 现在隐藏只走 widget-toggled 读回的 LS_WIDGET；面板相关事件不应有任何监听效果。
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: false, error: "stub" }) });
  const bus = new EventTarget();
  const { slots, reset, runCleanups, cleanup } = await setupApply({
    keepEffects: true, // 悬浮窗的监听器装在 effect 里：保留不回收，事件才能抵达
    windowExtras: {
      addEventListener(type, fn) { bus.addEventListener(type, fn); },
      removeEventListener(type, fn) { bus.removeEventListener(type, fn); },
      dispatchEvent(e) { bus.dispatchEvent(e); return true; },
    },
    documentStub: {
      documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute() {}, dataset: {} }),
      head: { appendChild() {} },
      body: { appendChild() {} },
      addEventListener() {},
      removeEventListener() {},
      visibilityState: "visible",
    },
  });
  try {
    slots.declare("shell.overlay");
    const widgetEntry = slots.registrations.get("shell.overlay")[0];
    assert.ok(widgetEntry, "apply 应注册 shell.overlay（悬浮窗）");
    const el = widgetEntry.body(); // {type: QuotaWidget}
    const styleOf = () => { reset(); return el.type({}).props.style || {}; };
    // 默认显示（style 无 display:none）
    assert.notEqual(String(styleOf().display), "none", "默认应显示悬浮窗");
    // 曾经的联动事件即使被派发也不应改变显隐（监听器已不存在）
    bus.dispatchEvent(new Event("opencode:panel-widget-suppressed"));
    bus.dispatchEvent(new Event("opencode:panel-widget-restore"));
    assert.notEqual(String(styleOf().display), "none", "面板事件不应影响悬浮窗显隐（联动已移除）");
    // 用户开关仍生效：widget-toggled 读回 LS_WIDGET=0 → 隐藏
    globalThis.localStorage.setItem("opencode_quota_widget_enabled", "0");
    bus.dispatchEvent(new Event("opencode:widget-toggled"));
    assert.equal(styleOf().display, "none", "用户开关关闭后应隐藏");
    // 开回来 → 恢复显示
    globalThis.localStorage.setItem("opencode_quota_widget_enabled", "1");
    bus.dispatchEvent(new Event("opencode:widget-toggled"));
    assert.notEqual(String(styleOf().display), "none", "用户开关打开后应恢复显示");
  } finally {
    runCleanups(); // 移除事件监听并停掉轮询定时器，避免挂住测试进程
    delete globalThis.fetch;
    cleanup();
  }
});
