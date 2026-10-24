# dsh-quota-widget

DeepSeek Harness (DSH) 标准插件 — **Opencode / DeepSeek / R4Coder 额度 + TokenMeter 用量悬浮小窗**。

在 DSH Web 界面右下角常驻一个可拖拽的悬浮小窗，实时展示：

- **Opencode Go 套餐**：剩余额度、已用占比、请求配额与重置倒计时；
- **DeepSeek API 余额**：CNY/USD 余额与可用状态；
- **R4Coder 套餐**：自定义 host 的套餐剩余额度；
- **TokenMeter 用量**：按日/按模型的 token 消耗、热力图、记录与实时指标。

完整配置在「设置 → Opencode 额度」中完成。

## 目录

- [特性](#特性)
- [安装](#安装)
- [配置说明](#配置说明)
- [数据链路与隐私](#数据链路与隐私)
- [开发](#开发)
- [发布（维护者）](#发布维护者)
- [License](#license)

## 特性

- **常驻悬浮小窗**：可拖拽、位置持久化、迷你态/收起态
- **多提供商聚合**：Opencode / DeepSeek / R4Coder / TokenMeter
- **TokenMeter 持久化**：用量账本写入 `$DSH_HOME/storages/token-meter.db`（90 天保留）
- **面板材质可切**：经典背板（默认，保持原样）/ 液态玻璃 / 亚克力 / 哑光纸，见「设置 → 用量与额度 → 通用 → 面板材质」
- **纯主题变量**：使用 `var(--dsw-alias-*)`，自动跟随 DSH 明/暗主题
- **标准 bundle 插件**：`dsh plugin add` 一条命令安装，无需手工改 patch

## 安装

前置：已安装 DeepSeek Harness（Web 或桌面版），Node.js >= 22。

### Web 版

```sh
dsh plugin --profile web add github:CuiKuLaXiua/dsh-quota-widget
```

重启 dsh 服务后，右下角出现悬浮小窗；配置入口在「设置 → 用量与额度」。

> 本包**尚未发布到 npm registry**（`npm view dsh-quota-widget` 会 404），因此统一用 `github:` 源。
> `dsh plugin` 本身是 pnpm 的转发壳（registry 名 / `github:` / `git+https:` / tarball / 本地路径都直通 pnpm），
> 若日后发布到 npm，可简写为 `dsh plugin --profile web add dsh-quota-widget`。

### 桌面版

在桌面端 **Plugins / 插件** 页的安装来源中使用 GitHub 源命令安装：

```sh
github:CuiKuLaXiua/dsh-quota-widget
```

> git 源默认取仓库默认分支（`main`）的最新提交；要固定版本，先给仓库打 tag 再写
> `github:CuiKuLaXiua/dsh-quota-widget#v0.1.0`。本包无 `prepare`/`build` 脚本，
> 安装时 pnpm 不需要放行构建（无 `allowBuilds` 配置步骤）。

具体步骤：

1. 打开桌面端 → 侧边栏 **Plugins / 插件** 页；
2. 在安装来源输入框粘贴 `github:CuiKuLaXiua/dsh-quota-widget`；
3. 点击安装并重启桌面端，生效后右下角出现悬浮小窗。

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

### 数据链路

- **Token 只走请求头**：Host 端代理各提供商额度接口，Token 通过 `Authorization` / `x-api-key` 请求头传递，**不写入 URL query、不写入日志、不写入数据库**；Host 端不持久化 Token，每次请求转发后即丢弃；
- **TokenMeter 账本**：仅保存在本机 `$DSH_HOME/storages/token-meter.db`（90 天保留），只记录模型名、token 计数、时间等用量元数据，**不记录对话内容**；
- **本地回环防护**：所有 HTTP 端点仅接受 `127.0.0.1` / `localhost` / `::1` 回环访问，并校验 `Sec-Fetch-Site`，防 DNS rebinding 与跨站读取；
- **上游主机白名单**：Opencode / DeepSeek 的 baseUrl 仅允许官方域名（`opencode.ai`、`api.opencode.ai`、`api.deepseek.com`）且强制 HTTPS，非白名单配置会自动回退官方端点。

### 风险提示（请知悉）

- **API Key 明文保存在浏览器 localStorage**：Opencode / DeepSeek / R4Coder 的 Token 以明文 JSON 保存在浏览器 localStorage（键 `opencode_quota_config`），以便下次打开自动使用。任何能在 DSH 页面同源下执行的脚本（如 XSS、恶意插件）或本机恶意软件均可读取，**建议仅在可信设备上使用**；
- **R4Coder 使用自定义 host**：R4Coder 的 Token 会发送到你配置的 `Base URL`。出于兼容自部署/第三方聚合服务的考虑，该地址**只强制 HTTPS、不设域名白名单**，**请只填写可信的 R4Coder 服务地址**；
- **外部 CDN 依赖（GSAP）**：部分动画（热力图、tooltip 等）会从 `cdn.jsdelivr.net` 动态加载 GSAP 脚本。它仅用于增强动画效果，加载失败时自动降级为纯 CSS / 原生动画，不影响功能；但该脚本会在 DSH 页面上下文中执行，存在供应链风险，若环境禁止外部 CDN 仍可正常使用（仅动画降级）。

## 开发

```sh
npm run check      # 两个 bundle 的语法检查
npm test           # node:test 单测（零依赖，node:sqlite 用 Node 内置）
npm pack           # 打包检查
```

- **无构建步骤**：仓库里的 `lib/*.js` 就是产物（宿主端手写 Node ESM、浏览器端手写单文件 bundle），
  `npm pack` 出的 9 个文件即安装包，push 到 GitHub 后 `github:` 源可直接安装，无需先打包再推代码；
- 宿主端 `lib/index.js`：纯 Node ESM，基于 `webServer` 注册同源 JSON 路由；
- 浏览器端 `lib/client.js`：按 DSH 模块加载器格式手写单文件 bundle；
- 本地安装测试：`dsh plugin --profile web add file:<本目录>`。

## 发布（维护者）

1. 源码仓库：https://github.com/CuiKuLaXiua/dsh-quota-widget ；
2. `npm login` 后执行 `npm publish --registry https://registry.npmjs.org`；
3. 推送源码 / 发版流程见 `docs/PUBLISHING.md`。

## License

MIT