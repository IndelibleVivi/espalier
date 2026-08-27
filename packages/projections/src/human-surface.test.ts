import { describe, expect, it } from "vitest";
import { EspalierCore } from "@espalier/core";
import type { ActorIdentity, CommandEnvelope } from "@espalier/protocol";
import { createHumanSurfaceFixtures, humanSurfaceFixtureIds } from "./fixtures.js";
import { HumanSurfaceBudgetError } from "./human-surface.js";
import { Projector } from "./index.js";

const owner: ActorIdentity = { principal_id: "example-owner", runtime_id: "test", device_id: "test", session_id: "owner", role: "owner", capabilities: ["read", "write", "claim", "evidence", "owner-update", "coordinate"] };
const worker: ActorIdentity = { principal_id: "example-worker", runtime_id: "test", device_id: "test", session_id: "worker", role: "worker", capabilities: ["read", "write", "claim", "evidence"] };
const secondOwner: ActorIdentity = { ...owner, principal_id: "kai", session_id: "second-owner" };
const fixtures = createHumanSurfaceFixtures();

describe("renderer-neutral Human Surface contract", () => {
  it("builds every required acceptance fixture without a canonical Route or geometry", () => {
    expect(Object.keys(fixtures).sort()).toEqual([...humanSurfaceFixtureIds].sort());
    for (const fixture of Object.values(fixtures)) {
      expect(fixture.projection).toMatchObject({ schema_version: "espalier.human-surface@0", project_id: "canopy", diagnostics: { canonical_route_objects: 0, geometry_fields: 0 } });
      expect(fixture.projection.as_of_revision).toBeGreaterThan(0);
      expect(fixture.projection.routes.every((route) => route.route_key.startsWith("route:canopy:") && route.basis_refs.length >= 2)).toBe(true);
      expect(fixture.projection.entities.some((entity) => String(entity.kind) === "route")).toBe(false);
      expect(JSON.stringify(fixture.projection)).not.toMatch(/"(?:x|y|node_positions)":/);
    }
  });

  it("encodes programme, deferred, research-only, and owner-pending placement without renderer inference", () => {
    const normal = fixtures["canopy-normal-live"].projection;
    expect(normal.routes.map((route) => route.branch_role)).toEqual(expect.arrayContaining(["programme", "deferred", "research-only", "owner-pending"]));
    expect(normal.routes.find((route) => route.title === "AIR compiler")?.programme_order_index).toBe(0);
    expect(normal.routes.find((route) => route.title === "Canvas aesthetics")?.default_expansion).toBe("collapsed");
    expect(normal.layout_hints.every((hint) => !Object.hasOwn(hint, "x") && !Object.hasOwn(hint, "y"))).toBe(true);
  });

  it("does not bind a proposed root to programme order through a substring match", () => {
    const core = seedMinimal();
    emit(core, worker, "work.create", {
      id: "roo",
      epoch_id: "epoch",
      kind: "workstream",
      title: "Roo",
      scope: "A different root whose label only overlaps Root",
      semantic_surfaces: ["roo"],
      repo_surfaces: [],
      priority: 2,
      work_state: "proposed",
      verification_policy: "test",
    });

    const projection = new Projector(core).humanSurface("canopy", { actor: owner });
    const route = projection.routes.find((candidate) => candidate.title === "Roo");

    expect(route?.programme_order_index).toBeUndefined();
    expect(route?.branch_role).toBe("deferred");
  });

  it("reveals meaningful delta and ancestors while ignoring routine claim acquisition", () => {
    const deltaFixture = fixtures["canopy-meaningful-delta"].projection;
    expect(deltaFixture.delta.changed_refs).toEqual(expect.arrayContaining([
      "espalier://canopy/work/sound-resolution",
      "espalier://canopy/relation/sound-to-render",
      "espalier://canopy/decision/owner-listening-question",
    ]));
    expect(deltaFixture.delta.changed_refs.some((ref) => ref.includes("claim-sound-delta"))).toBe(false);
    expect(deltaFixture.delta.change_reasons_by_ref["espalier://canopy/work/sound-resolution"]).toContain("evidence-threshold-crossed");
    expect(deltaFixture.delta.ancestor_paths_to_open).toContainEqual(["espalier://canopy/work/sound-resolution"]);
  });

  it("projects Lane and Batch integration transitions as meaningful delta", () => {
    const core = seedMinimal();
    emit(core, owner, "batch.create", {
      id: "runtime-batch",
      parent_work_item_ref: "esp:canopy/work/root",
      lanes: [{
        id: "runtime-lane",
        outcome: "Return runtime evidence",
        scope: "Exercise one bounded runtime lane",
        authority: "Bounded",
        return_contract: "Evidence",
        context_refs: [],
        semantic_surfaces: ["runtime:lane"],
        repo_surfaces: [],
      }],
    });
    emit(core, worker, "claim.acquire", {
      id: "runtime-lane-claim",
      target_ref: "esp:canopy/lane/runtime-lane",
      mode: "primary",
      lease_seconds: 600,
    });
    const sinceRevision = core.getProjectRevision("canopy");

    emit(core, worker, "lane.return", {
      lane_ref: "esp:canopy/lane/runtime-lane",
      result_id: "runtime-result",
      summary: "Runtime evidence returned",
      evidence_ref: "fixture:runtime-result",
    });

    const projection = new Projector(core).humanSurface("canopy", { actor: owner, since_revision: sinceRevision });
    expect(projection.delta.change_reasons_by_ref["espalier://canopy/lane/runtime-lane"]).toContain("integration-changed");
    expect(projection.delta.change_reasons_by_ref["espalier://canopy/batch/runtime-batch"]).toContain("integration-changed");
    expect(projection.delta.change_reasons_by_ref["espalier://canopy/work/root"]).toContain("integration-changed");
  });

  it("presents relations and stale annotations as first-class selectable targets", () => {
    const fixture = fixtures["relation-concern-stale-annotation"].projection;
    const relation = fixture.relations.find((item) => item.ref === "espalier://canopy/relation/sound-to-render");
    expect(relation).toMatchObject({ label_mode: "visible", annotation_refs: ["espalier://canopy/annotation/relation-concern"] });
    expect(relation?.capabilities.map((capability) => capability.action)).toEqual(expect.arrayContaining(["inspect", "copy-ref", "annotate"]));
    expect(relation?.valid_at_revision).toBeLessThan(fixture.as_of_revision);
    expect(relation?.valid_from_revision).toBeLessThan(relation!.valid_to_revision!);
    expect(relation?.valid_to_revision).toBe(relation?.valid_at_revision);
    expect(fixture.annotations).toEqual([expect.objectContaining({ ref: "espalier://canopy/annotation/relation-concern", state: "stale", change_reasons: ["annotation-stale"] })]);
    expect(fixture.command_previews).toEqual(expect.arrayContaining([
      expect.objectContaining({ command_type: "annotation.resolve", action_variant: "resolve", payload: { annotation_ref: "espalier://canopy/annotation/relation-concern", response_refs: [] } }),
      expect.objectContaining({ command_type: "annotation.reanchor", action_variant: "reanchor-current", payload: { annotation_ref: "espalier://canopy/annotation/relation-concern", anchor_revision: fixture.as_of_revision } }),
    ]));
  });

  it("keeps theme, collapse, pin, and geometry changes outside canonical project state", () => {
    const fixture = fixtures["theme-equivalence"];
    expect(fixture.view_states).toHaveLength(2);
    expect(fixture.view_states.map((state) => state.theme_id)).toEqual(["paper-cool", "paper-warm"]);
    expect(fixture.view_states[0]?.route_palette_slots).toEqual(fixture.view_states[1]?.route_palette_slots);
    expect(fixture.projection).not.toHaveProperty("theme_id");
    expect(fixture.projection).not.toHaveProperty("node_positions");
  });

  it("localizes a Batch claim conflict while retaining both additive evidence records", () => {
    const projection = fixtures["claim-overlap-batch-conflict"].projection;
    expect(projection.attention.filter((item) => item.reason === "authority-conflict")).toHaveLength(2);
    expect(projection.entities.map((entity) => entity.ref)).toEqual(expect.arrayContaining([
      "espalier://canopy/batch/render-batch",
      "espalier://canopy/lane/browser-lane",
      "espalier://canopy/lane/headless-lane",
      "espalier://canopy/evidence/browser-lane-note",
      "espalier://canopy/evidence/headless-lane-note",
    ]));
    expect(projection.entities.filter((entity) => entity.kind === "lane").every((entity) => entity.claim?.mode === "primary")).toBe(true);
  });

  it("bounds large projections, exposes stale state, and returns explicit service capabilities", () => {
    expect(fixtures["large-synthetic-map"].projection.entities).toHaveLength(18);
    expect(fixtures["large-synthetic-map"].projection.omitted_counts.entities).toBeGreaterThan(0);
    expect(Math.max(...fixtures["large-synthetic-map"].projection.routes.map((route) => route.member_refs.length))).toBeLessThanOrEqual(18);
    expect(fixtures["large-synthetic-map"].projection.attention.length).toBeLessThanOrEqual(18);
    expect(fixtures["stale-disconnected"].projection.stale_state).toMatchObject({ state: "disconnected", commands_enabled: false });
    const pending = fixtures["owner-pending-proposal"].projection.entities.find((entity) => entity.ref.endsWith("/adaptive-mastering"));
    expect(pending).toMatchObject({ branch_role: "owner-pending" });
    expect(pending?.capabilities.find((capability) => capability.action === "annotate")).toMatchObject({ allowed: true, input_requirements: ["kind", "body"] });
    expect(pending?.capabilities.find((capability) => capability.action === "annotate")).not.toHaveProperty("command_type");
    expect(fixtures["owner-pending-proposal"].projection.command_previews).toEqual(expect.arrayContaining([expect.objectContaining({ command_type: "work.authority.resolve", action_variant: "approve-within-goal", authority_requirement: "owner", availability: "executable", available: true, base_project_revision: fixtures["owner-pending-proposal"].projection.as_of_revision })]));
    expect(fixtures["stale-disconnected"].projection.capabilities.find((capability) => capability.action === "annotate")).toMatchObject({ allowed: false });
    expect(fixtures["stale-disconnected"].projection.command_previews.every((preview) => preview.availability === "read-only" && !preview.available)).toBe(true);
    expect(fixtures["stale-disconnected"].projection.command_state_contract).toMatchObject({ optimistic_state_is_canonical: false, accepted_receipt_required: true });
  });

  it("turns the required fixture names into semantic contract proofs", () => {
    const normal = fixtures["canopy-normal-live"].projection;
    const air = normal.entities.find((entity) => entity.ref.endsWith("/air-compiler"));
    expect(normal.goal_header).toMatchObject({ approval: "approved", binding_constraints: expect.arrayContaining(["Host agent owns authorship"]) });
    expect(air).toMatchObject({ branch_role: "historical", receipt_summary: { verified: true, evidence_refs: ["espalier://canopy/evidence/air-verification"] } });
    expect(normal.entities.filter((entity) => entity.primary_state === "blocked")).toEqual([]);

    const research = fixtures["research-only-side-branch"].projection;
    expect(research.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: "espalier://canopy/work/runtime-investigation", branch_role: "research-only" }),
      expect.objectContaining({ ref: "espalier://canopy/evidence/runtime-source", subtitle: "Repository implementation source linked without promoting a dependency" }),
      expect.objectContaining({ ref: "espalier://canopy/hypothesis/runtime-hypothesis", primary_state: "inconclusive" }),
    ]));
    expect(research.relations).toEqual(expect.arrayContaining([expect.objectContaining({ ref: "espalier://canopy/relation/research-observes-sound", relation_type: "observes" })]));

    const pending = fixtures["owner-pending-proposal"].projection;
    for (const variant of ["approve-within-goal", "reject", "request-revision"]) expect(pending.command_previews.some((preview) => preview.action_variant === variant && preview.available)).toBe(true);
    const impact = pending.command_previews.find((preview) => preview.action_variant === "approve-within-goal");
    expect(impact).toMatchObject({ projected_effect: { proposed_insertion_ref: "espalier://canopy/work/rendering", constraint_effects: expect.arrayContaining(["Host agent owns authorship"]), relation_changes: expect.arrayContaining([expect.stringContaining("mastering-insertion-proposal")]) } });

    const claimFixture = fixtures["claim-overlap-batch-conflict"];
    expect(claimFixture.contract_evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ accepted: false, code: "stale" }),
      expect.objectContaining({ accepted: false, code: "claim-conflict" }),
    ]));
    expect(claimFixture.projection.entities.filter((entity) => entity.kind === "evidence").map((entity) => entity.ref)).toEqual(expect.arrayContaining(["espalier://canopy/evidence/browser-lane-note", "espalier://canopy/evidence/headless-lane-note"]));

    const compacted = fixtures["compacted-verified-history"].projection;
    const receipt = compacted.entities.find((entity) => entity.ref === "espalier://canopy/evidence/epoch-01-compaction");
    expect(receipt?.receipt_bundle).toMatchObject({
      source_epoch_ref: "espalier://canopy/epoch/epoch-01",
      next_epoch_ref: "espalier://canopy/epoch/epoch-02",
      compacted_refs: expect.arrayContaining(["espalier://canopy/work/air-compiler"]),
      carried_refs: expect.arrayContaining(["espalier://canopy/work/sound-resolution"]),
      accepted_decision_refs: expect.arrayContaining(["espalier://canopy/decision/accepted-baseline-decision"]),
    });
    expect(compacted.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: "espalier://canopy/decision/accepted-baseline-decision", primary_state: "approved" }),
      expect.objectContaining({ ref: "espalier://canopy/work/sound-resolution" }),
    ]));
    expect(compacted.epoch).toMatchObject({ ref: "espalier://canopy/epoch/epoch-02", state: "active" });

    const large = fixtures["large-synthetic-map"].projection;
    expect(large.routes.some((route) => route.aggregate && Boolean(route.expansion_handle))).toBe(true);
    expect(large.entities.some((entity) => entity.claim?.mode === "primary")).toBe(true);
    expect(large.entities.some((entity) => entity.branch_role === "historical")).toBe(true);
    expect(large.annotations.length).toBeGreaterThan(0);
    expect(large.relations.length).toBeGreaterThan(0);
    expect(large.attention.length).toBeGreaterThan(0);
    expect(large.diagnostics.response_bytes).toBeLessThanOrEqual(large.diagnostics.budgets.response_byte_budget);
  });

  it("keeps fallback palette slots stable when an unrelated root is inserted", () => {
    const core = seedMinimal();
    const projector = new Projector(core);
    const before = projector.humanSurface("canopy", { actor: owner });
    const rootSlot = before.routes.find((route) => route.root_refs.includes("espalier://canopy/work/root"))?.default_family_slot;
    emit(core, worker, "work.create", { id: "aaa-unrelated", epoch_id: "epoch", kind: "workstream", title: "AAA unrelated", scope: "Unrelated", semantic_surfaces: ["unrelated"], repo_surfaces: [], priority: -100, verification_policy: "fixture" });
    const after = projector.humanSurface("canopy", { actor: owner });
    expect(after.routes.find((route) => route.root_refs.includes("espalier://canopy/work/root"))?.default_family_slot).toBe(rootSlot);
  });

  it("rejects a foreign Focus ref instead of leaking another project authority domain", () => {
    const core = seedMinimal();
    expect(core.execute({ command_id: crypto.randomUUID(), project_id: "orchard", actor: owner, base_project_revision: 0, base_entity_versions: {}, type: "project.create", occurred_at: "2026-08-22T08:00:00Z", payload: { display_name: "Orchard", authority_domain: "orchard", repository_refs: [], owner_policy: { owners: ["example-owner"], approval: "any-one" } } }).accepted).toBe(true);
    expect(() => new Projector(core).humanSurface("canopy", { actor: worker, mode: "focus", focus_ref: "esp:orchard/project/orchard" })).toThrow("another project authority domain");
  });

  it("bounds routes, layout, evidence detail, response bytes, and local references under a root-and-evidence flood", () => {
    const core = seedMinimal();
    for (let index = 1; index <= 36; index += 1) {
      emit(core, worker, "work.create", { id: `root-${index}`, epoch_id: "epoch", kind: "workstream", title: `Root ${index}`, scope: `Bounded route ${index}`, semantic_surfaces: [`root:${index}`], repo_surfaces: [], priority: index, verification_policy: "fixture" });
      emit(core, worker, "relation.create", { id: `edge-${index}`, source_ref: "esp:canopy/work/root", target_ref: `esp:canopy/work/root-${index}`, relation_type: "relates_to", authority_state: "within_scope" });
      emit(core, worker, "evidence.attach", { id: `evidence-${index}`, target_refs: ["esp:canopy/work/root"], kind: "test", origin: "observed", ref: `fixture:evidence-${index}`, summary: `Evidence ${index}`, verification_state: "unverified" });
    }
    const projection = new Projector(core).humanSurface("canopy", {
      actor: owner,
      mode: "focus",
      focus_ref: "esp:canopy/work/root",
      visible_node_budget: 10,
      route_budget: 5,
      relation_budget: 8,
      evidence_detail_budget: 2,
      layout_hint_budget: 12,
      collection_budget: 6,
      response_byte_budget: 60_000,
    });
    const entityRefs = new Set(projection.entities.map((entity) => entity.ref));
    expect(projection.routes.length).toBeLessThanOrEqual(5);
    expect(projection.collapse_groups.length).toBeLessThanOrEqual(5);
    expect(projection.layout_hints.length).toBeLessThanOrEqual(12);
    expect(projection.entities.filter((entity) => entity.kind === "evidence")).toHaveLength(2);
    expect(entityRefs).toContain("espalier://canopy/work/root");
    expect(Buffer.byteLength(JSON.stringify(projection), "utf8")).toBeLessThanOrEqual(60_000);
    expect(projection.relations.every((relation) => [relation.source_ref, relation.target_ref].every((ref) => !ref.startsWith("espalier://canopy/") || entityRefs.has(ref)))).toBe(true);
    expect(projection.routes.filter((route) => !route.aggregate).every((route) => [...route.root_refs, ...route.member_refs].every((ref) => entityRefs.has(ref)))).toBe(true);
    expect(projection.routes.some((route) => route.aggregate && route.omitted_root_count! > 0 && Boolean(route.expansion_handle))).toBe(true);
    expect(projection.omitted_counts.routes).toBeGreaterThan(0);
    expect(projection.omitted_counts.evidence_detail).toBeGreaterThan(0);
  });

  it("keeps every returned Work parent_ref locally resolvable even under a shallow expansion budget", () => {
    const core = seedMinimal();
    let parentId = "root";
    for (let depth = 2; depth <= 5; depth += 1) {
      const id = `depth-${depth}`;
      emit(core, worker, "work.create", { id, epoch_id: "epoch", parent_id: parentId, kind: "task", title: `Depth ${depth}`, scope: `Nested level ${depth}`, semantic_surfaces: [`depth:${depth}`], repo_surfaces: [], priority: depth, verification_policy: "fixture" });
      parentId = id;
    }
    const projection = new Projector(core).humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/depth-5", visible_node_budget: 10, expanded_depth_budget: 1 });
    const refs = new Set(projection.entities.map((entity) => entity.ref));
    expect(projection.entities.find((entity) => entity.ref.endsWith("/depth-5"))).toBeTruthy();
    expect(projection.entities.filter((entity) => entity.parent_ref).every((entity) => refs.has(entity.parent_ref!))).toBe(true);
  });

  it("returns a typed Focus budget failure instead of omitting a deep focused object", () => {
    const core = seedMinimal();
    let parentId = "root";
    for (let depth = 2; depth <= 20; depth += 1) {
      const id = `deep-${depth}`;
      emit(core, worker, "work.create", { id, epoch_id: "epoch", parent_id: parentId, kind: "task", title: `Deep ${depth}`, scope: `Deep focus level ${depth}`, semantic_surfaces: [`deep:${depth}`], repo_surfaces: [], priority: depth, verification_policy: "fixture" });
      parentId = id;
    }
    try {
      new Projector(core).humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/deep-20", visible_node_budget: 3, expanded_depth_budget: 1 });
      expect.unreachable("Deep Focus must not return without its selected identity");
    } catch (error) {
      expect(error).toBeInstanceOf(HumanSurfaceBudgetError);
      expect(error).toMatchObject({
        code: "visible-node-budget-too-small-for-focus",
        visible_node_budget: 3,
        required_node_count: 20,
        focus_ref: "espalier://canopy/work/deep-20",
      });
    }
  });

  it("reserves focused Relations and Annotations before ordinary collection slicing", () => {
    const core = seedMinimal();
    emit(core, worker, "work.create", { id: "focus-peer", epoch_id: "epoch", kind: "task", title: "Focus peer", scope: "Focus peer", semantic_surfaces: ["focus:peer"], repo_surfaces: [], priority: 2, verification_policy: "fixture" });
    emit(core, worker, "relation.create", { id: "a-relation", source_ref: "esp:canopy/work/root", target_ref: "esp:canopy/work/focus-peer", relation_type: "relates_to", authority_state: "within_scope" });
    emit(core, worker, "relation.create", { id: "z-focused-relation", source_ref: "esp:canopy/work/root", target_ref: "esp:canopy/work/focus-peer", relation_type: "implements", authority_state: "within_scope" });
    const relationFocus = new Projector(core).humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/relation/z-focused-relation", relation_budget: 1 });
    expect(relationFocus.relations.map((relation) => relation.ref)).toEqual(["espalier://canopy/relation/z-focused-relation"]);

    emit(core, owner, "annotation.add", { id: "a-note", anchor_ref: "esp:canopy/work/root", anchor_revision: core.getProjectRevision("canopy"), kind: "note", body: "Earlier note", source_refs: [] });
    emit(core, owner, "annotation.add", { id: "z-focused-note", anchor_ref: "esp:canopy/work/root", anchor_revision: core.getProjectRevision("canopy"), kind: "concern", body: "Focused note", source_refs: [] });
    const annotationFocus = new Projector(core).humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/annotation/z-focused-note", collection_budget: 1 });
    expect(annotationFocus.annotations.map((annotation) => annotation.ref)).toEqual(["espalier://canopy/annotation/z-focused-note"]);

    emit(core, owner, "annotation.resolve", { annotation_ref: "esp:canopy/annotation/z-focused-note", response_refs: [] });
    const resolvedFocus = new Projector(core).humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/annotation/z-focused-note", collection_budget: 1 });
    expect(resolvedFocus.annotations).toEqual([expect.objectContaining({ ref: "espalier://canopy/annotation/z-focused-note", state: "resolved" })]);
  });

  it("returns an aggregate expansion route when route_budget is one", () => {
    const core = seedMinimal();
    for (let index = 1; index <= 4; index += 1) emit(core, worker, "work.create", { id: `single-route-${index}`, epoch_id: "epoch", kind: "workstream", title: `Single route ${index}`, scope: "Route overflow", semantic_surfaces: [`route:${index}`], repo_surfaces: [], priority: index + 1, verification_policy: "fixture" });
    const projection = new Projector(core).humanSurface("canopy", { actor: owner, visible_node_budget: 10, route_budget: 1 });
    expect(projection.routes).toHaveLength(1);
    expect(projection.routes[0]).toMatchObject({ aggregate: true, omitted_root_count: 5, expansion_handle: expect.stringContaining("espalier-focus://canopy/routes") });
  });

  it("validates and consumes a route expansion handle as a bounded continuation intent", () => {
    const core = seedMinimal();
    for (let index = 1; index <= 4; index += 1) emit(core, worker, "work.create", { id: `expand-route-${index}`, epoch_id: "epoch", kind: "workstream", title: `Expand route ${index}`, scope: "Route expansion", semantic_surfaces: [`expand:route:${index}`], repo_surfaces: [], priority: index + 1, verification_policy: "fixture" });
    const projector = new Projector(core);
    const collapsed = projector.humanSurface("canopy", { actor: owner, visible_node_budget: 10, route_budget: 1 });
    const handle = collapsed.routes[0]?.expansion_handle;
    expect(handle).toBeDefined();
    if (!handle) throw new Error("Expected a route expansion handle");
    const cursor = new URL(handle).searchParams.get("after");
    expect(cursor).toBeTruthy();

    const expanded = projector.humanSurface("canopy", { actor: owner, visible_node_budget: 10, route_budget: 2, expansion_handle: handle });
    expect(expanded.routes.some((route) => route.root_refs.some((ref) => ref.endsWith(`/${cursor}`)))).toBe(true);
    expect(expanded.projection_revision).not.toBe(projector.humanSurface("canopy", { actor: owner, visible_node_budget: 10, route_budget: 2 }).projection_revision);
    expect(() => projector.humanSurface("canopy", { actor: owner, expansion_handle: "espalier-focus://other/routes?after=x" })).toThrow("project authority domain");
  });

  it("retains the focused concrete Route when route_budget is one", () => {
    const core = seedMinimal();
    for (let index = 1; index <= 4; index += 1) emit(core, worker, "work.create", { id: `focus-route-${index}`, epoch_id: "epoch", kind: "workstream", title: `Focus route ${index}`, scope: "Route overflow", semantic_surfaces: [`focus:route:${index}`], repo_surfaces: [], priority: index + 1, verification_policy: "fixture" });
    const projection = new Projector(core).humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/focus-route-4", visible_node_budget: 10, route_budget: 1 });
    expect(projection.routes).toEqual([expect.objectContaining({ root_refs: ["espalier://canopy/work/focus-route-4"] })]);
    expect(projection.routes[0]).not.toHaveProperty("aggregate");
    expect(projection.entities.find((entity) => entity.ref.endsWith("/focus-route-4"))?.route_key).toBe("route:canopy:focus-route-4");
    expect(projection).toMatchObject({ route_overflow: { omitted_root_count: 4, expansion_handle: expect.stringContaining("espalier-focus://canopy/routes") } });
  });

  it("represents a valid no-active-Epoch interval without selecting historical state as current", () => {
    const core = seedMinimal();
    emit(core, owner, "epoch.freeze", { epoch_ref: "esp:canopy/epoch/epoch" });
    emit(core, owner, "epoch.open", { id: "z-latest", goal_revision_id: "goal", title: "Latest frozen epoch", baseline_ref: "git:latest" });
    emit(core, worker, "work.create", { id: "latest-work", epoch_id: "z-latest", kind: "workstream", title: "Latest work", scope: "Latest lifecycle frontier", semantic_surfaces: ["latest"], repo_surfaces: [], priority: 1, verification_policy: "fixture" });
    emit(core, owner, "epoch.freeze", { epoch_ref: "esp:canopy/epoch/z-latest" });

    const projector = new Projector(core);
    const live = projector.humanSurface("canopy", { actor: owner, mode: "live" });
    expect(live.epoch).toEqual({ state: "no-active-epoch", latest_historical_ref: "espalier://canopy/epoch/z-latest", latest_historical_state: "frozen" });
    expect(live.entities.some((entity) => entity.kind === "work")).toBe(false);

    const atlas = projector.humanSurface("canopy", { actor: owner, mode: "atlas" });
    expect(atlas.epoch).toEqual({ state: "no-active-epoch", latest_historical_ref: "espalier://canopy/epoch/z-latest", latest_historical_state: "frozen" });
    expect(atlas.entities).toEqual(expect.arrayContaining([expect.objectContaining({ ref: "espalier://canopy/work/latest-work" }), expect.objectContaining({ ref: "espalier://canopy/epoch/z-latest", primary_state: "frozen" })]));

    const legacyLive = projector.live("canopy");
    expect(legacyLive.epoch).toBeNull();
    expect(legacyLive.work_items).toEqual([]);
  });

  it("bounds nested command-preview authority detail instead of failing a valid large projection", () => {
    const constraints = Array.from({ length: 1_800 }, (_, index) => `Constraint ${index + 1}: ${"binding-authority ".repeat(8)}`);
    const core = seedMinimal(constraints);
    emit(core, worker, "work.create", { id: "large-authority-pending", epoch_id: "epoch", kind: "task", title: "Large authority pending", scope: "Owner review", semantic_surfaces: ["large:authority"], repo_surfaces: [], priority: 2, authority_state: "owner_pending", verification_policy: "owner" });
    const projection = new Projector(core).humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/large-authority-pending", response_byte_budget: 524_288 });
    const preview = projection.command_previews.find((item) => item.action_variant === "approve-within-goal");
    expect(preview?.projected_effect.constraint_effects.length).toBeLessThan(constraints.length);
    expect(preview?.projected_effect).toMatchObject({ omitted_constraint_count: expect.any(Number), constraint_expansion_ref: "espalier://canopy/goal/goal" });
    expect(preview?.projected_effect.omitted_constraint_count).toBeGreaterThan(0);
    expect(projection.diagnostics.response_bytes).toBeLessThanOrEqual(524_288);
  });

  it("keeps preview-derived capabilities referentially closed after byte degradation", () => {
    const core = seedMinimal();
    for (let index = 1; index <= 8; index += 1) {
      emit(core, worker, "work.create", { id: `budget-pending-${index}`, epoch_id: "epoch", kind: "task", title: `Budget pending ${index}`, scope: "Owner review", semantic_surfaces: [`budget:pending:${index}`], repo_surfaces: [], priority: index + 1, authority_state: "owner_pending", verification_policy: "owner" });
    }
    const projection = new Projector(core).humanSurface("canopy", { actor: owner, visible_node_budget: 20, response_byte_budget: 60_000 });
    expect(projection.omitted_counts.command_previews).toBeGreaterThan(0);
    const previewIds = new Set(projection.command_previews.map((preview) => preview.preview_id));
    const capabilities = [
      ...projection.capabilities,
      ...projection.entities.flatMap((entity) => entity.capabilities),
      ...projection.relations.flatMap((relation) => relation.capabilities),
      ...projection.annotations.flatMap((annotation) => annotation.capabilities),
      ...projection.attention.flatMap((item) => item.capabilities),
    ];
    expect(capabilities.filter((capability) => capability.preview_id).every((capability) => previewIds.has(capability.preview_id!))).toBe(true);
    expect(capabilities.filter((capability) => capability.command_type).every((capability) => Boolean(capability.preview_id) && previewIds.has(capability.preview_id!))).toBe(true);
    expect(capabilities.filter((capability) => capability.action === "annotate").every((capability) => !capability.command_type && capability.input_requirements?.includes("kind") && capability.input_requirements.includes("body"))).toBe(true);
  });

  it("returns a typed bounded failure when mandatory Human Surface identity cannot fit", () => {
    const core = seedMinimal();
    expect(() => new Projector(core).humanSurface("canopy", { actor: owner, response_byte_budget: 64 })).toThrow(HumanSurfaceBudgetError);
    try {
      new Projector(core).humanSurface("canopy", { actor: owner, response_byte_budget: 64 });
      throw new Error("Expected HumanSurfaceBudgetError");
    } catch (error) {
      expect(error).toMatchObject({
        code: "response-budget-too-small-for-mandatory-surface",
        budget_bytes: 64,
        required_bytes: expect.any(Number),
        expansion_ref: "espalier://canopy/goal/goal",
      });
      expect(Buffer.byteLength(JSON.stringify(error), "utf8")).toBeLessThanOrEqual(512);
    }
  });

  it("binds projection identity to actor, focus, budgets, and stale state", () => {
    const core = seedMinimal();
    emit(core, worker, "work.create", { id: "other", epoch_id: "epoch", kind: "task", title: "Other", scope: "Other", semantic_surfaces: ["other"], repo_surfaces: [], priority: 2, verification_policy: "fixture" });
    const projector = new Projector(core);
    const baseline = projector.humanSurface("canopy", { actor: worker });
    const variants = [
      projector.humanSurface("canopy", { actor: owner }),
      projector.humanSurface("canopy", { actor: worker, mode: "focus", focus_ref: "esp:canopy/work/root" }),
      projector.humanSurface("canopy", { actor: worker, visible_node_budget: 1 }),
      projector.humanSurface("canopy", { actor: worker, stale_state: { state: "stale", last_revision: core.getProjectRevision("canopy"), reason: "fixture", commands_enabled: false } }),
    ];
    expect(new Set(variants.map((projection) => projection.projection_revision))).not.toContain(baseline.projection_revision);
  });

  it("binds projection identity to effective Claim lease state and surfaces verification reopening", () => {
    let now = "2026-08-22T08:00:00.000Z";
    const core = seedMinimal();
    core.setClock(() => now);
    emit(core, worker, "claim.acquire", { id: "lease-sensitive", target_ref: "esp:canopy/work/root", mode: "primary", lease_seconds: 60 });
    const projector = new Projector(core);
    const beforeExpiry = projector.humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/root" });
    const revision = core.getProjectRevision("canopy");
    now = "2026-08-22T08:02:00.000Z";
    const afterExpiry = projector.humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/root" });
    expect(afterExpiry.as_of_revision).toBe(revision);
    expect(afterExpiry.projection_revision).not.toBe(beforeExpiry.projection_revision);
    expect(afterExpiry.entities.find((entity) => entity.ref.endsWith("/root"))?.claim).toMatchObject({ stale: true });

    expect(core.execute({ command_id: crypto.randomUUID(), project_id: "canopy", actor: worker, base_project_revision: core.getProjectRevision("canopy"), base_entity_versions: {}, type: "evidence.attach", occurred_at: now, payload: { id: "verified-before-reopen", target_refs: ["esp:canopy/work/root"], kind: "test", origin: "observed", ref: "fixture:verified-before-reopen", summary: "Verified", verification_state: "verified" } })).toMatchObject({ accepted: true });
    emit(core, owner, "work.verify", { work_item_ref: "esp:canopy/work/root", evidence_refs: ["esp:canopy/evidence/verified-before-reopen"], outcome: "verified", rationale: "Initial verification" });
    const since = core.getProjectRevision("canopy");
    emit(core, worker, "evidence.attach", { id: "reopen-contradiction", target_refs: ["esp:canopy/work/root"], kind: "regression", origin: "observed", ref: "fixture:reopen", summary: "Regression", verification_state: "rejected" });
    const reopenReady = projector.humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/root" });
    expect(reopenReady.command_previews.find((preview) => preview.command_type === "work.verify" && preview.action_variant === "reopen")).toMatchObject({
      available: true,
      payload: { work_item_ref: "espalier://canopy/work/root", evidence_refs: ["espalier://canopy/evidence/reopen-contradiction"], outcome: "reopen" },
    });
    emit(core, owner, "work.verify", { work_item_ref: "esp:canopy/work/root", evidence_refs: ["esp:canopy/evidence/reopen-contradiction"], outcome: "reopen", rationale: "Regression reopened verification" });
    const reopened = projector.humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/root", since_revision: since });
    expect(reopened.delta.change_reasons_by_ref["espalier://canopy/work/root"]).toContain("verification-reopened");
  });

  it("treats offset-equivalent timestamps as the same Claim instant", () => {
    let now = "2026-08-22T08:00:00+08:00";
    const core = seedMinimal();
    core.setClock(() => now);
    emit(core, worker, "claim.acquire", { id: "offset-equivalent", target_ref: "esp:canopy/work/root", mode: "primary", lease_seconds: 60 });
    const projector = new Projector(core);
    const offsetProjection = projector.humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/root" });
    now = "2026-08-22T00:00:00.000Z";
    const utcProjection = projector.humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/root" });
    expect(offsetProjection.entities.find((entity) => entity.ref.endsWith("/root"))?.claim).toMatchObject({ stale: false });
    expect(offsetProjection.attention.some((item) => item.reason === "stale-claim")).toBe(false);
    expect(offsetProjection.projection_revision).toBe(utcProjection.projection_revision);
  });

  it("restores an expired Claim pointer as stale portable state", () => {
    let now = "2026-08-22T00:00:00.000Z";
    const source = seedMinimal();
    source.setClock(() => now);
    emit(source, worker, "claim.acquire", { id: "portable-stale", target_ref: "esp:canopy/work/root", mode: "primary", lease_seconds: 60 });
    now = "2026-08-22T00:02:00.000Z";

    const restored = new EspalierCore(":memory:", { now: () => now });
    restored.restoreProject(source.exportProject("canopy"));
    const projection = new Projector(restored).humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/root" });
    expect(projection.entities.find((entity) => entity.ref.endsWith("/root"))?.claim).toMatchObject({ ref: "espalier://canopy/claim/portable-stale", stale: true });
    expect(projection.attention).toEqual(expect.arrayContaining([expect.objectContaining({ attention_ref: "espalier://canopy/claim/portable-stale", reason: "stale-claim" })]));
  });

  it("uses Core preflight for exact claim and multi-owner command availability", () => {
    const core = seedMinimal();
    emit(core, worker, "work.create", { id: "pending", epoch_id: "epoch", kind: "task", title: "Pending", scope: "Pending", semantic_surfaces: ["pending"], repo_surfaces: [], priority: 2, authority_state: "owner_pending", verification_policy: "owner" });
    emit(core, owner, "project.owner-policy.update", { owner_policy: { owners: ["example-owner", "kai"], approval: "all" } });
    const projector = new Projector(core);
    const blocked = projector.humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/pending" });
    const approval = blocked.command_previews.find((preview) => preview.action_variant === "approve-within-goal");
    expect(approval).toMatchObject({
      command_type: "work.authority.resolve",
      availability: "approval-required",
      available: false,
      payload: { work_item_ref: "espalier://canopy/work/pending", authority_state: "approved", goal_integrity: "advances" },
    });
    expect(blocked.entities.find((entity) => entity.ref.endsWith("/pending"))?.capabilities.find((capability) => capability.preview_id === approval?.preview_id)).toMatchObject({ allowed: false });
    const ownerWithoutUpdate = { ...owner, capabilities: owner.capabilities.filter((capability) => capability !== "owner-update") } as ActorIdentity;
    expect(projector.humanSurface("canopy", { actor: ownerWithoutUpdate, mode: "focus", focus_ref: "esp:canopy/work/pending" }).command_previews.find((preview) => preview.action_variant === "approve-within-goal")).toMatchObject({ availability: "unavailable", available: false, blocked_reason: "Actor lacks owner-update capability" });

    emit(core, worker, "decision.propose", {
      id: "authorize-pending",
      question: "Approve pending work?",
      proposal: "Approve within current goal",
      scope: "pending",
      authorizes: { command_type: "work.authority.resolve", target_ref: "esp:canopy/work/pending", payload: { work_item_ref: "espalier://canopy/work/pending", authority_state: "approved", goal_integrity: "advances" } },
    });
    emit(core, owner, "decision.resolve", { decision_ref: "esp:canopy/decision/authorize-pending", decision_state: "approved" });
    emit(core, secondOwner, "decision.resolve", { decision_ref: "esp:canopy/decision/authorize-pending", decision_state: "approved" });
    const authorized = projector.humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/pending" });
    expect(authorized.command_previews.find((preview) => preview.action_variant === "approve-within-goal")).toMatchObject({
      availability: "executable",
      available: true,
      payload: { approval_decision_ref: "espalier://canopy/decision/authorize-pending" },
    });

    emit(core, worker, "claim.acquire", { id: "root-primary", target_ref: "esp:canopy/work/root", mode: "primary", lease_seconds: 60 });
    const conflict = projector.humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/root" });
    expect(conflict.entities.find((entity) => entity.ref.endsWith("/root"))?.capabilities.find((capability) => capability.action === "claim")).toMatchObject({ allowed: false });
    core.setClock(() => "2026-08-22T09:00:00.000Z");
    const expired = projector.humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/root" });
    expect(expired.entities.find((entity) => entity.ref.endsWith("/root"))?.claim).toMatchObject({ ref: "espalier://canopy/claim/root-primary", mode: "primary", stale: true });
    expect(expired.entities.find((entity) => entity.ref.endsWith("/root"))?.capabilities.find((capability) => capability.action === "claim")).toMatchObject({ allowed: true });
  });

  it("keeps every executable preview in parity with a fresh Core preflight", () => {
    const core = seedMinimal();
    emit(core, worker, "work.create", { id: "pending-parity", epoch_id: "epoch", kind: "task", title: "Pending parity", scope: "Pending", semantic_surfaces: ["pending:parity"], repo_surfaces: [], priority: 2, authority_state: "owner_pending", verification_policy: "owner" });
    const projection = new Projector(core).humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/pending-parity" });
    expect(projection.command_previews.length).toBeGreaterThan(0);
    for (const preview of projection.command_previews) {
      const preflight = core.preflight({ command_id: `${preview.preview_id}-parity`, project_id: "canopy", actor: owner, base_project_revision: preview.base_project_revision, base_entity_versions: preview.base_entity_versions, type: preview.command_type, occurred_at: core.currentTime(), payload: preview.payload });
      expect(preview.available, `${preview.command_type}:${preview.action_variant}`).toBe(preflight.executable);
    }
  });

  it("owns the action catalog for verification, integration, lane return, handoff, and Evidence attachment", () => {
    const core = seedMinimal();
    emit(core, worker, "evidence.attach", { id: "catalog-proof", target_refs: ["esp:canopy/work/root"], kind: "test", origin: "observed", ref: "fixture:catalog", summary: "Catalog proof", verification_state: "verified" });
    emit(core, owner, "batch.create", { id: "catalog-batch", parent_work_item_ref: "esp:canopy/work/root", lanes: [{ id: "catalog-lane", outcome: "Return a result", scope: "Catalog lane", authority: "Bounded", return_contract: "Evidence", context_refs: [], semantic_surfaces: ["catalog:lane"], repo_surfaces: [] }] });
    const projection = new Projector(core).humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/root" });
    const commands = new Set(projection.command_previews.map((preview) => preview.command_type));
    for (const commandType of ["work.verify", "batch.integrate", "lane.return", "handoff.record", "evidence.attach"] as const) expect(commands.has(commandType), commandType).toBe(true);
    expect(projection.command_previews.find((preview) => preview.command_type === "lane.return")).toMatchObject({ available: false, input_requirements: expect.arrayContaining(["result_id", "summary", "evidence_ref"]) });
  });

  it("carries canonical Work verification Evidence into the receipt summary", () => {
    const core = seedMinimal();
    emit(core, worker, "evidence.attach", { id: "verified", target_refs: ["esp:canopy/work/root"], kind: "test", origin: "observed", ref: "fixture:verified", summary: "Verified", verification_state: "verified" });
    emit(core, owner, "work.verify", { work_item_ref: "esp:canopy/work/root", evidence_refs: ["esp:canopy/evidence/verified"], outcome: "verified", rationale: "Fixture contract" });
    const projection = new Projector(core).humanSurface("canopy", { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/root" });
    expect(projection.entities.find((entity) => entity.ref.endsWith("/root"))?.receipt_summary).toEqual({ verified: true, label: "verified", evidence_refs: ["espalier://canopy/evidence/verified"] });
    expect(projection.diagnostics.response_bytes).toBe(Buffer.byteLength(JSON.stringify(projection), "utf8"));
  });
});

