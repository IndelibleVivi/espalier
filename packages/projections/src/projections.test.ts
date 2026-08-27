import { describe, expect, it } from "vitest";
import { EspalierCore } from "@espalier/core";
import type { ActorIdentity, CommandEnvelope } from "@espalier/protocol";
import { Projector } from "./index.js";

const owner: ActorIdentity = { principal_id: "example-owner", runtime_id: "test", device_id: "test", session_id: "owner", role: "owner", capabilities: ["read", "write", "claim", "owner-update", "coordinate"] };
const worker: ActorIdentity = { principal_id: "example-worker", runtime_id: "test", device_id: "test", session_id: "worker", role: "worker", capabilities: ["read", "write", "claim", "evidence"] };
function emit(core: EspalierCore, actor: ActorIdentity, type: CommandEnvelope["type"], payload: Record<string, unknown>) {
  const result = core.execute({ command_id: crypto.randomUUID(), project_id: "garden", actor, base_project_revision: core.getProjectRevision("garden"), base_entity_versions: {}, type, occurred_at: "2026-08-22T00:00:00Z", payload });
  expect(result.accepted).toBe(true);
}

it("keeps Live, Focus, Decisions, and Atlas on one project revision", () => {
  const core = new EspalierCore(":memory:", { now: () => "2026-08-22T00:00:00.000Z" });
  emit(core, owner, "project.create", { display_name: "Garden", authority_domain: "garden", repository_refs: [], owner_policy: { owners: ["example-owner"], approval: "any-one" } });
  emit(core, owner, "goal.approve", { id: "goal-1", purpose: "Grow carefully", present_consumers: [], programme_order: [], binding_constraints: [], trust_boundaries: [], explicit_non_goals: [], source_refs: [] });
  emit(core, owner, "epoch.open", { id: "epoch-1", goal_revision_id: "goal-1", title: "First growth", baseline_ref: "git:a" });
  emit(core, worker, "work.create", { id: "branch", epoch_id: "epoch-1", kind: "workstream", title: "Branch", scope: "Branch", semantic_surfaces: ["branch"], repo_surfaces: [], priority: 1, verification_policy: "test" });
  emit(core, owner, "batch.create", { id: "branch-batch", parent_work_item_ref: "esp:garden/work/branch", lanes: [{ id: "branch-lane", outcome: "Return branch evidence", scope: "Branch lane", authority: "Bounded", return_contract: "Evidence", context_refs: [], semantic_surfaces: ["branch:lane"], repo_surfaces: [] }] });
  emit(core, worker, "claim.acquire", { id: "branch-lane-claim", target_ref: "esp:garden/lane/branch-lane", mode: "primary", lease_seconds: 600 });
  emit(core, worker, "lane.return", { lane_ref: "esp:garden/lane/branch-lane", result_id: "branch-lane-result", summary: "Branch lane returned", evidence_ref: "fixture:branch-lane" });
  emit(core, worker, "claim.acquire", { id: "branch-claim", target_ref: "esp:garden/work/branch", mode: "primary", lease_seconds: 600 });
  emit(core, worker, "decision.propose", { id: "decision-1", question: "Change direction?", proposal: "Turn left", scope: "programme", rationale: "observation" });
  expect(core.execute({ command_id: crypto.randomUUID(), project_id: "library", actor: owner, base_project_revision: 0, base_entity_versions: {}, type: "project.create", occurred_at: "2026-08-22T00:00:00Z", payload: { display_name: "Library", authority_domain: "library", repository_refs: [], owner_policy: { owners: ["example-owner"], approval: "any-one" } } }).accepted).toBe(true);
  expect(core.execute({ command_id: crypto.randomUUID(), project_id: "garden", actor: worker, base_project_revision: core.getProjectRevision("garden"), base_entity_versions: {}, type: "relation.create", occurred_at: "2026-08-22T00:00:00Z", payload: { id: "unsafe-cross", source_ref: "esp:garden/work/branch", target_ref: "esp:library/project/library", relation_type: "depends_on", authority_state: "within_scope" } })).toMatchObject({ accepted: false, code: "authority" });
  emit(core, worker, "relation.create", { id: "proposed-cross", source_ref: "esp:garden/work/branch", target_ref: "esp:library/project/library", relation_type: "observes", authority_state: "proposal" });
  emit(core, owner, "relation.create", { id: "binding-cross", source_ref: "esp:garden/work/branch", target_ref: "esp:library/project/library", relation_type: "depends_on", authority_state: "approved" });

  const projector = new Projector(core);
  const live = projector.live("garden");
  const focus = projector.focus("esp:garden/work/branch");
  const anchoredFocus = projector.focus("esp:garden/work/branch@4");
  const decisions = projector.decisions("garden");
  const atlas = projector.atlas("garden");
  const dca = projector.dca("garden", "esp:garden/work/branch");
  const portfolio = projector.portfolio();
  expect(new Set([live.as_of_revision, focus.as_of_revision, decisions.as_of_revision, atlas.as_of_revision]).size).toBe(1);
  expect(live.attention.map((item) => item.category)).toEqual(expect.arrayContaining(["owner-decision", "lane-ready"]));
  expect(live.decisions.map((item) => item.id)).toContain("decision-1");
  expect(focus.selected.id).toBe("branch");
  expect(anchoredFocus).toMatchObject({ anchor_revision: 4, anchor: { entity_version: 1 }, selected: { entity_version: 3 }, changes_since_anchor: expect.arrayContaining([expect.objectContaining({ type: "lane.return.accepted" }), expect.objectContaining({ type: "claim.acquire.accepted" })]) });
  expect(atlas.entities.length).toBe(core.listEntities("garden").length);
  expect(dca).toMatchObject({ format: "espalier.dca-snapshot/1", source_revision: live.as_of_revision, focus_ref: "espalier://garden/work/branch" });
  expect(dca.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ ref: "espalier://garden/work/branch", state: expect.objectContaining({ work: "active" }) })]));
  expect(dca.nodes[0]).not.toHaveProperty("geometry");
  expect(portfolio).toMatchObject({ schema_version: "espalier.human-portfolio@0", mode: "portfolio", diagnostics: { geometry_fields: 0 } });
  expect(portfolio.projects).toHaveLength(2);
  expect(portfolio.projects.find((item) => item.project_id === "garden")).toMatchObject({ as_of_revision: live.as_of_revision, owner_policy: { owners: ["example-owner"], approval: "any-one" }, goal: { ref: "espalier://garden/goal/goal-1" }, epoch: { ref: "espalier://garden/epoch/epoch-1" } });
  expect(portfolio.cross_project_relations.map((relation) => relation.ref)).toEqual(["espalier://garden/relation/binding-cross", "espalier://garden/relation/proposed-cross"]);
  expect(portfolio.diagnostics.response_bytes).toBe(Buffer.byteLength(JSON.stringify(portfolio), "utf8"));
});

