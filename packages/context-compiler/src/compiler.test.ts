import { describe, expect, it } from "vitest";
import { EspalierCore } from "@espalier/core";
import type { ActorIdentity, CommandEnvelope } from "@espalier/protocol";
import { ContextBudgetError, ContextCompiler } from "./index.js";

const owner: ActorIdentity = {
  principal_id: "example-owner", runtime_id: "codex-app", device_id: "fixture-device", session_id: "s-owner",
  role: "owner", capabilities: ["read", "write", "claim", "evidence", "owner-update", "coordinate"],
};
const worker: ActorIdentity = {
  principal_id: "example-worker", runtime_id: "codex-cli", device_id: "fixture-device", session_id: "s-worker",
  role: "worker", capabilities: ["read", "write", "claim", "evidence"],
};

function emit(core: EspalierCore, actor: ActorIdentity, type: CommandEnvelope["type"], payload: Record<string, unknown>) {
  const receipt = core.execute({
    command_id: crypto.randomUUID(), project_id: "canopy", actor,
    base_project_revision: core.getProjectRevision("canopy"), base_entity_versions: {}, type,
    occurred_at: "2026-08-22T08:00:00+08:00", payload,
  });
  expect(receipt.accepted).toBe(true);
}

function fixture(bindingConstraints = ["Compiler makes no taste choices"]) {
  const core = new EspalierCore(":memory:", { now: () => "2026-08-22T00:00:00.000Z" });
  emit(core, owner, "project.create", { display_name: "Canopy", authority_domain: "canopy", repository_refs: [], owner_policy: { owners: ["example-owner"], approval: "any-one" } });
  emit(core, owner, "goal.approve", { id: "goal-r4", purpose: "Real-time responsive audio", present_consumers: ["browser player"], programme_order: ["AIR compiler", "Sound resolution", "Audio engine"], binding_constraints: bindingConstraints, trust_boundaries: ["Owner listening is subjective acceptance"], explicit_non_goals: ["Canvas aesthetics remains deferred"], source_refs: ["repo:AIR@r4"] });
  emit(core, owner, "epoch.open", { id: "epoch-03", goal_revision_id: "goal-r4", title: "Responsive audio", baseline_ref: "git:abc" });
  for (const [id, title, surfaces] of [
    ["air-compiler", "AIR compiler", ["air:compiler"]],
    ["sound-resolution", "Sound resolution", ["audio:resolution"]],
    ["audio-engine", "Audio engine", ["audio:engine"]],
    ["midi-wav", "MIDI / WAV", ["export:audio"]],
    ["canvas-aesthetics", "Canvas aesthetics", ["canvas:taste"]],
  ] as const) emit(core, worker, "work.create", { id, epoch_id: "epoch-03", kind: "workstream", title, scope: title, semantic_surfaces: surfaces, repo_surfaces: [`packages/${id}`], priority: 1, verification_policy: "evidence" });
  emit(core, worker, "relation.create", { id: "sound-to-engine", source_ref: "esp:canopy/work/sound-resolution", target_ref: "esp:canopy/work/audio-engine", relation_type: "provides_capability_to" });
  emit(core, worker, "claim.acquire", { id: "claim-example-worker", target_ref: "esp:canopy/work/sound-resolution", mode: "primary", lease_seconds: 600 });
  emit(core, owner, "annotation.add", { id: "listen-concern", anchor_ref: "esp:canopy/work/sound-resolution", anchor_revision: core.getProjectRevision("canopy"), kind: "concern", body: "需要 Example owner listening acceptance" });
  return core;
}

