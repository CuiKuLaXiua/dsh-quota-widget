# 开发说明

- 宿主端 `lib/index.js`：纯 Node ESM，注册 `/api/opencode/*`、`/api/deepseek/*`、
  `/api/r4coder/*`、`/api/token-meter` 等回环保护的同源 JSON 路由。
- 浏览器端 `lib/client.js`：按 DSH 模块加载器（`window.__ModuleLoader__.load`）
  格式手写的单文件 bundle，只依赖平台共享模块 `react` / `react/jsx-runtime`。
- TokenMeter 持久化：`$DSH_HOME/storages/token-meter.db`（node:sqlite，WAL 模式）。
- 本地测试安装：
  ```sh
  dsh plugin --profile web add file:D:\\code\\dsh-quota-widget
  ```
