import { createHash } from "node:crypto";
import { canonicalRef, entityRef, instantIsAfter, instantIsAtOrBefore, parseRef } from "@espalier/core";
import type { EspalierCore } from "@espalier/core";
import type {
  ActorIdentity,
  Annotation,
  CanonicalEntity,
  Claim,
  CommandEnvelope,
  CommandType,
  Decision,
  Epoch,
  GoalRevision,
  Project,
  Relation,
  StoredEvent,
  WorkItem,
} from "@espalier/protocol";

export type HumanSurfaceMode = "live" | "focus" | "attention" | "atlas" | "portfolio";
export type HumanSurfaceDensity = "overview" | "working" | "detail";
export type BranchRole = "programme" | "subordinate" | "deferred" | "research-only" | "owner-pending" | "diverging" | "historical";
export type ChangeReason =
  | "created"
  | "work-state-changed"
  | "evidence-threshold-crossed"
  | "verification-reopened"
  | "authority-changed"
  | "goal-integrity-changed"
  | "integration-changed"
  | "relation-materially-changed"
  | "attention-created"
  | "attention-resolved"
  | "annotation-created"
  | "annotation-stale"
  | "claim-conflict"
  | "claim-stale"
  | "owner-decision";

export interface SurfaceCapability {
  action: "inspect" | "copy-ref" | "annotate" | "claim" | "semantic-command" | "mark-seen" | "change-view";
  allowed: boolean;
  target_ref?: string;
  command_type?: CommandType;
  preview_id?: string;
  input_requirements?: string[];
  requires_confirmation?: boolean;
  reason?: string;
}

export interface CommandPreview {
  preview_id: string;
  command_type: CommandType;
  action_variant: string;
  payload: Record<string, unknown>;
  presentation_ref: string;
  target_refs: string[];
  base_project_revision: number;
  base_entity_versions: Record<string, number>;
  authority_requirement: "writer" | "claimant" | "coordinator" | "owner" | "multi-owner-vote" | "multi-owner-decision";
  availability: "executable" | "approval-required" | "unavailable" | "read-only";
  available: boolean;
  blocked_reason?: string;
  input_requirements?: string[];
  projected_effect: {
    state_changes: string[];
    relation_changes: string[];
    constraint_effects: string[];
    omitted_constraint_count?: number;
    constraint_expansion_ref?: string;
    proposed_insertion_ref?: string;
    attention_effect: string;
    supersession_effect: string;
    project_revision: string;
  };
}

export interface CollapseSummary {
  member_count: number;
  active_count: number;
  changed_count: number;
  blocked_count: number;
  owner_question_count: number;
  verified_count: number;
}

export interface RouteProjection {
  route_key: string;
  title: string;
  basis_refs: string[];
  root_refs: string[];
  member_refs: string[];
  parent_route_key?: string;
  programme_order_index?: number;
  branch_role: BranchRole;
  default_family_slot?: string;
  summary: CollapseSummary;
  default_expansion: "expanded" | "collapsed" | "peek";
  expansion_reasons: string[];
  aggregate?: true;
  omitted_root_count?: number;
  omitted_root_refs?: string[];
  expansion_handle?: string;
}

export interface RouteOverflowProjection {
  omitted_root_count: number;
  omitted_root_refs: string[];
  expansion_handle: string;
}

export type EpochHeaderProjection =
  | { state: "active"; ref: string; title: string; baseline_ref: string }
  | { state: "no-active-epoch"; latest_historical_ref?: string; latest_historical_state?: "frozen" | "archived" };

export interface SurfaceEntity {
  ref: string;
  entity_version: number;
  kind: CanonicalEntity["type"];
  title: string;
  subtitle?: string;
  route_key?: string;
  parent_ref?: string;
  branch_role: BranchRole;
  programme_order_key?: string;
  primary_state: string;
  state_axes: {
    work_state?: string;
    evidence_state?: string;
    authority_state?: string;
    goal_integrity?: string;
    integration_state?: string;
  };
  claim?: { ref: string; principal_id: string; mode: string; lease_until: string; stale: boolean };
  receipt_summary?: { verified: boolean; label: string; evidence_refs: string[] };
  receipt_bundle?: { source_epoch_ref: string; next_epoch_ref: string; compacted_refs: string[]; carried_refs: string[]; accepted_decision_refs: string[] };
  attention_refs: string[];
  change_reasons: ChangeReason[];
  default_visibility: "visible" | "summary" | "hidden";
  capabilities: SurfaceCapability[];
}

export interface SurfaceRelation {
  ref: string;
  entity_version: number;
  relation_type: string;
  source_ref: string;
  target_ref: string;
  authority_state: string;
  valid_at_revision: number;
  valid_from_revision: number;
  valid_to_revision?: number;
  visibility: "always" | "contextual" | "focus-only";
  criticality: "ordinary" | "structural" | "attention";
  label_mode: "hidden" | "on-hover" | "visible";
  change_reasons: ChangeReason[];
  annotation_refs: string[];
  capabilities: SurfaceCapability[];
  external_endpoint_refs?: string[];
}

export interface SurfaceAnnotation {
  ref: string;
  anchor_ref: string;
  anchor_revision: number;
  kind: Annotation["kind"];
  state: Annotation["state"];
  body: string;
  change_reasons: ChangeReason[];
  capabilities: SurfaceCapability[];
}

export interface AttentionPresentation {
  attention_ref: string;
  reason: string;
  severity: "notable" | "owner-action" | "conflict";
  anchor_refs: string[];
  proposed_insertion_ref?: string;
  summary: string;
  capabilities: SurfaceCapability[];
}

export interface MeaningfulDeltaProjection {
  since_revision: number | null;
  changed_refs: string[];
  change_reasons_by_ref: Record<string, ChangeReason[]>;
  ancestor_paths_to_open: string[][];
  attention_created: string[];
  attention_resolved: string[];
  mark_seen_capability?: SurfaceCapability;
}

export interface CollapseGroupProjection {
  group_key: string;
  route_key?: string;
  title: string;
  branch_role: BranchRole;
  member_refs: string[];
  default_expansion: "expanded" | "collapsed" | "peek";
  summary: CollapseSummary;
}

export type OperationalCategory =
  | "active-frontiers"
  | "blockers"
  | "owner-attention"
  | "claim-pressure"
  | "integration-waiting"
  | "meaningful-delta"
  | "recently-verified";

export interface AggregatePresentation {
  aggregate_key: string;
  aggregate_kind: OperationalCategory;
  title: string;
  member_count: number;
  sample_member_refs: string[];
  omitted_member_count: number;
  state_counts: Record<string, number>;
  attention_count: number;
  recent_change_count: number;
  summary_facts: string[];
  expansion_handle: string;
}

export interface OperationalSummaryProjection {
  selection_policy: "mandatory-operational-state-then-ranked-context";
  categories: AggregatePresentation[];
}

export interface RelationBundleProjection {
  bundle_key: string;
  relation_type: string;
  source_region_key: string;
  target_region_key: string;
  member_count: number;
  sample_relation_refs: string[];
  omitted_member_count: number;
  attention_count: number;
  recent_change_count: number;
  expansion_handle: string;
}

export interface LayoutHint {
  target_key: string;
  semantic_region: "programme" | "adjacent" | "periphery" | "history" | "overlay";
  order_key?: string;
  depth?: number;
  keep_near?: string[];
  preserve_anchor?: boolean;
  preferred_ports?: string[];
}

export interface PersonalViewState {
  project_id: string;
  principal_id: string;
  device_or_saved_view: string;
  based_on_projection_revision: string;
  camera: unknown;
  node_positions: Record<string, { x: number; y: number }>;
  relation_geometry?: Record<string, unknown>;
  pinned_refs: string[];
  collapsed_entity_refs: string[];
  collapsed_route_keys: string[];
  route_palette_slots: Record<string, string>;
  density: "overview" | "working" | "detail";
  theme_id: string;
}

export interface HumanSurfaceProjection {
  schema_version: "espalier.human-surface@0";
  project_id: string;
  as_of_revision: number;
  projection_revision: string;
  generated_at: string;
  mode: HumanSurfaceMode;
  density: HumanSurfaceDensity;
  goal_header: { ref: string; purpose: string; revision_number: number; approval: GoalRevision["approval"]; binding_constraints: string[] };
  epoch: EpochHeaderProjection;
  routes: RouteProjection[];
  route_overflow: RouteOverflowProjection | null;
  entities: SurfaceEntity[];
  relations: SurfaceRelation[];
  annotations: SurfaceAnnotation[];
  attention: AttentionPresentation[];
  delta: MeaningfulDeltaProjection;
  operational_summary: OperationalSummaryProjection;
  relation_bundles: RelationBundleProjection[];
  collapse_groups: CollapseGroupProjection[];
  layout_hints: LayoutHint[];
  capabilities: SurfaceCapability[];
  command_previews: CommandPreview[];
  command_state_contract: {
    optimistic_state_is_canonical: false;
    accepted_receipt_required: true;
    stale_conflict_fields: Array<"current_project_revision" | "stale_entity" | "intervening_delta" | "recovery">;
  };
  stale_state: { state: "stale" | "disconnected" | "projection-failure"; last_revision: number; last_updated?: string; reason: string; commands_enabled: false } | null;
  omitted_counts: Record<string, number>;
  diagnostics: {
    canonical_route_objects: 0;
    geometry_fields: 0;
    source_entity_count: number;
    response_bytes: number;
    budgets: Required<Pick<HumanSurfaceOptions, "visible_node_budget" | "relation_budget" | "collection_budget" | "route_budget" | "expanded_depth_budget" | "evidence_detail_budget" | "historical_entity_budget" | "layout_hint_budget" | "response_byte_budget">>;
  };
}

export interface HumanSurfaceOptions {
  mode?: HumanSurfaceMode;
  density?: HumanSurfaceDensity;
  actor: ActorIdentity;
  since_revision?: number | null;
  focus_ref?: string;
  visible_node_budget?: number;
  relation_budget?: number;
  collection_budget?: number;
  route_budget?: number;
  expanded_depth_budget?: number;
  evidence_detail_budget?: number;
  historical_entity_budget?: number;
  layout_hint_budget?: number;
  response_byte_budget?: number;
  expansion_handle?: string;
  stale_state?: HumanSurfaceProjection["stale_state"];
}

export type HumanSurfaceExpansionIntent =
  | { kind: "routes"; after: string }
  | { kind: "relations"; bundle: string; after: string }
  | { kind: "operational"; category: OperationalCategory; after: string };

const operationalCategories = new Set<OperationalCategory>([
  "active-frontiers",
  "blockers",
  "owner-attention",
  "claim-pressure",
  "integration-waiting",
  "meaningful-delta",
  "recently-verified",
]);

export function parseHumanSurfaceExpansionHandle(handle: string, projectId: string): HumanSurfaceExpansionIntent {
  let parsed: URL;
  try {
    parsed = new URL(handle);
  } catch {
    throw new Error("Human Surface expansion handle is not a valid URL");
  }
  if (parsed.protocol !== "espalier-focus:") throw new Error("Human Surface expansion handle uses an unsupported protocol");
  if (decodeURIComponent(parsed.hostname) !== projectId) throw new Error("Human Surface expansion handle belongs to another project authority domain");
  const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const after = parsed.searchParams.get("after") ?? "";
  if (parts.length === 1 && parts[0] === "routes") return { kind: "routes", after };
  if (parts.length === 1 && parts[0] === "relations") {
    const bundle = parsed.searchParams.get("bundle");
    if (!bundle) throw new Error("Human Surface relation expansion handle is missing its bundle identity");
    return { kind: "relations", bundle, after };
  }
  const category = parts[1] as OperationalCategory | undefined;
  if (parts.length === 2 && parts[0] === "operational" && category && operationalCategories.has(category)) {
    return { kind: "operational", category, after };
  }
  throw new Error("Human Surface expansion handle has an unsupported projection path");
}

type HumanSurfaceBudgetFailure =
  | { code: "response-budget-too-small-for-mandatory-surface"; budget_bytes: number; required_bytes: number; expansion_ref: string }
  | { code: "visible-node-budget-too-small-for-focus"; visible_node_budget: number; required_node_count: number; focus_ref: string; required_refs: string[] };

