# 安全说明

简体中文 · [English](SECURITY.md)

## 当前支持的 boundary

Espalier 目前的 developer preview 面向同一台本地机器上的一个可信用户：

- executable 只允许绑定 `127.0.0.1`、`::1` 或 `localhost`，拒绝其他 host；
- API 检查 loopback Host 与 same-origin boundary；
- mutation 与 restore endpoint 要求 JSON 和每个 process 单独生成的 local token；
- runtime state 位于 user application-data directory，不进入 repo；
- 一个 Project 只有一个 writable canonical service。

这些措施减少意外网络暴露与 browser-CSRF 风险，但不构成 multi-principal authentication。HTTP actor fields 目前由 client self-assert，不能当作 identity proof。

## 不受支持的部署方式

不要把当前 service 暴露到 LAN address、tailnet、tunnel、container ingress、reverse proxy、public hostname 或共享系统账号；不要在 hosts 之间 file-sync 可写 SQLite database。远程部署需要独立 authenticated adapter 在 server side 派生 actor identity 与 effective capabilities，并加入 transport security 与明确的 operating model。

当前 local token 可以被本地 Web client 取得。它是可信 local boundary 内的 containment mechanism，不是可复用 API credential，也不是远程 bearer-auth 设计。

## 数据处理

默认 data paths 见[快速开始](docs/zh-CN/getting-started.md)。Database、WAL、registry、raw log、export 与 private handoff 都不能进入 Git。请根据 enrolled project 的敏感程度使用合适的 OS disk/account protection。

Portable export 包含 accepted project history 与 current graph state。即使它不复制任意 repo file 或完整聊天，也应被视为可能敏感的项目数据。

## 报告安全问题

不要在 public issue 中放 exploit detail、secret、私人项目数据或 database export。GitHub private Security Advisory reporting 启用后，应使用该路径。在公开 reporting channel 被明确发布前，请通过已经建立的私人渠道联系 repo owner。

报告应包含受影响 commit/version、本地 deployment shape、复现步骤、expected/observed boundary，以及能够验证问题的最小 redacted evidence。

## 当前安全状态

Developer preview 阶段不承诺 production support window 或 security-release SLA。Test / CI 绿色是工程证据，不表示 unsupported remote deployment 已经安全。
