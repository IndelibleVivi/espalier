import { canonicalRef, entityRef, parseRef, withoutRevision } from "@espalier/core";
import type { EspalierCore } from "@espalier/core";
import type { ActorIdentity, Batch, CanonicalEntity, Claim, GoalRevision, Lane, Relation, StoredEvent, WorkItem } from "@espalier/protocol";

export type BriefProjection = "presence" | "compact" | "normal" | "handoff" | "delta" | "decision" | "overview" | "deep-inspect";
export interface BriefInput {
  project_id: string;
  actor: ActorIdentity;
  current_claim_ref?: string;
  requested_task_ref?: string;
  last_seen_revision: number;
  context_budget_tokens: number;
  requested_projection: BriefProjection;
  language: string;
}

export interface SelectedBriefObject {
  ref: string;
  selection_reasons: string[];
  object: Record<string, unknown>;
}

export interface CompiledBrief {
  project_id: string;
  as_of_revision: number;
  projection: BriefProjection;
  language: string;
  current_goal_revision: string;
  selected_objects: SelectedBriefObject[];
  selection_reasons: Record<string, string[]>;
  omitted_counts: Record<string, number>;
  expandable_refs: string[];
  changes_since_revision: Array<{ revision: number; event_id: string; type: string; refs: string[] }>;
  next_safe_action: string;
  estimated_tokens: number;
}

export class ContextBudgetError extends Error {
  constructor(
    readonly code: "budget-too-small-for-authority-core" | "budget-too-small-for-required-task-contract",
    readonly budget_tokens: number,
    readonly required_tokens: number,
    readonly required_refs: string[],
  ) {
    super(code === "budget-too-small-for-authority-core"
      ? `Context budget ${budget_tokens} tokens is too small for the authority core, which requires ${required_tokens} tokens`
      : `Context budget ${budget_tokens} tokens is too small for the required task contract, which requires ${required_tokens} tokens`);
    this.name = "ContextBudgetError";
  }

  toJSON(): Record<string, unknown> {
    return { code: this.code, budget_tokens: this.budget_tokens, required_tokens: this.required_tokens, required_refs: this.required_refs };
  }
}

interface Candidate { entity: CanonicalEntity; priority: number; reason: string }

export class ContextCompiler {
  constructor(private readonly core: EspalierCore) {}

