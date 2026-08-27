---
name: espalier
description: Use in repository work that may belong to an explicitly enrolled Espalier project, especially tracked programme work, architecture, migration, cross-session or multi-agent coordination, owner decisions, claims, and handoffs. Recover bounded context and publish sparse semantic checkpoints through the installed CLI; stay dormant for routine untracked edits and never replace repo truth or owner authority.
---

# Espalier

Espalier is a local coordination substrate, not the project itself. The repo remains authoritative for code, schema, tests, Git state and formal documents. Espalier carries owner-approved direction, current Work, Relations, claims, decisions, evidence, attention and bounded handoff context. Human Surface geometry and personal view state are projections, never authority.

## Decide whether to enter

Do not invoke Espalier for a known mechanical command, a routine one-file edit, a lookup, or an experiment with no durable consequence.

When the task touches tracked work, an approved programme/spec, architecture, migration, an owner decision, claim/scope risk, cross-session recovery, multi-agent work or a handoff, run this once from the current repo:

```text
espalier doctor --compact
```

`doctor` follows the user-level enrollment registry, checks the selected localhost service and verifies that the enrolled Project exists with compatible capabilities. It does not write inside the repo. If the command is missing, the current path is not enrolled, the service is unavailable, the Project is absent or capabilities mismatch, do not imitate Espalier with a repo marker, direct SQLite access or a parallel state file. Continue only when the task is safely independent of missing authority/context; otherwise report the exact harness blocker.

Classify an available enrolled task:

- **Dormant:** no durable semantic signal. Do not fetch a brief or emit anything.
- **Aware:** relevant tracked context or a handoff may affect the work. Read bounded context; emit nothing unless meaning actually changes.
- **Participating:** approved programme/architecture/migration, explicit tracking, multi-session or multi-agent work, an existing Work item, or claim/authority risk. Read a task brief and claim the exact Work before versioned semantic mutation.

Owner overrides such as “keep Espalier dormant,” “track this,” “capture final decisions only,” or “do not promote this brainstorm” win.

## Read bounded context

Use a small presence brief to orient, then expand only the exact task or neighborhood needed:

```text
espalier join --budget 900 --compact
espalier brief <work-ref> --budget 1400 --since <revision>
espalier inspect <stable-ref>
espalier changes --since <revision>
espalier search <query>
```

Treat every brief/projection as `as_of_revision` state. Resolve revision-qualified refs or fetch changes before relying on an older view. Search hits are derived pointers; inspect the stable ref before acting. Do not copy Atlas or the full Human Surface into routine agent context.

## Respect authority and claims

Within approved scope, an agent may create and advance Work, attach observed evidence, record hypotheses or blockers, add non-binding notes, and leave a handoff. It may only propose changes to goals, programme order, trust boundaries, deferred-work promotion, cross-project authority or another primary writer's semantic surface.

Before mutating tracked Work or another versioned semantic surface:

```text
espalier claim <work-ref> --lease 900
```

One overlapping semantic surface has one primary writer. A Claim conflict requires refresh, scope split, handoff, proposal or escalation; it is never last-write-wins and does not solve Git conflicts. A claimed Lane brief must retain its Outcome, Scope, Context, Authority, Return contract, parent Batch and parent Work. Only a coordinator or owner integrates a returned Batch.

Binding owner operations follow the current owner policy and exact Decision authorization contract. Never turn an agent paraphrase into an owner directive or decision.

## Publish sparse checkpoints

Write only when durable project meaning crosses a boundary: Work opened/claimed, a blocker or hypothesis materially changed, a scope/decision proposal changed, implementation/verification/integration crossed a real boundary, a Lane returned, a handoff was recorded, or Work closed/superseded/froze.

Do not capture routine shell commands, model/tool activity, repeated test status, raw transcripts, private reasoning, brainstorm chatter or no-op sessions. Evidence is observed provenance, not automatic verification or acceptance.

Use exact stable refs for non-binding notes:

```text
espalier annotate <ref> --kind note --body "..."
espalier annotate <ref> --kind concern --body "..."
```

For canonical commands without a dedicated shortcut, use `emit` with the exact command type and payload. A partial command is wrapped with the current Project revision and runtime identity; rejection remains visible.

Open in-scope Work only when the bounded outcome is real:

```text
espalier emit --json '{"type":"work.create","payload":{"id":"bounded-task","epoch_id":"epoch-1","kind":"task","title":"Bounded task","scope":"One inspectable outcome","semantic_surfaces":["area:contract"],"repo_surfaces":["packages/example"],"authority_state":"within_scope","goal_integrity":"advances","verification_policy":"focused tests plus source review"}}'
```

Attach only evidence actually observed by the current actor:

```text
espalier emit --json '{"type":"evidence.attach","payload":{"id":"bounded-task-tests","target_refs":["esp:project/work/bounded-task"],"kind":"test","origin":"observed","ref":"command:npm-test@commit","summary":"The focused contract tests passed at the named commit","verification_state":"verified"}}'
```

Use `origin: reported` for a fact reported by another source. Never forge `owner-confirmed`. Evidence attachment does not itself verify Work, integrate a Lane, accept aesthetics, clear rights or authorize publication.

Use `espalier import-handoff <file> --anchor <ref>` only for old material that must remain explicitly imported and non-binding. Never import a historical note as current authority.

## Hand off cleanly

When participating Work remains, record the smallest structured handoff that lets another real session resume, then release the Claim:

```text
espalier handoff <work-ref> \
  --state "<current semantic state>" \
  --next "<next safe action>" \
  --completed "<bounded outcomes>" \
  --blockers "<real blockers>" \
  --questions "<open questions>" \
  --evidence "<stable evidence refs>" \
  --narrative "<likely misunderstanding>"
espalier release <work-ref>
```

If nothing durable changed, do not manufacture a handoff event.

The installed `espalier` command derives Codex runtime/session identity from the current Codex environment when present. Actor fields are still self-asserted under the localhost-only security boundary; they are not remote identity proof. Never hot-edit the installed Skill copy—update the canonical repo source, validate it, then reinstall through the repository's supported installer.

For the complete first-project walkthrough and exact failure boundaries, read the repository's `docs/agent-guide.md` and `docs/getting-started.md`; they explain usage but do not override this Skill or canonical protocol/Core contracts.
