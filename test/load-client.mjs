// 载入浏览器半端（lib/client.js）以取用其纯函数 / 组件。
// client.js 是给宿主 window.__ModuleLoader__ 用的模块工厂（不导出 ESM），
// 所以这里注入一个最小 loader 桩 + react 桩，再调用工厂拿导出。
import { fileURLToPath } from "node:url";

/** 极简 react 桩：只够了让纯函数出口可用（不渲染）。 */
export const stubRequire = (name) => {
  if (name === "react") {
    return { useState: (v) => [v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useMemo: (f) => f() };
  }
  if (name === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null, Fragment: {} };
  throw new Error("unexpected require: " + name);
};

/**
 * 载入并执行模块工厂。
 * @param {{requireStub?: (name:string)=>any}} [opts] 自定义 require 桩（渲染冒烟测试会传带真实 hook 的版本）
 * @returns {Promise<any>} client.js 的导出对象（apply + __testing）
 */
// ESM 只会执行一次模块体：工厂描述符缓存下来，之后每次调用都重新执行一次工厂
// （即"重新加载插件"的语义），这样同一个进程里可以反复拿新的模块实例做多场景测试。
let capturedFactory = null;

export async function loadClientModule(opts = {}) {
  const url = new URL("../lib/client.js", import.meta.url);
  fileURLToPath(url); // 保留真实路径解析（打包/软链场景下便于定位）
  const hadWindow = "window" in globalThis;
  const prevWindow = globalThis.window;
  try {
    if (!capturedFactory) {
      let captured = null;
      globalThis.window = { __ModuleLoader__: { load(mod) { captured = mod; } } };
      await import(url.href);
      if (!captured || typeof captured.factory !== "function") {
        throw new Error("client.js 未注册模块工厂（window.__ModuleLoader__.load 未被调用）");
      }
      capturedFactory = captured.factory;
    }
    const mod = capturedFactory(opts.requireStub || stubRequire);
    if (!mod || !mod.__testing) throw new Error("client.js 未导出 __testing");
    return mod;
  } finally {
    if (hadWindow) globalThis.window = prevWindow; else delete globalThis.window;
  }
}

export async function loadClientTesting() {
  const mod = await loadClientModule();
  return mod.__testing;
}