it("discovers cross-project Relations from omitted authority projects before applying the project budget", () => {
  const core = new EspalierCore(":memory:", { now: () => "2026-08-22T00:00:00.000Z" });
  for (const projectId of ["alpha", "zeta"]) {
    expect(core.execute({ command_id: crypto.randomUUID(), project_id: projectId, actor: owner, base_project_revision: 0, base_entity_versions: {}, type: "project.create", occurred_at: "2026-08-22T00:00:00Z", payload: { display_name: projectId, authority_domain: projectId, repository_refs: [], owner_policy: { owners: ["example-owner"], approval: "any-one" } } })).toMatchObject({ accepted: true });
  }
  expect(core.execute({ command_id: crypto.randomUUID(), project_id: "zeta", actor: owner, base_project_revision: core.getProjectRevision("zeta"), base_entity_versions: {}, type: "relation.create", occurred_at: "2026-08-22T00:00:00Z", payload: { id: "zeta-depends-alpha", source_ref: "esp:zeta/project/zeta", target_ref: "esp:alpha/project/alpha", relation_type: "depends_on", authority_state: "approved" } })).toMatchObject({ accepted: true });

  const portfolio = new Projector(core).portfolio({ project_budget: 1, relation_budget: 10 });
  expect(portfolio.projects.map((project) => project.project_id)).toEqual(["alpha"]);
  expect(portfolio.cross_project_relations).toEqual([expect.objectContaining({ ref: "espalier://zeta/relation/zeta-depends-alpha", authority_project_id: "zeta", external_project_ids: expect.arrayContaining(["zeta"]) })]);
  expect(portfolio.omitted_counts.relations).toBe(0);
});