  compile(input: BriefInput): CompiledBrief {
    if (!input.actor?.capabilities?.includes("read")) throw new Error("Context compilation requires read capability");
    if (!Number.isInteger(input.last_seen_revision) || input.last_seen_revision < 0) throw new Error("last_seen_revision must be a non-negative integer");
    if (!Number.isInteger(input.context_budget_tokens) || input.context_budget_tokens < 320) throw new Error("context_budget_tokens must be an integer of at least 320");
    const revision = this.core.getProjectRevision(input.project_id);
    if (input.last_seen_revision > revision) throw new Error("last_seen_revision is newer than the project");
    const entities = this.core.listEntities(input.project_id);
    const project = entities.find((entity) => entity.type === "project");
    if (!project || project.type !== "project") throw new Error(`Unknown project ${input.project_id}`);
    const goal = entities.find((entity) => entity.type === "goal" && entity.id === project.current_goal_revision_id) as GoalRevision | undefined;
    if (!goal) throw new Error(`Project ${input.project_id} has no approved current goal`);
    const epoch = entities.find((entity) => entity.type === "epoch" && entity.id === project.current_epoch_id);
    if (epoch?.type === "epoch" && epoch.goal_revision_id !== goal.id) throw new Error(`Project ${input.project_id} has an authority mismatch between current Goal ${goal.id} and active Epoch ${epoch.id}`);
    const budget = Math.max(320, input.context_budget_tokens);
    const authorityCoreObjects = [project, goal].map((entity) => ({
      ref: entityRef(entity, revision),
      selection_reasons: [entity.type === "project" ? "project identity and current revision" : "binding owner-approved goal and constraints"],
      object: compactObject(entity),
    }));
    const authorityCoreDraft = {
      project_id: input.project_id,
      as_of_revision: revision,
      projection: input.requested_projection,
      language: input.language,
      current_goal_revision: canonicalRef(input.project_id, "goal", goal.id, revision),
      selected_objects: authorityCoreObjects,
      selection_reasons: Object.fromEntries(authorityCoreObjects.map((item) => [item.ref, item.selection_reasons])),
      omitted_counts: {},
      expandable_refs: [],
      changes_since_revision: [],
      next_safe_action: "Expand the current Goal authority before taking action.",
    };
    const authorityCoreTokens = stabilizedEstimate(authorityCoreDraft);
    if (authorityCoreTokens > budget) throw new ContextBudgetError("budget-too-small-for-authority-core", budget, authorityCoreTokens, [entityRef(project), entityRef(goal)]);
    const relations = entities.filter((entity): entity is Relation => entity.type === "relation" && entity.authority_state !== "superseded");
    const events = this.core.listEvents(input.project_id, input.last_seen_revision)
      .filter((event) => !event.type.startsWith("claim."));
    const candidates = new Map<string, Candidate>();
    const add = (entity: CanonicalEntity | undefined, priority: number, reason: string) => {
      if (!entity) return;
      const ref = entityRef(entity);
      const existing = candidates.get(ref);
      if (!existing || priority < existing.priority) candidates.set(ref, { entity, priority, reason });
      else if (priority === existing.priority) {
        if (entity.entity_version > existing.entity.entity_version) existing.entity = entity;
        if (!existing.reason.includes(reason)) existing.reason += `; ${reason}`;
      }
    };

    add(project, 0, "project identity and current revision");
    add(goal, 0, "binding owner-approved goal and constraints");
    add(epoch, 1, "current epoch");

    let claim: Claim | undefined;
    let task: WorkItem | Lane | undefined;
    const inspectOnly = input.requested_projection === "presence" || input.requested_projection === "overview" || input.requested_projection === "deep-inspect";
    if (input.requested_projection !== "delta") {
      if (input.current_claim_ref) {
        const candidate = this.core.resolveInProject(input.project_id, withoutRevision(input.current_claim_ref));
        if (candidate.type !== "claim") throw new Error("current_claim_ref must identify a Claim");
        if (candidate.principal_id !== input.actor.principal_id) throw new Error("current_claim_ref belongs to another principal");
        if (!this.core.isClaimActive(candidate)) throw new Error("current_claim_ref is not active");
        if (candidate.mode !== "primary" && !inspectOnly) throw new Error("A resumable brief requires an active primary Claim");
        claim = candidate;
      } else {
        claim = entities.find((entity): entity is Claim => entity.type === "claim" && entity.mode === "primary" && entity.principal_id === input.actor.principal_id && this.core.isClaimActive(entity) && (!input.requested_task_ref || withoutRevision(entity.target_ref) === withoutRevision(input.requested_task_ref)));
      }
      add(claim, 1, "actor current claim");

      if (input.requested_task_ref) {
        const requested = this.core.resolveInProject(input.project_id, withoutRevision(input.requested_task_ref));
        if (requested.type !== "work" && requested.type !== "lane") throw new Error("requested_task_ref must identify Work or Lane");
        task = requested;
      } else if (claim) {
        const target = this.core.resolveInProject(input.project_id, claim.target_ref);
        if (target.type === "work" || target.type === "lane") task = target;
      }
      if (claim && task && withoutRevision(claim.target_ref) !== withoutRevision(entityRef(task)) && !inspectOnly) throw new Error("current_claim_ref does not target the requested task");
      add(task, 1, "current claimed or requested work");
    }

    if (task?.type === "work" && task.parent_id) add(entities.find((entity) => entity.type === "work" && entity.id === task!.parent_id), 2, "parent work");
    if (task?.type === "lane") {
      const batch = this.core.resolveInProject(input.project_id, task.batch_ref) as Batch;
      add(batch, 1, "lane batch contract");
      add(this.core.resolveInProject(input.project_id, batch.parent_work_item_ref), 2, "parent work for lane integration");
      for (const ref of task.context_refs) add(this.core.resolveInProject(input.project_id, ref), 3, "lane context contract");
    }
    if (task) {
      const taskRef = entityRef(task);
      for (const relation of relations) {
        if (relation.source_ref === taskRef || relation.target_ref === taskRef) {
          add(relation, 1, "direct relation");
          const otherRef = relation.source_ref === taskRef ? relation.target_ref : relation.source_ref;
          if (parseRef(otherRef).projectId === input.project_id) {
            add(this.core.resolveInProject(input.project_id, otherRef), 1, `one-hop ${relation.relation_type}`);
          }
        }
      }
      for (const entity of entities) {
        if (entity.type === "annotation" && entity.anchor_ref === taskRef && entity.state !== "resolved") add(entity, 3, "relevant open annotation");
        if (entity.type === "handoff" && task.type === "work" && entity.work_item_ref === taskRef) add(entity, 4, "recent handoff");
        if (entity.type === "evidence" && entity.target_refs.includes(taskRef)) add(entity, 5, "evidence for current work");
      }
    }

    for (const entity of entities) {
      if (entity.type === "decision" && entity.decision_state === "proposed") add(entity, 6, "pending owner decision");
      if (entity.type === "work" && entity.work_state === "blocked") add(entity, 2, "unresolved blocker");
    }

    for (const event of events) {
      const upserts = (event.payload.upserts ?? []) as CanonicalEntity[];
      for (const entity of upserts) {
        if (entity.type === "claim" || entity.type === "project") continue;
        add(entity, input.requested_projection === "delta" ? 1 : 3, "changed since last-seen revision");
      }
    }

    const sorted = [...candidates.values()].sort((a, b) => a.priority - b.priority || entityRef(a.entity).localeCompare(entityRef(b.entity)));
    const selected: SelectedBriefObject[] = [];
    const selectedPriorities = new Map<string, number>();
    for (const candidate of sorted) {
      selectedPriorities.set(`${candidate.entity.type}:${candidate.entity.id}`, candidate.priority);
      const item: SelectedBriefObject = {
        ref: entityRef(candidate.entity, revision),
        selection_reasons: candidate.reason.split("; "),
        object: compactObject(candidate.entity),
      };
      const projected = estimateTokens({ selected_objects: [...selected, item] }) + 220;
      const mandatory = candidate.entity.type === "project" || candidate.entity.type === "goal" || candidate.entity.id === task?.id;
      if (mandatory || projected <= budget) {
        selected.push(item);
      }
    }

    let expandableLimit = entities.length;
    let changes = events.map(summarizeEvent);
    const resumable = Boolean(task && claim?.mode === "primary" && withoutRevision(claim.target_ref) === withoutRevision(entityRef(task)));
    const nextAction = task && resumable
      ? `Continue ${boundedText(task.title, 96)} within ${boundedText(task.scope, 160)}; write only at a semantic checkpoint.`
      : task
        ? `Inspect ${boundedText(task.title, 96)} read-only; acquire its primary Claim before writing.`
      : this.core.deriveAttentionRefs(input.project_id)[0]
        ? `Inspect owner/coordinator attention at ${this.core.deriveAttentionRefs(input.project_id)[0]}.`
        : "Remain aware; no semantic write is required until durable state changes.";

    const build = (): CompiledBrief => {
      const selectedKeys = new Set(selected.map((item) => {
        const parsed = parseRef(item.ref);
        return `${parsed.type}:${parsed.id}`;
      }));
      const omitted = entities
        .filter((entity) => !selectedKeys.has(`${entity.type}:${entity.id}`))
        .sort((left, right) => (selectedPriorities.get(`${left.type}:${left.id}`) ?? Number.POSITIVE_INFINITY)
          - (selectedPriorities.get(`${right.type}:${right.id}`) ?? Number.POSITIVE_INFINITY)
          || entityRef(left).localeCompare(entityRef(right)));
      const omittedCounts = omitted.reduce<Record<string, number>>((counts, entity) => {
        counts[entity.type] = (counts[entity.type] ?? 0) + 1;
        return counts;
      }, {});
      const expandable = omitted.slice(0, expandableLimit).map((entity) => entityRef(entity, revision));
      const draft = {
        project_id: input.project_id,
        as_of_revision: revision,
        projection: input.requested_projection,
        language: input.language,
        current_goal_revision: canonicalRef(input.project_id, "goal", goal.id, revision),
        selected_objects: selected,
        selection_reasons: Object.fromEntries(selected.map((item) => [item.ref, item.selection_reasons])),
        omitted_counts: omittedCounts,
        expandable_refs: expandable,
        changes_since_revision: changes,
        next_safe_action: nextAction,
      };
      return { ...draft, estimated_tokens: stabilizedEstimate(draft) };
    };
    let brief = build();
    while (brief.estimated_tokens > budget && brief.expandable_refs.length > 1) {
      expandableLimit = brief.expandable_refs.length - 1;
      brief = build();
    }
    while (brief.estimated_tokens > budget) {
      const removable = selected.findLastIndex((item) => {
        const type = item.object.type;
        const id = item.object.id;
        return type !== "project" && type !== "goal" && id !== task?.id
          && (selectedPriorities.get(`${type}:${id}`) ?? Number.POSITIVE_INFINITY) >= 4;
      });
      if (removable < 0) break;
      selected.splice(removable, 1);
      brief = build();
    }
    while (brief.estimated_tokens > budget) {
      const removable = selected.findLastIndex((item) => {
        const type = item.object.type;
        const id = item.object.id;
        return type !== "project" && type !== "goal" && id !== task?.id
          && !item.selection_reasons.includes("changed since last-seen revision")
          && (selectedPriorities.get(`${type}:${id}`) ?? Number.POSITIVE_INFINITY) >= 3;
      });
      if (removable < 0) break;
      selected.splice(removable, 1);
      brief = build();
    }
    while (brief.estimated_tokens > budget) {
      const removable = selected.findLastIndex((item) => {
        const type = item.object.type;
        const id = item.object.id;
        return type !== "project" && type !== "goal" && id !== task?.id
          && (selectedPriorities.get(`${type}:${id}`) ?? Number.POSITIVE_INFINITY) >= 3;
      });
      if (removable < 0) break;
      selected.splice(removable, 1);
      brief = build();
    }
    while (brief.estimated_tokens > budget && changes.length > 0) {
      changes = changes.slice(1);
      brief = build();
    }
    while (brief.estimated_tokens > budget) {
      const removable = selected.findLastIndex((item) => {
        const type = item.object.type;
        const id = item.object.id;
        return type !== "project" && type !== "goal" && id !== task?.id;
      });
      if (removable < 0) break;
      selected.splice(removable, 1);
      brief = build();
    }
    if (brief.estimated_tokens > budget) {
      expandableLimit = 0;
      changes = [];
      for (const item of selected) item.object = ultraCompactObject(item.object);
      brief = build();
    }
    if (brief.estimated_tokens > budget) {
      throw new ContextBudgetError(
        task ? "budget-too-small-for-required-task-contract" : "budget-too-small-for-authority-core",
        budget,
        brief.estimated_tokens,
        [entityRef(project), entityRef(goal), ...(task ? [entityRef(task)] : [])],
      );
    }
    return brief;
  }
}

