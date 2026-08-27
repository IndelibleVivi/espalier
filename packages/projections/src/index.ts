import { createHash } from "node:crypto";
import { entityRef, instantIsAfter, parseRef, withoutRevision } from "@espalier/core";
import type { EspalierCore } from "@espalier/core";
import type { Annotation, Batch, CanonicalEntity, Claim, DcaSnapshot, Decision, Epoch, GoalRevision, Lane, Project, Relation, WorkItem } from "@espalier/protocol";
import { deriveAttention, type AttentionItem } from "./attention.js";
import { compileHumanSurface, type HumanSurfaceOptions, type HumanSurfaceProjection } from "./human-surface.js";
import { compileHistoricalReplay, type HistoricalReplayOptions, type HistoricalReplayProjection } from "./replay.js";

export * from "./attention.js";
export * from "./human-surface.js";
export * from "./fixtures.js";
export * from "./replay.js";
export * from "./scale-stressbench.js";

interface ProjectionBase { project_id: string; as_of_revision: number; projection_revision: number }
export interface ProjectionBudget { visible_node_budget: number; relation_budget: number; collection_budget: number; event_budget: number }
export interface RecentEventSummary { event_sequence: number; event_id: string; project_revision: number; type: string; occurred_at: string; recorded_at: string; refs: string[] }
export interface HumanPortfolioOptions { project_budget?: number; relation_budget?: number; attention_budget?: number; response_byte_budget?: number }
export class HumanPortfolioBudgetError extends Error {
  readonly code = "response-budget-too-small-for-mandatory-portfolio" as const;

  constructor(
    readonly budget_bytes: number,
    readonly required_bytes: number,
    readonly expansion_refs: string[],
  ) {
    super(`Human Portfolio budget ${budget_bytes} bytes is too small for the mandatory portfolio, which requires ${required_bytes} bytes`);
    this.name = "HumanPortfolioBudgetError";
  }

  toJSON(): Record<string, unknown> {
    return { code: this.code, budget_bytes: this.budget_bytes, required_bytes: this.required_bytes, expansion_refs: this.expansion_refs };
  }
}
export interface HumanPortfolioProjection {
  schema_version: "espalier.human-portfolio@0";
  mode: "portfolio";
  projection_revision: string;
  generated_at: string;
  projects: Array<{
    project_ref: string;
    project_id: string;
    display_name: string;
    as_of_revision: number;
    status: Project["status"];
    owner_policy: Project["owner_policy"];
    owner_policy_version: number;
    goal: { ref: string; purpose: string; approval: GoalRevision["approval"] } | null;
    epoch: { ref: string; title: string; state: Epoch["state"] } | null;
    attention_refs: string[];
    omitted_attention_count: number;
  }>;
  cross_project_relations: Array<{
    ref: string;
    authority_project_id: string;
    source_ref: string;
    target_ref: string;
    relation_type: string;
    authority_state: string;
    valid_at_revision: number;
    valid_from_revision: number;
    valid_to_revision?: number;
    external_project_ids: string[];
  }>;
  omitted_counts: { projects: number; relations: number; attention: number };
  diagnostics: { geometry_fields: 0; response_bytes: number; budgets: Required<HumanPortfolioOptions> };
}
export interface LiveProjection extends ProjectionBase {
  project: Project;
  goal: GoalRevision;
  epoch: Epoch | null;
  work_items: WorkItem[];
  relations: Relation[];
  claims: Claim[];
  batches: Batch[];
  lanes: Lane[];
  decisions: Decision[];
  annotations: Annotation[];
  attention: AttentionItem[];
  recent_events: RecentEventSummary[];
  recently_verified: WorkItem[];
  omitted_counts: Record<"work_items" | "relations" | "claims" | "batches" | "lanes" | "decisions" | "annotations" | "attention" | "events", number>;
}

export class Projector {
  constructor(private readonly core: EspalierCore) {}

  humanSurface(projectId: string, options: HumanSurfaceOptions): HumanSurfaceProjection {
    return compileHumanSurface(this.core, projectId, options, (entities) => deriveAttention(entities, this.core.currentTime()));
  }

