import type { EspalierCore } from "@espalier/core";
import type { ActorIdentity, CommandEnvelope, CommandType } from "@espalier/protocol";

export const fixtureOwner: ActorIdentity = {
  principal_id: "example-owner",
  runtime_id: "contract-fixture",
  device_id: "local",
  session_id: "orchard-seed-owner",
  role: "owner",
  capabilities: ["read", "write", "claim", "evidence", "owner-update", "coordinate"],
};

export const fixtureWorker: ActorIdentity = {
  principal_id: "example-agent",
  runtime_id: "example-agent-runtime",
  device_id: "local",
  session_id: "orchard-seed-agent",
  role: "worker",
  capabilities: ["read", "write", "claim", "evidence"],
};

export function seedExampleFixture(core: EspalierCore): { seeded: boolean; revision: number } {
  const projectId = "orchard";
  if (core.getProjectRevision(projectId) > 0) return { seeded: false, revision: core.getProjectRevision(projectId) };

  const emit = (actor: ActorIdentity, type: CommandType, payload: Record<string, unknown>) => {
    const receipt = core.execute({
      command_id: crypto.randomUUID(),
      project_id: projectId,
      actor,
      base_project_revision: core.getProjectRevision(projectId),
      base_entity_versions: {},
      type,
      occurred_at: "2026-08-27T08:00:00Z",
      payload,
    } satisfies CommandEnvelope);
    if (!receipt.accepted) throw new Error(`Fixture command ${type} rejected: ${receipt.reason}`);
  };

  emit(fixtureOwner, "project.create", {
    display_name: "Orchard",
    authority_domain: projectId,
    repository_refs: ["repo:example/orchard"],
    owner_policy: { owners: [fixtureOwner.principal_id], approval: "any-one" },
  });
  emit(fixtureOwner, "goal.approve", {
    id: "goal-1",
    purpose: "Publish a reliable local-first field guide without losing owner judgment",
    present_consumers: ["first-time reader", "returning agent", "release owner"],
    programme_order: ["Source contract", "Reader onboarding", "Service lifecycle", "Release package"],
    binding_constraints: ["Repository source stays authoritative", "Observed evidence does not imply owner acceptance", "Private working continuity never enters the public tree"],
    trust_boundaries: ["Owner controls publication", "Agents may report evidence but cannot invent approval"],
    explicit_non_goals: ["The example fixture is not imported project truth"],
    source_refs: ["docs:getting-started@example"],
  });
  emit(fixtureOwner, "epoch.open", { id: "epoch-1", goal_revision_id: "goal-1", title: "Public-readiness programme", baseline_ref: "baseline_as_of:2026-08-27" });

  const work = [
    { id: "source-contract", title: "Source contract", scope: "Keep code, formal documents, and provenance refs authoritative", semantic_surfaces: ["source:authority"], repo_surfaces: ["packages/protocol", "AGENTS.md"] },
    { id: "reader-onboarding", title: "Reader onboarding", scope: "Make the first source run and product boundary understandable", semantic_surfaces: ["docs:onboarding"], repo_surfaces: ["README.md", "docs"] },
    { id: "service-lifecycle", title: "Service lifecycle", scope: "Keep the loopback service inspectable across terminal closure", semantic_surfaces: ["runtime:lifecycle"], repo_surfaces: ["apps/server", "scripts"] },
    { id: "release-package", title: "Release package", scope: "Prepare an audited public source tree and release evidence", semantic_surfaces: ["release:public"], repo_surfaces: [".github", "package.json"] },
    { id: "visual-language", title: "Production visual language", scope: "Complete the general Human Surface only after product comprehension holds", semantic_surfaces: ["surface:visual-language"], repo_surfaces: ["apps/web"], work_state: "proposed", authority_state: "owner_pending", goal_integrity: "research-only" },
  ];
  for (const item of work) {
    emit(item.id === "source-contract" ? fixtureOwner : fixtureWorker, "work.create", {
      epoch_id: "epoch-1",
      kind: "workstream",
      priority: 1,
      verification_policy: item.id === "reader-onboarding" ? "tests plus first-time reader comprehension" : "explicit evidence",
      ...item,
    });
  }

  emit(fixtureWorker, "evidence.attach", { id: "source-contract-tests", target_refs: ["esp:orchard/work/source-contract"], kind: "test", origin: "observed", ref: "test:source-contract", summary: "Protocol and authority contract tests passed", verification_state: "verified" });
  emit(fixtureOwner, "work.verify", { work_item_ref: "esp:orchard/work/source-contract", evidence_refs: ["esp:orchard/evidence/source-contract-tests"], outcome: "verified", rationale: "The named contract tests satisfy the verification policy" });
  emit(fixtureOwner, "batch.create", { id: "source-integration", title: "Source integration", parent_work_item_ref: "esp:orchard/work/source-contract", lanes: [{ id: "source-integration-lane", title: "Source integration lane", outcome: "Return the verified source contract", scope: "Integrate the verified contract without changing its authority", context_refs: [], authority: "within the approved source-contract scope", return_contract: "observed result Evidence", semantic_surfaces: [], repo_surfaces: [] }] });
  emit(fixtureWorker, "claim.acquire", { id: "claim-source-integration", target_ref: "esp:orchard/lane/source-integration-lane", mode: "primary", lease_seconds: 600 });
  emit(fixtureWorker, "lane.return", { lane_ref: "esp:orchard/lane/source-integration-lane", result_id: "source-integration-result", summary: "Verified source contract returned", evidence_ref: "test:source-integration" });
  emit(fixtureOwner, "batch.integrate", { batch_ref: "esp:orchard/batch/source-integration" });

  emit(fixtureWorker, "claim.acquire", { id: "claim-agent-onboarding", target_ref: "esp:orchard/work/reader-onboarding", mode: "primary", lease_seconds: 86_400, handoff_required: true });
  emit(fixtureWorker, "work.transition", { work_item_ref: "esp:orchard/work/reader-onboarding", work_state: "implemented" });
  emit(fixtureOwner, "batch.create", { id: "onboarding-integration", title: "Onboarding integration", parent_work_item_ref: "esp:orchard/work/reader-onboarding", lanes: [{ id: "onboarding-integration-lane", title: "Onboarding integration lane", outcome: "Return the tested onboarding path", scope: "Prepare the first-time reader candidate", context_refs: [], authority: "within the approved onboarding scope", return_contract: "observed result Evidence", semantic_surfaces: [], repo_surfaces: [] }] });
  emit(fixtureWorker, "claim.acquire", { id: "claim-onboarding-integration", target_ref: "esp:orchard/lane/onboarding-integration-lane", mode: "primary", lease_seconds: 600 });
  emit(fixtureWorker, "lane.return", { lane_ref: "esp:orchard/lane/onboarding-integration-lane", result_id: "onboarding-integration-result", summary: "Onboarding candidate awaits coordinator integration", evidence_ref: "test:onboarding-integration" });

  emit(fixtureWorker, "relation.create", { id: "source-to-onboarding", title: "Source contract informs onboarding", source_ref: "esp:orchard/work/source-contract", target_ref: "esp:orchard/work/reader-onboarding", relation_type: "provides_capability_to" });
  emit(fixtureWorker, "relation.create", { id: "lifecycle-to-release", title: "Stable lifecycle enables release", source_ref: "esp:orchard/work/service-lifecycle", target_ref: "esp:orchard/work/release-package", relation_type: "provides_capability_to" });
  emit(fixtureWorker, "relation.create", { id: "onboarding-to-release", title: "Onboarding is required for release", source_ref: "esp:orchard/work/reader-onboarding", target_ref: "esp:orchard/work/release-package", relation_type: "depends_on" });
  emit(fixtureOwner, "annotation.add", { id: "reader-comprehension", anchor_ref: "esp:orchard/work/reader-onboarding", anchor_revision: core.getProjectRevision(projectId), kind: "concern", body: "A first-time reader must understand the product before publication", requested_action: "Run a fresh-reader challenge and accept or request correction" });
  emit(fixtureWorker, "decision.propose", { id: "public-license", question: "Which license map should govern the public source tree?", proposal: "Select terms by material class after the rights audit", scope: "public release", rationale: "Repository visibility must not silently imply a reuse grant", source_refs: [] });
  emit(fixtureWorker, "evidence.attach", { id: "onboarding-tests", target_refs: ["esp:orchard/work/reader-onboarding"], kind: "test", origin: "observed", ref: "test:public-onboarding", summary: "The documented source path passed in an isolated data directory", verification_state: "verified" });
  return { seeded: true, revision: core.getProjectRevision(projectId) };
}
