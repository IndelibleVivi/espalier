# Agent operating guide

[简体中文](zh-CN/agent-guide.md) · English

This guide is for a coding agent encountering an Espalier-enrolled repository for the first time. The canonical behavior contract is [`skills/espalier/SKILL.md`](../skills/espalier/SKILL.md); this document adds runnable source examples without changing its authority.

## 1. Detect, then classify

For work that may involve tracked programme state, architecture, migration, decisions, overlap, cross-session recovery, or handoff, run once from the repository:

```bash
espalier doctor --compact
```

Then classify the task:

- **Dormant:** routine or mechanically self-contained. Use the repository normally; emit nothing.
- **Aware:** tracked context may matter. Read `join` or an exact ref; emit only if durable meaning changes.
- **Participating:** existing Work, multi-session/multi-agent coordination, Claim risk, an approved programme, or explicit owner tracking. Read the exact Work contract and Claim before semantic mutation.

Never fabricate an enrollment marker, direct SQLite write, hidden sidecar file, or parallel authority store when the service is unavailable.

## 2. Recover the minimum sufficient context

```bash
espalier join --budget 900 --compact
espalier brief <work-ref> --budget 1400 --since <last-seen-revision>
espalier inspect <stable-ref>
espalier changes --since <last-seen-revision>
espalier search "exact concept"
```

Treat all results as `as_of_revision` state. Search is a derived index: inspect the returned stable ref before acting. Do not paste an entire Atlas or transcript into context merely because it is available.

## 3. Claim the semantic surface

```bash
espalier claim <work-ref> --lease 900
```

A Claim coordinates semantic ownership, not Git locking. If another primary Claim overlaps, refresh and choose one of: split the scope, work in a non-overlapping area, request a handoff, propose a change, or escalate to the coordinator/owner. Do not retry until one write wins.

## 4. Open Work only when it is real

Use the generic `emit` command for canonical transitions that do not have a dedicated CLI shortcut:

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

An agent must use `authority_state: "owner_pending"` or proposal semantics when the task changes the Goal, programme order, binding constraints, trust boundary, or another owner's authority. It must not phrase a proposal as approved Work.

## 5. Record evidence, not conclusions you did not earn

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

Use `origin: "reported"` when another source reports a fact you did not observe. `owner-confirmed` is owner authority and cannot be forged. Evidence attachment does not itself verify Work, integrate a Lane, accept aesthetics, clear rights, or authorize publication.

For a non-binding observation anchored to exact context:

```bash
espalier annotate <stable-ref> --kind concern --body "The current return omits the rights boundary"
```

Do not turn routine progress into annotations. Do not import private chain-of-thought, full transcripts, tool logs, or token activity.

## 6. Handoff and release

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

If nothing durable changed and no session must resume, do not manufacture a Handoff.

## 7. Hard stop conditions

Stop semantic mutation and report the exact blocker when:

- `doctor` finds a missing/incompatible service, project, or capability contract;
- the returned brief cannot fit its authority or required task kernel;
- a Claim conflicts or a revision is stale;
- a requested change needs owner authority or an exact Decision authorization;
- an imported note is being treated as present truth;
- the only available action would require direct database writes or invented command payloads.

Repository work that is genuinely independent of the missing semantic context may continue. Say explicitly what remains unverified.
