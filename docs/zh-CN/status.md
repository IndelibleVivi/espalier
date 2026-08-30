# 公开状态

简体中文 · [English](../status.md)

最后复核：2026-08-30。

Espalier 是 developer preview 与 local dogfood candidate，不是 finished public release。Implemented、locally verified、packaged、installed、running、published 与 owner accepted 是不同状态。

| Surface | 当前状态 | 重要 boundary |
| --- | --- | --- |
| Protocol / canonical entities | implemented + local tests | protocol `0.2`、schema `4`；旧历史必须 migration，不能 relabel |
| Deterministic Core | implemented + local tests | 唯一 canonical mutation path；owner/Decision/stale-write fail closed |
| SQLite persistence / replay | implemented + local tests | 每 Project 一个 writable service；不跨 host sync writable DB |
| Context Compiler | implemented + local tests | deterministic bounded selection；没有 hidden model dependency |
| Human Surface projections | renderer-neutral contracts/fixtures implemented | projection semantics 与 replaceable renderer 保持分离 |
| Canonical local Canvas | live developer renderer 已实现，并在 neutral fixture 上通过 Browser 验证 | production accessibility、performance、physical gesture 与 final owner acceptance 仍 open |
| CLI / stable refs | source-linked developer path implemented | 通用 binary/package distribution 未完成 |
| Codex Skill / installer | transactional local install implemented | fresh task 才 discovery；其他 runtime 未 packaged |
| Local service | loopback foreground + detached lifecycle implemented | detached manager 抗 terminal close，不承诺 reboot/login；无 remote identity |
| HTTP/SSE/client | localhost implemented | self-asserted actor identity 不是 authentication |
| Search / CJK fallback | implemented + rebuildable | search 是 derived，不是 authority |
| Export/restore | empty-domain path implemented + tests | 显式 confirmation + graph revalidation |
| Scale projection fixtures | 500/5,000-object headless stress | 不是 Browser/GPU production performance evidence |
| Real dogfood | 首次 bounded single-agent checkpoint/handoff 已观察 | fresh-session、second agent、parallel/Lane pressure 与长任务 metrics 仍 open |
| CI/public-surface foundation | Public hardening PR [#8](https://github.com/IndelibleVivi/espalier/pull/8) 已产出 hosted passing candidate：精确 Node 24.0.0/npm 11.19.1 与 Node 26、public profile、coverage、Chromium mutation/SSE、Ubuntu/macOS managed lifecycle 及 exact-commit review-bundle gates 全部通过 | 每次 PR head 变化后，仍须在 merge 前通过 strict/up-to-date `Espalier / required`；绿色 CI 不等于 release、deployment 或 product acceptance |
| Code scanning | GitHub-managed CodeQL default setup 已配置 JavaScript/TypeScript；initial public-main 与 PR #8 candidate analyses 均已通过 | 该 setting 位于 source tree 之外，不替代 `Espalier / required`、release 或 owner gates |
| Public source repository | 已于 2026-08-27 作为 owner-authorized clean source projection 发布 | 不声称已有 tagged product release 或通用 packaged distribution |

## Open product gates

1. 在不 replay full report 的前提下证明 fresh-session recovery 与第二个 participating agent。
2. 真实跑 parallel Claims、Relations、Batch/Lane return pressure、ordinary conversational correction 与更长任务。
3. 完成 canonical Canvas 的 keyboard/screen-reader/forced-color/physical-gesture/performance evidence，并获得 owner product/aesthetic acceptance。
4. 任何 non-loopback / mutually untrusted principal 部署前实现 authenticated identity + TLS。
5. 只在 concrete consumer 存在时添加 scheduled retention、attachment storage、cross-device personal continuity 与 packaged distribution。
6. 每次后续 public update 继续执行相同的 clean-tree privacy/secret/rights 与 exact-commit CI gates；tagged product release 与 source publication 保持分离。

内部 project-specific experiment 与 private working continuity 可能领先于这张表；它们是开发 evidence，不属于 public support contract。