function seedMinimal(bindingConstraints: string[] = []): EspalierCore {
  const core = new EspalierCore(":memory:", { now: () => "2026-08-22T08:00:00.000Z" });
  emit(core, owner, "project.create", { display_name: "Canopy", authority_domain: "canopy", repository_refs: [], owner_policy: { owners: ["example-owner"], approval: "any-one" } });
  emit(core, owner, "goal.approve", { id: "goal", purpose: "Render", present_consumers: [], programme_order: ["Root"], binding_constraints: bindingConstraints, trust_boundaries: [], explicit_non_goals: [], source_refs: [] });
  emit(core, owner, "epoch.open", { id: "epoch", goal_revision_id: "goal", title: "Epoch", baseline_ref: "git:test" });
  emit(core, worker, "work.create", { id: "root", epoch_id: "epoch", kind: "workstream", title: "Root", scope: "Root", semantic_surfaces: ["root"], repo_surfaces: [], priority: 1, verification_policy: "test" });
  return core;
}

function emit(core: EspalierCore, actor: ActorIdentity, type: CommandEnvelope["type"], payload: Record<string, unknown>): void {
  const receipt = core.execute({ command_id: crypto.randomUUID(), project_id: "canopy", actor, base_project_revision: core.getProjectRevision("canopy"), base_entity_versions: {}, type, occurred_at: "2026-08-22T08:00:00Z", payload });
  if (!receipt.accepted) throw new Error(receipt.reason);
}
