# 公开状态

简体中文 · [English](../status.md)

最后复核：2026-08-27。

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
| CI/public-surface foundation | combined candidate，正在进行 fresh combined-line verification | hosted Node 24/26 first run 与 branch protection 是独立 gate |
| Public repository | 未 release | clean history/content、rights/license、secret scan 与 owner publication gate 未闭合 |

## Open product gates

1. 在不 replay full report 的前提下证明 fresh-session recovery 与第二个 participating agent。
2. 真实跑 parallel Claims、Relations、Batch/Lane return pressure、ordinary conversational correction 与更长任务。
3. 完成 canonical Canvas 的 keyboard/screen-reader/forced-color/physical-gesture/performance evidence，并获得 owner product/aesthetic acceptance。
4. 任何 non-loopback / mutually untrusted principal 部署前实现 authenticated identity + TLS。
5. 只在 concrete consumer 存在时添加 scheduled retention、attachment storage、cross-device personal continuity 与 packaged distribution。
6. 生成 clean public tree，完成 history/secret/privacy/rights audit，按 material class 选择 licenses，并获得 explicit publication approval。

内部 project-specific experiment 与 private working continuity 可能领先于这张表；它们是开发 evidence，不属于 public support contract。
