import { EspalierCore } from "@espalier/core";
import type { ActorIdentity, CommandEnvelope } from "@espalier/protocol";
import { deriveAttention } from "./attention.js";
import { compileHumanSurface, type HumanSurfaceDensity, type HumanSurfaceMode, type HumanSurfaceProjection } from "./human-surface.js";
import { compileHistoricalReplay, type HistoricalReplayProjection } from "./replay.js";

export const scaleStressTargets = [500, 5_000] as const;

export const scaleStressProfiles = [
  { profile: "compact", mode: "live", density: "overview", visible_node_budget: 24, relation_budget: 18, collection_budget: 24, route_budget: 12, response_byte_budget: 120_000 },
  { profile: "standard", mode: "live", density: "working", visible_node_budget: 48, relation_budget: 32, collection_budget: 40, route_budget: 24, response_byte_budget: 240_000 },
  { profile: "focus", mode: "focus", density: "detail", visible_node_budget: 96, relation_budget: 80, collection_budget: 64, route_budget: 40, response_byte_budget: 500_000 },
] as const satisfies ReadonlyArray<{
  profile: "compact" | "standard" | "focus";
  mode: HumanSurfaceMode;
  density: HumanSurfaceDensity;
  visible_node_budget: number;
  relation_budget: number;
  collection_budget: number;
  route_budget: number;
  response_byte_budget: number;
}>;

export interface ScaleReplayStressRequest {
  target_canonical_objects: number;
}

export interface ScaleReplayStressResult {
  corpus: {
    provenance: "synthetic";
    target_canonical_objects: number;
    canonical_object_count: number;
    semantic_event_count: number;
    source_label: "d1-5-generated-current-state";
  };
  profiles: Array<{
    profile: "compact" | "standard" | "focus";
    mode: HumanSurfaceMode;
    density: HumanSurfaceDensity;
    projection_revision: string;
    visible_entity_count: number;
    visible_relation_count: number;
    relation_bundle_count: number;
    response_bytes: number;
    invariants: {
      stable_projection_identity: boolean;
      visible_node_budget_respected: boolean;
      relation_budget_respected: boolean;
      response_byte_budget_respected: boolean;
      focus_identity_preserved: boolean;
      no_canonical_routes_or_geometry: boolean;
      exact_relation_omission_accounting: boolean;
    };
  }>;
  replay_checkpoints: HistoricalReplayProjection[];
}

const stressOwner: ActorIdentity = { principal_id: "example-owner", runtime_id: "scale-stress", device_id: "headless", session_id: "owner", role: "owner", capabilities: ["read", "write", "claim", "evidence", "owner-update", "coordinate"] };
const stressWorker: ActorIdentity = { principal_id: "example-worker", runtime_id: "scale-stress", device_id: "headless", session_id: "worker", role: "worker", capabilities: ["read", "write", "claim", "evidence"] };