  historicalReplay(projectId: string, checkpointRevision: number, options: HistoricalReplayOptions = {}): HistoricalReplayProjection {
    return compileHistoricalReplay(this.core, projectId, checkpointRevision, options);
  }

  live(projectId: string, requestedBudget: Partial<ProjectionBudget> = {}): LiveProjection {
    const all = this.core.listEntities(projectId);
    const project = required(all, "project", projectId) as Project;
    const goal = required(all, "goal", project.current_goal_revision_id) as GoalRevision;
    const epoch = project.current_epoch_id ? required(all, "epoch", project.current_epoch_id) as Epoch : null;
    if (epoch && epoch.state !== "active") throw new Error(`Project current Epoch ${epoch.id} is not active`);
    const budget: ProjectionBudget = {
      visible_node_budget: requestedBudget.visible_node_budget ?? 80,
      relation_budget: requestedBudget.relation_budget ?? 120,
      collection_budget: requestedBudget.collection_budget ?? 40,
      event_budget: requestedBudget.event_budget ?? 8,
    };
    if (Object.values(budget).some((value) => !Number.isInteger(value) || value < 1)) throw new Error("Projection budgets must be positive integers");
    const allWork = epoch ? all.filter((entity): entity is WorkItem => entity.type === "work" && entity.epoch_id === epoch.id && entity.work_state !== "closed").sort((a, b) => a.priority - b.priority || a.valid_from_revision - b.valid_from_revision || a.id.localeCompare(b.id)) : [];
    const work = allWork.slice(0, budget.visible_node_budget);
    const allRelations = all.filter((entity): entity is Relation => entity.type === "relation" && entity.authority_state !== "superseded");
    const visibleRefs = new Set(work.map((entity) => entityRef(entity)));
    const relations = allRelations.filter((relation) => visibleRefs.has(relation.source_ref) || visibleRefs.has(relation.target_ref)).slice(0, budget.relation_budget);
    const allClaims = all.filter((entity): entity is Claim => entity.type === "claim" && !entity.released_at && visibleRefs.has(entity.target_ref));
    const claims = allClaims.slice(0, budget.collection_budget);
    const allBatches = all.filter((entity): entity is Batch => entity.type === "batch" && visibleRefs.has(entity.parent_work_item_ref));
    const batches = allBatches.slice(0, budget.collection_budget);
    const batchRefs = new Set(batches.map((entity) => entityRef(entity)));
    const allLanes = all.filter((entity): entity is Lane => entity.type === "lane" && batchRefs.has(entity.batch_ref));
    const lanes = allLanes.slice(0, budget.collection_budget);
    const allDecisions = all.filter((entity): entity is Decision => entity.type === "decision").sort((left, right) => Number(left.decision_state !== "proposed") - Number(right.decision_state !== "proposed") || right.valid_from_revision - left.valid_from_revision);
    const decisions = allDecisions.slice(0, budget.collection_budget);
    const relationRefs = new Set(relations.map((entity) => entityRef(entity)));
    const allAnnotations = all.filter((entity): entity is Annotation => entity.type === "annotation" && entity.state !== "resolved" && (visibleRefs.has(entity.anchor_ref) || relationRefs.has(entity.anchor_ref)));
    const annotations = allAnnotations.slice(0, budget.collection_budget);
    const allAttention = deriveAttention(all, this.core.currentTime());
    const attention = allAttention.slice(0, budget.collection_budget);
    const allEvents = this.core.listEvents(projectId);
    const recentEvents = allEvents.slice(-budget.event_budget).reverse().map((event) => ({
      event_sequence: event.event_sequence,
      event_id: event.event_id,
      project_revision: event.project_revision,
      type: event.type,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at,
      refs: ((event.payload.upserts ?? []) as CanonicalEntity[]).map((entity) => entityRef(entity)),
    }));
    const revision = this.core.getProjectRevision(projectId);
    return {
      project_id: projectId,
      as_of_revision: revision,
      projection_revision: revision,
      project,
      goal,
      epoch,
      work_items: work,
      relations,
      claims,
      batches,
      lanes,
      decisions,
      annotations,
      attention,
      recent_events: recentEvents,
      recently_verified: work.filter((item) => item.evidence_state === "verified"),
      omitted_counts: {
        work_items: allWork.length - work.length,
        relations: allRelations.length - relations.length,
        claims: allClaims.length - claims.length,
        batches: allBatches.length - batches.length,
        lanes: allLanes.length - lanes.length,
        decisions: allDecisions.length - decisions.length,
        annotations: allAnnotations.length - annotations.length,
        attention: allAttention.length - attention.length,
        events: allEvents.length - recentEvents.length,
      },
    };
  }