export class HumanSurfaceBudgetError extends Error {
  readonly code: HumanSurfaceBudgetFailure["code"];
  readonly budget_bytes?: number;
  readonly required_bytes?: number;
  readonly expansion_ref?: string;
  readonly visible_node_budget?: number;
  readonly required_node_count?: number;
  readonly focus_ref?: string;
  readonly required_refs?: string[];

  constructor(failure: HumanSurfaceBudgetFailure) {
    super(failure.code === "response-budget-too-small-for-mandatory-surface"
      ? `Human Surface budget ${failure.budget_bytes} bytes is too small for the mandatory surface, which requires ${failure.required_bytes} bytes`
      : `Human Surface node budget ${failure.visible_node_budget} cannot retain Focus ${failure.focus_ref} and its ${failure.required_node_count} required nodes`);
    this.name = "HumanSurfaceBudgetError";
    this.code = failure.code;
    Object.assign(this, failure);
  }

  toJSON(): Record<string, unknown> {
    return Object.fromEntries(Object.entries({
      code: this.code,
      budget_bytes: this.budget_bytes,
      required_bytes: this.required_bytes,
      expansion_ref: this.expansion_ref,
      visible_node_budget: this.visible_node_budget,
      required_node_count: this.required_node_count,
      focus_ref: this.focus_ref,
      required_refs: this.required_refs,
    }).filter(([, value]) => value !== undefined));
  }
}

export interface AttentionSource {
  ref: string;
  category: string;
  title: string;
  detail: string;
  priority: number;
}

export function compileHumanSurface(
  core: EspalierCore,
  projectId: string,
  options: HumanSurfaceOptions,
  attentionFor: (entities: CanonicalEntity[]) => AttentionSource[],
): HumanSurfaceProjection {
  if (!options.actor || typeof options.actor.principal_id !== "string" || !Array.isArray(options.actor.capabilities)) throw new Error("Human Surface actor identity is malformed");
  const all = core.listEntities(projectId);
  const project = requireType(all, "project", projectId) as Project;
  const goal = requireType(all, "goal", project.current_goal_revision_id) as GoalRevision;
  const epoch = project.current_epoch_id ? requireType(all, "epoch", project.current_epoch_id) as Epoch : undefined;
  if (epoch && epoch.state !== "active") throw new Error(`Project current Epoch ${epoch.id} is not active`);
  const latestHistoricalEpoch = all.filter((entity): entity is Epoch & { state: "frozen" | "archived" } => entity.type === "epoch" && entity.state !== "active")
    .sort((left, right) => right.valid_from_revision - left.valid_from_revision || right.entity_version - left.entity_version || right.id.localeCompare(left.id))[0];
  const epochHeader: EpochHeaderProjection = epoch
    ? { state: "active", ref: entityRef(epoch), title: boundedText(epoch.title, 200), baseline_ref: boundedText(epoch.baseline_ref, 400) }
    : {
        state: "no-active-epoch",
        ...(latestHistoricalEpoch ? { latest_historical_ref: entityRef(latestHistoricalEpoch), latest_historical_state: latestHistoricalEpoch.state } : {}),
      };
  const revision = core.getProjectRevision(projectId);
  const generatedAt = core.currentTime();
  const mode = options.mode ?? "live";
  const density = options.density ?? "working";
  const expansionIntent = options.expansion_handle ? parseHumanSurfaceExpansionHandle(options.expansion_handle, projectId) : undefined;
  const densityDefaults = projectionDefaultsForDensity(density);
  const visibleNodeBudget = positiveBudget(options.visible_node_budget, densityDefaults.visible_node_budget);
  const collectionBudget = positiveBudget(options.collection_budget, Math.min(densityDefaults.collection_budget, visibleNodeBudget));
  const budgets = {
    visible_node_budget: visibleNodeBudget,
    relation_budget: positiveBudget(options.relation_budget, densityDefaults.relation_budget),
    collection_budget: collectionBudget,
    route_budget: Math.min(visibleNodeBudget, positiveBudget(options.route_budget, Math.min(densityDefaults.route_budget, visibleNodeBudget))),
    expanded_depth_budget: positiveBudget(options.expanded_depth_budget, densityDefaults.expanded_depth_budget),
    evidence_detail_budget: Math.min(visibleNodeBudget, positiveBudget(options.evidence_detail_budget, Math.min(densityDefaults.evidence_detail_budget, Math.max(1, Math.ceil(visibleNodeBudget / 4))))),
    historical_entity_budget: Math.min(visibleNodeBudget, positiveBudget(options.historical_entity_budget, Math.min(densityDefaults.historical_entity_budget, visibleNodeBudget))),
    layout_hint_budget: positiveBudget(options.layout_hint_budget, Math.max(densityDefaults.layout_hint_budget, visibleNodeBudget)),
    response_byte_budget: positiveBudget(options.response_byte_budget, densityDefaults.response_byte_budget),
  };
  const focusAnchor = options.focus_ref ? parseRef(options.focus_ref).revision : undefined;
  const since = normalizeSince(options.since_revision ?? focusAnchor, revision);
  const events = core.listEvents(projectId);
  const relationStartRevisions = firstEntityRevisionByRef(events, "relation");
  const allAttention = attentionFor(all);
  const currentAttention = allAttention.slice(0, collectionBudget);
  const fullDelta = meaningfulDelta(projectId, all, events, since, options.actor, allAttention, attentionFor);
  const delta = limitDelta(fullDelta, visibleNodeBudget * 2, budgets.expanded_depth_budget);
  const activeWork = all.filter((entity): entity is WorkItem => entity.type === "work" && (mode === "atlas" || Boolean(epoch && entity.epoch_id === epoch.id)));
  const operationalSummary = buildOperationalSummary(projectId, activeWork, all, allAttention, fullDelta, collectionBudget);
  const routeBuild = buildRoutes(projectId, goal, activeWork, all, currentAttention, delta, visibleNodeBudget, budgets.route_budget, collectionBudget, options.focus_ref, expansionIntent?.kind === "routes" ? expansionIntent.after : undefined);
  const expandedOperationalRefs = expansionIntent?.kind === "operational"
    ? operationalSummary.categories.find((category) => category.aggregate_kind === expansionIntent.category)?.sample_member_refs ?? []
    : [];
  const selection = selectVisibleRefs(projectId, all, activeWork, routeBuild, currentAttention, delta, options, budgets, expandedOperationalRefs);
  const selectedEntities = selection.entities;
  const visibleEntityRefs = new Set(selectedEntities.map((entity) => entityRef(entity)));
  const routes = finalizeRoutes(routeBuild.routes, visibleEntityRefs, visibleNodeBudget);
  const visibleRouteKeys = new Set(routes.map((route) => route.route_key));
  const focused = options.focus_ref ? parseRef(options.focus_ref) : undefined;
  const allRelations = all.filter((entity): entity is Relation => entity.type === "relation" && (
    mode === "atlas" || entity.authority_state !== "superseded" || delta.changed_refs.includes(entityRef(entity)) || (focused?.type === "relation" && focused.id === entity.id && focused.projectId === projectId)
  ));
  const densityEligibleRelations = allRelations.filter((relation) => density !== "overview" || relationPriority(relation, currentAttention, delta, all) <= 2);
  const relationCandidates = densityEligibleRelations.filter((relation) => {
    const localEndpoints = [relation.source_ref, relation.target_ref].filter((ref) => parseRef(ref).projectId === projectId);
    return localEndpoints.length > 0 && localEndpoints.every((ref) => visibleEntityRefs.has(ref));
  }).sort((left, right) => {
    const expansionRank = (relation: Relation) => expansionIntent?.kind === "relations" && relationBundleIdentity(projectId, relation, routeBuild.routeByMember).bundleKey === expansionIntent.bundle ? 0 : 1;
    return expansionRank(left) - expansionRank(right)
      || relationPriority(left, currentAttention, delta, all) - relationPriority(right, currentAttention, delta, all)
      || left.id.localeCompare(right.id);
  });
  const focusedRelationRef = focused?.type === "relation" && focused.projectId === projectId ? canonicalRef(projectId, "relation", focused.id) : undefined;
  const relations = takeWithMandatoryRef(relationCandidates, budgets.relation_budget, focusedRelationRef);
  const selectedRelationRefs = new Set(relations.map((relation) => entityRef(relation)));
  const relationBundles = buildRelationBundles(
    projectId,
    relationCandidates.filter((relation) => !selectedRelationRefs.has(entityRef(relation))),
    routeBuild.routeByMember,
    all,
    allAttention,
    fullDelta,
    collectionBudget,
  );
  const relationRefs = new Set(relations.map((relation) => entityRef(relation)));
  const focusedAnnotationRef = focused?.type === "annotation" && focused.projectId === projectId ? canonicalRef(projectId, "annotation", focused.id) : undefined;
  const allAnnotations = all.filter((entity): entity is Annotation => {
    if (entity.type !== "annotation") return false;
    const isFocused = entityRef(entity) === focusedAnnotationRef;
    if (!isFocused && mode !== "atlas" && entity.state === "resolved") return false;
    return visibleEntityRefs.has(entity.anchor_ref) || relationRefs.has(entity.anchor_ref);
  });
  const annotations = takeWithMandatoryRef(allAnnotations, collectionBudget, focusedAnnotationRef);
  const claims = all.filter((entity): entity is Claim => entity.type === "claim" && !entity.released_at && entity.mode === "primary");
  const claimsByTarget = new Map<string, Claim>();
  for (const entity of selectedEntities) {
    const claim = primaryClaimFor(entity, claims);
    if (claim) claimsByTarget.set(entityRef(entity), claim);
  }
  const returnedRefs = new Set([...visibleEntityRefs, ...relationRefs]);
  const attentionItems = currentAttention.filter((item) => attentionAnchors(item, all).every((ref) => {
    const parsed = parseRef(ref);
    return parsed.projectId !== projectId || returnedRefs.has(ref);
  }));
  const attentionByAnchor = new Map<string, string[]>();
  for (const item of attentionItems) for (const anchor of attentionAnchors(item, all)) {
    const refs = attentionByAnchor.get(anchor) ?? [];
    refs.push(item.ref);
    attentionByAnchor.set(anchor, refs);
  }
  let surfaceEntities = selectedEntities.map((entity) => surfaceEntity(
    entity,
    project,
    goal,
    options.actor,
    visibleRouteKeys.has(routeBuild.routeByMember.get(entityRef(entity)) ?? "") ? routeBuild.routeByMember.get(entityRef(entity)) : undefined,
    claimsByTarget.get(entityRef(entity)),
    attentionByAnchor.get(entityRef(entity)) ?? [],
    delta.change_reasons_by_ref[entityRef(entity)] ?? [],
    generatedAt,
  ));
  let surfaceRelations = relations.map((relation) => surfaceRelation(
    relation,
    project,
    options.actor,
    revision,
    relationStartRevisions.get(entityRef(relation)) ?? relation.valid_from_revision,
    annotations.filter((annotation) => annotation.anchor_ref === entityRef(relation)).map((annotation) => entityRef(annotation)),
    attentionItems.some((item) => attentionAnchors(item, all).includes(entityRef(relation))),
    delta.change_reasons_by_ref[entityRef(relation)] ?? [],
    mode,
  ));
  let surfaceAnnotations = annotations.map((annotation) => ({
    ref: entityRef(annotation),
    anchor_ref: annotation.anchor_ref,
    anchor_revision: annotation.anchor_revision,
    kind: annotation.kind,
    state: annotation.state,
    body: boundedText(annotation.body ?? "", 800),
    change_reasons: delta.change_reasons_by_ref[entityRef(annotation)] ?? [],
    capabilities: capabilitiesFor(annotation, project, options.actor),
  } satisfies SurfaceAnnotation));
  let attention = attentionItems.map((item) => {
    const presentation = attentionPresentation(item, all, project, options.actor);
    return presentation;
  });
  const previewTargets: CanonicalEntity[] = [
    ...selectedEntities,
    ...relations,
    ...annotations,
    ...uniqueByRef([...claimsByTarget.values()]),
  ];
  const commandPreviews = buildCommandPreviews(core, project, options.actor, revision, previewTargets, options.stale_state ?? null, Math.min(6, collectionBudget));
  const previewCapabilities = capabilitiesFromPreviews(commandPreviews);
  const mergeCapabilities = (ref: string, capabilities: SurfaceCapability[]) => gateCapabilities([...capabilities, ...(previewCapabilities.get(ref) ?? [])], Boolean(options.stale_state));
  surfaceEntities = surfaceEntities.map((entity) => ({ ...entity, capabilities: mergeCapabilities(entity.ref, entity.capabilities) }));
  surfaceRelations = surfaceRelations.map((relation) => ({ ...relation, capabilities: mergeCapabilities(relation.ref, relation.capabilities) }));
  surfaceAnnotations = surfaceAnnotations.map((annotation) => ({ ...annotation, capabilities: mergeCapabilities(annotation.ref, annotation.capabilities) }));
  attention = attention.map((item) => ({ ...item, capabilities: mergeCapabilities(item.attention_ref, item.capabilities) }));
  const allLayoutHints = layoutHintsFor(routes, surfaceEntities, surfaceRelations);
  const layoutHints = allLayoutHints.slice(0, budgets.layout_hint_budget);
  const collapseGroups = routes.map((route) => ({ group_key: `group:${route.route_key}`, route_key: route.route_key, title: route.title, branch_role: route.branch_role, member_refs: route.member_refs, default_expansion: route.default_expansion, summary: route.summary } satisfies CollapseGroupProjection));
  const projectionIdentity = stableHash({
    project_id: projectId,
    revision,
    mode,
    density,
    since,
    focus_ref: options.focus_ref ?? null,
    expansion_handle: options.expansion_handle ?? null,
    actor: { principal_id: options.actor.principal_id, role: options.actor.role, capabilities: [...options.actor.capabilities].sort() },
    budgets,
    stale_state: options.stale_state ?? null,
    lease_state: claims.map((claim) => ({ ref: entityRef(claim), lease_until: claim.lease_until, effective_state: instantIsAfter(claim.lease_until, generatedAt) ? "active" : "stale" })).sort((left, right) => left.ref.localeCompare(right.ref)),
  });
  const projection: HumanSurfaceProjection = {
    schema_version: "espalier.human-surface@0",
    project_id: projectId,
    as_of_revision: revision,
    projection_revision: `${projectId}@${revision}:${projectionIdentity}`,
    generated_at: generatedAt,
    mode,
    density,
    goal_header: { ref: entityRef(goal), purpose: boundedText(goal.purpose, 600), revision_number: goal.revision_number, approval: goal.approval, binding_constraints: goal.binding_constraints.slice(0, collectionBudget).map((item) => boundedText(item, 400)) },
    epoch: epochHeader,
    routes,
    route_overflow: routeBuild.routeOverflow,
    entities: surfaceEntities,
    relations: surfaceRelations,
    annotations: surfaceAnnotations,
    attention,
    delta,
    operational_summary: operationalSummary,
    relation_bundles: relationBundles,
    collapse_groups: collapseGroups,
    layout_hints: layoutHints,
    capabilities: [
      { action: "change-view", allowed: true },
      { action: "mark-seen", allowed: options.actor.capabilities.includes("read") },
      { action: "annotate", allowed: !options.stale_state && options.actor.capabilities.includes("write"), input_requirements: ["target_ref", "kind", "body"], ...(options.stale_state ? { reason: "Commands are disabled while the projection is stale or disconnected" } : !options.actor.capabilities.includes("write") ? { reason: "Actor lacks write capability" } : {}) },
    ],
    command_previews: commandPreviews,
    command_state_contract: {
      optimistic_state_is_canonical: false,
      accepted_receipt_required: true,
      stale_conflict_fields: ["current_project_revision", "stale_entity", "intervening_delta", "recovery"],
    },
    stale_state: options.stale_state ?? null,
    omitted_counts: {
      entities: Math.max(0, selection.eligibleCount - selectedEntities.length),
      relations: Math.max(0, relationCandidates.length - relations.length),
      referential_relations: Math.max(0, densityEligibleRelations.length - relationCandidates.length),
      relation_density: Math.max(0, allRelations.length - densityEligibleRelations.length),
      relation_bundles: 0,
      annotations: Math.max(0, all.filter((entity) => entity.type === "annotation").length - annotations.length),
      attention: Math.max(0, allAttention.length - attention.length),
      delta: Math.max(0, Object.keys(fullDelta.change_reasons_by_ref).length - delta.changed_refs.length),
      history: mode === "atlas" ? 0 : all.filter((entity) => entity.valid_to_revision !== undefined || (entity.type === "work" && entity.work_state === "closed")).length,
      routes: routeBuild.omittedRootCount,
      collapse_groups: routeBuild.omittedRootCount,
      layout_hints: Math.max(0, allLayoutHints.length - layoutHints.length),
      evidence_detail: selection.evidenceOmitted,
    },
    diagnostics: { canonical_route_objects: 0, geometry_fields: 0, source_entity_count: all.length, response_bytes: 0, budgets },
  };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const responseBytes = Buffer.byteLength(JSON.stringify(projection), "utf8");
    if (projection.diagnostics.response_bytes === responseBytes) break;
    projection.diagnostics.response_bytes = responseBytes;
  }
  degradeProjectionToBudget(projection, budgets.response_byte_budget);
  if (projection.diagnostics.response_bytes > budgets.response_byte_budget) {
    throw new HumanSurfaceBudgetError({ code: "response-budget-too-small-for-mandatory-surface", budget_bytes: budgets.response_byte_budget, required_bytes: projection.diagnostics.response_bytes, expansion_ref: projection.goal_header.ref });
  }
  return projection;
}

