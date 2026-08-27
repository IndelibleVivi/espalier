import { describe, expect, it } from "vitest";
import { EspalierCore } from "@espalier/core";
import type { ActorIdentity, CommandEnvelope } from "@espalier/protocol";
import { Projector } from "./index.js";
import { compileHistoricalReplay } from "./replay.js";
import { runScaleReplayStressbench, scaleStressTargets } from "./scale-stressbench.js";

const owner: ActorIdentity = { principal_id: "example-owner", runtime_id: "scale-test", device_id: "test", session_id: "owner", role: "owner", capabilities: ["read", "write", "claim", "evidence", "owner-update", "coordinate"] };
const worker: ActorIdentity = { principal_id: "example-worker", runtime_id: "scale-test", device_id: "test", session_id: "worker", role: "worker", capabilities: ["read", "write", "claim", "evidence"] };

describe("D1.5 scale and replay projection foundation", () => {
  it("keeps operational conditions represented and bundles Relations omitted by an independent budget", () => {
    const core = seedScaleProject();
    for (let index = 0; index < 12; index += 1) {
      emit(core, worker, "work.create", {
        id: `frontier-${String(index).padStart(2, "0")}`,
        epoch_id: "epoch-01",
        kind: "task",
        title: `Frontier ${index}`,
        scope: "D1.5 scale selection",
        semantic_surfaces: [`scale:${index}`],
        repo_surfaces: [],
        priority: index,
        ...(index >= 8 ? { authority_state: "owner_pending" } : {}),
        verification_policy: "synthetic fixture",
      });
    }
    for (let index = 0; index < 14; index += 1) {
      emit(core, worker, "relation.create", {
        id: `dense-${String(index).padStart(2, "0")}`,
        source_ref: `esp:scale/work/frontier-${String(8 + (index % 2)).padStart(2, "0")}`,
        target_ref: `esp:scale/work/frontier-${String(10 + (index % 2)).padStart(2, "0")}`,
        relation_type: "depends_on",
        authority_state: "within_scope",
      });
    }

    const options = { actor: owner, mode: "live" as const, density: "overview" as const, visible_node_budget: 4, route_budget: 4, relation_budget: 2, collection_budget: 4, response_byte_budget: 120_000 };
    const projection = new Projector(core).humanSurface("scale", options);
    const repeated = new Projector(core).humanSurface("scale", options);

    expect(projection.density).toBe("overview");
    expect(projection.projection_revision).toBe(repeated.projection_revision);
    expect(projection.entities).toHaveLength(4);
    expect(projection.relations).toHaveLength(2);
    expect(projection.operational_summary.selection_policy).toBe("mandatory-operational-state-then-ranked-context");
    expect(projection.operational_summary.categories.find((category) => category.aggregate_key.endsWith(":active-frontiers"))).toMatchObject({
      member_count: 12,
      omitted_member_count: 8,
      state_counts: { active: 12 },
      sample_member_refs: expect.arrayContaining(["espalier://scale/work/frontier-00"]),
    });
    expect(projection.operational_summary.categories.find((category) => category.aggregate_key.endsWith(":owner-attention"))).toMatchObject({ member_count: 4 });
    expect(projection.relation_bundles.length).toBeGreaterThan(0);
    expect(projection.relation_bundles.reduce((total, bundle) => total + bundle.member_count, 0)).toBe(projection.omitted_counts.relations);
    expect(projection.relation_bundles.every((bundle) => bundle.sample_relation_refs.length <= 4 && bundle.expansion_handle.startsWith("espalier-focus://scale/relations"))).toBe(true);
    expect(projection.relation_bundles.map((bundle) => bundle.bundle_key)).toEqual(repeated.relation_bundles.map((bundle) => bundle.bundle_key));
    expect(projection.diagnostics.response_bytes).toBeLessThanOrEqual(projection.diagnostics.budgets.response_byte_budget);
    const overviewDefaults = new Projector(core).humanSurface("scale", { actor: owner, density: "overview" });
    const detailDefaults = new Projector(core).humanSurface("scale", { actor: owner, density: "detail" });
    expect(overviewDefaults.diagnostics.budgets).toMatchObject({ visible_node_budget: 40, relation_budget: 24, collection_budget: 24 });
    expect(detailDefaults.diagnostics.budgets).toMatchObject({ visible_node_budget: 120, relation_budget: 200, collection_budget: 60 });
    expect(overviewDefaults.projection_revision).not.toBe(detailDefaults.projection_revision);
    core.close();
  });

  it("replays only accepted canonical event upserts and proves the supported same-identity compaction boundary", () => {
    const core = seedScaleProject();
    emit(core, worker, "work.create", { id: "root", epoch_id: "epoch-01", kind: "workstream", title: "Root", scope: "Carry the same identity", semantic_surfaces: ["scale:root"], repo_surfaces: [], priority: 0, verification_policy: "synthetic fixture" });
    emit(core, worker, "work.create", { id: "child", epoch_id: "epoch-01", parent_id: "root", kind: "task", title: "Child", scope: "Ancestor-closed carry", semantic_surfaces: ["scale:child"], repo_surfaces: [], priority: 1, verification_policy: "synthetic fixture" });
    const beforeCompactionRevision = core.getProjectRevision("scale");
    emit(core, owner, "epoch.freeze", { epoch_ref: "esp:scale/epoch/epoch-01" });
    emit(core, owner, "epoch.compact", { epoch_ref: "esp:scale/epoch/epoch-01", receipt_id: "epoch-01-compaction", next_epoch: { id: "epoch-02", title: "Next scale baseline", baseline_ref: "synthetic:scale@2" } });
    const afterCompactionRevision = core.getProjectRevision("scale");

    const before = compileHistoricalReplay(core, "scale", beforeCompactionRevision, { visible_node_budget: 20, relation_budget: 20, response_byte_budget: 80_000 });
    const after = compileHistoricalReplay(core, "scale", afterCompactionRevision, { visible_node_budget: 20, relation_budget: 20, response_byte_budget: 80_000 });
    const repeated = compileHistoricalReplay(core, "scale", afterCompactionRevision, { visible_node_budget: 20, relation_budget: 20, response_byte_budget: 80_000 });
    const throughProjector = new Projector(core).historicalReplay("scale", afterCompactionRevision, { visible_node_budget: 20, relation_budget: 20, response_byte_budget: 80_000 });

    expect(before.source).toBe("accepted-canonical-event-log");
    expect(before.invariants.fabricated_event_count).toBe(0);
    expect(before.evidence_boundary.supported_facts).toEqual(expect.arrayContaining([expect.stringContaining("accepted canonical events")]));
    expect(before.evidence_boundary.unknowns).toEqual(expect.arrayContaining([expect.stringContaining("split/merge")]));
    expect(before.entities.find((entity) => entity.ref.endsWith("/root"))).toMatchObject({ state: { epoch_id: "epoch-01" } });
    expect(after.entities.find((entity) => entity.ref.endsWith("/root"))).toMatchObject({ ref: "espalier://scale/work/root", state: { epoch_id: "epoch-02" } });
    expect(after.entities.find((entity) => entity.ref.endsWith("/child"))).toMatchObject({ ref: "espalier://scale/work/child", state: { epoch_id: "epoch-02", parent_id: "root" } });
    expect(after.entities).toEqual(expect.arrayContaining([expect.objectContaining({ ref: "espalier://scale/evidence/epoch-01-compaction", kind: "evidence" })]));
    expect(before.entities.some((entity) => entity.ref.endsWith("/epoch-01-compaction"))).toBe(false);
    expect(after.projection_revision).toBe(repeated.projection_revision);
    expect(throughProjector.projection_revision).toBe(after.projection_revision);
    expect(after.invariants).toMatchObject({ canonical_route_objects: 0, geometry_fields: 0, local_ref_gaps: [] });
    expect(JSON.stringify(after)).not.toMatch(/split_mapping|merge_mapping|fabricated_history/);
    core.close();
  });

  it("runs compact, standard, and focus headless profiles over a labeled synthetic corpus", () => {
    expect(scaleStressTargets).toEqual([500, 5_000]);
    const result = runScaleReplayStressbench({ target_canonical_objects: 500 });
    expect(result.corpus).toMatchObject({ provenance: "synthetic", target_canonical_objects: 500 });
    expect(result.corpus.canonical_object_count).toBeGreaterThanOrEqual(450);
    expect(result.profiles.map((profile) => profile.profile)).toEqual(["compact", "standard", "focus"]);
    for (const profile of result.profiles) {
      expect(profile.invariants).toMatchObject({
        stable_projection_identity: true,
        visible_node_budget_respected: true,
        relation_budget_respected: true,
        response_byte_budget_respected: true,
        focus_identity_preserved: true,
        no_canonical_routes_or_geometry: true,
        exact_relation_omission_accounting: true,
      });
    }
    expect(result.replay_checkpoints.every((checkpoint) => checkpoint.source === "accepted-canonical-event-log" && checkpoint.invariants.fabricated_event_count === 0)).toBe(true);
  }, 30_000);
});

