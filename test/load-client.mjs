// 载入浏览器半端（lib/client.js）以取用其纯函数。
// client.js 是给宿主 window.__ModuleLoader__ 用的模块工厂（不导出 ESM），
// 所以这里注入一个最小 loader 桩 + react 桩，再调用工厂拿 __testing。
import { fileURLToPath } from "node:url";

export async function loadClientTesting() {
  const url = new URL("../lib/client.js", import.meta.url);
  fileURLToPath(url); // 保留真实路径解析（打包/软链场景下便于定位）
  let captured = null;
  const hadWindow = "window" in globalThis;
  const prevWindow = globalThis.window;
  let testing = null;
  try {
    globalThis.window = { __ModuleLoader__: { load(mod) { captured = mod; } } };
    await import(url.href);
    if (!captured || typeof captured.factory !== "function") {
      throw new Error("client.js 未注册模块工厂（window.__ModuleLoader__.load 未被调用）");
    }
    const requireStub = (name) => {
      if (name === "react") {
        return { useState: (v) => [v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useMemo: (f) => f() };
      }
      if (name === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null, Fragment: {} };
      throw new Error("unexpected require: " + name);
    };
    const mod = captured.factory(requireStub);
    testing = mod && mod.__testing;
    if (!testing) throw new Error("client.js 未导出 __testing");
  } finally {
    if (hadWindow) globalThis.window = prevWindow; else delete globalThis.window;
  }
  return testing;
}