export function createPersonalViewState(projection: HumanSurfaceProjection, principalId: string, deviceOrSavedView: string): PersonalViewState {
  return {
    project_id: projection.project_id,
    principal_id: principalId,
    device_or_saved_view: deviceOrSavedView,
    based_on_projection_revision: projection.projection_revision,
    camera: null,
    node_positions: {},
    pinned_refs: [],
    collapsed_entity_refs: [],
    collapsed_route_keys: projection.routes.filter((route) => route.default_expansion === "collapsed").map((route) => route.route_key),
    route_palette_slots: Object.fromEntries(projection.routes.flatMap((route) => route.default_family_slot ? [[route.route_key, route.default_family_slot]] : [])),
    density: "working",
    theme_id: "paper-neutral",
  };
}

function buildRoutes(
  projectId: string,
  goal: GoalRevision,
  work: WorkItem[],
  allEntities: CanonicalEntity[],
  attention: AttentionSource[],
  delta: MeaningfulDeltaProjection,
  memberRefBudget: number,
  routeBudget: number,
  collectionBudget: number,
  focusRef?: string,
  expansionRootId?: string,
) {
  const byId = new Map(work.map((item) => [item.id, item]));
  const rootFor = (item: WorkItem): WorkItem => {
    let current = item;
    const seen = new Set<string>();
    while (current.parent_id && byId.has(current.parent_id) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.parent_id)!;
    }
    return current;
  };
  const members = new Map<string, WorkItem[]>();
  for (const item of work) {
    const root = rootFor(item);
    const group = members.get(root.id) ?? [];
    group.push(item);
    members.set(root.id, group);
  }
  const normalizedProgramme = goal.programme_order.map(normalizeLabel);
  const roots = [...members].map(([rootId, items]) => ({ root: byId.get(rootId)!, items })).sort((left, right) => {
    const leftIndex = programmeIndex(left.root, normalizedProgramme);
    const rightIndex = programmeIndex(right.root, normalizedProgramme);
    return (leftIndex ?? Number.MAX_SAFE_INTEGER) - (rightIndex ?? Number.MAX_SAFE_INTEGER) || left.root.priority - right.root.priority || left.root.id.localeCompare(right.root.id);
  });
  const routeByMember = new Map<string, string>();
  for (const { root, items } of roots) for (const item of items) routeByMember.set(entityRef(item), `route:${projectId}:${root.id}`);
  const focusedWork = focusRef ? parseRef(focusRef) : undefined;
  const focusedRootId = focusedWork?.projectId === projectId && focusedWork.type === "work" && byId.has(focusedWork.id) ? rootFor(byId.get(focusedWork.id)!).id : undefined;
  const rankedRoots = roots.map((candidate, index) => {
    const memberRefs = candidate.items.map((item) => entityRef(item));
    const attentionCount = attention.filter((item) => attentionAnchors(item, allEntities).some((ref) => memberRefs.includes(ref))).length;
    const changedCount = memberRefs.filter((ref) => delta.changed_refs.includes(ref)).length;
    const programmeOrderIndex = programmeIndex(candidate.root, normalizedProgramme);
    const rank = candidate.root.id === focusedRootId ? -2 : candidate.root.id === expansionRootId ? -1 : attentionCount > 0 ? 1 : changedCount > 0 ? 2 : programmeOrderIndex !== undefined ? 3 : candidate.root.work_state === "active" ? 4 : 5;
    return { ...candidate, index, rank };
  });
  const overflowing = rankedRoots.length > routeBudget;
  const focusOnlyRoute = overflowing && routeBudget === 1 && focusedRootId !== undefined;
  const actualRouteBudget = overflowing ? focusOnlyRoute ? 1 : Math.max(0, routeBudget - 1) : routeBudget;
  const selectedRootIds = new Set([...rankedRoots].sort((left, right) => left.rank - right.rank || left.index - right.index).slice(0, actualRouteBudget).map((item) => item.root.id));
  const selectedRoots = rankedRoots.filter((item) => selectedRootIds.has(item.root.id));
  const omittedRoots = rankedRoots.filter((item) => !selectedRootIds.has(item.root.id));
  const routes = selectedRoots.map(({ root, items, index }): RouteProjection => {
    const routeKey = `route:${projectId}:${root.id}`;
    const allMemberRefs = items.map((item) => entityRef(item)).sort();
    const role = branchRole(root, normalizedProgramme);
    const changedCount = allMemberRefs.filter((ref) => delta.changed_refs.includes(ref)).length;
    const attentionCount = attention.filter((item) => attentionAnchors(item, allEntities).some((ref) => allMemberRefs.includes(ref))).length;
    const summary: CollapseSummary = {
      member_count: items.length,
      active_count: items.filter((item) => item.work_state === "active" || item.work_state === "blocked").length,
      changed_count: changedCount,
      blocked_count: items.filter((item) => item.work_state === "blocked").length,
      owner_question_count: attentionCount,
      verified_count: items.filter((item) => item.evidence_state === "verified").length,
    };
    const expansionReasons = [
      ...(changedCount > 0 ? [`${changedCount} meaningful change${changedCount === 1 ? "" : "s"}`] : []),
      ...(attentionCount > 0 ? [`${attentionCount} attention item${attentionCount === 1 ? "" : "s"}`] : []),
    ];
    const programmeOrderIndex = programmeIndex(root, normalizedProgramme);
    return {
      route_key: routeKey,
      title: boundedText(root.title, 180),
      basis_refs: [entityRef(goal), entityRef(root)],
      root_refs: [entityRef(root)],
      member_refs: allMemberRefs.slice(0, memberRefBudget),
      ...(programmeOrderIndex !== undefined ? { programme_order_index: programmeOrderIndex } : {}),
      branch_role: role,
      default_family_slot: stableFamilySlot(routeKey),
      summary,
      default_expansion: expansionReasons.length > 0 ? "expanded" : role === "historical" || role === "deferred" ? "collapsed" : role === "owner-pending" || role === "research-only" ? "peek" : "expanded",
      expansion_reasons: expansionReasons,
    };
  });
  const overflowExpansionHandle = `espalier-focus://${projectId}/routes?after=${encodeURIComponent(omittedRoots[0]?.root.id ?? "")}`;
  if (overflowing && !focusOnlyRoute) {
    const omittedItems = omittedRoots.flatMap((item) => item.items);
    const aggregateKey = `route:${projectId}:omitted`;
    routes.push({
      route_key: aggregateKey,
      title: `${omittedRoots.length} more routes`,
      basis_refs: [entityRef(goal), ...(omittedRoots[0] ? [entityRef(omittedRoots[0].root)] : [])],
      root_refs: [],
      member_refs: [],
      branch_role: "deferred",
      default_family_slot: stableFamilySlot(aggregateKey),
      summary: {
        member_count: omittedItems.length,
        active_count: omittedItems.filter((item) => item.work_state === "active" || item.work_state === "blocked").length,
        changed_count: omittedItems.filter((item) => delta.changed_refs.includes(entityRef(item))).length,
        blocked_count: omittedItems.filter((item) => item.work_state === "blocked").length,
        owner_question_count: attention.filter((item) => attentionAnchors(item, allEntities).some((ref) => omittedItems.some((workItem) => entityRef(workItem) === ref))).length,
        verified_count: omittedItems.filter((item) => item.evidence_state === "verified").length,
      },
      default_expansion: "collapsed",
      expansion_reasons: ["route budget exceeded; use Focus expansion"],
      aggregate: true,
      omitted_root_count: omittedRoots.length,
      omitted_root_refs: omittedRoots.slice(0, collectionBudget).map((item) => entityRef(item.root)),
      expansion_handle: overflowExpansionHandle,
    });
  }
  const routeOverflow: RouteOverflowProjection | null = focusOnlyRoute ? {
    omitted_root_count: omittedRoots.length,
    omitted_root_refs: omittedRoots.slice(0, collectionBudget).map((item) => entityRef(item.root)),
    expansion_handle: overflowExpansionHandle,
  } : null;
  return { routes, routeByMember, selectedRootRefs: selectedRoots.map((item) => entityRef(item.root)), omittedRootCount: omittedRoots.length, totalRootCount: rankedRoots.length, routeOverflow };
}

