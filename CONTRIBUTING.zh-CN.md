# 贡献指南

简体中文 · [English](CONTRIBUTING.md)

Espalier 仍处于 developer preview。提出 source change 前，请先阅读[产品指南](docs/zh-CN/product-guide.md)、[公开状态](docs/zh-CN/status.md)与 repo-local [`AGENTS.md`](AGENTS.md)。

## 贡献前边界

- 项目 repo 始终拥有 code、schema、tests、Git 与正式文档的 authority。
- 不要为了 renderer 方便而添加 canonical entity、command 或 authority semantics。
- Geometry、camera、locale、density 与 personal layout 不得进入 canonical project state。
- 不要为了让 demo 更顺而削弱 loopback、stale-write、Claim、owner-policy、Decision、budget、export/restore 或 migration 检查。
- 不要包含私人项目数据、raw export、本地绝对路径、credential、private handoff 或非公开项目截图。
- 提交前把 Git 配置为 GitHub 提供的 noreply email。Public CI 接受 contributor 自己的姓名，但会拒绝个人、工作单位与本机 commit email address。
- 不要用绕过 `strict-allow-scripts`、`--force`、`--legacy-peer-deps` 或放宽 `allowScripts` 的方式让 dependency update 暂时可安装；每个 dependency script authorization 都必须 review 并 pin。
- Supported public contract 改变时，同时更新 English 与中文 user-facing docs。

## 本地 gate

```bash
npm ci
npm run check
npm run test:coverage
npm run smoke:process
npx playwright install chromium
npm run smoke:browser
npm run smoke:managed-service
npm run stress:scale-replay
```

使用 Node.js 24.0.0 或更新版本与 npm 11.19.1 或更新版本；CI 会安装 repo pin 的 npm 11.19.1。施工时先跑最窄相关 test，再跑与 blast radius 匹配的完整 gate。`smoke:browser` 不会自己安装 browser，因此 `npm ci` 后需要先安装一次 pinned Chromium。Rendered Web change 还需要真实 browser 的 desktop/mobile 检查、meaningful DOM、console health、target-flow interaction、keyboard/accessibility evidence 与 non-color semantic review。

## Change shape

每次 change 尽量只承载一个 bounded semantic outcome。替换行为时，应在同一 change 中更新 canonical path，并移除 superseded path、caller、test 与 docs；只有存在真实 compatibility boundary 时才能暂留旧路径，并说明移除条件。

Commit message 使用简洁 English imperative mood。只 stage 明确路径并检查 staged diff；不要用 catch-all staging 把本地 continuity 或 runtime data 一起收进去。

## 贡献与 license terms

提交 contribution 前请先阅读 repo 的精确 [licensing map](LICENSING.md)。你必须有权提交该材料，也不得带入 private project data 或 terms 不兼容的 third-party material。

你保留 contribution 的 copyright。将其提交以供纳入时，你同意被接受的 contribution 按 destination path 适用的 license 发布：functional source 使用 `SUL-1.0`，受覆盖的 documentation 使用 `CC BY-NC-SA 4.0`。这不是 copyright assignment。如果你不能按该 license 提供 contribution，请不要提交 patch；可以改用脱敏 issue 先讨论。
