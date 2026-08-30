# 快速开始

简体中文 · [English](../getting-started.md)

这份指南让一个有技术基础、第一次拿到 Espalier 的人从 source checkout 走到：一个 enrolled repo、一个明确 Work、一次干净 Handoff。它不假定 Web surface 就是产品 authority，也不假定每个项目都需要 Espalier。

## 1. 安装并启动本地 service

要求：Node.js 24.0.0+、npm 11.19.1+（repo pin npm 11.19.1）、macOS 或 Linux。

```bash
git clone https://github.com/IndelibleVivi/espalier.git
cd espalier
npm ci
npm run build
npm run seed
npm run service:start
npm run service:status
```

`service:start` 会把 canonical service 作为可检查的 detached local process 运行。关 terminal 不会关掉它；PID、status record 与 log 只进入 provider-neutral application-data directory，不进 repo。它不会安装 login item，也不承诺机器 reboot 后自动启动。

默认 endpoint 是 <http://127.0.0.1:4317/>。打开它可以在 canonical live Canvas 中检查中性 Orchard Project。`seed` 是显式的 synthetic fixture，不会 import 真实 repo。`service:status` 报告 managed process record（其中 `schema_version: 1` 是 service-record format）；`espalier doctor --compact` 报告 service contract，并应包含 `health.ok: true`、`health.schema_version: 4` 与 `health.protocol_version: "0.2"`。

日常生命周期：

```bash
npm run service:status
npm run service:restart
npm run service:stop
```

需要前台 debug 时使用 `npm run dev:server`。不要在同一 port 同时跑 foreground 与 managed service。

## 2. 安装 Codex harness

在 Espalier checkout 中：

```bash
npm run install:codex -- --dry-run
npm run install:codex
```

这个 source-linked developer installer 会同时安装 `espalier` CLI 与 canonical Skill，旧 Skill 进入本地 backup，当前副本写入 digest manifest。Launcher 会独立解析已安装的 source tree，不受 caller repo 的 TypeScript path aliases 污染。安装后打开一个新的 Codex task，让 Skill discovery 重新加载。

Enroll 真实项目之前先验证：

```bash
espalier --help
espalier doctor --compact
```

未 enroll 时，`doctor` 仍可能报告健康 service 与 `enrollment: null`；这是正常的。Service availability 与 project enrollment 是两件事。

## 3. Enroll 一个 repo

选择一个确实值得保存长期协调状态的 repo：

```bash
espalier link /path/to/orchard \
  --project orchard \
  --name "Orchard" \
  --purpose "Ship the approved programme without losing owner decisions" \
  --principal owner-name
```

如果 Project 不存在，`link --purpose` 只创建 thin explicit seed：一个 Project/owner policy、一个 approved Goal revision、一个 active initial Epoch。它不会扫描或 import Git history，不会 invent Work，不复制项目文档，也不把任何内容标记为完成。Enrollment 位于 user application-data registry，不通过 repo marker 表达。

进入 enrolled repo 验证映射：

```bash
cd /path/to/orchard
espalier doctor --compact
espalier join --budget 900 --compact
```

刷新 <http://127.0.0.1:4317/> 即可在同一张 Canvas 中阅读 enrolled Project。Service 只有一个 Project 时 app 会自动选择；如果有多个，打开 `http://127.0.0.1:4317/?project=orchard`。`EN / 中文` 只改界面词汇，不翻译 Project 自己写入的 title 或 scope。

## 4. 创建第一个明确 Work

`link` 创建的初始 Epoch id 是 `epoch-1`：

```bash
espalier emit --json '{
  "type": "work.create",
  "payload": {
    "id": "public-onboarding",
    "epoch_id": "epoch-1",
    "kind": "task",
    "title": "Make first-project onboarding truthful",
    "scope": "Verify the public setup and agent handoff path",
    "semantic_surfaces": ["docs:onboarding"],
    "repo_surfaces": ["README.md", "docs/"],
    "authority_state": "within_scope",
    "goal_integrity": "advances"
  }
}'
```

`emit` 会用 current project revision 与 runtime identity 包装 partial command。Stale/invalid command 会被拒绝，不会 silent merge。

读取并 Claim 精确 Work：

```bash
espalier brief public-onboarding --budget 1400
espalier claim public-onboarding --lease 900
```

Claim 协调的是 semantic write，不是 Git file lock，也不替代正常 branch/worktree discipline。

## 5. 只发布 durable Evidence

Repo work 正常进行；read/edit/shell command/model activity/重复进度都不是 Espalier event。

真实 observed boundary 跨过后再 attach Evidence：

```bash
espalier emit --json '{
  "type": "evidence.attach",
  "payload": {
    "id": "public-onboarding-test",
    "target_refs": ["esp:orchard/work/public-onboarding"],
    "kind": "test",
    "origin": "observed",
    "ref": "command:npm-test@git-commit",
    "summary": "The documented first-project path passed in an isolated data directory",
    "verification_state": "verified"
  }
}'
```

Evidence 只说明观察到了什么；它不会自动改变 Work verification、Lane integration、owner acceptance、rights clearance 或 publication authority。

## 6. Handoff 并干净离开

```bash
espalier handoff public-onboarding \
  --state "Setup and first Work path are verified" \
  --next "Run the same path from a fresh session" \
  --completed "service lifecycle,CLI onboarding" \
  --evidence "esp:orchard/evidence/public-onboarding-test" \
  --narrative "Do not treat the synthetic Web fixture as imported project truth"

espalier release public-onboarding
```

下一个 session 从 `doctor`、`join` 与精确 Work brief 开始，不应需要上一段完整聊天。

## Data 与 reset boundary

默认 runtime 位置：

- macOS：`~/Library/Application Support/Espalier/`
- Linux：`${XDG_DATA_HOME:-~/.local/share}/espalier/`

支持 `ESPALIER_DATA_DIR`、`ESPALIER_DATABASE`、`ESPALIER_HOST` 与 `ESPALIER_PORT` override；executable 拒绝 non-loopback host。

不要通过删除 database “重置”真实 enrolled project。Export、backup、restore、migration 与 intentional retirement 是不同操作。Disposable experiment 应在启动前把 `ESPALIER_DATA_DIR` 指向隔离临时目录。

## Troubleshooting

- **`espalier: command not found`：**先 `npm run install:codex -- --dry-run`，再安装，并检查 npm global bin 是否在 `PATH`。
- **Service healthy 但没有 enrollment：**运行 `espalier link`，不要手写 `.espalier` marker。
- **Enrollment 存在但 Project 不在 service：**registry 指向了不拥有该 Project 的 service/database；修映射，不要在 hosts 间复制 writable database。
- **Port 被 unmanaged process 占用：**manager 不会接管或 kill 它；请精确检查 process 或换 isolated port。
- **Capability mismatch：**从 matching repo source 更新 installed harness；不要压掉 fail-closed negotiation。
- **Claim conflict / stale revision：**refresh exact Work、split scope、handoff 或询问 coordinator/owner；不要当作 last-write-wins 重试。