function finalizeRoutes(routes: RouteProjection[], visibleRefs: Set<string>, memberRefBudget: number): RouteProjection[] {
  return routes.flatMap((route): RouteProjection[] => {
    if (route.aggregate) return [route];
    if (!route.root_refs.every((ref) => visibleRefs.has(ref))) return [];
    return [{
      ...route,
      root_refs: route.root_refs.filter((ref) => visibleRefs.has(ref)),
      member_refs: route.member_refs.filter((ref) => visibleRefs.has(ref)).slice(0, memberRefBudget),
    }];
  });
}

function projectionDefaultsForDensity(density: HumanSurfaceDensity): Required<Pick<HumanSurfaceOptions, "visible_node_budget" | "relation_budget" | "collection_budget" | "route_budget" | "expanded_depth_budget" | "evidence_detail_budget" | "historical_entity_budget" | "layout_hint_budget" | "response_byte_budget">> {
  if (density === "overview") return {
    visible_node_budget: 40,
    relation_budget: 24,
    collection_budget: 24,
    route_budget: 18,
    expanded_depth_budget: 4,
    evidence_detail_budget: 4,
    historical_entity_budget: 12,
    layout_hint_budget: 100,
    response_byte_budget: 393_216,
  };
  if (density === "detail") return {
    visible_node_budget: 120,
    relation_budget: 200,
    collection_budget: 60,
    route_budget: 60,
    expanded_depth_budget: 12,
    evidence_detail_budget: 24,
    historical_entity_budget: 48,
    layout_hint_budget: 240,
    response_byte_budget: 786_432,
  };
  return {
    visible_node_budget: 80,
    relation_budget: 120,
    collection_budget: 40,
    route_budget: 40,
    expanded_depth_budget: 8,
    evidence_detail_budget: 12,
    historical_entity_budget: 24,
    layout_hint_budget: 160,
    response_byte_budget: 524_288,
  };
}

function buildOperationalSummary(
  projectId: string,
  work: WorkItem[],
  all: CanonicalEntity[],
  attention: AttentionSource[],
  delta: MeaningfulDeltaProjection,
  sampleBudget: number,
): OperationalSummaryProjection {
  const activeWorkIds = new Set(work.filter((item) => item.work_state === "active" || item.work_state === "blocked").map((item) => item.id));
  const activeFrontiers = work.filter((item) => activeWorkIds.has(item.id) && !work.some((candidate) => candidate.parent_id === item.id && activeWorkIds.has(candidate.id))).map((item) => entityRef(item));
  const blockers = work.filter((item) => item.work_state === "blocked").map((item) => entityRef(item));
  const ownerAttention = attention.filter((item) => item.priority === 1).flatMap((item) => attentionAnchors(item, all));
  const claimPressure = all.filter((entity): entity is Claim => entity.type === "claim" && !entity.released_at && entity.mode === "primary")
    .map((claim) => claim.target_ref);
  const integrationWaiting = all.flatMap((entity): string[] => {
    if (entity.type === "work" && entity.integration_state === "needs-integration") return [entityRef(entity)];
    if (entity.type === "batch" && entity.integration_state !== "integrated") return [entityRef(entity), entity.parent_work_item_ref];
    if (entity.type === "lane" && entity.integration_state !== "integrated") return [entityRef(entity), entity.batch_ref];
    return [];
  });
  const recentlyVerified = delta.changed_refs.filter((ref) => delta.change_reasons_by_ref[ref]?.includes("evidence-threshold-crossed"));
  const categories: Array<{ key: OperationalCategory; title: string; refs: string[] }> = [
    { key: "active-frontiers", title: "Active frontiers", refs: activeFrontiers },
    { key: "blockers", title: "Blockers", refs: blockers },
    { key: "owner-attention", title: "Owner attention", refs: ownerAttention },
    { key: "claim-pressure", title: "Claim pressure", refs: claimPressure },
    { key: "integration-waiting", title: "Integration waiting", refs: integrationWaiting },
    { key: "meaningful-delta", title: "Meaningful delta", refs: delta.changed_refs },
    { key: "recently-verified", title: "Recently verified", refs: recentlyVerified },
  ];
  const entityByRef = new Map(all.map((entity) => [entityRef(entity), entity]));
  const attentionAnchoredRefs = new Set(attention.flatMap((item) => attentionAnchors(item, all)));
  const changedRefs = new Set(delta.changed_refs);
  const boundedSampleBudget = Math.max(1, sampleBudget);
  return {
    selection_policy: "mandatory-operational-state-then-ranked-context",
    categories: categories.map(({ key, title, refs }): AggregatePresentation => {
      const members = unique(refs).sort();
      const stateCounts: Record<string, number> = {};
      for (const ref of members) {
        const entity = entityByRef.get(ref);
        const state = entity ? primaryState(entity) : "referenced";
        stateCounts[state] = (stateCounts[state] ?? 0) + 1;
      }
      const sampleMemberRefs = members.slice(0, boundedSampleBudget);
      return {
        aggregate_key: `aggregate:${projectId}:${key}`,
        aggregate_kind: key,
        title,
        member_count: members.length,
        sample_member_refs: sampleMemberRefs,
        omitted_member_count: Math.max(0, members.length - sampleMemberRefs.length),
        state_counts: stateCounts,
        attention_count: members.filter((ref) => attentionAnchoredRefs.has(ref)).length,
        recent_change_count: members.filter((ref) => changedRefs.has(ref)).length,
        summary_facts: members.length === 0 ? ["No current members"] : [`${members.length} current member${members.length === 1 ? "" : "s"}`],
        expansion_handle: `espalier-focus://${projectId}/operational/${key}?after=${encodeURIComponent(sampleMemberRefs.at(-1) ?? "")}`,
      };
    }),
  };
}

function buildRelationBundles(
  projectId: string,
  omittedRelations: Relation[],
  routeByMember: Map<string, string>,
  all: CanonicalEntity[],
  attention: AttentionSource[],
  delta: MeaningfulDeltaProjection,
  collectionBudget: number,
): RelationBundleProjection[] {
  const regionFor = (ref: string) => {
    const parsed = parseRef(ref);
    if (parsed.projectId !== projectId) return `external:${parsed.projectId}`;
    return routeByMember.get(ref) ?? `unrouted:${parsed.type}`;
  };
  const attentionRefs = new Set(attention.flatMap((item) => attentionAnchors(item, all)));
  const changedRefs = new Set(delta.changed_refs);
  const groups = new Map<string, { relationType: string; sourceRegion: string; targetRegion: string; relations: Relation[] }>();
  for (const relation of omittedRelations) {
    const { sourceRegion, targetRegion } = relationBundleIdentity(projectId, relation, routeByMember);
    const groupIdentity = stableJson({ relation_type: relation.relation_type, source_region: sourceRegion, target_region: targetRegion });
    const group = groups.get(groupIdentity) ?? { relationType: relation.relation_type, sourceRegion, targetRegion, relations: [] };
    group.relations.push(relation);
    groups.set(groupIdentity, group);
  }
  const sampleBudget = Math.max(1, Math.min(8, collectionBudget));
  const projectBundle = (relationType: string, sourceRegion: string, targetRegion: string, relations: Relation[], keySuffix?: string): RelationBundleProjection => {
    const memberRefs = relations.map((relation) => entityRef(relation)).sort();
    const sampleRelationRefs = memberRefs.slice(0, sampleBudget);
    const bundleKey = `relation-bundle:${projectId}:${keySuffix ?? stableHash({ relationType, sourceRegion, targetRegion })}`;
    return {
      bundle_key: bundleKey,
      relation_type: relationType,
      source_region_key: sourceRegion,
      target_region_key: targetRegion,
      member_count: memberRefs.length,
      sample_relation_refs: sampleRelationRefs,
      omitted_member_count: Math.max(0, memberRefs.length - sampleRelationRefs.length),
      attention_count: memberRefs.filter((ref) => attentionRefs.has(ref)).length,
      recent_change_count: memberRefs.filter((ref) => changedRefs.has(ref)).length,
      expansion_handle: `espalier-focus://${projectId}/relations?bundle=${encodeURIComponent(bundleKey)}&after=${encodeURIComponent(sampleRelationRefs.at(-1) ?? "")}`,
    };
  };
  const projected = [...groups.values()]
    .map((group) => projectBundle(group.relationType, group.sourceRegion, group.targetRegion, group.relations))
    .sort((left, right) => left.bundle_key.localeCompare(right.bundle_key));
  if (projected.length <= collectionBudget) return projected;
  const retained = projected.slice(0, Math.max(0, collectionBudget - 1));
  const retainedKeys = new Set(retained.map((bundle) => bundle.bundle_key));
  const overflowRelations = [...groups.values()]
    .flatMap((group) => group.relations)
    .filter((relation) => !retainedKeys.has(`relation-bundle:${projectId}:${stableHash({ relationType: relation.relation_type, sourceRegion: regionFor(relation.source_ref), targetRegion: regionFor(relation.target_ref) })}`));
  return [...retained, projectBundle("mixed", "multiple", "multiple", overflowRelations, "overflow")];
}

function relationBundleIdentity(projectId: string, relation: Relation, routeByMember: Map<string, string>): { bundleKey: string; sourceRegion: string; targetRegion: string } {
  const regionFor = (ref: string) => {
    const parsed = parseRef(ref);
    if (parsed.projectId !== projectId) return `external:${parsed.projectId}`;
    return routeByMember.get(ref) ?? `unrouted:${parsed.type}`;
  };
  const sourceRegion = regionFor(relation.source_ref);
  const targetRegion = regionFor(relation.target_ref);
  return {
    bundleKey: `relation-bundle:${projectId}:${stableHash({ relationType: relation.relation_type, sourceRegion, targetRegion })}`,
    sourceRegion,
    targetRegion,
  };
}

function relationPriority(relation: Relation, attention: AttentionSource[], delta: MeaningfulDeltaProjection, all: CanonicalEntity[]): number {
  const ref = entityRef(relation);
  if (attention.some((item) => attentionAnchors(item, all).includes(ref))) return 0;
  if (delta.changed_refs.includes(ref)) return 1;
  if (["blocks", "depends_on", "provides_capability_to"].includes(relation.relation_type)) return 2;
  return 3;
}

function meaningfulDelta(
  projectId: string,
  current: CanonicalEntity[],
  events: StoredEvent[],
  since: number | null,
  actor: ActorIdentity,
  currentAttention: AttentionSource[],
  attentionFor: (entities: CanonicalEntity[]) => AttentionSource[],
): MeaningfulDeltaProjection {
  if (since === null) return { since_revision: null, changed_refs: [], change_reasons_by_ref: {}, ancestor_paths_to_open: [], attention_created: [], attention_resolved: [], mark_seen_capability: { action: "mark-seen", allowed: actor.capabilities.includes("read") } };
  const before = snapshotAt(events, since);
  const changes: Record<string, ChangeReason[]> = {};
  for (const entity of current) {
    const ref = entityRef(entity);
    const prior = before.get(`${entity.type}:${entity.id}`);
    const reasons = changeReasons(entity, prior);
    if (reasons.length > 0 && entity.valid_from_revision > since) changes[ref] = reasons;
  }
  const previousAttention = attentionFor([...before.values()]);
  const previousRefs = new Set(previousAttention.map((item) => item.ref));
  const currentRefs = new Set(currentAttention.map((item) => item.ref));
  const attentionCreated = [...currentRefs].filter((ref) => !previousRefs.has(ref)).sort();
  const attentionResolved = [...previousRefs].filter((ref) => !currentRefs.has(ref)).sort();
  for (const ref of attentionCreated) changes[ref] = unique([...(changes[ref] ?? []), "attention-created"]);
  for (const ref of attentionResolved) changes[ref] = unique([...(changes[ref] ?? []), "attention-resolved"]);
  const changedRefs = Object.keys(changes).sort();
  return {
    since_revision: since,
    changed_refs: changedRefs,
    change_reasons_by_ref: changes,
    ancestor_paths_to_open: ancestorPaths(projectId, current, changedRefs),
    attention_created: attentionCreated,
    attention_resolved: attentionResolved,
    mark_seen_capability: { action: "mark-seen", allowed: actor.capabilities.includes("read") },
  };
}