  focus(ref: string) {
    const parsed = parseRef(ref);
    const anchor = this.core.resolve(ref);
    const selected = parsed.revision === undefined ? anchor : this.core.resolve(withoutRevision(ref));
    const projectId = selected.project_id;
    const all = this.core.listEntities(projectId);
    const selectedRef = entityRef(selected);
    const relations = all.filter((entity): entity is Relation => entity.type === "relation" && (entity.source_ref === selectedRef || entity.target_ref === selectedRef));
    const neighborRefs = new Set(relations.flatMap((relation) => [relation.source_ref, relation.target_ref]));
    const neighbors = all.filter((entity) => neighborRefs.has(entityRef(entity)) && entityRef(entity) !== selectedRef);
    const anchored = all.filter((entity) =>
      (entity.type === "annotation" && entity.anchor_ref === selectedRef) ||
      (entity.type === "evidence" && entity.target_refs.includes(selectedRef)) ||
      (entity.type === "handoff" && entity.work_item_ref === selectedRef));
    const revision = this.core.getProjectRevision(projectId);
    const changesSinceAnchor = parsed.revision === undefined ? [] : this.core.listEvents(projectId, parsed.revision).filter((event) => ((event.payload.upserts ?? []) as CanonicalEntity[]).some((entity) => entity.type === selected.type && entity.id === selected.id));
    return {
      project_id: projectId,
      as_of_revision: revision,
      projection_revision: revision,
      selected,
      ...(parsed.revision === undefined ? {} : { anchor_revision: parsed.revision, anchor, changes_since_anchor: changesSinceAnchor }),
      relations,
      neighbors,
      anchored,
    };
  }

  decisions(projectId: string) {
    const all = this.core.listEntities(projectId);
    const revision = this.core.getProjectRevision(projectId);
    return {
      project_id: projectId,
      as_of_revision: revision,
      projection_revision: revision,
      decisions: all.filter((entity): entity is Decision => entity.type === "decision"),
      attention: deriveAttention(all, this.core.currentTime()),
    };
  }

  atlas(projectId: string) {
    const revision = this.core.getProjectRevision(projectId);
    return { project_id: projectId, as_of_revision: revision, projection_revision: revision, entities: this.core.listEntities(projectId), events: this.core.listEvents(projectId) };
  }

  metrics(projectId: string) {
    const revision = this.core.getProjectRevision(projectId);
    const entities = this.core.listEntities(projectId);
    const events = this.core.listEvents(projectId);
    const receipts = this.core.store.listReceipts(projectId);
    const rejected = receipts.filter((receipt) => !receipt.accepted);
    const workCount = entities.filter((entity) => entity.type === "work").length;
    const now = this.core.currentTime();
    return {
      project_id: projectId,
      as_of_revision: revision,
      semantic_event_count: events.length,
      work_item_count: workCount,
      event_to_work_ratio: workCount === 0 ? 0 : Number((events.length / workCount).toFixed(2)),
      rejected_write_count: rejected.length,
      stale_write_count: rejected.filter((receipt) => receipt.code === "stale").length,
      conflicting_write_count: rejected.filter((receipt) => receipt.code === "claim-conflict").length,
      owner_attention_count: deriveAttention(entities, now).filter((item) => item.priority === 1).length,
      active_claim_count: entities.filter((entity) => entity.type === "claim" && !entity.released_at && instantIsAfter(entity.lease_until, now)).length,
    };
  }

