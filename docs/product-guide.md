# Product guide

[简体中文](zh-CN/product-guide.md) · English

## The product in one sentence

Espalier is a local-first semantic sidecar that helps a responsible human and multiple agent sessions see what changed, what remains parallel, and where human judgment is actually needed—without turning chat, machine output, or Canvas geometry into project authority.

It is closer to coordination infrastructure with a human reading surface than to a drawing tool. The Canvas / Map is important, but it is a projection of explicit project meaning rather than the canonical database itself.

## The problem it solves

Long-running agent work usually distributes state across several incompatible places:

- the repository knows source and history, but not the current human rationale;
- chats know local conversation, but not a stable cross-session project topology;
- issue trackers flatten work into lists and rarely express exact authority or evidence boundaries;
- agent memory can preserve continuity, but should not silently become project truth;
- generated reports contain detail, but impose too much reading cost on the owner.

Espalier stores a deliberately sparse semantic layer beside those sources. It keeps only durable coordination meaning, then compiles bounded returns for agents and renderer-neutral projections for people.

## What gets a first-class identity

- **Project:** one authority domain and one writable canonical service.
- **Goal revision:** approved purpose, consumers, programme order, constraints, trust boundaries, and non-goals.
- **Epoch:** an active interval under one Goal revision.
- **Work:** a bounded task/workstream with separate work, evidence, authority, goal-integrity, and integration axes.
- **Relation:** an explicit typed connection; no title parsing or geometry inference.
- **Claim:** who currently holds a semantic write surface, in which runtime/session, and until when.
- **Evidence:** observed provenance with its own verification state; not automatic acceptance.
- **Decision and Annotation:** exact owner authority or non-binding human/agent meaning, with stable anchors.
- **Batch and Lane:** parallel delegated outcomes and their return/integration contracts.
- **Handoff:** the smallest structured state needed by a real returning session.

These distinctions prevent several common collapses: “tests passed” is not “owner accepted”; “implemented” is not “integrated”; “mentioned in chat” is not “binding”; “visible near another node” is not “depends on it.”

## The normal operating loop

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

Agents are expected to stay quiet. They read a bounded brief when tracked context matters, acquire a Claim only before semantic writes, publish sparse checkpoints at real boundaries, and hand off/release when leaving.

Humans do not have to operate a permanent approval dashboard. Ordinary conversation remains a first-class response path: a person can point to visible context or a stable ref and tell an agent what is wrong. Canvas actions are optional affordances for outcomes that should become durable or binding.

## Human Surface: what should attract attention

The Human Surface is meant to answer a small set of high-value reading questions:

1. What changed meaningfully since I last looked?
2. What work is still progressing in parallel?
3. What depends on, blocks, changes, verifies, or supersedes what?
4. Where is an owner judgment genuinely required?
5. Can I return to the exact selected context after inspecting detail?

Live, Focus, Attention/Decisions, Atlas, and Portfolio are projections over the same stable identity space, not four cosmetic themes. A renderer may vary density and disclosure, but it must preserve relation visibility, return continuity, exact semantic states, and non-color cues.

Pan, zoom, camera, collapse, locale, density, and personal layout are necessary reading controls but remain `PersonalViewState`. They do not reorder the programme or grant authority. UI locale changes renderer chrome; source-authored project content stays in its original language, including natural Chinese/English mixed text.

## Where it helps most

### Live engineering sidecar

Several sessions or agents work in different programme areas. Claims, meaningful deltas, Relations, Evidence, Handoffs, and Lane return pressure become visible without emitting every command or token event.

### Spec and architecture comprehension

The owner can inspect parallel proposals, constraints, evidence, uncovered branches, and pending judgments without accepting a generated wall of text. The original spec remains authoritative; the surface is a bounded reading projection.

### Fresh-session recovery

A returning agent receives the authority kernel, exact Work contract, meaningful change since its last revision, and expansion refs. It does not need the whole previous chat or the entire Atlas.

### Human judgment without approval theatre

Subjective/aesthetic acceptance, legal or rights clearance, product authority, and publication approval stay separate from mechanical verification. The interface can surface the boundary while the actual judgment still happens in ordinary conversation.

### Portfolio orientation

Projects remain independent authority domains. Explicit cross-project Relations can be inspected without creating one global writable database or silently merging their goals.

## When not to use it

Do not activate Espalier for a mechanical lookup, a tiny single-session edit, a disposable experiment, or work with no durable handoff/authority ambiguity. If a normal repository plus conversation already provides enough context, Espalier should remain Dormant.

## Present limitations

Espalier is a developer preview. Its deterministic Core, projections, bounded compiler, CLI, local service, Codex Skill, canonical local live Canvas, and source-linked dogfood path work. The Canvas is a replaceable developer renderer over the projection contract; it is not yet backed by complete production accessibility/performance evidence or final owner acceptance. Espalier also does not provide authenticated remote identity, a hosted multi-user service, automatic cross-device personal state, or general binary packaging. See [Public status](status.md) for the exact current matrix.