function limitDelta(delta: MeaningfulDeltaProjection, limit: number, expandedDepthBudget: number): MeaningfulDeltaProjection {
  const orderedRefs = [...delta.changed_refs].sort((left, right) => deltaPriority(delta.change_reasons_by_ref[left] ?? []) - deltaPriority(delta.change_reasons_by_ref[right] ?? []) || left.localeCompare(right));
  const changedRefs = orderedRefs.slice(0, limit);
  const selected = new Set(changedRefs);
  return {
    ...delta,
    changed_refs: changedRefs,
    change_reasons_by_ref: Object.fromEntries(changedRefs.map((ref) => [ref, delta.change_reasons_by_ref[ref] ?? []])),
    ancestor_paths_to_open: delta.ancestor_paths_to_open.filter((path) => path.some((ref) => selected.has(ref))).slice(0, limit).map((path) => path.slice(-expandedDepthBudget)),
    attention_created: delta.attention_created.filter((ref) => selected.has(ref)),
    attention_resolved: delta.attention_resolved.filter((ref) => selected.has(ref)),
  };
}

function deltaPriority(reasons: ChangeReason[]): number {
  const priority: ChangeReason[] = ["claim-conflict", "owner-decision", "attention-created", "authority-changed", "goal-integrity-changed", "relation-materially-changed", "verification-reopened", "evidence-threshold-crossed", "work-state-changed", "integration-changed", "annotation-stale", "annotation-created", "attention-resolved", "claim-stale", "created"];
  return Math.min(...reasons.map((reason) => priority.indexOf(reason)).filter((index) => index >= 0), priority.length);
}

function changeReasons(entity: CanonicalEntity, prior: CanonicalEntity | undefined): ChangeReason[] {
  if (!prior) {
    if (entity.type === "annotation") return ["annotation-created"];
    if (["work", "relation", "decision", "goal", "epoch", "batch", "lane"].includes(entity.type)) return ["created"];
    return [];
  }
  const reasons: ChangeReason[] = [];
  if (entity.type === "work" && prior.type === "work") {
    if (entity.work_state !== prior.work_state) reasons.push("work-state-changed");
    if (entity.evidence_state !== prior.evidence_state && evidenceRank(entity.evidence_state) > evidenceRank(prior.evidence_state)) reasons.push("evidence-threshold-crossed");
    if (entity.evidence_state !== prior.evidence_state && evidenceRank(entity.evidence_state) < evidenceRank(prior.evidence_state)) reasons.push("verification-reopened");
    if (entity.authority_state !== prior.authority_state) reasons.push("authority-changed");
    if (entity.goal_integrity !== prior.goal_integrity) reasons.push("goal-integrity-changed");
    if (entity.integration_state !== prior.integration_state) reasons.push("integration-changed");
  }
  if (entity.type === "batch" && prior.type === "batch" && entity.integration_state !== prior.integration_state) reasons.push("integration-changed");
  if (entity.type === "lane" && prior.type === "lane" && entity.integration_state !== prior.integration_state) reasons.push("integration-changed");
  if (entity.type === "relation" && prior.type === "relation" && [entity.source_ref, entity.target_ref, entity.relation_type, entity.authority_state, entity.valid_to_revision].some((value, index) => value !== [prior.source_ref, prior.target_ref, prior.relation_type, prior.authority_state, prior.valid_to_revision][index])) reasons.push("relation-materially-changed");
  if (entity.type === "annotation" && prior.type === "annotation" && entity.state === "stale" && prior.state !== "stale") reasons.push("annotation-stale");
  if (entity.type === "decision" && prior.type === "decision" && entity.decision_state !== prior.decision_state) reasons.push("owner-decision");
  if (entity.type === "goal" && prior.type === "goal" && entity.approval !== prior.approval) reasons.push("owner-decision");
  return unique(reasons);
}

function selectVisibleRefs(
  projectId: string,
  all: CanonicalEntity[],
  work: WorkItem[],
  routeBuild: ReturnType<typeof buildRoutes>,
  attention: AttentionSource[],
  delta: MeaningfulDeltaProjection,
  options: HumanSurfaceOptions,
  budgets: HumanSurfaceProjection["diagnostics"]["budgets"],
  expandedOperationalRefs: string[] = [],
): { entities: CanonicalEntity[]; eligibleCount: number; evidenceOmitted: number } {
  const byRef = new Map(all.map((entity) => [entityRef(entity), entity]));
  const candidates = new Map<string, number>();
  const requiredFocusRefs = new Set<string>();
  let requiredFocusedEvidenceRef: string | undefined;
  let canonicalFocusRef: string | undefined;
  const mode = options.mode ?? "live";
  const addRef = (ref: string, priority: number) => {
    const entity = byRef.get(ref);
    if (!entity || entity.type === "relation" || entity.type === "annotation" || entity.type === "evidence") return;
    candidates.set(ref, Math.min(candidates.get(ref) ?? Number.MAX_SAFE_INTEGER, priority));
  };
  const add = (entity: CanonicalEntity | undefined, priority: number) => { if (entity) addRef(entityRef(entity), priority); };
  for (const rootRef of routeBuild.selectedRootRefs) addRef(rootRef, 1);
  for (const ref of expandedOperationalRefs) addRef(ref, 1);
  if (mode === "attention") {
    for (const item of attention) for (const anchor of attentionAnchors(item, all)) addRef(anchor, 0);
  } else if (mode === "focus" && options.focus_ref) {
    const focus = parseRef(options.focus_ref);
    if (focus.projectId !== projectId) throw new Error("Focus ref belongs to another project authority domain");
    const focusEntity = all.find((entity) => entity.type === focus.type && entity.id === focus.id);
    if (!focusEntity) throw new Error(`Missing focus object ${options.focus_ref}`);
    const focusRef = entityRef(focusEntity);
    canonicalFocusRef = focusRef;
    const requireRef = (ref: string) => {
      const entity = byRef.get(ref);
      if (!entity || entity.type === "relation" || entity.type === "annotation" || entity.type === "evidence") return;
      requiredFocusRefs.add(ref);
      addRef(ref, 0);
    };
    if (focusEntity.type === "relation") {
      for (const endpoint of [focusEntity.source_ref, focusEntity.target_ref]) if (parseRef(endpoint).projectId === projectId) requireRef(endpoint);
    } else if (focusEntity.type === "annotation") {
      requireRef(focusEntity.anchor_ref);
    } else if (focusEntity.type === "evidence") {
      requiredFocusedEvidenceRef = focusRef;
      for (const target of focusEntity.target_refs) if (parseRef(target).projectId === projectId) requireRef(target);
    } else if (focusEntity.type === "claim") {
      requireRef(focusRef);
      requireRef(focusEntity.target_ref);
    } else if (focusEntity.type === "work") {
      let cursor: WorkItem | undefined = focusEntity;
      while (cursor) {
        requireRef(entityRef(cursor));
        cursor = cursor.parent_id ? work.find((candidate) => candidate.id === cursor!.parent_id) : undefined;
      }
    } else {
      requireRef(focusRef);
    }
    for (const relation of all) if (relation.type === "relation" && (relation.source_ref === focusRef || relation.target_ref === focusRef)) {
      const other = relation.source_ref === focusRef ? relation.target_ref : relation.source_ref;
      if (parseRef(other).projectId === projectId) addRef(other, 3);
    }
  } else if (mode === "atlas") {
    for (const entity of all) if (entity.type !== "relation" && entity.type !== "annotation" && entity.type !== "evidence") add(entity, entity.valid_to_revision !== undefined ? 8 : 5);
  } else {
    for (const item of work) if (item.work_state !== "closed" || item.evidence_state === "verified") add(item, item.work_state === "blocked" ? 2 : item.work_state === "active" ? 4 : 5);
  }
  for (const entity of all) {
    if (entity.type === "decision" && entity.decision_state === "proposed") add(entity, 2);
    if (entity.type === "batch" && entity.integration_state !== "integrated") add(entity, 3);
    if (entity.type === "lane" && entity.integration_state !== "integrated") add(entity, 3);
  }
  const evidenceByRef = new Map(all.filter((entity) => entity.type === "evidence").map((entity) => [entityRef(entity), entity]));
  for (const entity of all) if (entity.type === "hypothesis" && entity.evidence_refs.some((evidenceRef) => evidenceByRef.get(evidenceRef)?.target_refs.some((targetRef) => candidates.has(targetRef)))) add(entity, 4);
  for (const path of delta.ancestor_paths_to_open) for (const ref of path) addRef(ref, 2);
  for (const ref of delta.changed_refs) addRef(ref, 2);
  for (const ref of [...candidates.keys()]) {
    const parsed = parseRef(ref);
    if (parsed.projectId !== projectId || parsed.type !== "lane") continue;
    const lane = byRef.get(ref);
    if (lane?.type !== "lane") continue;
    addRef(lane.batch_ref, 2);
    const batchRef = parseRef(lane.batch_ref);
    const batch = all.find((entity) => entity.type === "batch" && entity.id === batchRef.id);
    if (batch?.type === "batch") addRef(batch.parent_work_item_ref, 2);
  }
  const byId = new Map(work.map((item) => [item.id, item]));
  for (const ref of requiredFocusRefs) {
    const parsed = parseRef(ref);
    if (parsed.projectId !== projectId || parsed.type !== "work") continue;
    let item = byId.get(parsed.id);
    while (item?.parent_id && byId.has(item.parent_id)) {
      item = byId.get(item.parent_id);
      requiredFocusRefs.add(entityRef(item!));
      add(item, 0);
    }
  }
  for (const ref of [...candidates.keys()]) {
    const parsed = parseRef(ref);
    if (parsed.projectId !== projectId || parsed.type !== "work") continue;
    let item = byId.get(parsed.id);
    while (item?.parent_id && byId.has(item.parent_id)) { item = byId.get(item.parent_id); add(item, 1); }
  }
  const evidence = all.filter((entity): entity is Extract<CanonicalEntity, { type: "evidence" }> => entity.type === "evidence" && entity.target_refs.some((targetRef) => candidates.has(targetRef)))
    .sort((left, right) => verificationPriority(left.verification_state) - verificationPriority(right.verification_state) || right.valid_from_revision - left.valid_from_revision || left.id.localeCompare(right.id));
  const requiredEvidenceCount = requiredFocusedEvidenceRef ? 1 : 0;
  const requiredNodeCount = requiredFocusRefs.size + requiredEvidenceCount;
  if (canonicalFocusRef && requiredNodeCount > budgets.visible_node_budget) {
    throw new HumanSurfaceBudgetError({
      code: "visible-node-budget-too-small-for-focus",
      visible_node_budget: budgets.visible_node_budget,
      required_node_count: requiredNodeCount,
      focus_ref: canonicalFocusRef,
      required_refs: [...requiredFocusRefs, ...(requiredFocusedEvidenceRef ? [requiredFocusedEvidenceRef] : [])].slice(0, 20),
    });
  }
  const mandatoryCount = [...candidates.values()].filter((priority) => priority <= 2).length;
  const availableEvidenceSlots = Math.max(0, budgets.visible_node_budget - requiredFocusRefs.size);
  const evidenceLimit = Math.min(availableEvidenceSlots, Math.max(requiredEvidenceCount, Math.min(budgets.evidence_detail_budget, evidence.length, Math.max(0, budgets.visible_node_budget - Math.min(mandatoryCount, budgets.visible_node_budget)))));
  const entityLimit = budgets.visible_node_budget - evidenceLimit;
  const selected: CanonicalEntity[] = [...requiredFocusRefs].map((ref) => byRef.get(ref)!).filter(Boolean);
  const selectedRefSet = new Set(selected.map((entity) => entityRef(entity)));
  let historicalCount = selected.filter((entity) => entity.valid_to_revision !== undefined || (entity.type === "work" && entity.work_state === "closed")).length;
  for (const [ref] of [...candidates].sort((left, right) => left[1] - right[1] || entityOrder(byRef.get(left[0])!) - entityOrder(byRef.get(right[0])!) || left[0].localeCompare(right[0]))) {
    if (selected.length >= entityLimit) break;
    if (selectedRefSet.has(ref)) continue;
    const entity = byRef.get(ref)!;
    const historical = entity.valid_to_revision !== undefined || (entity.type === "work" && entity.work_state === "closed");
    if (historical && historicalCount >= budgets.historical_entity_budget) continue;
    selected.push(entity);
    selectedRefSet.add(ref);
    if (historical) historicalCount += 1;
  }
  let parentClosed = selected;
  let selectedRefs = new Set(parentClosed.map((entity) => entityRef(entity)));
  while (true) {
    const next = parentClosed.filter((entity) => entity.type !== "work" || !entity.parent_id || selectedRefs.has(canonicalRef(entity.project_id, "work", entity.parent_id)));
    if (next.length === parentClosed.length) break;
    parentClosed = next;
    selectedRefs = new Set(parentClosed.map((entity) => entityRef(entity)));
  }
  const orderedEvidence = requiredFocusedEvidenceRef
    ? [...evidence.filter((item) => entityRef(item) === requiredFocusedEvidenceRef), ...evidence.filter((item) => entityRef(item) !== requiredFocusedEvidenceRef)]
    : evidence;
  const selectedEvidence = orderedEvidence.filter((item) => item.target_refs.some((ref) => selectedRefs.has(ref))).slice(0, evidenceLimit);
  return {
    entities: [...parentClosed, ...selectedEvidence],
    eligibleCount: candidates.size + evidence.length,
    evidenceOmitted: Math.max(0, evidence.length - selectedEvidence.length),
  };
}