  dca(projectId: string, focusRef?: string): DcaSnapshot {
    const revision = this.core.getProjectRevision(projectId);
    let entities: CanonicalEntity[];
    let relations: Relation[];
    if (focusRef) {
      const focus = this.focus(focusRef);
      if (focus.project_id !== projectId) throw new Error("Focus ref does not belong to requested project");
      entities = [focus.selected, ...focus.neighbors, ...focus.anchored];
      relations = focus.relations;
    } else {
      const all = this.core.listEntities(projectId);
      entities = all.filter((entity) => entity.type !== "relation");
      relations = all.filter((entity): entity is Relation => entity.type === "relation" && entity.authority_state !== "superseded");
    }
    const unique = new Map(entities.map((entity) => [entityRef(entity), entity]));
    return {
      format: "espalier.dca-snapshot/1",
      project_id: projectId,
      source_revision: revision,
      ...(focusRef ? { focus_ref: entityRef(this.core.resolve(focusRef)) } : {}),
      nodes: [...unique.values()].map((entity) => ({ ref: entityRef(entity), type: entity.type, title: entity.title, state: snapshotState(entity) })),
      edges: relations.map((relation) => ({ ref: entityRef(relation), source_ref: relation.source_ref, target_ref: relation.target_ref, relation_type: relation.relation_type, authority_state: relation.authority_state })),
    };
  }

  portfolio(requested: HumanPortfolioOptions = {}): HumanPortfolioProjection {
    const budgets: Required<HumanPortfolioOptions> = {
      project_budget: portfolioBudget(requested.project_budget, 40),
      relation_budget: portfolioBudget(requested.relation_budget, 120),
      attention_budget: portfolioBudget(requested.attention_budget, 20),
      response_byte_budget: portfolioBudget(requested.response_byte_budget, 262_144),
    };
    const allProjects = this.core.listProjects().sort((left, right) => left.project_id.localeCompare(right.project_id));
    const projects = allProjects.slice(0, budgets.project_budget);
    const selectedProjectIds = new Set(projects.map((project) => project.project_id));
    const allEntitiesByProject = new Map(allProjects.map((project) => [project.project_id, this.core.listEntities(project.project_id)]));
    let omittedAttention = 0;
    const projectSummaries = projects.map((project) => {
      const entities = allEntitiesByProject.get(project.project_id)!;
      const goal = entities.find((entity): entity is GoalRevision => entity.type === "goal" && entity.id === project.current_goal_revision_id);
      const epoch = entities.find((entity): entity is Epoch => entity.type === "epoch" && entity.id === project.current_epoch_id);
      const attention = deriveAttention(entities, this.core.currentTime());
      omittedAttention += Math.max(0, attention.length - budgets.attention_budget);
      return {
        project_ref: entityRef(project),
        project_id: project.project_id,
        display_name: boundedPortfolioText(project.display_name, 240),
        as_of_revision: this.core.getProjectRevision(project.project_id),
        status: project.status,
        owner_policy: project.owner_policy,
        owner_policy_version: project.owner_policy_version,
        goal: goal ? { ref: entityRef(goal), purpose: boundedPortfolioText(goal.purpose, 600), approval: goal.approval } : null,
        epoch: epoch ? { ref: entityRef(epoch), title: boundedPortfolioText(epoch.title, 200), state: epoch.state } : null,
        attention_refs: attention.slice(0, budgets.attention_budget).map((item) => item.ref),
        omitted_attention_count: Math.max(0, attention.length - budgets.attention_budget),
      };
    });
    const allRelations = [...new Map([...allEntitiesByProject.values()].flat().filter((entity): entity is Relation => entity.type === "relation" && parseRef(entity.source_ref).projectId !== parseRef(entity.target_ref).projectId).map((relation) => [entityRef(relation), relation])).values()]
      .sort((left, right) => entityRef(left).localeCompare(entityRef(right)));
    const relationCandidates = allRelations.filter((relation) => [parseRef(relation.source_ref).projectId, parseRef(relation.target_ref).projectId].some((projectId) => selectedProjectIds.has(projectId)))
      .sort((left, right) => Number(right.authority_state === "approved") - Number(left.authority_state === "approved") || entityRef(left).localeCompare(entityRef(right)));
    const selectedRelations = relationCandidates.slice(0, budgets.relation_budget);
    const crossProjectRelations = selectedRelations.map((relation) => {
      const endpointProjects = uniqueStrings([parseRef(relation.source_ref).projectId, parseRef(relation.target_ref).projectId]);
      const validFromRevision = firstEntityRevision(this.core, relation.project_id, "relation", relation.id) ?? relation.valid_from_revision;
      return {
        ref: entityRef(relation),
        authority_project_id: relation.project_id,
        source_ref: relation.source_ref,
        target_ref: relation.target_ref,
        relation_type: relation.relation_type,
        authority_state: relation.authority_state,
        valid_at_revision: relation.valid_to_revision ?? this.core.getProjectRevision(relation.project_id),
        valid_from_revision: validFromRevision,
        ...(relation.valid_to_revision !== undefined ? { valid_to_revision: relation.valid_to_revision } : {}),
        external_project_ids: uniqueStrings([...endpointProjects, relation.project_id]).filter((projectId) => !selectedProjectIds.has(projectId)),
      };
    });
    const identity = createHash("sha256").update(allProjects.map((project) => `${project.project_id}@${this.core.getProjectRevision(project.project_id)}`).join(",") + allRelations.map((relation) => `${entityRef(relation)}@${relation.entity_version}`).join(",")).digest("hex").slice(0, 20);
    const projection: HumanPortfolioProjection = {
      schema_version: "espalier.human-portfolio@0",
      mode: "portfolio",
      projection_revision: `portfolio:${identity}:p${budgets.project_budget}:r${budgets.relation_budget}:a${budgets.attention_budget}`,
      generated_at: this.core.currentTime(),
      projects: projectSummaries,
      cross_project_relations: crossProjectRelations,
      omitted_counts: { projects: Math.max(0, allProjects.length - projects.length), relations: Math.max(0, allRelations.length - crossProjectRelations.length), attention: omittedAttention },
      diagnostics: { geometry_fields: 0, response_bytes: 0, budgets },
    };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const bytes = Buffer.byteLength(JSON.stringify(projection), "utf8");
      if (projection.diagnostics.response_bytes === bytes) break;
      projection.diagnostics.response_bytes = bytes;
    }
    if (projection.diagnostics.response_bytes > budgets.response_byte_budget) {
      throw new HumanPortfolioBudgetError(
        budgets.response_byte_budget,
        projection.diagnostics.response_bytes,
        uniqueStrings(projectSummaries.flatMap((summary) => [summary.project_ref, ...(summary.goal ? [summary.goal.ref] : [])])).slice(0, 80),
      );
    }
    return projection;
  }
}