function compactObject(entity: CanonicalEntity): Record<string, unknown> {
  const common = { id: entity.id, type: entity.type, title: boundedText(entity.title, 240), entity_version: entity.entity_version, authority: entity.provenance.authority };
  switch (entity.type) {
    case "project": return { ...common, display_name: boundedText(entity.display_name, 240), status: entity.status, project_revision: entity.project_revision, current_goal_revision_id: entity.current_goal_revision_id, current_epoch_id: entity.current_epoch_id };
    case "goal": return { ...common, revision_number: entity.revision_number, purpose: boundedText(entity.purpose, 480), programme_order: [...entity.programme_order], binding_constraints: [...entity.binding_constraints], trust_boundaries: [...entity.trust_boundaries], explicit_non_goals: [...entity.explicit_non_goals], approval: entity.approval };
    case "epoch": return { ...common, goal_revision_id: entity.goal_revision_id, baseline_ref: entity.baseline_ref, state: entity.state };
    case "work": return { ...common, scope: boundedText(entity.scope, 480), kind: entity.kind, work_state: entity.work_state, evidence_state: entity.evidence_state, authority_state: entity.authority_state, goal_integrity: entity.goal_integrity, integration_state: entity.integration_state, semantic_surfaces: boundedStrings(entity.semantic_surfaces), current_claim_id: entity.current_claim_id };
    case "relation": return { ...common, source_ref: entity.source_ref, target_ref: entity.target_ref, relation_type: entity.relation_type, authority_state: entity.authority_state };
    case "claim": return { ...common, target_ref: entity.target_ref, principal_id: entity.principal_id, mode: entity.mode, lease_until: entity.lease_until };
    case "decision": return { ...common, question: entity.question, proposal: entity.proposal, decision_state: entity.decision_state, scope: entity.scope };
    case "annotation": return { ...common, anchor_ref: entity.anchor_ref, anchor_revision: entity.anchor_revision, kind: entity.kind, body: entity.body, state: entity.state };
    case "handoff": return { ...common, work_item_ref: entity.work_item_ref, current_state: entity.current_state, blockers: entity.blockers, open_questions: entity.open_questions, next_safe_action: entity.next_safe_action, narrative: entity.narrative };
    case "evidence": return { ...common, target_refs: entity.target_refs, kind: entity.kind, origin: entity.origin, ref: entity.ref, summary: entity.summary, verification_state: entity.verification_state };
    case "batch": return { ...common, parent_work_item_ref: entity.parent_work_item_ref, coordinator: entity.coordinator.principal_id, lane_refs: entity.lane_refs, integration_state: entity.integration_state };
    case "lane": return { ...common, batch_ref: entity.batch_ref, outcome: boundedText(entity.outcome, 480), scope: boundedText(entity.scope, 480), context_refs: boundedStrings(entity.context_refs), authority_contract: boundedText(entity.authority, 480), return_contract: boundedText(entity.return_contract, 480), semantic_surfaces: boundedStrings(entity.semantic_surfaces), repo_surfaces: boundedStrings(entity.repo_surfaces), integration_state: entity.integration_state };
    case "hypothesis": return { ...common, ...entity };
  }
}