function surfaceEntity(entity: CanonicalEntity, project: Project, goal: GoalRevision, actor: ActorIdentity, routeKey: string | undefined, claim: Claim | undefined, attentionRefs: string[], reasons: ChangeReason[], now: string): SurfaceEntity {
  const role = entity.type === "work" ? branchRole(entity, goal.programme_order.map(normalizeLabel)) : entity.valid_to_revision ? "historical" : "programme";
  const entitySubtitle = subtitle(entity);
  return {
    ref: entityRef(entity),
    entity_version: entity.entity_version,
    kind: entity.type,
    title: boundedText(entity.title, 180),
    ...(entitySubtitle ? { subtitle: boundedText(entitySubtitle, 500) } : {}),
    ...(routeKey ? { route_key: routeKey } : {}),
    ...(entity.type === "work" && entity.parent_id ? { parent_ref: canonicalRef(entity.project_id, "work", entity.parent_id) } : {}),
    branch_role: entity.type === "work" && entity.parent_id && role === "programme" ? "subordinate" : role,
    ...(entity.type === "work" ? { programme_order_key: `${entity.priority}:${entity.id}` } : {}),
    primary_state: primaryState(entity),
    state_axes: stateAxes(entity),
    ...(claim ? { claim: { ref: entityRef(claim), principal_id: claim.principal_id, mode: claim.mode, lease_until: claim.lease_until, stale: Boolean(claim.released_at) || instantIsAtOrBefore(claim.lease_until, now) } } : {}),
    ...(entity.type === "work" && entity.evidence_state !== "none" ? { receipt_summary: { verified: entity.evidence_state === "verified", label: entity.evidence_state, evidence_refs: entity.verification_evidence_refs ?? [] } } : {}),
    ...(entity.type === "evidence" && entity.kind === "compaction-receipt" ? { receipt_bundle: compactionReceiptBundle(entity.body) } : {}),
    attention_refs: attentionRefs.slice(0, 20),
    change_reasons: reasons,
    default_visibility: role === "historical" ? "summary" : "visible",
    capabilities: capabilitiesFor(entity, project, actor),
  };
}

function surfaceRelation(relation: Relation, project: Project, actor: ActorIdentity, revision: number, effectiveFromRevision: number, annotationRefs: string[], attention: boolean, reasons: ChangeReason[], mode: HumanSurfaceMode): SurfaceRelation {
  const externalEndpointRefs = [relation.source_ref, relation.target_ref].filter((ref) => parseRef(ref).projectId !== relation.project_id);
  return {
    ref: entityRef(relation),
    entity_version: relation.entity_version,
    relation_type: relation.relation_type,
    source_ref: relation.source_ref,
    target_ref: relation.target_ref,
    authority_state: relation.authority_state,
    valid_at_revision: relation.valid_to_revision ?? revision,
    valid_from_revision: effectiveFromRevision,
    ...(relation.valid_to_revision !== undefined ? { valid_to_revision: relation.valid_to_revision } : {}),
    visibility: attention ? "always" : mode === "focus" ? "always" : ["blocks", "depends_on", "provides_capability_to"].includes(relation.relation_type) ? "contextual" : "focus-only",
    criticality: attention ? "attention" : ["blocks", "depends_on", "provides_capability_to"].includes(relation.relation_type) ? "structural" : "ordinary",
    label_mode: attention || mode === "focus" ? "visible" : "on-hover",
    change_reasons: reasons,
    annotation_refs: annotationRefs.slice(0, 20),
    capabilities: capabilitiesFor(relation, project, actor),
    ...(externalEndpointRefs.length > 0 ? { external_endpoint_refs: externalEndpointRefs } : {}),
  };
}

function capabilitiesFor(entity: CanonicalEntity, project: Project, actor: ActorIdentity): SurfaceCapability[] {
  const writable = actor.capabilities.includes("write");
  const capabilities: SurfaceCapability[] = [
    { action: "inspect", allowed: actor.capabilities.includes("read"), target_ref: entityRef(entity) },
    { action: "copy-ref", allowed: actor.capabilities.includes("read"), target_ref: entityRef(entity) },
    { action: "annotate", allowed: writable, target_ref: entityRef(entity), input_requirements: ["kind", "body"], ...(!writable ? { reason: "Actor lacks write capability" } : {}) },
  ];
  return capabilities;
}

function attentionPresentation(item: AttentionSource, entities: CanonicalEntity[], project: Project, actor: ActorIdentity): AttentionPresentation {
  const anchors = attentionAnchors(item, entities);
  const target = entities.find((entity) => entityRef(entity) === item.ref);
  return {
    attention_ref: item.ref,
    reason: item.category,
    severity: item.category.includes("conflict") ? "conflict" : item.priority === 1 ? "owner-action" : "notable",
    anchor_refs: anchors,
    ...(target?.type === "decision" && target.authorizes?.target_ref ? { proposed_insertion_ref: target.authorizes.target_ref } : {}),
    summary: boundedText(item.detail, 600),
    capabilities: target ? capabilitiesFor(target, project, actor) : [],
  };
}

function attentionAnchors(item: AttentionSource, entities: Array<CanonicalEntity> | WorkItem[]): string[] {
  const entity = entities.find((candidate) => entityRef(candidate) === item.ref);
  if (!entity) return [item.ref];
  if (entity.type === "annotation") return [entity.anchor_ref];
  if (entity.type === "claim") return [entity.target_ref];
  if (entity.type === "decision" && entity.authorizes?.target_ref) return [entity.authorizes.target_ref];
  if (entity.type === "lane") return [entityRef(entity), entity.batch_ref];
  if (entity.type === "batch") return [entityRef(entity), entity.parent_work_item_ref];
  return [entityRef(entity)];
}

function layoutHintsFor(routes: RouteProjection[], entities: SurfaceEntity[], relations: SurfaceRelation[]): LayoutHint[] {
  const hints: LayoutHint[] = routes.map((route) => ({
    target_key: route.route_key,
    semantic_region: regionForRole(route.branch_role),
    ...(route.programme_order_index !== undefined ? { order_key: String(route.programme_order_index).padStart(4, "0") } : {}),
    preserve_anchor: true,
  }));
  for (const entity of entities) hints.push({
    target_key: entity.ref,
    semantic_region: regionForRole(entity.branch_role),
    ...(entity.programme_order_key ? { order_key: entity.programme_order_key } : {}),
    ...(entity.parent_ref ? { keep_near: [entity.parent_ref], depth: 1 } : {}),
    preserve_anchor: true,
  });
  for (const relation of relations.filter((item) => item.criticality !== "ordinary")) hints.push({ target_key: relation.ref, semantic_region: relation.criticality === "attention" ? "overlay" : "adjacent", keep_near: [relation.source_ref, relation.target_ref], preferred_ports: ["auto"] });
  return hints;
}

function branchRole(work: WorkItem, normalizedProgramme: string[]): BranchRole {
  if (work.valid_to_revision !== undefined || work.work_state === "closed" || work.authority_state === "superseded") return "historical";
  if (work.goal_integrity === "diverges" || work.goal_integrity === "authority-unclear") return "diverging";
  if (work.authority_state === "proposal" || work.authority_state === "owner_pending") return "owner-pending";
  if (work.goal_integrity === "research-only") return "research-only";
  if (work.parent_id) return "subordinate";
  if (work.work_state === "proposed" && programmeIndex(work, normalizedProgramme) === undefined) return "deferred";
  return "programme";
}

function programmeIndex(work: WorkItem, normalizedProgramme: string[]): number | undefined {
  const labels = [work.id, work.title, ...work.aliases].map(normalizeLabel);
  const index = normalizedProgramme.findIndex((entry) => labels.some((label) => entry === label));
  return index >= 0 ? index : undefined;
}

function ancestorPaths(projectId: string, entities: CanonicalEntity[], changedRefs: string[]): string[][] {
  const work = entities.filter((entity): entity is WorkItem => entity.type === "work");
  const byId = new Map(work.map((item) => [item.id, item]));
  const paths: string[][] = [];
  const addWorkPath = (item: WorkItem) => {
    const path = [entityRef(item)];
    const seen = new Set([item.id]);
    while (item.parent_id && byId.has(item.parent_id) && !seen.has(item.parent_id)) {
      item = byId.get(item.parent_id)!;
      seen.add(item.id);
      path.unshift(entityRef(item));
    }
    paths.push(path);
  };
  for (const ref of changedRefs) {
    const parsed = parseRef(ref);
    if (parsed.projectId !== projectId) continue;
    const entity = entities.find((candidate) => candidate.type === parsed.type && candidate.id === parsed.id);
    if (!entity) continue;
    if (entity.type === "work") addWorkPath(entity);
    else if (entity.type === "annotation") {
      const anchor = parseRef(entity.anchor_ref);
      const workItem = anchor.projectId === projectId && anchor.type === "work" ? byId.get(anchor.id) : undefined;
      if (workItem) addWorkPath(workItem);
    } else if (entity.type === "relation") {
      for (const endpoint of [entity.source_ref, entity.target_ref]) {
        const parsedEndpoint = parseRef(endpoint);
        const workItem = parsedEndpoint.projectId === projectId && parsedEndpoint.type === "work" ? byId.get(parsedEndpoint.id) : undefined;
        if (workItem) addWorkPath(workItem);
      }
    }
  }
  const seen = new Set<string>();
  return paths.filter((path) => { const key = path.join("→"); if (seen.has(key)) return false; seen.add(key); return true; }).sort((left, right) => left.join().localeCompare(right.join()));
}

function snapshotAt(events: StoredEvent[], revision: number): Map<string, CanonicalEntity> {
  const snapshot = new Map<string, CanonicalEntity>();
  for (const event of events) {
    if (event.project_revision > revision) break;
    for (const entity of (event.payload.upserts ?? []) as CanonicalEntity[]) snapshot.set(`${entity.type}:${entity.id}`, entity);
  }
  return snapshot;
}

function firstEntityRevisionByRef(events: StoredEvent[], type: CanonicalEntity["type"]): Map<string, number> {
  const revisions = new Map<string, number>();
  for (const event of events) for (const entity of (event.payload.upserts ?? []) as CanonicalEntity[]) {
    if (entity.type === type && !revisions.has(entityRef(entity))) revisions.set(entityRef(entity), event.project_revision);
  }
  return revisions;
}