function portfolioBudget(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new Error("Portfolio budgets must be positive integers");
  return value;
}

function uniqueStrings(values: string[]): string[] { return [...new Set(values)]; }

function boundedPortfolioText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function firstEntityRevision(core: EspalierCore, projectId: string, type: CanonicalEntity["type"], id: string): number | undefined {
  for (const event of core.listEvents(projectId)) if (((event.payload.upserts ?? []) as CanonicalEntity[]).some((entity) => entity.type === type && entity.id === id)) return event.project_revision;
  return undefined;
}

function required(entities: CanonicalEntity[], type: CanonicalEntity["type"], id?: string): CanonicalEntity {
  const entity = entities.find((candidate) => candidate.type === type && (id === undefined || candidate.id === id));
  if (!entity) throw new Error(`Missing ${type}${id ? ` ${id}` : ""}`);
  return entity;
}

function snapshotState(entity: CanonicalEntity): Record<string, string> {
  switch (entity.type) {
    case "project": return { status: entity.status };
    case "goal": return { approval: entity.approval };
    case "epoch": return { state: entity.state };
    case "work": return { work: entity.work_state, evidence: entity.evidence_state, authority: entity.authority_state, integrity: entity.goal_integrity, integration: entity.integration_state };
    case "decision": return { state: entity.decision_state, authority: entity.authority };
    case "hypothesis": return { state: entity.state };
    case "claim": return { mode: entity.mode, lease_until: entity.lease_until, released: String(Boolean(entity.released_at)) };
    case "evidence": return { verification: entity.verification_state, origin: entity.origin };
    case "annotation": return { state: entity.state, kind: entity.kind };
    case "batch": return { integration: entity.integration_state };
    case "lane": return { integration: entity.integration_state };
    case "handoff": return { as_of_revision: String(entity.as_of_revision) };
    case "relation": return { authority: entity.authority_state };
  }
}
