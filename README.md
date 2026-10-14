# dsh-quota-widget

DeepSeek Harness (DSH) 标准插件 — **Opencode / DeepSeek / R4Coder 额度 + TokenMeter 用量悬浮小窗**。

在 DSH Web 界面右下角常驻一个可拖拽的悬浮小窗，实时展示：

- **Opencode Go 套餐**：剩余额度、已用占比、请求配额与重置倒计时；
- **DeepSeek API 余额**：CNY/USD 余额与可用状态；
- **R4Coder 套餐**：自定义 host 的套餐剩余额度；
- **TokenMeter 用量**：按日/按模型的 token 消耗、热力图、记录与实时指标。

完整配置在「设置 → Opencode 额度」中完成。

## 特性

- **常驻悬浮小窗**：可拖拽、位置持久化、迷你态/收起态
- **多提供商聚合**：Opencode / DeepSeek / R4Coder / TokenMeter
- **TokenMeter 持久化**：用量账本写入 `$DSH_HOME/storages/token-meter.db`（90 天保留）
- **纯主题变量**：使用 `var(--dsw-alias-*)`，自动跟随 DSH 明/暗主题
- **标准 bundle 插件**：`dsh plugin add` 一条命令安装，无需手工改 patch

## 安装

前置：已安装 DeepSeek Harness（Web 或桌面版），Node.js >= 22。

### Web 版

```sh
dsh plugin --profile web add dsh-quota-widget
```

重启 dsh 服务后，右下角出现悬浮小窗；配置入口在「设置 → Opencode 额度」。

### 桌面版

1. 打开桌面端 → 侧边栏 **Plugins / 插件** 页
2. 安装来源填 `dsh-quota-widget`（若尚未发布到 npm，则填本地 tarball 的 `file:` 路径）
3. 按提示重启桌面端生效

> 本插件是 bundle 型包（声明了 `dsh.bundle.patch`），`dsh plugin add` 会自动把它加进
> profile 的 `dsh.profile.bundles` 并应用 `cordis.patch.yml`，**不需要手工加 loader 行**。

## 配置说明

| 字段 | 说明 |
|------|------|
| Token | Opencode API Key / Bearer Token |
| Base URL | Opencode 自托管地址；留空自动探测官方端点 |
| 刷新间隔 | 秒，默认 120，建议 >= 60 |
| DeepSeek Key | DeepSeek API Key（Bearer） |
| R4Coder Base URL | 自定义 host（如 `https://api.r4.codes/v1`） |

## 数据链路与隐私

- Host 端代理各提供商额度接口，Token 只走请求头，**不写入 URL query**；
- TokenMeter 用量账本仅保存在本机 `$DSH_HOME/storages/token-meter.db`；
- 所有 HTTP 端点仅接受本机回环访问（防 DNS rebinding）。

## 开发

```sh
npm install        # 无运行时依赖，仅开发工具
npm pack           # 打包检查
```

- 宿主端 `lib/index.js`：纯 Node ESM，基于 `webServer` 注册同源 JSON 路由；
- 浏览器端 `lib/client.js`：按 DSH 模块加载器格式手写单文件 bundle；
- 本地安装测试：`dsh plugin --profile web add file:<本目录>`。

## 发布（维护者）

1. 源码仓库：https://github.com/CuiKuLaXiua/dsh-quota-widget ；
2. `npm login` 后执行 `npm publish --registry https://registry.npmjs.org`；
3. 推送源码 / 发版流程见 `docs/PUBLISHING.md`。

## License

MIT