function seedScaleProject(): EspalierCore {
  const core = new EspalierCore(":memory:", { now: () => "2026-08-23T00:00:00.000Z" });
  emit(core, owner, "project.create", { display_name: "Scale Fixture", authority_domain: "scale", repository_refs: [], owner_policy: { owners: ["example-owner"], approval: "any-one" } });
  emit(core, owner, "goal.approve", { id: "goal-01", purpose: "Prove bounded renderer-neutral scale behavior", present_consumers: ["headless stressbench"], programme_order: [], binding_constraints: ["Synthetic data is not historical evidence"], trust_boundaries: ["Core remains the only mutation path"], explicit_non_goals: ["production frontend"], source_refs: ["fixture:d1-5"] });
  emit(core, owner, "epoch.open", { id: "epoch-01", goal_revision_id: "goal-01", title: "Scale foundation", baseline_ref: "synthetic:scale@1" });
  return core;
}

let commandSequence = 0;

function emit(core: EspalierCore, actor: ActorIdentity, type: CommandEnvelope["type"], payload: Record<string, unknown>): void {
  commandSequence += 1;
  const receipt = core.execute({ command_id: `scale-test-${commandSequence}`, project_id: "scale", actor, base_project_revision: core.getProjectRevision("scale"), base_entity_versions: {}, type, occurred_at: "2026-08-23T00:00:00.000Z", payload });
  if (!receipt.accepted) throw new Error(`${type}: ${receipt.reason}`);
}
