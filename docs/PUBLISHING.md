# 发布指南

## 0. 两种分发形态（都不需要构建/打包）

`dsh plugin` 本质是 pnpm 的转发壳（"thin pnpm forwarder": 在 profile 目录里跑 `pnpm <args>` 再
reconcile `dsh.profile.bundles`），registry 名 / `github:` / `git+https:` / tarball / 本地路径都直通 pnpm。

| 形态 | 用户安装命令 | 版本由谁决定 |
|---|---|---|
| GitHub 源 | `dsh plugin --profile web add github:CuiKuLaXiua/dsh-quota-widget` | 默认分支 HEAD；可用 `#v0.1.0` 固定到 tag |
| npm 源 | `dsh plugin --profile web add dsh-quota-widget` | `package.json` 的 `version`（需先 `npm publish`） |

本包**无 `prepare`/`build`/`postinstall` 脚本**、无 dependencies/devDependencies，`lib/*.js` 就是产物，
所以：`git push` 之后别人**立刻**能用 `github:` 源装到（不需要先打包、也不需要 `pnpm-workspace.yaml`
里加 `allowBuilds` 放行构建）。`npm pack` 的结果就是安装内容（9 个文件 / 约 72 kB）。

发版流程：改 `package.json` 的 `version` → `git tag vX.Y.Z` → push（tag 与 version 保持一致，
两条安装路径才不会指向不同代码）。

## 1. 发布到 npm

```sh
# 检查 npm 源必须是官方源
npm config get registry        # 应输出 https://registry.npmjs.org/

npm login
npm publish --registry https://registry.npmjs.org
```

发布后可用 `npm view dsh-quota-widget version` 验证。

## 2. 推送到 GitHub

```sh
git init
git add .
git commit -m "feat: initial release of dsh-quota-widget"
git branch -M main
git remote add origin https://github.com/CuiKuLaXiua/dsh-quota-widget.git
git push -u origin main
```

给仓库打 topic：`dsh-plugin`、`deepseek-harness`、`dsh`、`opencode`、`quota`。

## 3. 让社区发现

- 向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR
- 关注 [dsh-market](https://github.com/dsh-market/dsh-market) 插件市场收录
