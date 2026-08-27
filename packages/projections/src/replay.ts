import { createHash } from "node:crypto";
import { entityRef, parseRef } from "@espalier/core";
import type { EspalierCore } from "@espalier/core";
import type { CanonicalEntity, Project, Relation, StoredEvent } from "@espalier/protocol";

export interface HistoricalReplayOptions {
  visible_node_budget?: number;
  relation_budget?: number;
  response_byte_budget?: number;
}

export interface ReplayEntityProjection {
  ref: string;
  entity_version: number;
  kind: Exclude<CanonicalEntity["type"], "relation">;
  title: string;
  valid_from_revision: number;
  valid_to_revision?: number;
  state: Record<string, unknown>;
}

export interface ReplayRelationProjection {
  ref: string;
  entity_version: number;
  relation_type: string;
  source_ref: string;
  target_ref: string;
  authority_state: string;
  valid_from_revision: number;
  valid_to_revision?: number;
  omitted_endpoint_refs: string[];
}

export interface HistoricalReplayProjection {
  schema_version: "espalier.historical-replay@0";
  project_id: string;
  checkpoint_revision: number;
  checkpoint_ref: string;
  projection_revision: string;
  generated_at: string;
  source: "accepted-canonical-event-log";
  source_event_count: number;
  evidence_boundary: {
    supported_facts: string[];
    unknowns: string[];
  };
  entities: ReplayEntityProjection[];
  relations: ReplayRelationProjection[];
  omitted_counts: { entities: number; relations: number };
  invariants: {
    canonical_route_objects: 0;
    geometry_fields: 0;
    fabricated_event_count: 0;
    active_epoch_count: number;
    local_ref_gaps: string[];
  };
  diagnostics: {
    source_entity_count: number;
    response_bytes: number;
    budgets: Required<HistoricalReplayOptions>;
  };
}

export class HistoricalReplayBudgetError extends Error {
  readonly code = "response-budget-too-small-for-replay-checkpoint" as const;

  constructor(
    readonly budget_bytes: number,
    readonly required_bytes: number,
    readonly checkpoint_ref: string,
  ) {
    super(`Historical replay budget ${budget_bytes} bytes is too small for checkpoint ${checkpoint_ref}, which requires ${required_bytes} bytes`);
    this.name = "HistoricalReplayBudgetError";
  }

  toJSON(): Record<string, unknown> {
    return { code: this.code, budget_bytes: this.budget_bytes, required_bytes: this.required_bytes, checkpoint_ref: this.checkpoint_ref };
  }
}