function requireType(entities: CanonicalEntity[], type: CanonicalEntity["type"], id?: string): CanonicalEntity {
  const entity = entities.find((candidate) => candidate.type === type && (id === undefined || candidate.id === id));
  if (!entity) throw new Error(`Missing ${type}${id ? ` ${id}` : ""}`);
  return entity;
}

function normalizeSince(value: number | null | undefined, currentRevision: number): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > currentRevision) throw new Error("since_revision must be between zero and the current project revision");
  return value;
}

function positiveBudget(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new Error("Projection budgets must be positive integers");
  return value;
}

function primaryState(entity: CanonicalEntity): string {
  switch (entity.type) {
    case "project": return entity.status;
    case "goal": return entity.approval;
    case "epoch": return entity.state;
    case "work": return entity.work_state;
    case "relation": return entity.authority_state;
    case "decision": return entity.decision_state;
    case "hypothesis": return entity.state;
    case "claim": return entity.released_at ? "released" : "active";
    case "evidence": return entity.verification_state;
    case "annotation": return entity.state;
    case "handoff": return "recorded";
    case "batch": case "lane": return entity.integration_state;
  }
}

function stateAxes(entity: CanonicalEntity): SurfaceEntity["state_axes"] {
  if (entity.type === "work") return { work_state: entity.work_state, evidence_state: entity.evidence_state, authority_state: entity.authority_state, goal_integrity: entity.goal_integrity, integration_state: entity.integration_state };
  if (entity.type === "relation") return { authority_state: entity.authority_state };
  if (entity.type === "lane" || entity.type === "batch") return { integration_state: entity.integration_state };
  return {};
}

function subtitle(entity: CanonicalEntity): string | undefined {
  if (entity.type === "work") return entity.scope;
  if (entity.type === "decision") return entity.proposal;
  if (entity.type === "lane") return entity.outcome;
  if (entity.type === "evidence") return entity.summary;
  return entity.body;
}

function compactionReceiptBundle(body: string | undefined): NonNullable<SurfaceEntity["receipt_bundle"]> {
  if (!body) throw new Error("Compaction receipt Evidence is missing its canonical bundle");
  const value = JSON.parse(body) as Partial<NonNullable<SurfaceEntity["receipt_bundle"]>>;
  if (typeof value.source_epoch_ref !== "string" || typeof value.next_epoch_ref !== "string" || !Array.isArray(value.compacted_refs) || !Array.isArray(value.carried_refs) || !Array.isArray(value.accepted_decision_refs)) {
    throw new Error("Compaction receipt Evidence has a malformed canonical bundle");
  }
  return {
    source_epoch_ref: value.source_epoch_ref,
    next_epoch_ref: value.next_epoch_ref,
    compacted_refs: value.compacted_refs.slice(0, 80),
    carried_refs: value.carried_refs.slice(0, 80),
    accepted_decision_refs: value.accepted_decision_refs.slice(0, 80),
  };
}

function regionForRole(role: BranchRole): LayoutHint["semantic_region"] {
  if (role === "programme" || role === "subordinate") return "programme";
  if (role === "historical") return "history";
  if (role === "owner-pending" || role === "diverging") return "overlay";
  return "periphery";
}

function evidenceRank(state: WorkItem["evidence_state"]): number {
  return ["none", "partial", "tested", "verified"].indexOf(state);
}

function normalizeLabel(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function verificationPriority(state: "unverified" | "verified" | "rejected"): number {
  return state === "rejected" ? 0 : state === "verified" ? 1 : 2;
}

function entityOrder(entity: CanonicalEntity): number {
  const order: CanonicalEntity["type"][] = ["work", "decision", "batch", "lane", "hypothesis", "claim", "evidence", "handoff", "project", "goal", "epoch", "relation", "annotation"];
  return order.indexOf(entity.type);
}

function primaryClaimFor(entity: CanonicalEntity, claims: Claim[]): Claim | undefined {
  if (entity.type === "work" && entity.current_claim_id) return claims.find((claim) => claim.id === entity.current_claim_id && claim.target_ref === entityRef(entity));
  if (entity.type === "lane" && entity.claim_ref) return claims.find((claim) => entityRef(claim) === entity.claim_ref && claim.target_ref === entityRef(entity));
  return undefined;
}

function uniqueByRef<T extends CanonicalEntity>(entities: T[]): T[] {
  return [...new Map(entities.map((entity) => [entityRef(entity), entity])).values()];
}

function boundedText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function measureProjection(projection: HumanSurfaceProjection): number {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const bytes = Buffer.byteLength(JSON.stringify(projection), "utf8");
    if (projection.diagnostics.response_bytes === bytes) return bytes;
    projection.diagnostics.response_bytes = bytes;
  }
  return projection.diagnostics.response_bytes;
}

function degradeProjectionToBudget(projection: HumanSurfaceProjection, budget: number): void {
  if (measureProjection(projection) <= budget) return;
  for (const preview of projection.command_previews) {
    const removed = preview.projected_effect.constraint_effects.length;
    if (removed > 0) {
      preview.projected_effect.constraint_effects = [];
      preview.projected_effect.omitted_constraint_count = (preview.projected_effect.omitted_constraint_count ?? 0) + removed;
      preview.projected_effect.constraint_expansion_ref ??= projection.goal_header.ref;
    }
  }
  if (measureProjection(projection) <= budget) return;
  projection.omitted_counts.layout_hints = (projection.omitted_counts.layout_hints ?? 0) + projection.layout_hints.length;
  projection.layout_hints = [];
  if (measureProjection(projection) <= budget) return;
  projection.entities = projection.entities.map((entity) => ({ ...entity, ...(entity.subtitle ? { subtitle: boundedText(entity.subtitle, 120) } : {}), attention_refs: entity.attention_refs.slice(0, 4) }));
  projection.annotations = projection.annotations.map((annotation) => ({ ...annotation, body: boundedText(annotation.body, 160) }));
  projection.attention = projection.attention.map((item) => ({ ...item, summary: boundedText(item.summary, 160) }));
  if (measureProjection(projection) <= budget) return;
  projection.omitted_counts.command_previews = (projection.omitted_counts.command_previews ?? 0) + projection.command_previews.length;
  projection.command_previews = [];
  closePreviewCapabilityRefs(projection);
  if (measureProjection(projection) <= budget) return;
  projection.omitted_counts.annotations = (projection.omitted_counts.annotations ?? 0) + projection.annotations.length;
  projection.annotations = [];
  projection.omitted_counts.attention = (projection.omitted_counts.attention ?? 0) + projection.attention.length;
  projection.attention = [];
  if (measureProjection(projection) <= budget) return;
  projection.omitted_counts.relations = (projection.omitted_counts.relations ?? 0) + projection.relations.length;
  if (projection.relations.length > 0) {
    const sampleRelationRefs = projection.relations.map((relation) => relation.ref).sort().slice(0, Math.max(1, Math.min(8, projection.diagnostics.budgets.collection_budget)));
    projection.relation_bundles.push({
      bundle_key: `relation-bundle:${projection.project_id}:response-degraded`,
      relation_type: "mixed",
      source_region_key: "multiple",
      target_region_key: "multiple",
      member_count: projection.relations.length,
      sample_relation_refs: sampleRelationRefs,
      omitted_member_count: Math.max(0, projection.relations.length - sampleRelationRefs.length),
      attention_count: projection.relations.filter((relation) => relation.criticality === "attention").length,
      recent_change_count: projection.relations.filter((relation) => relation.change_reasons.length > 0).length,
      expansion_handle: `espalier-focus://${projection.project_id}/relations?bundle=response-degraded&after=${encodeURIComponent(sampleRelationRefs.at(-1) ?? "")}`,
    });
  }
  projection.relations = [];
  if (measureProjection(projection) <= budget) return;
  projection.operational_summary.categories = projection.operational_summary.categories.map((category) => ({
    ...category,
    sample_member_refs: [],
    omitted_member_count: category.member_count,
    summary_facts: [],
  }));
  projection.relation_bundles = projection.relation_bundles.map((bundle) => ({
    ...bundle,
    sample_relation_refs: [],
    omitted_member_count: bundle.member_count,
  }));
  measureProjection(projection);
}

function closePreviewCapabilityRefs(projection: HumanSurfaceProjection): void {
  const retainedPreviewIds = new Set(projection.command_previews.map((preview) => preview.preview_id));
  const close = (capabilities: SurfaceCapability[]) => capabilities.filter((capability) => !capability.preview_id || retainedPreviewIds.has(capability.preview_id));
  projection.entities = projection.entities.map((entity) => ({ ...entity, capabilities: close(entity.capabilities) }));
  projection.relations = projection.relations.map((relation) => ({ ...relation, capabilities: close(relation.capabilities) }));
  projection.annotations = projection.annotations.map((annotation) => ({ ...annotation, capabilities: close(annotation.capabilities) }));
  projection.attention = projection.attention.map((item) => ({ ...item, capabilities: close(item.capabilities) }));
  projection.capabilities = close(projection.capabilities);
}

function stableFamilySlot(routeKey: string): string {
  const byte = createHash("sha256").update(routeKey).digest()[0] ?? 0;
  return `family-${byte % 8 + 1}`;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 20);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function takeWithMandatoryRef<T extends CanonicalEntity>(items: T[], budget: number, mandatoryRef?: string): T[] {
  if (!mandatoryRef) return items.slice(0, budget);
  const mandatory = items.find((item) => entityRef(item) === mandatoryRef);
  if (!mandatory) return items.slice(0, budget);
  return [mandatory, ...items.filter((item) => entityRef(item) !== mandatoryRef)].slice(0, budget);
}

function gateCapabilities(capabilities: SurfaceCapability[], disabled: boolean): SurfaceCapability[] {
  if (!disabled) return capabilities;
  return capabilities.map((capability) => ["annotate", "claim", "semantic-command"].includes(capability.action)
    ? { ...capability, allowed: false, reason: "Commands are disabled while the projection is stale or disconnected" }
    : capability);
}

interface PreviewCandidate {
  command_type: CommandType;
  action_variant: string;
  payload: Record<string, unknown>;
  target_refs: string[];
  presentation_ref: string;
  affected_relation_refs?: string[];
  proposed_insertion_ref?: string;
  authority_requirement?: CommandPreview["authority_requirement"];
  input_requirements?: string[];
}