function boundedText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function boundedStrings(values: string[], count = 12, length = 160): string[] {
  const selected = values.slice(0, count).map((value) => boundedText(value, length));
  return values.length > count ? [...selected, `… ${values.length - count} more`] : selected;
}

function ultraCompactObject(object: Record<string, unknown>): Record<string, unknown> {
  const compact: Record<string, unknown> = {
    id: object.id,
    type: object.type,
    title: boundedText(String(object.title ?? object.id ?? ""), 80),
    entity_version: object.entity_version,
  };
  if (object.type === "project") {
    compact.project_revision = object.project_revision;
    compact.current_goal_revision_id = object.current_goal_revision_id;
    compact.current_epoch_id = object.current_epoch_id;
  }
  if (object.type === "goal") {
    compact.purpose = boundedText(String(object.purpose ?? ""), 120);
    compact.approval = object.approval;
    compact.programme_order = object.programme_order;
    compact.binding_constraints = object.binding_constraints;
    compact.trust_boundaries = object.trust_boundaries;
    compact.explicit_non_goals = object.explicit_non_goals;
  }
  if (object.type === "work" || object.type === "lane") {
    compact.scope = boundedText(String(object.scope ?? ""), 120);
    compact.work_state = object.work_state;
    compact.authority_state = object.authority_state;
  }
  if (object.type === "lane") {
    compact.outcome = boundedText(String(object.outcome ?? ""), 80);
    compact.scope = boundedText(String(object.scope ?? ""), 80);
    compact.authority_contract = boundedText(String(object.authority_contract ?? ""), 80);
    compact.return_contract = boundedText(String(object.return_contract ?? ""), 80);
  }
  return compact;
}

function summarizeEvent(event: StoredEvent) {
  const upserts = (event.payload.upserts ?? []) as CanonicalEntity[];
  return { revision: event.project_revision, event_id: event.event_id, type: event.type, refs: upserts.map((entity) => entityRef(entity)) };
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function stabilizedEstimate(value: Record<string, unknown>): number {
  let estimatedTokens = estimateTokens({ ...value, estimated_tokens: 0 });
  while (true) {
    const next = estimateTokens({ ...value, estimated_tokens: estimatedTokens });
    if (next === estimatedTokens) return next;
    estimatedTokens = next;
  }
}