export function compileHistoricalReplay(
  core: EspalierCore,
  projectId: string,
  checkpointRevision: number,
  requested: HistoricalReplayOptions = {},
): HistoricalReplayProjection {
  const currentRevision = core.getProjectRevision(projectId);
  if (!Number.isInteger(checkpointRevision) || checkpointRevision < 1 || checkpointRevision > currentRevision) {
    throw new Error(`Historical replay revision ${checkpointRevision} is outside Project ${projectId} revision 1..${currentRevision}`);
  }
  const budgets: Required<HistoricalReplayOptions> = {
    visible_node_budget: replayBudget(requested.visible_node_budget, 120),
    relation_budget: replayBudget(requested.relation_budget, 160),
    response_byte_budget: replayBudget(requested.response_byte_budget, 524_288),
  };
  const events = core.listEvents(projectId).filter((event) => event.project_revision <= checkpointRevision);
  const snapshot = snapshotFromAcceptedEvents(events, projectId);
  const allEntities = [...snapshot.values()];
  const project = allEntities.find((entity): entity is Project => entity.type === "project" && entity.id === projectId);
  if (!project) throw new Error(`Historical replay checkpoint ${projectId}@${checkpointRevision} has no Project identity`);
  const nonRelations = allEntities.filter((entity): entity is Exclude<CanonicalEntity, Relation> => entity.type !== "relation");
  const allRelations = allEntities.filter((entity): entity is Relation => entity.type === "relation");
  const mandatoryRefs = new Set([
    entityRef(project),
    ...(project.current_goal_revision_id ? [`espalier://${projectId}/goal/${project.current_goal_revision_id}`] : []),
    ...(project.current_epoch_id ? [`espalier://${projectId}/epoch/${project.current_epoch_id}`] : []),
  ]);
  if (mandatoryRefs.size > budgets.visible_node_budget) {
    throw new Error(`Historical replay node budget ${budgets.visible_node_budget} cannot retain mandatory Project checkpoint identity`);
  }
  const orderedEntities = [...nonRelations].sort((left, right) => Number(!mandatoryRefs.has(entityRef(left))) - Number(!mandatoryRefs.has(entityRef(right))) || replayEntityOrder(left) - replayEntityOrder(right) || entityRef(left).localeCompare(entityRef(right)));
  const selectedEntities = orderedEntities.slice(0, budgets.visible_node_budget);
  const selectedRefs = new Set(selectedEntities.map((entity) => entityRef(entity)));
  const selectedRelations = [...allRelations]
    .sort((left, right) => replayRelationOrder(left) - replayRelationOrder(right) || entityRef(left).localeCompare(entityRef(right)))
    .slice(0, budgets.relation_budget);
  const checkpointRef = `espalier-replay://${projectId}@${checkpointRevision}`;
  const identity = stableReplayHash({
    project_id: projectId,
    checkpoint_revision: checkpointRevision,
    entities: allEntities.map((entity) => [entityRef(entity), entity.entity_version]).sort(([left], [right]) => String(left).localeCompare(String(right))),
    budgets,
  });
  const projection: HistoricalReplayProjection = {
    schema_version: "espalier.historical-replay@0",
    project_id: projectId,
    checkpoint_revision: checkpointRevision,
    checkpoint_ref: checkpointRef,
    projection_revision: `${checkpointRef}:${identity}`,
    generated_at: core.currentTime(),
    source: "accepted-canonical-event-log",
    source_event_count: events.length,
    evidence_boundary: {
      supported_facts: [
        `${events.length} accepted canonical events were replayed through Project revision ${checkpointRevision}`,
        "Entity and Relation summaries use the latest accepted upsert at or before the checkpoint revision",
      ],
      unknowns: [
        "External source intent, timing, and completeness are not established by this checkpoint",
        "Work split/merge and coordinated reconstruction dispositions are not represented by the current Core contract",
      ],
    },
    entities: selectedEntities.map(replayEntity),
    relations: selectedRelations.map((relation) => ({
      ref: entityRef(relation),
      entity_version: relation.entity_version,
      relation_type: relation.relation_type,
      source_ref: relation.source_ref,
      target_ref: relation.target_ref,
      authority_state: relation.authority_state,
      valid_from_revision: relation.valid_from_revision,
      ...(relation.valid_to_revision !== undefined ? { valid_to_revision: relation.valid_to_revision } : {}),
      omitted_endpoint_refs: [relation.source_ref, relation.target_ref].filter((ref) => parseRef(ref).projectId === projectId && !selectedRefs.has(ref)),
    })),
    omitted_counts: {
      entities: Math.max(0, nonRelations.length - selectedEntities.length),
      relations: Math.max(0, allRelations.length - selectedRelations.length),
    },
    invariants: {
      canonical_route_objects: 0,
      geometry_fields: 0,
      fabricated_event_count: 0,
      active_epoch_count: allEntities.filter((entity) => entity.type === "epoch" && entity.state === "active").length,
      local_ref_gaps: localReferenceGaps(allEntities, projectId),
    },
    diagnostics: { source_entity_count: allEntities.length, response_bytes: 0, budgets },
  };
  stabilizeReplaySize(projection);
  if (projection.diagnostics.response_bytes > budgets.response_byte_budget) {
    throw new HistoricalReplayBudgetError(budgets.response_byte_budget, projection.diagnostics.response_bytes, checkpointRef);
  }
  return projection;
}

function snapshotFromAcceptedEvents(events: StoredEvent[], projectId: string): Map<string, CanonicalEntity> {
  const snapshot = new Map<string, CanonicalEntity>();
  for (const event of events) {
    const upserts = Array.isArray(event.payload.upserts) ? event.payload.upserts as CanonicalEntity[] : [];
    for (const entity of upserts) {
      if (entity.project_id !== projectId) throw new Error(`Canonical event ${event.event_id} crossed Project authority domains`);
      snapshot.set(`${entity.type}:${entity.id}`, structuredClone(entity));
    }
  }
  return snapshot;
}

