import { EspalierCore } from "@espalier/core";
import type { ActorIdentity, CommandEnvelope, CommandReceipt } from "@espalier/protocol";
import { deriveAttention } from "./attention.js";
import { compileHumanSurface, createPersonalViewState, type HumanSurfaceOptions, type HumanSurfaceProjection, type PersonalViewState } from "./human-surface.js";

export const humanSurfaceFixtureIds = [
  "canopy-normal-live",
  "canopy-meaningful-delta",
  "research-only-side-branch",
  "owner-pending-proposal",
  "relation-concern-stale-annotation",
  "claim-overlap-batch-conflict",
  "compacted-verified-history",
  "stale-disconnected",
  "bilingual-stress",
  "large-synthetic-map",
  "theme-equivalence",
] as const;

export type HumanSurfaceFixtureId = (typeof humanSurfaceFixtureIds)[number];

export interface HumanSurfaceFixture {
  id: HumanSurfaceFixtureId;
  description: string;
  projection: HumanSurfaceProjection;
  view_states: PersonalViewState[];
  review_prompts: string[];
  contract_evidence: CommandReceipt[];
}

const owner: ActorIdentity = {
  principal_id: "example-owner",
  runtime_id: "fixture-owner",
  device_id: "fixture-device",
  session_id: "fixture-owner-session",
  role: "owner",
  capabilities: ["read", "write", "claim", "evidence", "owner-update", "coordinate"],
};

const worker: ActorIdentity = {
  principal_id: "example-worker",
  runtime_id: "fixture-worker",
  device_id: "fixture-device",
  session_id: "fixture-worker-session",
  role: "worker",
  capabilities: ["read", "write", "claim", "evidence"],
};

const secondWorker: ActorIdentity = { ...worker, principal_id: "example-collaborator", runtime_id: "kimi-code", session_id: "fixture-example-collaborator-session" };