export function runScaleReplayStressbench(request: ScaleReplayStressRequest): ScaleReplayStressResult {
  if (!Number.isInteger(request.target_canonical_objects) || request.target_canonical_objects < 100) throw new Error("Scale stress target must be an integer of at least 100 canonical objects");
  const core = new EspalierCore(":memory:", { now: () => "2026-08-23T00:00:00.000Z" });
  let sequence = 0;
  const emit = (actor: ActorIdentity, type: CommandEnvelope["type"], payload: Record<string, unknown>) => {
    sequence += 1;
    const receipt = core.execute({
      command_id: `scale-stress-${request.target_canonical_objects}-${sequence}`,
      project_id: "scale-stress",
      actor,
      base_project_revision: core.getProjectRevision("scale-stress"),
      base_entity_versions: {},
      type,
      occurred_at: "2026-08-23T00:00:00.000Z",
      payload,
    });
    if (!receipt.accepted) throw new Error(`${type}: ${receipt.reason}`);
  };

  try {
    emit(stressOwner, "project.create", { display_name: "D1.5 Synthetic Scale", authority_domain: "scale-stress", repository_refs: [], owner_policy: { owners: ["example-owner"], approval: "any-one" } });
    emit(stressOwner, "goal.approve", {
      id: "goal-01",
      purpose: "Exercise bounded renderer-neutral projections without claiming historical fidelity",
      present_consumers: ["headless stressbench"],
      programme_order: Array.from({ length: 8 }, (_, index) => `Route ${index}`),
      binding_constraints: ["Synthetic data is not historical evidence", "Core remains the only mutation path"],
      trust_boundaries: ["No production renderer", "No fabricated source reconstruction"],
      explicit_non_goals: ["visual acceptance", "historical ledger mapping"],
      source_refs: ["fixture:d1-5-scale-stress"],
    });
    emit(stressOwner, "epoch.open", { id: "epoch-01", goal_revision_id: "goal-01", title: "Synthetic scale", baseline_ref: "synthetic:d1-5@baseline" });
    for (let index = 0; index < 8; index += 1) {
      emit(stressWorker, "work.create", {
        id: `route-${String(index).padStart(2, "0")}`,
        epoch_id: "epoch-01",
        kind: "workstream",
        title: `Route ${index}`,
        scope: "Synthetic projection pressure",
        semantic_surfaces: [`scale:route:${index}`],
        repo_surfaces: [],
        priority: index,
        ...(index >= 6 ? { authority_state: "owner_pending" } : {}),
        verification_policy: "synthetic fixture",
      });
    }
    const baselineRevision = core.getProjectRevision("scale-stress");
    const relationCount = request.target_canonical_objects >= 5_000 ? 256 : 64;
    for (let index = 0; index < relationCount; index += 1) {
      emit(stressWorker, "relation.create", {
        id: `dense-${String(index).padStart(4, "0")}`,
        source_ref: `esp:scale-stress/work/route-${String(index % 8).padStart(2, "0")}`,
        target_ref: `esp:scale-stress/work/route-${String((index + 1 + Math.floor(index / 8)) % 8).padStart(2, "0")}`,
        relation_type: index % 5 === 0 ? "blocks" : "depends_on",
        authority_state: "within_scope",
      });
    }
    for (let index = 0; index < 4; index += 1) {
      emit(stressWorker, "claim.acquire", { id: `claim-${index}`, target_ref: `esp:scale-stress/work/route-${String(index).padStart(2, "0")}`, mode: "primary", lease_seconds: 3_600 });
      emit(stressWorker, "decision.propose", { id: `decision-${index}`, question: `Resolve synthetic owner question ${index}?`, proposal: "Keep the decision explicit", scope: "synthetic scale" });
    }
    for (let index = 0; index < 8; index += 1) {
      emit(stressOwner, "annotation.add", { id: `attention-${index}`, anchor_ref: `esp:scale-stress/work/route-${String(index).padStart(2, "0")}`, anchor_revision: core.getProjectRevision("scale-stress"), kind: "concern", body: `Synthetic attention marker ${index}` });
    }
    const baseCount = core.listEntities("scale-stress").length;
    const lanesPerBatch = 48;
    const batchCount = Math.max(1, Math.floor((request.target_canonical_objects - baseCount) / (lanesPerBatch + 1)));
    for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
      emit(stressOwner, "batch.create", {
        id: `batch-${String(batchIndex).padStart(4, "0")}`,
        title: `Synthetic batch ${batchIndex}`,
        parent_work_item_ref: `esp:scale-stress/work/route-${String(batchIndex % 8).padStart(2, "0")}`,
        lanes: Array.from({ length: lanesPerBatch }, (_, laneIndex) => ({
          id: `lane-${String(batchIndex).padStart(4, "0")}-${String(laneIndex).padStart(2, "0")}`,
          title: `Lane ${batchIndex}.${laneIndex}`,
          outcome: "Synthetic bounded return",
          scope: "Headless scale only",
          context_refs: [`esp:scale-stress/work/route-${String(batchIndex % 8).padStart(2, "0")}`],
          authority: "Within synthetic fixture",
          return_contract: "No historical claim",
          semantic_surfaces: [`scale:batch:${batchIndex}`],
          repo_surfaces: [],
        })),
      });
    }

    const focusRef = "espalier://scale-stress/work/route-00";
    const profiles = scaleStressProfiles.map((profile) => {
      const projectionOptions = {
        actor: stressOwner,
        mode: profile.mode,
        density: profile.density,
        visible_node_budget: profile.visible_node_budget,
        relation_budget: profile.relation_budget,
        collection_budget: profile.collection_budget,
        route_budget: profile.route_budget,
        response_byte_budget: profile.response_byte_budget,
        ...(profile.mode === "focus" ? { focus_ref: focusRef } : {}),
      };
      const projection = compileHumanSurface(core, "scale-stress", projectionOptions, (entities) => deriveAttention(entities, core.currentTime()));
      const repeated = compileHumanSurface(core, "scale-stress", projectionOptions, (entities) => deriveAttention(entities, core.currentTime()));
      return stressProfileResult(profile, projection, repeated, focusRef);
    });
    const currentRevision = core.getProjectRevision("scale-stress");
    const replayOptions = { visible_node_budget: 160, relation_budget: 160, response_byte_budget: 600_000 };
    const replayCheckpoints = [
      compileHistoricalReplay(core, "scale-stress", baselineRevision, replayOptions),
      compileHistoricalReplay(core, "scale-stress", currentRevision, replayOptions),
    ];
    return {
      corpus: {
        provenance: "synthetic",
        target_canonical_objects: request.target_canonical_objects,
        canonical_object_count: core.listEntities("scale-stress").length,
        semantic_event_count: core.listEvents("scale-stress").length,
        source_label: "d1-5-generated-current-state",
      },
      profiles,
      replay_checkpoints: replayCheckpoints,
    };
  } finally {
    core.close();
  }
}

function stressProfileResult(
  profile: (typeof scaleStressProfiles)[number],
  projection: HumanSurfaceProjection,
  repeated: HumanSurfaceProjection,
  focusRef: string,
): ScaleReplayStressResult["profiles"][number] {
  const visibleRefs = new Set(projection.entities.map((entity) => entity.ref));
  const relationOmissionCount = projection.relation_bundles.reduce((total, bundle) => total + bundle.member_count, 0);
  return {
    profile: profile.profile,
    mode: profile.mode,
    density: profile.density,
    projection_revision: projection.projection_revision,
    visible_entity_count: projection.entities.length,
    visible_relation_count: projection.relations.length,
    relation_bundle_count: projection.relation_bundles.length,
    response_bytes: projection.diagnostics.response_bytes,
    invariants: {
      stable_projection_identity: projection.projection_revision === repeated.projection_revision,
      visible_node_budget_respected: projection.entities.length <= profile.visible_node_budget,
      relation_budget_respected: projection.relations.length <= profile.relation_budget,
      response_byte_budget_respected: projection.diagnostics.response_bytes <= profile.response_byte_budget,
      focus_identity_preserved: profile.mode !== "focus" || visibleRefs.has(focusRef),
      no_canonical_routes_or_geometry: projection.diagnostics.canonical_route_objects === 0 && projection.diagnostics.geometry_fields === 0 && !/"(?:x|y|node_positions)":/.test(JSON.stringify(projection)),
      exact_relation_omission_accounting: relationOmissionCount === projection.omitted_counts.relations,
    },
  };
}
