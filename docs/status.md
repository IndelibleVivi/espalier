# Public status

[简体中文](zh-CN/status.md) · English

Last reviewed: 2026-08-27.

Espalier is a developer preview and local dogfood candidate, not a finished public release. “Implemented,” “locally verified,” “packaged,” “installed,” “running,” “published,” and “owner accepted” are separate states.

| Surface | Current status | Important boundary |
| --- | --- | --- |
| Protocol and canonical entities | Implemented and locally tested | Protocol `0.2`, schema `4`; future migrations must transform history rather than relabel it |
| Deterministic Core | Implemented and locally tested | Only canonical mutation path; owner/Decision and stale-write checks fail closed |
| SQLite persistence and replay | Implemented and locally tested | One writable service per Project; no writable database file sync between hosts |
| Context Compiler | Implemented and locally tested | Deterministic bounded selection; no hidden model dependency |
| Human Surface projections | Renderer-neutral contracts and fixtures implemented | Projection semantics remain separate from the replaceable renderer |
| Canonical local Canvas | Live developer renderer implemented and browser-verified on the neutral fixture | Production accessibility, performance, physical-gesture, and final owner acceptance remain open |
| CLI and stable refs | Source-linked developer path implemented | General binary/package distribution remains open |
| Codex Skill and installer | Transactional local installer implemented | Fresh task required for discovery; other agent runtimes are not yet packaged |
| Local service | Loopback foreground and detached source lifecycle implemented | Detached manager survives terminal closure, not reboot/login; no remote identity |
| HTTP/SSE/client | Implemented for localhost | Self-asserted actor identity is not authentication |
| Search and CJK fallback | Implemented and rebuildable | Search is derived, never canonical authority |
| Export/restore | Implemented and tested for an empty authority domain | Restore requires explicit confirmation and graph revalidation |
| Scale projection fixtures | 500/5,000-object headless contract stress implemented | Not Browser/GPU production performance evidence |
| Real dogfood | First bounded single-agent checkpoint/handoff loop observed | Fresh-session, second-agent, parallel/Lane pressure, and longer-task metrics remain open |
| CI/public-surface foundation | Integrated candidate under fresh combined-line verification | Hosted Node 24/26 first run and branch protection remain separate gates |
| Public repository | Not released | Clean history/content, rights/license, secret scan, and owner publication gate remain |

## Open product gates

1. Prove fresh-session recovery and a second real participating agent without replaying a full report.
2. Exercise parallel Claims, Relations, Batch/Lane return pressure, ordinary conversational correction, and a longer real task.
3. Complete keyboard/screen-reader/forced-color/physical-gesture/performance evidence for the canonical Canvas and obtain owner aesthetic/product acceptance.
4. Add authenticated identity and TLS before any non-loopback or mutually untrusted-principal deployment.
5. Add scheduled retention, attachment storage, cross-device personal continuity, and packaged distribution only with concrete consumers.
6. Produce a clean public tree, complete history/secret/privacy/rights review, select licenses by material class, and receive explicit publication approval.

Internal project-specific experiments and private working continuity may be ahead of this matrix. They are evidence for development, not part of the public support contract.