function buildCommandPreviews(
  core: EspalierCore,
  project: Project,
  actor: ActorIdentity,
  revision: number,
  targets: CanonicalEntity[],
  staleState: HumanSurfaceProjection["stale_state"],
  constraintDetailBudget: number,
): CommandPreview[] {
  const goal = core.requireEntity(project.project_id, "goal", project.current_goal_revision_id!) as GoalRevision;
  const candidates = uniqueByPreview(targets.flatMap((entity): PreviewCandidate[] => {
    const ref = entityRef(entity);
    if (entity.type === "work") {
      const relatedRelations = targets.filter((candidate): candidate is Relation => candidate.type === "relation" && (candidate.source_ref === ref || candidate.target_ref === ref));
      const affectedRelationRefs = relatedRelations.map((relation) => entityRef(relation));
      const insertionRelation = relatedRelations.find((relation) => relation.authority_state === "proposal");
      const insertionRef = insertionRelation?.[insertionRelation.source_ref === ref ? "target_ref" : "source_ref"];
      const actions: PreviewCandidate[] = [{ command_type: "claim.acquire", action_variant: "acquire-primary", payload: { id: `preview-claim-${stableHash({ ref, actor: actor.principal_id, revision })}`, target_ref: ref, mode: "primary", lease_seconds: 900 }, target_refs: [ref], presentation_ref: ref }];
      const evidence = core.listEntities(project.project_id, "evidence").filter((candidate) => candidate.type === "evidence" && candidate.target_refs.includes(ref));
      const verifiedEvidenceRefs = evidence.filter((candidate) => candidate.type === "evidence" && candidate.verification_state === "verified").map((candidate) => entityRef(candidate));
      const rejectedEvidenceRefs = evidence.filter((candidate) => candidate.type === "evidence" && candidate.verification_state === "rejected").map((candidate) => entityRef(candidate));
      if (entity.evidence_state !== "verified" && verifiedEvidenceRefs.length > 0) actions.push({ command_type: "work.verify", action_variant: "verify", payload: { work_item_ref: ref, evidence_refs: verifiedEvidenceRefs, outcome: "verified", rationale: "Canonical verified Evidence is available for policy evaluation" }, target_refs: [ref, ...verifiedEvidenceRefs], presentation_ref: ref });
      if (entity.evidence_state === "verified" && rejectedEvidenceRefs.length > 0) actions.push({ command_type: "work.verify", action_variant: "reopen", payload: { work_item_ref: ref, evidence_refs: rejectedEvidenceRefs, outcome: "reopen", rationale: "Contradictory rejected Evidence requires renewed review" }, target_refs: [ref, ...rejectedEvidenceRefs], presentation_ref: ref });
      actions.push(
        { command_type: "evidence.attach", action_variant: "attach-evidence", payload: { target_refs: [ref] }, target_refs: [ref], presentation_ref: ref, input_requirements: ["id", "kind", "origin", "ref", "summary", "verification_state"] },
        { command_type: "handoff.record", action_variant: "record-handoff", payload: { id: `preview-handoff-${stableHash({ ref, revision })}`, work_item_ref: ref, completed: [], current_state: `${entity.work_state}; evidence ${entity.evidence_state}; integration ${entity.integration_state}`, open_questions: [], blockers: [], next_safe_action: "Inspect the current Work and continue only within its authority", evidence_refs: entity.verification_evidence_refs ?? [] }, target_refs: [ref, ...(entity.verification_evidence_refs ?? [])], presentation_ref: ref, authority_requirement: "claimant" },
      );
      if (entity.authority_state === "owner_pending" || entity.authority_state === "proposal" || entity.goal_integrity === "diverges" || entity.goal_integrity === "authority-unclear") {
        actions.push(
          { command_type: "work.authority.resolve", action_variant: "approve-within-goal", payload: { work_item_ref: ref, authority_state: "approved", goal_integrity: "advances" }, target_refs: [ref], presentation_ref: ref, affected_relation_refs: affectedRelationRefs, ...(insertionRef ? { proposed_insertion_ref: insertionRef } : {}) },
          { command_type: "work.authority.resolve", action_variant: "retain-research-only", payload: { work_item_ref: ref, authority_state: "approved", goal_integrity: "research-only" }, target_refs: [ref], presentation_ref: ref, affected_relation_refs: affectedRelationRefs, ...(insertionRef ? { proposed_insertion_ref: insertionRef } : {}) },
          { command_type: "work.authority.resolve", action_variant: "reject", payload: { work_item_ref: ref, authority_state: "superseded" }, target_refs: [ref], presentation_ref: ref, affected_relation_refs: affectedRelationRefs, ...(insertionRef ? { proposed_insertion_ref: insertionRef } : {}) },
          { command_type: "annotation.add", action_variant: "request-revision", payload: { id: `revision-request-${stableHash({ ref, revision })}`, anchor_ref: ref, anchor_revision: revision, kind: "directive", body: "Revise this proposal before owner approval", source_refs: [], requested_action: "Submit a revised proposal with updated scope, constraints, Relations, and impact" }, target_refs: [ref], presentation_ref: ref, affected_relation_refs: affectedRelationRefs, ...(insertionRef ? { proposed_insertion_ref: insertionRef } : {}) },
        );
      }
      return actions;
    }
    if (entity.type === "lane") return [
      { command_type: "claim.acquire", action_variant: "acquire-primary", payload: { id: `preview-claim-${stableHash({ ref, actor: actor.principal_id, revision })}`, target_ref: ref, mode: "primary", lease_seconds: 900 }, target_refs: [ref], presentation_ref: ref },
      ...(entity.integration_state !== "integrated" ? [{ command_type: "lane.return" as const, action_variant: "return-result", payload: { lane_ref: ref }, target_refs: [ref], presentation_ref: ref, authority_requirement: "claimant" as const, input_requirements: ["result_id", "summary", "evidence_ref"] }] : []),
    ];
    if (entity.type === "batch") return [{ command_type: "batch.integrate", action_variant: "integrate", payload: { batch_ref: ref }, target_refs: [ref, ...entity.lane_refs], presentation_ref: ref, authority_requirement: "coordinator" }];
    if (entity.type === "decision" && entity.decision_state === "proposed") return (["approved", "rejected", "superseded"] as const).map((decisionState) => ({ command_type: "decision.resolve", action_variant: decisionState === "approved" ? "approve" : decisionState === "rejected" ? "reject" : "supersede", payload: { decision_ref: ref, decision_state: decisionState }, target_refs: [ref], presentation_ref: ref }));
    if (entity.type === "relation" && entity.authority_state !== "superseded") return [{ command_type: "relation.supersede", action_variant: "supersede", payload: { relation_ref: ref }, target_refs: [ref], presentation_ref: ref }];
    if (entity.type === "claim" && !entity.released_at) return [{ command_type: "claim.force-release", action_variant: "force-release", payload: { claim_ref: ref }, target_refs: [ref, entity.target_ref], presentation_ref: entity.target_ref }];
    if (entity.type === "annotation" && entity.state !== "resolved") {
      const bindingResolution = entity.kind === "directive" || entity.kind === "decision" || (entity.kind === "concern" && entity.author.role === "owner" && entity.author.principal_id !== actor.principal_id);
      const authorityRequirement: CommandPreview["authority_requirement"] = bindingResolution ? project.owner_policy.approval === "any-one" ? "owner" : "multi-owner-decision" : "writer";
      return [
        { command_type: "annotation.resolve", action_variant: "resolve", payload: { annotation_ref: ref, response_refs: [] }, target_refs: [ref], presentation_ref: ref, authority_requirement: authorityRequirement },
        ...(entity.state === "stale" ? [{ command_type: "annotation.reanchor" as const, action_variant: "reanchor-current", payload: { annotation_ref: ref, anchor_revision: revision }, target_refs: [ref], presentation_ref: ref, authority_requirement: authorityRequirement }] : []),
      ];
    }
    return [];
  }));
  const authorizationDecisions = core.listEntities(project.project_id, "decision").filter((entity): entity is Decision => entity.type === "decision" && entity.decision_state === "approved" && !entity.consumed_by_command_id);

  return candidates.map((candidate): CommandPreview => {
    const baseEntityVersions = Object.fromEntries(candidate.target_refs.flatMap((ref) => {
      try { return [[ref, core.resolve(ref).entity_version] as const]; } catch { return []; }
    }));
    const envelopeFor = (payload: Record<string, unknown>): CommandEnvelope => ({
      command_id: `preview-${stableHash({ project: project.project_id, revision, actor: actor.principal_id, command: candidate.command_type, variant: candidate.action_variant, payload })}`,
      project_id: project.project_id,
      actor,
      base_project_revision: revision,
      base_entity_versions: baseEntityVersions,
      type: candidate.command_type,
      occurred_at: core.currentTime(),
      payload,
    });
    let payload = candidate.payload;
    let result = staleState || candidate.input_requirements ? undefined : core.preflight(envelopeFor(payload));
    if (result && !result.executable && project.owner_policy.approval !== "any-one" && !candidate.input_requirements) {
      for (const decision of authorizationDecisions) {
        const authorizedPayload = { ...candidate.payload, approval_decision_ref: entityRef(decision) };
        const authorized = core.preflight(envelopeFor(authorizedPayload));
        if (authorized.executable) { payload = authorizedPayload; result = authorized; break; }
      }
    }
    const availability: CommandPreview["availability"] = staleState
      ? "read-only"
      : candidate.input_requirements
        ? "unavailable"
      : result?.executable
        ? "executable"
        : result?.reason.includes("approved multi-owner authorization decision")
          ? "approval-required"
          : "unavailable";
    const target = candidate.target_refs[0] ?? candidate.presentation_ref;
    const showsConstraintEffects = candidate.command_type === "work.authority.resolve" || candidate.action_variant === "request-revision";
    const constraintEffects = showsConstraintEffects ? goal.binding_constraints.slice(0, constraintDetailBudget).map((constraint) => boundedText(constraint, 300)) : [];
    const omittedConstraintCount = showsConstraintEffects ? Math.max(0, goal.binding_constraints.length - constraintEffects.length) : 0;
    return {
      preview_id: envelopeFor(payload).command_id,
      command_type: candidate.command_type,
      action_variant: candidate.action_variant,
      payload,
      presentation_ref: candidate.presentation_ref,
      target_refs: candidate.target_refs,
      base_project_revision: revision,
      base_entity_versions: baseEntityVersions,
      authority_requirement: authorityRequirement(candidate, project),
      availability,
      available: availability === "executable",
      ...(candidate.input_requirements ? { input_requirements: candidate.input_requirements } : {}),
      ...(availability !== "executable" ? { blocked_reason: staleState ? "Commands are disabled while the projection is stale or disconnected" : candidate.input_requirements ? `Requires input: ${candidate.input_requirements.join(", ")}` : result && !result.executable ? result.reason : "Command is unavailable" } : {}),
      projected_effect: {
        state_changes: [effectLabel(candidate.command_type, candidate.action_variant, target)],
        relation_changes: candidate.command_type === "relation.supersede" ? ["supersede the selected typed relation while retaining history"] : (candidate.affected_relation_refs ?? []).map((ref) => `re-evaluate affected Relation ${ref} after acceptance`),
        constraint_effects: constraintEffects,
        ...(omittedConstraintCount > 0 ? { omitted_constraint_count: omittedConstraintCount, constraint_expansion_ref: entityRef(goal) } : {}),
        ...(candidate.proposed_insertion_ref ? { proposed_insertion_ref: candidate.proposed_insertion_ref } : {}),
        attention_effect: "recompute deterministic Attention after the accepted command",
        supersession_effect: candidate.command_type === "relation.supersede" || candidate.action_variant === "supersede" ? "retain the prior canonical object as superseded history" : "no implicit supersession",
        project_revision: `${revision} → ${revision + 1} only after an accepted receipt`,
      },
    };
  });
}

function uniqueByPreview(candidates: PreviewCandidate[]): PreviewCandidate[] {
  return [...new Map(candidates.map((candidate) => [`${candidate.command_type}:${candidate.action_variant}:${stableJson(candidate.payload)}`, candidate])).values()];
}

function authorityRequirement(candidate: PreviewCandidate, project: Project): CommandPreview["authority_requirement"] {
  if (candidate.authority_requirement) return candidate.authority_requirement;
  const commandType = candidate.command_type;
  if (commandType === "decision.resolve") return project.owner_policy.approval === "any-one" ? "owner" : "multi-owner-vote";
  if (["work.authority.resolve", "work.verify", "claim.force-release", "relation.supersede"].includes(commandType) || candidate.action_variant === "request-revision") return project.owner_policy.approval === "any-one" ? "owner" : "multi-owner-decision";
  if (commandType === "claim.acquire") return "claimant";
  if (commandType === "batch.integrate") return "coordinator";
  if (commandType === "lane.return" || commandType === "handoff.record") return "claimant";
  return "writer";
}

function capabilitiesFromPreviews(previews: CommandPreview[]): Map<string, SurfaceCapability[]> {
  const byRef = new Map<string, SurfaceCapability[]>();
  for (const preview of previews) for (const ref of unique([preview.presentation_ref, ...preview.target_refs])) {
    const capability: SurfaceCapability = {
      action: preview.command_type === "claim.acquire" ? "claim" : "semantic-command",
      allowed: preview.available,
      target_ref: preview.target_refs[0] ?? preview.presentation_ref,
      command_type: preview.command_type,
      preview_id: preview.preview_id,
      requires_confirmation: preview.command_type !== "claim.acquire",
      ...(!preview.available && preview.blocked_reason ? { reason: preview.blocked_reason } : {}),
    };
    byRef.set(ref, [...(byRef.get(ref) ?? []), capability]);
  }
  return byRef;
}

function effectLabel(commandType: CommandType, actionVariant: string, targetRef: string): string {
  if (commandType === "decision.resolve") return `${actionVariant} owner decision ${targetRef}`;
  if (commandType === "work.authority.resolve") return `${actionVariant} for authority and goal-integrity state on ${targetRef}`;
  if (commandType === "claim.acquire") return `acquire an active primary Claim on ${targetRef}`;
  if (commandType === "claim.force-release") return `force-release claim ${targetRef}`;
  if (commandType === "annotation.resolve") return `resolve annotation ${targetRef}`;
  if (commandType === "annotation.reanchor") return `reanchor annotation ${targetRef} to the current canonical revision`;
  if (commandType === "relation.supersede") return `supersede relation ${targetRef}`;
  return `apply ${commandType} (${actionVariant}) to ${targetRef}`;
}
