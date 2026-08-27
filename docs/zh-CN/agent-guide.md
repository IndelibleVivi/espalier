# Agent 操作指南

简体中文 · [English](../agent-guide.md)

这份指南给第一次进入 Espalier-enrolled repo 的 coding agent。Canonical behavior contract 是 [`skills/espalier/SKILL.md`](../../skills/espalier/SKILL.md)；这里补 runnable source example，不改变 Skill authority。

## 1. Detect，再 classify

当任务可能涉及 tracked programme、architecture、migration、decision、overlap、cross-session recovery 或 handoff 时，从 repo 运行一次：

```bash
espalier doctor --compact
```

- **Dormant：**routine / mechanically self-contained；正常使用 repo，不 emit。
- **Aware：**tracked context 可能影响任务；读 `join` 或 exact ref，只有 durable meaning 真的变化才 emit。
- **Participating：**已有 Work、多 session/agent coordination、Claim risk、approved programme 或 owner 明确要求 tracking；读 exact Work contract，semantic mutation 前 Claim。

Service 不可用时，不得 fabricate enrollment marker、direct SQLite write、hidden sidecar file 或 parallel authority store。

## 2. 恢复 minimum sufficient context

```bash
espalier join --budget 900 --compact
espalier brief <work-ref> --budget 1400 --since <last-seen-revision>
espalier inspect <stable-ref>
espalier changes --since <last-seen-revision>
espalier search "exact concept"
```

所有结果都是 `as_of_revision` state。Search 是 derived index：行动前 inspect returned stable ref。不要因为 Atlas 可用就把整张图或 transcript 塞进 context。

## 3. Claim semantic surface

```bash
espalier claim <work-ref> --lease 900
```

Claim 协调 semantic ownership，不是 Git lock。Primary Claim overlap 时应 refresh 后 split scope、换 non-overlapping area、request handoff、propose change 或 escalate；不要重试到某个 write 赢。

## 4. 只在真实边界 open Work

```bash
espalier emit --json '{
  "type": "work.create",
  "payload": {
    "id": "bounded-task",
    "epoch_id": "epoch-1",
    "kind": "task",
    "title": "Bounded task",
    "scope": "One outcome with an inspectable completion boundary",
    "semantic_surfaces": ["area:contract"],
    "repo_surfaces": ["packages/example"],
    "authority_state": "within_scope",
    "goal_integrity": "advances",
    "verification_policy": "focused tests plus source review"
  }
}'
```

改变 Goal、programme order、binding constraint、trust boundary 或另一 owner authority 时，agent 必须使用 `owner_pending` / proposal semantics，不能把 proposal 写成 approved Work。

## 5. 记录 Evidence，不越权写结论

```bash
espalier emit --json '{
  "type": "evidence.attach",
  "payload": {
    "id": "bounded-task-tests",
    "target_refs": ["esp:project/work/bounded-task"],
    "kind": "test",
    "origin": "observed",
    "ref": "command:npm-test@commit",
    "summary": "The focused contract tests passed at the named commit",
    "verification_state": "verified"
  }
}'
```

没有亲自观察的来源用 `reported`；`owner-confirmed` 是 owner authority，不能伪造。Attach Evidence 不会自动 verify Work、integrate Lane、accept aesthetics、clear rights 或 authorize publication。

Non-binding exact-context observation：

```bash
espalier annotate <stable-ref> --kind concern --body "The current return omits the rights boundary"
```

不要把 routine progress 变成 annotation，也不要 import private chain-of-thought、full transcript、tool log 或 token activity。

## 6. Handoff 与 Release

```bash
espalier handoff <work-ref> \
  --state "Current semantic state" \
  --next "One next safe action" \
  --completed "bounded outcome one,bounded outcome two" \
  --blockers "real blocker" \
  --questions "unresolved owner question" \
  --evidence "esp:project/evidence/example" \
  --narrative "The misunderstanding a fresh session is most likely to make"

espalier release <work-ref>
```

没有 durable change、也不需要另一个 session 接手时，不制造 Handoff event。

## 7. Hard stop conditions

遇到这些情况停止 semantic mutation，并报告 exact blocker：missing/incompatible service/project/capability；brief 装不下 authority/task kernel；Claim conflict/stale revision；需要 owner authority/Decision authorization；imported note 正被当作 present truth；唯一可行路径是 direct DB write 或 invented payload。

与缺失 semantic context 确实独立的 repo work 可以继续，但必须明确哪些事实仍 unverified。
