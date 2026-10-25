// 共享的最小 React 桩（settings-render / sidebar-panel 渲染冒烟测试共用）。
// useState/useRef 跨渲染保持状态；useEffect 立即执行。默认立即回收 cleanup——
// 组件里的 effect 会 setInterval（轮询/相对时间节拍），不回收的话 node 事件循环
// 永远不空，测试进程会挂住。keepEffects 模式（事件时序测试用）不回收，cleanup
// 存入 cleanups 数组由测试手动 runCleanups()。jsx 桩返回 {type,props} 普通对象，
// 便于遍历文本做断言。

export function makeReactStub({ keepEffects = false } = {}) {
  const states = [];
  const refs = [];
  const cleanups = [];
  let idx = 0;
  const reset = () => { idx = 0; };
  const react = {
    useState(init) {
      const i = idx++;
      if (!(i in states)) states[i] = [typeof init === "function" ? init() : init, (n) => { states[i][0] = typeof n === "function" ? n(states[i][0]) : n; }];
      return states[i];
    },
    useRef(init) {
      const i = idx++;
      if (!(i in refs)) refs[i] = { current: init };
      return refs[i];
    },
    useEffect(fn) {
      const c = fn();
      if (typeof c === "function") {
        if (keepEffects) cleanups.push(c);
        else { try { c(); } catch { /* ignore */ } }
      }
    },
    useMemo(fn) { return fn(); },
  };
  return { react, reset, states, runCleanups: () => { while (cleanups.length) { try { cleanups.pop()(); } catch { /* ignore */ } } } };
}

export function makeJsxStub() {
  const jsx = (type, props) => ({ type, props: props || {} });
  return { jsx, jsxs: jsx, Fragment: "Fragment" };
}