function replayEntity(entity: Exclude<CanonicalEntity, Relation>): ReplayEntityProjection {
  const stateKeys = [
    "status", "current_goal_revision_id", "current_epoch_id", "approval", "revision_number", "goal_revision_id", "baseline_ref", "state",
    "epoch_id", "parent_id", "work_state", "evidence_state", "authority_state", "goal_integrity", "integration_state", "current_claim_id",
    "decision_state", "target_ref", "mode", "lease_until", "released_at", "verification_state", "origin", "kind", "anchor_ref", "anchor_revision",
    "batch_ref", "parent_work_item_ref", "result_ref",
  ];
  const record = entity as unknown as Record<string, unknown>;
  return {
    ref: entityRef(entity),
    entity_version: entity.entity_version,
    kind: entity.type,
    title: boundedReplayText(entity.title, 240),
    valid_from_revision: entity.valid_from_revision,
    ...(entity.valid_to_revision !== undefined ? { valid_to_revision: entity.valid_to_revision } : {}),
    state: Object.fromEntries(stateKeys.flatMap((key) => record[key] === undefined ? [] : [[key, structuredClone(record[key])]])),
  };
}

function replayEntityOrder(entity: Exclude<CanonicalEntity, Relation>): number {
  const order: Array<Exclude<CanonicalEntity["type"], "relation">> = ["project", "goal", "epoch", "work", "batch", "lane", "decision", "claim", "evidence", "annotation", "hypothesis", "handoff"];
  const index = order.indexOf(entity.type);
  return index < 0 ? order.length : index;
}

function replayRelationOrder(relation: Relation): number {
  if (relation.authority_state === "approved") return 0;
  if (["blocks", "depends_on", "provides_capability_to"].includes(relation.relation_type)) return 1;
  if (relation.authority_state === "superseded") return 3;
  return 2;
}

function localReferenceGaps(entities: CanonicalEntity[], projectId: string): string[] {
  const refs = new Set(entities.map((entity) => entityRef(entity)));
  const gaps = new Set<string>();
  for (const entity of entities) {
    for (const ref of entityLocalRefs(entity, projectId)) if (!refs.has(ref)) gaps.add(ref);
  }
  return [...gaps].sort();
}

function entityLocalRefs(entity: CanonicalEntity, projectId: string): string[] {
  const canonical = (refs: Array<string | undefined>) => refs.filter((ref): ref is string => Boolean(ref) && ref!.startsWith("espalier://") && parseRef(ref!).projectId === projectId);
  if (entity.type === "project") return canonical([
    entity.current_goal_revision_id ? `espalier://${projectId}/goal/${entity.current_goal_revision_id}` : undefined,
    entity.current_epoch_id ? `espalier://${projectId}/epoch/${entity.current_epoch_id}` : undefined,
  ]);
  if (entity.type === "goal") return canonical([entity.supersedes_goal_revision_id ? `espalier://${projectId}/goal/${entity.supersedes_goal_revision_id}` : undefined]);
  if (entity.type === "epoch") return canonical([`espalier://${projectId}/goal/${entity.goal_revision_id}`, entity.compaction_receipt_ref]);
  if (entity.type === "work") return canonical([
    `espalier://${projectId}/epoch/${entity.epoch_id}`,
    entity.parent_id ? `espalier://${projectId}/work/${entity.parent_id}` : undefined,
    entity.current_claim_id ? `espalier://${projectId}/claim/${entity.current_claim_id}` : undefined,
    ...(entity.verification_evidence_refs ?? []),
    entity.handoff_ref,
  ]);
  if (entity.type === "relation") return canonical([entity.source_ref, entity.target_ref]);
  if (entity.type === "decision") return canonical([...(entity.source_refs ?? []), entity.authorizes?.target_ref]);
  if (entity.type === "hypothesis") return canonical(entity.evidence_refs);
  if (entity.type === "claim") return canonical([entity.target_ref]);
  if (entity.type === "evidence") return canonical(entity.target_refs);
  if (entity.type === "annotation") return canonical([entity.anchor_ref, ...entity.response_refs]);
  if (entity.type === "handoff") return canonical([entity.work_item_ref, ...entity.evidence_refs]);
  if (entity.type === "batch") return canonical([entity.parent_work_item_ref, ...entity.lane_refs]);
  if (entity.type === "lane") return canonical([entity.batch_ref, ...entity.context_refs, entity.result_ref]);
  return [];
}

function replayBudget(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new Error("Historical replay budgets must be positive integers");
  return value;
}

function boundedReplayText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function stabilizeReplaySize(projection: HistoricalReplayProjection): void {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const bytes = Buffer.byteLength(JSON.stringify(projection), "utf8");
    if (projection.diagnostics.response_bytes === bytes) return;
    projection.diagnostics.response_bytes = bytes;
  }
}

function stableReplayHash(value: unknown): string {
  return createHash("sha256").update(stableReplayJson(value)).digest("hex").slice(0, 20);
}

function stableReplayJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableReplayJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableReplayJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
