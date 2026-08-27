# 产品指南

简体中文 · [English](../product-guide.md)

## 一句话定位

Espalier 是一个 local-first semantic sidecar：让负责任的 human 与多个 agent sessions 看清什么发生了 meaningful change、什么仍在并行、哪里真的需要人的判断，同时不让聊天、机生成内容或 Canvas geometry 变成 project authority。

它更接近“带 human reading surface 的协调基础设施”，而不是单纯画画工具。Canvas / Map 很重要，但它是明确 project meaning 的 projection，不是 canonical database 本身。

## 它解决的问题

长期 agent work 的状态通常散落在几个不兼容表面：repo 有 source/history 却缺 human rationale；chat 有局部对话却没有跨 session 稳定拓扑；issue tracker 把工作压扁成 list；agent memory 能保存 continuity，却不应偷偷变成 project truth；generated report 细节足够，却让 owner 承担过高阅读成本。

Espalier 在这些来源侧翼保存一层刻意稀疏的 semantics，只保留 durable coordination meaning，再为 agent 编译 bounded return，为人提供 renderer-neutral projection。

## 什么拥有 first-class identity

- **Project：**一个 authority domain 与一个 writable canonical service。
- **Goal revision：**approved purpose、consumers、programme order、constraints、trust boundaries 与 non-goals。
- **Epoch：**在一个 Goal revision 下的 active interval。
- **Work：**bounded task/workstream，work/evidence/authority/goal-integrity/integration 各自独立。
- **Relation：**显式 typed connection，不靠 title parsing 或 geometry inference。
- **Claim：**谁在哪个 runtime/session 持有哪块 semantic write surface、到什么时候。
- **Evidence：**带 verification state 的 observed provenance，不是 automatic acceptance。
- **Decision / Annotation：**精确 owner authority 或 non-binding meaning，锚定 stable context。
- **Batch / Lane：**并行 delegated outcome 及其 return/integration contract。
- **Handoff：**另一个真实 session 恢复所需的最小 structured state。

这些区分阻止常见坍缩：test passed 不等于 owner accepted；implemented 不等于 integrated；chat 里提过不等于 binding；两个 Node 靠得近不等于 depends_on。

## 正常 operating loop

```text
repository + conversation
        │
        ├─ ordinary work stays ordinary
        │
        └─ durable boundary crosses
                 ↓
       canonical Core command
                 ↓
    semantic event + current state
          ↙                 ↘
 bounded agent brief     Human Surface projection
```

Agent 默认保持安静：tracked context 真有影响时才读 bounded brief；semantic write 前才 Claim；只在 durable boundary 发布 sparse checkpoint；离开时 Handoff/Release。

Human 不必操作永久 approval dashboard。普通对话仍是 first-class response path：人可以指着 visible context 或 stable ref 直接告诉 agent 哪里不对；Canvas action 只是把结果持久化或 binding 时的 optional affordance。

## Human Surface 想让人注意什么

1. 我上次离开后发生了什么 meaningful change？
2. 哪些 work 仍然并行推进？
3. 什么 depends on / blocks / changes / verifies / supersedes 什么？
4. 哪里真的需要 owner judgment？
5. 看完 detail 后能否返回 exact selected context？

Live、Focus、Attention/Decisions、Atlas 与 Portfolio 是同一个 stable identity space 上的不同 projection，不是四套 cosmetic theme。Renderer 可以改变 density/disclosure，但必须保留 Relation visibility、return continuity、exact semantic state 与 non-color cue。

Pan、zoom、camera、collapse、locale、density 与 personal layout 是必要 reading control，却始终属于 `PersonalViewState`，不会改 programme order 或授予 authority。UI locale 只改变 renderer chrome；source-authored project content 保持原语言，包括自然的中英混排。

## 最有效的使用场景

- **Live engineering sidecar：**多个 session/agent 在不同 programme area 工作，Claim、meaningful delta、Relation、Evidence、Handoff 与 Lane return pressure 可见，但不记录每个 command/token。
- **Spec / architecture comprehension：**人看并行 proposal、constraint、Evidence、uncovered branch 与 pending judgment，不必批准一堵 generated text；原 spec 仍是 authority。
- **Fresh-session recovery：**返回 agent 收到 authority kernel、exact Work contract、last revision 之后的 meaningful change 与 expansion refs，不需要完整 chat/Atlas。
- **Human judgment without approval theatre：**aesthetic acceptance、legal/rights clearance、product authority 与 publication approval 和机械 verification 分开；判断仍可在普通对话发生。
- **Portfolio orientation：**各 Project 保持独立 authority domain，以明确 cross-project Relation 连接，而不是共享一个全球 writable database。

## 什么时候不该用

Mechanical lookup、tiny single-session edit、disposable experiment，或完全没有 durable handoff/authority ambiguity 的工作，不该激活 Espalier。普通 repo + conversation 已经够用时，它应保持 Dormant。

## 当前 limitations

Espalier 是 developer preview。Deterministic Core、projection、bounded compiler、CLI、local service、Codex Skill、canonical local live Canvas 与 source-linked dogfood path 已工作。Canvas 是 projection contract 上可替换的 developer renderer，尚没有完整 production accessibility/performance evidence 或 final owner acceptance。Authenticated remote identity、hosted multi-user service、automatic cross-device personal state 与通用 binary packaging 也尚未完成。精确矩阵见[公开状态](status.md)。