export function createHumanSurfaceFixtures(): Record<HumanSurfaceFixtureId, HumanSurfaceFixture> {
  const fixtures = {} as Record<HumanSurfaceFixtureId, HumanSurfaceFixture>;

  {
    const { core } = seedRefrain();
    fixtures["canopy-normal-live"] = fixture("canopy-normal-live", "Owner-approved Canopy programme with active routes, a deferred Canvas branch, research-only work, owner-pending work, and a verified outcome.", surface(core, { actor: owner, mode: "live" }), ["Identify the approved programme and active routes", "Find the deferred and research-only boundaries", "Locate the latest verified outcome"]);
    core.close();
  }

  {
    const { core } = seedRefrain();
    const since = core.getProjectRevision("canopy");
    emit(core, worker, "claim.acquire", { id: "claim-sound-delta", target_ref: "esp:canopy/work/sound-resolution", mode: "primary", lease_seconds: 600 });
    emit(core, worker, "evidence.attach", { id: "sound-delta-proof", target_refs: ["esp:canopy/work/sound-resolution"], kind: "acceptance", origin: "observed", ref: "fixture:sound-delta", summary: "Sound branch verification completed", verification_state: "verified" });
    emit(core, owner, "work.verify", { work_item_ref: "esp:canopy/work/sound-resolution", evidence_refs: ["esp:canopy/evidence/sound-delta-proof"], outcome: "verified", rationale: "Fixture verification policy satisfied" });
    emit(core, owner, "relation.supersede", { relation_ref: "esp:canopy/relation/sound-to-render" });
    emit(core, worker, "decision.propose", { id: "owner-listening-question", question: "Accept the current listening target?", proposal: "Promote tested sound resolution after owner listening", scope: "sound acceptance", rationale: "Automated evidence cannot establish taste", authorizes: { command_type: "work.authority.resolve", target_ref: "esp:canopy/work/sound-resolution", payload: { work_item_ref: "esp:canopy/work/sound-resolution", authority_state: "approved" } } });
    fixtures["canopy-meaningful-delta"] = fixture("canopy-meaningful-delta", "A return after meaningful changes: evidence threshold, material relation, and an owner question; routine claim acquisition stays out of the delta emphasis.", surface(core, { actor: owner, mode: "live", since_revision: since }), ["Confirm the changed route auto-opens", "Confirm the owner question is map-located", "Confirm unrelated stable routes do not gain change reasons"]);
    core.close();
  }

  {
    const { core } = seedRefrain();
    fixtures["research-only-side-branch"] = fixture("research-only-side-branch", "A repository investigation remains near Sound resolution without becoming an accepted programme dependency.", surface(core, { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/runtime-investigation" }), ["Identify research-only status without relying on color", "Trace its typed relation to Sound resolution"]);
    core.close();
  }

  {
    const { core } = seedRefrain();
    fixtures["owner-pending-proposal"] = fixture("owner-pending-proposal", "An agent-proposed adaptive mastering capability appears near its desired insertion point but is not approved programme work.", surface(core, { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/adaptive-mastering" }), ["Confirm owner-pending does not resemble approved work", "Inspect explicit allowed capabilities rather than inferring from role labels"]);
    core.close();
  }

  {
    const { core } = seedRefrain();
    emit(core, owner, "annotation.add", { id: "relation-concern", anchor_ref: "esp:canopy/relation/sound-to-render", anchor_revision: core.getProjectRevision("canopy"), kind: "concern", body: "Does rendering still depend on this exact sound contract?" });
    const since = core.getProjectRevision("canopy");
    emit(core, owner, "relation.supersede", { relation_ref: "esp:canopy/relation/sound-to-render" });
    emit(core, worker, "evidence.attach", { id: "post-supersession-observation", target_refs: ["esp:canopy/work/sound-resolution"], kind: "observation", origin: "observed", ref: "fixture:post-supersession", summary: "Later evidence proves the historical relation boundary is not the current projection revision", verification_state: "unverified" });
    fixtures["relation-concern-stale-annotation"] = fixture("relation-concern-stale-annotation", "A first-class Relation changed after an anchored concern, so the concern is stale and retains its original anchor revision.", surface(core, { actor: owner, mode: "focus", focus_ref: "esp:canopy/relation/sound-to-render", since_revision: since }), ["Select and inspect the Relation as a first-class target", "Locate the stale annotation and retained anchor revision"]);
    core.close();
  }

  {
    const { core } = seedRefrain();
    emit(core, owner, "batch.create", { id: "render-batch", title: "Runtime render lanes", parent_work_item_ref: "esp:canopy/work/rendering", lanes: [
      { id: "browser-lane", title: "Browser lane", outcome: "Browser playback evidence", scope: "Browser runtime", context_refs: ["esp:canopy/work/sound-resolution"], authority: "Within approved rendering scope", return_contract: "Observed browser evidence", semantic_surfaces: ["render:browser"], repo_surfaces: ["packages/audio"] },
      { id: "headless-lane", title: "Headless lane", outcome: "Headless export evidence", scope: "Headless runtime", context_refs: ["esp:canopy/work/sound-resolution"], authority: "Within approved rendering scope", return_contract: "Observed headless evidence", semantic_surfaces: ["render:headless"], repo_surfaces: ["packages/audio/render"] },
    ] });
    const staleBase = core.getProjectRevision("canopy");
    const staleRenderingVersion = core.requireEntity("canopy", "work", "rendering").entity_version;
    emit(core, owner, "work.authority.resolve", { work_item_ref: "esp:canopy/work/rendering", authority_state: "within_scope" });
    emit(core, worker, "evidence.attach", { id: "browser-lane-note", target_refs: ["esp:canopy/lane/browser-lane"], kind: "lane-observation", origin: "observed", ref: "fixture:browser-lane", summary: "Browser lane additive observation retained independently", verification_state: "unverified" });
    emit(core, secondWorker, "evidence.attach", { id: "headless-lane-note", target_refs: ["esp:canopy/lane/headless-lane"], kind: "lane-observation", origin: "observed", ref: "fixture:headless-lane", summary: "Headless lane additive observation retained independently", verification_state: "unverified" });
    const staleMutation = attempt(core, worker, "work.transition", { work_item_ref: "esp:canopy/work/rendering", work_state: "implemented" }, { base_project_revision: staleBase, base_entity_versions: { "espalier://canopy/work/rendering": staleRenderingVersion } });
    emit(core, worker, "claim.acquire", { id: "claim-browser-lane", target_ref: "esp:canopy/lane/browser-lane", mode: "primary", semantic_surfaces: ["render:browser"], repo_surfaces: ["packages/audio"], lease_seconds: 600 });
    emit(core, secondWorker, "claim.acquire", { id: "claim-headless-lane", target_ref: "esp:canopy/lane/headless-lane", mode: "primary", semantic_surfaces: ["render:headless"], repo_surfaces: ["packages/audio/render"], lease_seconds: 600 });
    const overlappingClaim = attempt(core, secondWorker, "claim.acquire", { id: "rejected-overlap", target_ref: "esp:canopy/lane/headless-lane", mode: "primary", semantic_surfaces: ["render:browser"], repo_surfaces: ["packages/audio/render"], lease_seconds: 600 });
    fixtures["claim-overlap-batch-conflict"] = fixture("claim-overlap-batch-conflict", "Two runtimes retain additive Evidence while Core rejects an overlapping semantic Claim and a stale mutation; the surviving primary writers still expose the localized repo integration warning.", surface(core, { actor: owner, mode: "attention" }), ["Locate both claim anchors", "Confirm the conflict is actionable and map-located"], undefined, [staleMutation, overlappingClaim]);
    core.close();
  }

  {
    const { core } = seedRefrain();
    emit(core, worker, "decision.propose", { id: "accepted-baseline-decision", question: "Retain the AIR authorship boundary?", proposal: "Carry the owner-approved AIR boundary into the next baseline", scope: "epoch baseline", source_refs: ["repo:canopy/AIR.md@r4"] });
    emit(core, owner, "decision.resolve", { decision_ref: "esp:canopy/decision/accepted-baseline-decision", decision_state: "approved", rationale: "Accepted for the next baseline" });
    emit(core, owner, "epoch.freeze", { epoch_ref: "esp:canopy/epoch/epoch-01" });
    emit(core, owner, "epoch.compact", { epoch_ref: "esp:canopy/epoch/epoch-01", receipt_id: "epoch-01-compaction", next_epoch: { id: "epoch-02", title: "Integrated performance", baseline_ref: "git:canopy@epoch-02" } });
    emit(core, owner, "epoch.archive", { epoch_ref: "esp:canopy/epoch/epoch-01" });
    fixtures["compacted-verified-history"] = fixture("compacted-verified-history", "Archived epoch history retains its compaction receipt, verified work, accepted baseline, and carried unresolved work in Atlas.", surface(core, { actor: owner, mode: "atlas" }), ["Find the archived epoch and compaction receipt", "Distinguish carried work from compacted verified history"]);
    core.close();
  }

  {
    const { core } = seedRefrain();
    const projection = surface(core, { actor: owner, mode: "live", stale_state: { state: "disconnected", last_revision: core.getProjectRevision("canopy"), last_updated: "2026-08-22T08:00:00.000Z", reason: "Fixture network boundary", commands_enabled: false } });
    fixtures["stale-disconnected"] = fixture("stale-disconnected", "A last-known-good projection remains readable while all semantic commands are explicitly non-canonical until reconnection.", projection, ["Confirm disconnected state is unmistakable", "Confirm no pending visual state masquerades as an accepted receipt"]);
    core.close();
  }

  {
    const { core } = seedRefrain();
    emit(core, worker, "work.create", { id: "bilingual-performance", epoch_id: "epoch-01", parent_id: "rendering", kind: "task", title: "舞台 Preview / headless parity", scope: "验证中文标点、long-stable-ref 与 code-switching label", semantic_surfaces: ["render:bilingual"], repo_surfaces: ["packages/render/bilingual"], priority: 2, verification_policy: "CJK and Latin browser fixtures" });
    emit(core, owner, "annotation.add", { id: "cjk-note", anchor_ref: "esp:canopy/work/bilingual-performance", anchor_revision: core.getProjectRevision("canopy"), kind: "note", body: "中文与 English 需要 natural code-switching，并保留 canonical enum。" });
    fixtures["bilingual-stress"] = fixture("bilingual-stress", "Chinese, English enums, natural code-switching, long refs, and CJK annotation text share one renderer-neutral projection.", surface(core, { actor: owner, mode: "focus", focus_ref: "esp:canopy/work/bilingual-performance" }), ["Check CJK and Latin fields remain distinct", "Check full titles and stable refs remain available"]);
    core.close();
  }

  {
    const { core } = seedRefrain();
    for (let index = 1; index <= 54; index += 1) {
      const id = `synthetic-${String(index).padStart(3, "0")}`;
      emit(core, worker, "work.create", { id, epoch_id: "epoch-01", kind: "workstream", title: `Synthetic bounded route ${index}`, scope: "Large-map projection budget fixture", semantic_surfaces: [`synthetic:${index}`], repo_surfaces: [`packages/synthetic/${index}`], priority: index + 10, ...(index % 11 === 0 ? { authority_state: "owner_pending" } : {}), verification_policy: "fixture only" });
      emit(core, worker, "relation.create", { id: `synthetic-edge-${index}`, source_ref: `esp:canopy/work/${id}`, target_ref: index % 2 === 0 ? "esp:canopy/work/sound-resolution" : "esp:canopy/work/rendering", relation_type: index % 3 === 0 ? "depends_on" : "relates_to", authority_state: "within_scope" });
      if (index <= 30) emit(core, worker, "evidence.attach", { id: `synthetic-evidence-${index}`, target_refs: [`esp:canopy/work/${id}`], kind: "observation", origin: "observed", ref: `fixture:synthetic-${index}`, summary: `Synthetic evidence ${index}`, verification_state: "unverified" });
      if (index === 5 || index % 8 === 0) emit(core, owner, "annotation.add", { id: `synthetic-concern-${index}`, anchor_ref: `esp:canopy/work/${id}`, anchor_revision: core.getProjectRevision("canopy"), kind: "concern", body: `Synthetic attention ${index}` });
      if (index === 5 || index % 10 === 0) {
        emit(core, worker, "claim.acquire", { id: `synthetic-history-claim-${index}`, target_ref: `esp:canopy/work/${id}`, mode: "primary", semantic_surfaces: [`synthetic:${index}`], repo_surfaces: [`packages/synthetic/${index}`], lease_seconds: 600 });
        emit(core, worker, "work.transition", { work_item_ref: `esp:canopy/work/${id}`, work_state: "closed" });
        emit(core, worker, "claim.release", { claim_ref: `esp:canopy/claim/synthetic-history-claim-${index}` });
      }
      if (index <= 4) emit(core, index % 2 === 0 ? secondWorker : worker, "claim.acquire", { id: `synthetic-claim-${index}`, target_ref: `esp:canopy/work/${id}`, mode: "primary", semantic_surfaces: [`synthetic:${index}`], repo_surfaces: [index === 1 ? "packages/synthetic" : `packages/synthetic/${index}`], lease_seconds: 600 });
    }
    fixtures["large-synthetic-map"] = fixture("large-synthetic-map", "An adversarial Live projection combines many roots, Evidence, cross-Relations, historical work, Claims, Annotations, and Attention while deterministic aggregate Routes keep the response bounded.", surface(core, { actor: owner, mode: "live", visible_node_budget: 18, route_budget: 8, relation_budget: 16, evidence_detail_budget: 5, layout_hint_budget: 32, response_byte_budget: 120_000 }), ["Confirm omitted counts and expansion handles are explicit", "Confirm the programme remains legible without shrinking into a hairball"]);
    core.close();
  }

  {
    const { core } = seedRefrain();
    const projection = surface(core, { actor: owner, mode: "live" });
    const cool = createPersonalViewState(projection, "example-owner", "theme-cool");
    cool.theme_id = "paper-cool";
    const warm = structuredClone(cool);
    warm.device_or_saved_view = "theme-warm";
    warm.theme_id = "paper-warm";
    fixtures["theme-equivalence"] = fixture("theme-equivalence", "The same semantic projection is paired with cool and warm personal view states; route keys, palette slots, hierarchy, status, and authority remain identical.", projection, ["Compare themes without changing route identity", "Verify non-color semantic data is unchanged"], [cool, warm]);
    core.close();
  }

  return fixtures;
}

function fixture(id: HumanSurfaceFixtureId, description: string, projection: HumanSurfaceProjection, reviewPrompts: string[], viewStates?: PersonalViewState[], contractEvidence: CommandReceipt[] = []): HumanSurfaceFixture {
  return {
    id,
    description,
    projection,
    view_states: viewStates ?? [createPersonalViewState(projection, "example-owner", "fixture-default")],
    review_prompts: reviewPrompts,
    contract_evidence: contractEvidence,
  };
}

function surface(core: EspalierCore, options: HumanSurfaceOptions): HumanSurfaceProjection {
  return compileHumanSurface(core, "canopy", options, (entities) => deriveAttention(entities, core.currentTime()));
}

function seedRefrain(): { core: EspalierCore } {
  const core = new EspalierCore(":memory:", { now: () => "2026-08-22T08:00:00.000Z" });
  emit(core, owner, "project.create", { display_name: "Canopy", authority_domain: "canopy", repository_refs: ["repo:canopy"], owner_policy: { owners: ["example-owner"], approval: "any-one" } });
  emit(core, owner, "goal.approve", { id: "goal-r4", purpose: "Real-time responsive audio performance", present_consumers: ["browser performance", "headless export"], programme_order: ["AIR compiler", "Sound resolution", "Rendering"], binding_constraints: ["Host agent owns authorship", "Owner listening acceptance remains explicit"], trust_boundaries: ["Compiler makes no taste choices"], explicit_non_goals: ["Canvas aesthetics are delegated to Visual collaborator"], source_refs: ["repo:canopy/AIR.md@r4"] });
  emit(core, owner, "epoch.open", { id: "epoch-01", goal_revision_id: "goal-r4", title: "Responsive audio foundation", baseline_ref: "git:canopy@baseline" });
  emit(core, owner, "work.create", { id: "air-compiler", epoch_id: "epoch-01", kind: "workstream", title: "AIR compiler", scope: "Compile authored performance intent without making taste decisions", semantic_surfaces: ["air:compiler"], repo_surfaces: ["packages/air"], priority: 0, verification_policy: "compiler tests and owner contract review" });
  emit(core, worker, "work.create", { id: "sound-resolution", epoch_id: "epoch-01", kind: "workstream", title: "Sound resolution", scope: "Resolve loudness, spectral character, and listening boundary", semantic_surfaces: ["audio:sound"], repo_surfaces: ["packages/audio"], priority: 1, verification_policy: "tests plus owner listening" });
  emit(core, worker, "work.create", { id: "rendering", epoch_id: "epoch-01", kind: "workstream", title: "Rendering", scope: "Deliver browser and headless performance output", semantic_surfaces: ["audio:render"], repo_surfaces: ["packages/render"], priority: 2, verification_policy: "browser and headless evidence" });
  emit(core, worker, "work.create", { id: "canvas-aesthetics", epoch_id: "epoch-01", kind: "workstream", title: "Canvas aesthetics", scope: "Production visual direction owned by Visual collaborator", semantic_surfaces: ["surface:visual"], repo_surfaces: ["apps/web"], priority: 6, work_state: "proposed", verification_policy: "Example owner aesthetic acceptance" });
  emit(core, worker, "work.create", { id: "runtime-investigation", epoch_id: "epoch-01", kind: "investigation", title: "Runtime renderer investigation", scope: "Compare implementation mechanisms without promoting a dependency", semantic_surfaces: ["research:renderer"], repo_surfaces: ["notes/renderer"], priority: 4, goal_integrity: "research-only", verification_policy: "linked source refs and explicit outcome" });
  emit(core, worker, "work.create", { id: "adaptive-mastering", epoch_id: "epoch-01", kind: "workstream", title: "Adaptive mastering proposal", scope: "Proposed capability awaiting owner authority", semantic_surfaces: ["audio:mastering"], repo_surfaces: ["packages/mastering"], priority: 3, authority_state: "owner_pending", verification_policy: "owner decision" });
  emit(core, worker, "relation.create", { id: "air-to-sound", source_ref: "esp:canopy/work/air-compiler", target_ref: "esp:canopy/work/sound-resolution", relation_type: "provides_capability_to", authority_state: "within_scope" });
  emit(core, worker, "relation.create", { id: "sound-to-render", source_ref: "esp:canopy/work/sound-resolution", target_ref: "esp:canopy/work/rendering", relation_type: "depends_on", authority_state: "within_scope" });
  emit(core, worker, "relation.create", { id: "research-observes-sound", source_ref: "esp:canopy/work/runtime-investigation", target_ref: "esp:canopy/work/sound-resolution", relation_type: "observes", authority_state: "within_scope" });
  emit(core, worker, "relation.create", { id: "mastering-insertion-proposal", source_ref: "esp:canopy/work/adaptive-mastering", target_ref: "esp:canopy/work/rendering", relation_type: "provides_capability_to", authority_state: "proposal" });
  emit(core, worker, "evidence.attach", { id: "runtime-source", target_refs: ["esp:canopy/work/runtime-investigation"], kind: "source", origin: "observed", ref: "repo:canopy/packages/render/runtime.ts@fixture", summary: "Repository implementation source linked without promoting a dependency", verification_state: "verified" });
  emit(core, worker, "hypothesis.record", { id: "runtime-hypothesis", statement: "The existing renderer can remain an observed implementation detail", state: "inconclusive", tests: ["Compare browser and headless behavior"], evidence_refs: ["espalier://canopy/evidence/runtime-source"] });
  emit(core, owner, "evidence.attach", { id: "air-verification", target_refs: ["esp:canopy/work/air-compiler"], kind: "acceptance", origin: "owner-confirmed", ref: "fixture:air-verification", summary: "AIR authorship boundary verified", verification_state: "verified" });
  emit(core, owner, "work.verify", { work_item_ref: "esp:canopy/work/air-compiler", evidence_refs: ["esp:canopy/evidence/air-verification"], outcome: "verified", rationale: "Compiler tests and owner contract review passed" });
  emit(core, owner, "claim.acquire", { id: "air-close-claim", target_ref: "esp:canopy/work/air-compiler", mode: "primary", lease_seconds: 600 });
  emit(core, owner, "work.transition", { work_item_ref: "esp:canopy/work/air-compiler", work_state: "closed" });
  emit(core, owner, "claim.release", { claim_ref: "esp:canopy/claim/air-close-claim" });
  return { core };
}

function emit(core: EspalierCore, actor: ActorIdentity, type: CommandEnvelope["type"], payload: Record<string, unknown>): void {
  const receipt = core.execute({
    command_id: crypto.randomUUID(),
    project_id: "canopy",
    actor,
    base_project_revision: core.getProjectRevision("canopy"),
    base_entity_versions: {},
    type,
    occurred_at: "2026-08-22T08:00:00.000Z",
    payload,
  });
  if (!receipt.accepted) throw new Error(`Fixture command ${type} rejected: ${receipt.reason}`);
}

function attempt(core: EspalierCore, actor: ActorIdentity, type: CommandEnvelope["type"], payload: Record<string, unknown>, overrides: { base_project_revision?: number; base_entity_versions?: Record<string, number> } = {}): CommandReceipt {
  return core.execute({
    command_id: crypto.randomUUID(),
    project_id: "canopy",
    actor,
    base_project_revision: overrides.base_project_revision ?? core.getProjectRevision("canopy"),
    base_entity_versions: overrides.base_entity_versions ?? {},
    type,
    occurred_at: "2026-08-22T08:00:00.000Z",
    payload,
  });
}