it("bounds oversized Portfolio summaries and returns a typed irreducible-budget failure", () => {
  const core = new EspalierCore(":memory:", { now: () => "2026-08-22T00:00:00.000Z" });
  emit(core, owner, "project.create", { display_name: "Garden", authority_domain: "garden", repository_refs: [], owner_policy: { owners: ["example-owner"], approval: "any-one" } });
  emit(core, owner, "goal.approve", { id: "goal-large", purpose: "p".repeat(400_000), present_consumers: [], programme_order: [], binding_constraints: [], trust_boundaries: [], explicit_non_goals: [], source_refs: [] });
  const portfolio = new Projector(core).portfolio();
  expect(portfolio.projects[0]?.goal).toMatchObject({ ref: "espalier://garden/goal/goal-large", purpose: expect.stringMatching(/…$/) });
  expect(portfolio.projects[0]!.goal!.purpose.length).toBeLessThanOrEqual(600);
  expect(portfolio.diagnostics.response_bytes).toBeLessThanOrEqual(portfolio.diagnostics.budgets.response_byte_budget);

  try {
    new Projector(core).portfolio({ response_byte_budget: 64 });
    expect.unreachable("Mandatory Portfolio identity should not fit in 64 bytes");
  } catch (error) {
    expect(error).toMatchObject({
      name: "HumanPortfolioBudgetError",
      code: "response-budget-too-small-for-mandatory-portfolio",
      budget_bytes: 64,
      required_bytes: expect.any(Number),
      expansion_refs: expect.arrayContaining(["espalier://garden/project/garden", "espalier://garden/goal/goal-large"]),
    });
  }
});

it("bounds a large Live projection without deleting canonical work or reordering existing peers", () => {
  const core = new EspalierCore(":memory:", { now: () => "2026-08-22T00:00:00.000Z" });
  emit(core, owner, "project.create", { display_name: "Garden", authority_domain: "garden", repository_refs: [], owner_policy: { owners: ["example-owner"], approval: "any-one" } });
  emit(core, owner, "goal.approve", { id: "goal-1", purpose: "Bounded growth", present_consumers: [], programme_order: [], binding_constraints: [], trust_boundaries: [], explicit_non_goals: [], source_refs: [] });
  emit(core, owner, "epoch.open", { id: "epoch-1", goal_revision_id: "goal-1", title: "Growth", baseline_ref: "git:a" });
  for (const [id, title] of [["first", "Zulu"], ["second", "Alpha"], ["third", "Beta"], ["fourth", "Gamma"]]) emit(core, worker, "work.create", { id, epoch_id: "epoch-1", kind: "task", title, scope: title, semantic_surfaces: [id], repo_surfaces: [], priority: 1, verification_policy: "test" });
  for (let index = 0; index < 6; index += 1) emit(core, worker, "annotation.add", { id: `note-${index}`, anchor_ref: "esp:garden/work/first", anchor_revision: core.getProjectRevision("garden"), kind: "concern", body: `Concern ${index}` });

  const projection = new Projector(core).live("garden", { visible_node_budget: 2, collection_budget: 2, event_budget: 2 });
  expect(projection.work_items.map((work) => work.id)).toEqual(["first", "second"]);
  expect(projection.annotations).toHaveLength(2);
  expect(projection.attention).toHaveLength(2);
  expect(projection.recent_events).toHaveLength(2);
  expect(projection.recent_events[0]).not.toHaveProperty("payload");
  expect(projection.omitted_counts).toMatchObject({ work_items: 2, annotations: 4, attention: 4, events: expect.any(Number) });
  expect(core.listEntities("garden", "work")).toHaveLength(4);
  expect(core.listEntities("garden", "annotation")).toHaveLength(6);
});