describe("bounded deterministic briefs", () => {
  it("always includes the binding goal and prioritizes claim neighborhood within budget", () => {
    const core = fixture();
    const compiler = new ContextCompiler(core);
    const input = { project_id: "canopy", actor: worker, last_seen_revision: 4, context_budget_tokens: 1100, requested_projection: "normal" as const, language: "zh-CN" };
    const first = compiler.compile(input);
    const second = compiler.compile(input);
    expect(second).toEqual(first);
    expect(first.as_of_revision).toBe(core.getProjectRevision("canopy"));
    expect(first.selected_objects.some((item) => item.ref.includes("/goal/goal-r4"))).toBe(true);
    expect(first.selected_objects.some((item) => item.ref.includes("/work/sound-resolution"))).toBe(true);
    expect(first.selected_objects.some((item) => item.ref.includes("/work/audio-engine"))).toBe(true);
    expect(first.estimated_tokens).toBeLessThanOrEqual(1100);
    expect(Object.values(first.omitted_counts).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
    expect(first.expandable_refs.length).toBeGreaterThan(0);
    const claimRef = first.selected_objects.find((item) => item.object.type === "claim")?.ref;
    const taskRef = first.selected_objects.find((item) => item.object.id === "sound-resolution")?.ref;
    expect(claimRef).toBeTruthy();
    expect(taskRef).toBeTruthy();
    const resumed = compiler.compile({ ...input, current_claim_ref: claimRef!, requested_task_ref: taskRef! });
    expect(resumed.next_safe_action).toContain("Continue Sound resolution");
  });

  it("keeps every binding constraint in the authority kernel or returns a typed budget failure", () => {
    const constraints = Array.from({ length: 20 }, (_, index) => `Binding constraint ${index + 1}: ${"authority ".repeat(8)}`);
    const core = fixture(constraints);
    const compiler = new ContextCompiler(core);
    const input = { project_id: "canopy", actor: worker, last_seen_revision: core.getProjectRevision("canopy"), requested_projection: "normal" as const, language: "en" };
    const generous = compiler.compile({ ...input, context_budget_tokens: 5000 });
    expect(generous.selected_objects.find((item) => item.object.type === "goal")?.object.binding_constraints).toEqual(constraints);

    try {
      compiler.compile({ ...input, context_budget_tokens: 500 });
      expect.unreachable("The authority kernel should not fit in 500 tokens");
    } catch (error) {
      expect(error).toBeInstanceOf(ContextBudgetError);
      expect(error).toMatchObject({ code: "budget-too-small-for-authority-core", budget_tokens: 500, required_tokens: expect.any(Number), required_refs: ["espalier://canopy/project/canopy", "espalier://canopy/goal/goal-r4"] });
    }
  });

  it("emits a delta brief from last-seen revision without leaking the full Atlas", () => {
    const core = fixture();
    const since = core.getProjectRevision("canopy");
    emit(core, worker, "evidence.attach", { id: "test-evidence", target_refs: ["esp:canopy/work/sound-resolution"], kind: "test", origin: "observed", ref: "test:npm", summary: "core tests passed", verification_state: "verified" });
    const brief = new ContextCompiler(core).compile({ project_id: "canopy", actor: worker, last_seen_revision: since, context_budget_tokens: 800, requested_projection: "delta", language: "en" });
    expect(brief.changes_since_revision).toHaveLength(1);
    expect(brief.selected_objects.some((item) => item.ref.includes("test-evidence"))).toBe(true);
    expect(brief.selected_objects.length).toBeLessThan(core.listEntities("canopy").length);
  });

  it("retains a real return checkpoint ahead of released-claim churn and unrelated pending decisions", () => {
    const core = fixture();
    for (let index = 0; index < 4; index += 1) {
      emit(core, worker, "decision.propose", {
        id: `unrelated-decision-${index}`,
        question: `Unrelated owner question ${index}`,
        proposal: "Keep this outside the returning worker's immediate context.",
        scope: "Another programme lane",
        rationale: "Budget-pressure fixture",
        source_refs: [],
      });
    }
    const since = core.getProjectRevision("canopy");
    emit(core, worker, "evidence.attach", {
      id: "return-evidence",
      target_refs: ["esp:canopy/work/sound-resolution"],
      kind: "committed-source-delta",
      origin: "observed",
      ref: "git:canopy/main@return",
      summary: "A committed source delta needs inspection without implying acceptance.",
      verification_state: "unverified",
    });
    emit(core, worker, "handoff.record", {
      id: "return-handoff",
      work_item_ref: "esp:canopy/work/sound-resolution",
      current_state: "The source delta is attached and acceptance remains open.",
      next_safe_action: "Inspect the changed source and choose an exact verification lane.",
      completed: ["source delta classified"],
      blockers: [],
      open_questions: ["Which verification lane is next?"],
      evidence_refs: ["esp:canopy/evidence/return-evidence"],
      narrative: "Do not read this checkpoint as owner acceptance.",
    });
    emit(core, worker, "claim.release", { claim_ref: "esp:canopy/claim/claim-example-worker" });

    const brief = new ContextCompiler(core).compile({
      project_id: "canopy",
      actor: worker,
      requested_task_ref: "esp:canopy/work/sound-resolution",
      last_seen_revision: since,
      context_budget_tokens: 1400,
      requested_projection: "normal",
      language: "en",
    });

    expect(brief.changes_since_revision.map((change) => change.type)).toEqual([
      "evidence.attach.accepted",
      "handoff.record.accepted",
    ]);
    expect(brief.selected_objects.map((item) => item.object.id)).toContain("return-evidence");
    expect(brief.expandable_refs).toContain("espalier://canopy/handoff/return-handoff?rev=18");
    expect(brief.changes_since_revision[1]?.refs).toContain("espalier://canopy/handoff/return-handoff");
    expect(brief.selected_objects.some((item) => item.object.id === "claim-example-worker")).toBe(false);
  });

  it("does not resume work from an expired claim", () => {
    const core = fixture();
    core.setClock(() => "2026-08-22T01:00:00.000Z");
    const brief = new ContextCompiler(core).compile({ project_id: "canopy", actor: worker, last_seen_revision: core.getProjectRevision("canopy"), context_budget_tokens: 900, requested_projection: "normal", language: "en" });
    expect(brief.selected_objects.some((item) => item.ref.includes("/claim/claim-example-worker"))).toBe(false);
    expect(brief.next_safe_action).not.toContain("Continue Sound resolution");
    expect(() => new ContextCompiler(core).compile({ project_id: "canopy", actor: worker, current_claim_ref: "esp:canopy/claim/claim-example-worker", last_seen_revision: core.getProjectRevision("canopy"), context_budget_tokens: 900, requested_projection: "normal", language: "en" })).toThrow("not active");
  });

  it("enforces principal-scoped claims, read capability, and a hard serialized budget", () => {
    const core = fixture();
    const compiler = new ContextCompiler(core);
    expect(() => compiler.compile({ project_id: "canopy", actor: owner, current_claim_ref: "esp:canopy/claim/claim-example-worker", last_seen_revision: core.getProjectRevision("canopy"), context_budget_tokens: 900, requested_projection: "normal", language: "en" })).toThrow("another principal");
    expect(() => compiler.compile({ project_id: "canopy", actor: { ...worker, capabilities: ["write"] }, last_seen_revision: core.getProjectRevision("canopy"), context_budget_tokens: 900, requested_projection: "normal", language: "en" })).toThrow("read capability");
    emit(core, worker, "work.create", { id: "huge-scope", epoch_id: "epoch-03", kind: "task", title: "Huge scope", scope: "x".repeat(100_000), semantic_surfaces: [], repo_surfaces: [], priority: 0, verification_policy: "evidence" });
    const brief = compiler.compile({ project_id: "canopy", actor: worker, requested_task_ref: "esp:canopy/work/huge-scope", last_seen_revision: core.getProjectRevision("canopy"), context_budget_tokens: 500, requested_projection: "normal", language: "en" });
    expect(brief.estimated_tokens).toBeLessThanOrEqual(500);
    expect(JSON.stringify(brief)).not.toContain("x".repeat(1000));
  });

  it("compiles a claimed lane with its Outcome/Authority/Return contract, batch, parent, and bounded context", () => {
    const core = fixture();
    emit(core, owner, "batch.create", {
      id: "batch-runtime",
      title: "Runtime lanes",
      parent_work_item_ref: "esp:canopy/work/sound-resolution",
      lanes: [{ id: "lane-browser", title: "Browser runtime", outcome: "Browser playback works", scope: "Implement browser runtime", context_refs: ["esp:canopy/work/audio-engine"], authority: "No taste choices", return_contract: "Return observed test evidence", semantic_surfaces: ["runtime:browser"], repo_surfaces: ["packages/runtime/browser"] }],
    });
    emit(core, worker, "claim.acquire", { id: "claim-lane-browser", target_ref: "esp:canopy/lane/lane-browser", mode: "primary", lease_seconds: 600 });
    const brief = new ContextCompiler(core).compile({ project_id: "canopy", actor: worker, current_claim_ref: "esp:canopy/claim/claim-lane-browser", requested_task_ref: "esp:canopy/lane/lane-browser", last_seen_revision: core.getProjectRevision("canopy"), context_budget_tokens: 1200, requested_projection: "normal", language: "en" });
    expect(brief.selected_objects.map((item) => item.object)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "lane", outcome: "Browser playback works", authority_contract: "No taste choices", return_contract: "Return observed test evidence" }),
      expect.objectContaining({ type: "batch", id: "batch-runtime" }),
      expect.objectContaining({ type: "work", id: "sound-resolution" }),
      expect.objectContaining({ type: "work", id: "audio-engine" }),
    ]));
    expect(brief.next_safe_action).toContain("Continue Browser runtime");
    expect(brief.estimated_tokens).toBeLessThanOrEqual(1200);
  });

  it("keeps foreign relation endpoints out of a project brief", () => {
    const core = fixture();
    expect(core.execute({
      command_id: crypto.randomUUID(), project_id: "orchard", actor: owner,
      base_project_revision: 0, base_entity_versions: {}, type: "project.create",
      occurred_at: "2026-08-22T08:00:00+08:00",
      payload: { display_name: "Secret Orchard", authority_domain: "orchard", repository_refs: [], owner_policy: { owners: ["example-owner"], approval: "any-one" } },
    }).accepted).toBe(true);
    emit(core, owner, "relation.create", {
      id: "canopy-observes-orchard",
      source_ref: "esp:canopy/work/sound-resolution",
      target_ref: "esp:orchard/project/orchard",
      relation_type: "observes",
      authority_state: "within_scope",
    });

    const brief = new ContextCompiler(core).compile({
      project_id: "canopy", actor: worker,
      requested_task_ref: "esp:canopy/work/sound-resolution",
      last_seen_revision: core.getProjectRevision("canopy"),
      context_budget_tokens: 1200, requested_projection: "normal", language: "en",
    });
    expect(brief.selected_objects.some((item) => item.object.project_id === "orchard")).toBe(false);
    expect(brief.selected_objects.some((item) => item.object.id === "canopy-observes-orchard")).toBe(true);
    expect(() => new ContextCompiler(core).compile({
      project_id: "canopy", actor: worker,
      requested_task_ref: "esp:orchard/project/orchard",
      last_seen_revision: core.getProjectRevision("canopy"),
      context_budget_tokens: 1200, requested_projection: "normal", language: "en",
    })).toThrow("another project authority domain");
  });

  it("uses only an active primary Claim for resumable work and binds it to the requested task", () => {
    const core = fixture();
    const observer = { ...worker, principal_id: "observer", session_id: "observer-session", role: "observer" as const };
    emit(core, observer, "claim.acquire", { id: "observer-claim", target_ref: "esp:canopy/work/audio-engine", mode: "observer", lease_seconds: 600 });
    const compiler = new ContextCompiler(core);
    const automatic = compiler.compile({ project_id: "canopy", actor: observer, last_seen_revision: core.getProjectRevision("canopy"), context_budget_tokens: 900, requested_projection: "normal", language: "en" });
    expect(automatic.selected_objects.some((item) => item.object.id === "observer-claim")).toBe(false);
    expect(automatic.next_safe_action).not.toContain("Continue Audio engine");
    expect(() => compiler.compile({ project_id: "canopy", actor: observer, current_claim_ref: "esp:canopy/claim/observer-claim", last_seen_revision: core.getProjectRevision("canopy"), context_budget_tokens: 900, requested_projection: "normal", language: "en" })).toThrow("primary Claim");
    expect(() => compiler.compile({ project_id: "canopy", actor: worker, current_claim_ref: "esp:canopy/claim/claim-example-worker", requested_task_ref: "esp:canopy/work/audio-engine", last_seen_revision: core.getProjectRevision("canopy"), context_budget_tokens: 900, requested_projection: "normal", language: "en" })).toThrow("does not target the requested task");
  });

  it("uses the latest post-since entity version and reports the complete serialized budget", () => {
    const core = fixture();
    const since = core.getProjectRevision("canopy");
    emit(core, worker, "work.transition", { work_item_ref: "esp:canopy/work/sound-resolution", work_state: "blocked" });
    emit(core, worker, "work.transition", { work_item_ref: "esp:canopy/work/sound-resolution", work_state: "active" });
    const brief = new ContextCompiler(core).compile({ project_id: "canopy", actor: worker, last_seen_revision: since, context_budget_tokens: 900, requested_projection: "delta", language: "en" });
    const work = brief.selected_objects.find((item) => item.object.id === "sound-resolution")!;
    expect(work.object).toMatchObject({ work_state: "active", entity_version: core.requireEntity("canopy", "work", "sound-resolution").entity_version });
    expect(brief.estimated_tokens).toBe(Math.ceil(JSON.stringify(brief).length / 4));
    expect(brief.estimated_tokens).toBeLessThanOrEqual(900);
  });

  it("preserves the compact Lane Outcome, Scope, Authority, and Return contract under pressure", () => {
    const core = fixture();
    emit(core, owner, "batch.create", {
      id: "batch-tight",
      parent_work_item_ref: "esp:canopy/work/sound-resolution",
      lanes: [{
        id: "lane-tight",
        outcome: `Outcome ${"o".repeat(2000)}`,
        scope: `Scope ${"s".repeat(2000)}`,
        authority: `Authority ${"a".repeat(2000)}`,
        return_contract: `Return ${"r".repeat(2000)}`,
        context_refs: [], semantic_surfaces: [], repo_surfaces: [],
      }],
    });
    emit(core, worker, "claim.acquire", { id: "claim-tight", target_ref: "esp:canopy/lane/lane-tight", mode: "primary", lease_seconds: 600 });
    const compiler = new ContextCompiler(core);
    try {
      compiler.compile({ project_id: "canopy", actor: worker, current_claim_ref: "esp:canopy/claim/claim-tight", requested_task_ref: "esp:canopy/lane/lane-tight", last_seen_revision: core.getProjectRevision("canopy"), context_budget_tokens: 500, requested_projection: "normal", language: "en" });
      expect.unreachable("The required Lane contract should not fit in 500 tokens");
    } catch (error) {
      expect(error).toBeInstanceOf(ContextBudgetError);
      expect(error).toMatchObject({
        code: "budget-too-small-for-required-task-contract",
        budget_tokens: 500,
        required_tokens: expect.any(Number),
        required_refs: expect.arrayContaining(["espalier://canopy/lane/lane-tight"]),
      });
    }
    const brief = compiler.compile({ project_id: "canopy", actor: worker, current_claim_ref: "esp:canopy/claim/claim-tight", requested_task_ref: "esp:canopy/lane/lane-tight", last_seen_revision: core.getProjectRevision("canopy"), context_budget_tokens: 700, requested_projection: "normal", language: "en" });
    const lane = brief.selected_objects.find((item) => item.object.id === "lane-tight")!.object;
    expect(lane).toMatchObject({ type: "lane", outcome: expect.stringContaining("Outcome"), scope: expect.stringContaining("Scope"), authority_contract: expect.stringContaining("Authority"), return_contract: expect.stringContaining("Return") });
    expect(brief.estimated_tokens).toBe(Math.ceil(JSON.stringify(brief).length / 4));
    expect(brief.estimated_tokens).toBeLessThanOrEqual(700);
  });
});
