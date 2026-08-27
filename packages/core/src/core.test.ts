import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ActorIdentity, CanonicalEntity, CommandEnvelope, EntityType, ProjectExport, WorkItem } from "@espalier/protocol";
import { EspalierCore, SqliteStore } from "./index.js";

const owner: ActorIdentity = {
  principal_id: "example-owner",
  runtime_id: "codex-app",
  device_id: "fixture-device",
  session_id: "owner-session",
  role: "owner",
  capabilities: ["read", "write", "claim", "evidence", "owner-update", "coordinate"],
};

const worker: ActorIdentity = {
  principal_id: "example-worker",
  runtime_id: "codex-cli",
  device_id: "fixture-device",
  session_id: "worker-session",
  role: "worker",
  capabilities: ["read", "write", "claim", "evidence"],
};

const secondOwner: ActorIdentity = {
  ...owner,
  principal_id: "kai",
  session_id: "second-owner-session",
};

const coordinator: ActorIdentity = {
  ...worker,
  principal_id: "coord",
  session_id: "coordinator-session",
  role: "coordinator",
  capabilities: ["read", "write", "claim", "evidence", "coordinate"],
};

function command<T extends Record<string, unknown>>(
  core: EspalierCore,
  actor: ActorIdentity,
  type: CommandEnvelope<T>["type"],
  payload: T,
  options: { id?: string; base?: number; versions?: Record<string, number> } = {},
): CommandEnvelope<T> {
  return {
    command_id: options.id ?? crypto.randomUUID(),
    project_id: "canopy",
    actor,
    base_project_revision: options.base ?? core.getProjectRevision("canopy"),
    base_entity_versions: options.versions ?? {},
    type,
    occurred_at: "2026-08-22T08:00:00+08:00",
    payload,
  };
}

function seededCore(filename = ":memory:") {
  const core = new EspalierCore(filename, { now: () => "2026-08-22T00:00:00.000Z" });
  expect(core.execute(command(core, owner, "project.create", {
    display_name: "Canopy",
    authority_domain: "canopy",
    repository_refs: ["repo:canopy"],
    owner_policy: { owners: ["example-owner"], approval: "any-one" },
  })).accepted).toBe(true);
  expect(core.execute(command(core, owner, "goal.approve", {
    id: "goal-r4",
    purpose: "Real-time responsive audio",
    present_consumers: ["browser performance"],
    programme_order: ["AIR compiler", "Sound resolution", "Audio engine"],
    binding_constraints: ["Host agent owns authorship"],
    trust_boundaries: ["Compiler makes no taste choices"],
    explicit_non_goals: ["Canvas aesthetics in current epoch"],
    source_refs: ["repo:canopy/AIR.md@r4"],
  })).accepted).toBe(true);
  expect(core.execute(command(core, owner, "epoch.open", {
    id: "epoch-03",
    goal_revision_id: "goal-r4",
    title: "Responsive audio",
    baseline_ref: "git:canopy@abc123",
  })).accepted).toBe(true);
  expect(core.execute(command(core, worker, "work.create", {
    id: "sound-resolution",
    epoch_id: "epoch-03",
    kind: "workstream",
    title: "Sound resolution",
    scope: "Resolve target loudness and spectral character",
    semantic_surfaces: ["audio:resolution"],
    repo_surfaces: ["packages/audio"],
    priority: 1,
    verification_policy: "tests plus Example owner listening acceptance",
  })).accepted).toBe(true);
  return core;
}

function rewriteExportEntity(project: ProjectExport, type: EntityType, id: string, rewrite: (entity: CanonicalEntity) => void): void {
  for (const entity of project.entities) if (entity.type === type && entity.id === id) rewrite(entity);
  for (const event of project.events) {
    for (const entity of (event.payload.upserts ?? []) as CanonicalEntity[]) if (entity.type === type && entity.id === id) rewrite(entity);
  }
}

describe("canonical command path", () => {
  it("deduplicates command retries and advances one project revision", () => {
    const core = seededCore();
    const before = core.getProjectRevision("canopy");
    const envelope = command(core, worker, "annotation.add", {
      id: "note-1",
      anchor_ref: "espalier://canopy/work/sound-resolution",
      anchor_revision: before,
      kind: "note",
      body: "needs owner listening",
    }, { id: "retry-safe" });
    const first = core.execute(envelope);
    const second = core.execute(envelope);
    expect(first.accepted).toBe(true);
    expect(second).toMatchObject({ accepted: true, idempotent_replay: true });
    expect(core.getProjectRevision("canopy")).toBe(before + 1);
    expect(core.listEntities("canopy", "annotation")).toHaveLength(1);

    const changedPayload = command(core, worker, "annotation.add", {
      id: "note-2",
      anchor_ref: "espalier://canopy/work/sound-resolution",
      anchor_revision: core.getProjectRevision("canopy"),
      kind: "note",
      body: "different command content",
    }, { id: "retry-safe" });
    expect(core.execute(changedPayload)).toMatchObject({ accepted: false, code: "invalid", reason: expect.stringContaining("different command envelope") });
    expect(core.listEntities("canopy", "annotation")).toHaveLength(1);
  });

  it("rejects owner-only goal mutation from a worker but accepts a proposal", () => {
    const core = seededCore();
    const rejected = core.execute(command(core, worker, "goal.approve", {
      id: "goal-r5",
      purpose: "Reordered programme",
      present_consumers: [],
      programme_order: ["Canvas first"],
      binding_constraints: [],
      trust_boundaries: [],
      explicit_non_goals: [],
      source_refs: [],
    }));
    expect(rejected).toMatchObject({ accepted: false, code: "authority" });

    const proposed = core.execute(command(core, worker, "goal.propose", {
      id: "goal-proposal-r5",
      question: "Should Canvas move earlier?",
      proposal: "Move Canvas before Audio engine",
      scope: "programme order",
      rationale: "Research result",
    }));
    expect(proposed.accepted).toBe(true);
    expect(core.listEntities("canopy", "goal").find((goal) => goal.id === "goal-proposal-r5")).toMatchObject({ approval: "proposed" });
  });

  it("rejects overlapping primary claims and allows takeover after lease expiry", () => {
    let now = "2026-08-22T00:00:00.000Z";
    const core = seededCore();
    core.setClock(() => now);
    const first = core.execute(command(core, worker, "claim.acquire", {
      id: "claim-example-worker",
      target_ref: "espalier://canopy/work/sound-resolution",
      mode: "primary",
      lease_seconds: 60,
    }));
    expect(first.accepted).toBe(true);

    const kai = { ...worker, principal_id: "kai", session_id: "kai-session" };
    const conflict = core.execute(command(core, kai, "claim.acquire", {
      id: "claim-kai",
      target_ref: "espalier://canopy/work/sound-resolution",
      mode: "primary",
      lease_seconds: 60,
    }));
    expect(conflict).toMatchObject({ accepted: false, code: "claim-conflict" });

    now = "2026-08-22T00:02:00.000Z";
    const takeover = core.execute(command(core, kai, "claim.acquire", {
      id: "claim-kai",
      target_ref: "espalier://canopy/work/sound-resolution",
      mode: "primary",
      lease_seconds: 60,
    }));
    expect(takeover.accepted).toBe(true);
  });

  it("keeps primary Work and Lane pointers stable across observer and coordinator Claims", () => {
    const core = seededCore();
    const observer = { ...worker, principal_id: "observer", session_id: "observer-session", role: "observer" as const };
    const laneWorker = { ...worker, principal_id: "lane-worker", session_id: "lane-worker-session" };

    expect(core.execute(command(core, worker, "claim.acquire", {
      id: "work-primary",
      target_ref: "esp:canopy/work/sound-resolution",
      mode: "primary",
      lease_seconds: 600,
    }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, observer, "claim.acquire", {
      id: "work-observer",
      target_ref: "esp:canopy/work/sound-resolution",
      mode: "observer",
      lease_seconds: 600,
    }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, coordinator, "claim.acquire", {
      id: "work-coordinator",
      target_ref: "esp:canopy/work/sound-resolution",
      mode: "coordinator",
      lease_seconds: 600,
    }))).toMatchObject({ accepted: true });
    expect(core.requireEntity("canopy", "work", "sound-resolution")).toMatchObject({ current_claim_id: "work-primary" });
    expect(core.execute(command(core, worker, "work.transition", {
      work_item_ref: "esp:canopy/work/sound-resolution",
      work_state: "implemented",
    }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, observer, "claim.release", { claim_ref: "esp:canopy/claim/work-observer" }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, coordinator, "claim.release", { claim_ref: "esp:canopy/claim/work-coordinator" }))).toMatchObject({ accepted: true });
    expect(core.requireEntity("canopy", "work", "sound-resolution")).toMatchObject({ current_claim_id: "work-primary" });

    expect(core.execute(command(core, coordinator, "batch.create", {
      id: "claim-pointer-batch",
      parent_work_item_ref: "esp:canopy/work/sound-resolution",
      lanes: [{ id: "claim-pointer-lane", outcome: "Return pointer proof", scope: "Claim pointer", authority: "bounded", return_contract: "evidence", context_refs: [], semantic_surfaces: ["claim:pointer"], repo_surfaces: [] }],
    }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, laneWorker, "claim.acquire", { id: "lane-primary", target_ref: "esp:canopy/lane/claim-pointer-lane", mode: "primary", lease_seconds: 600 }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, observer, "claim.acquire", { id: "lane-observer", target_ref: "esp:canopy/lane/claim-pointer-lane", mode: "observer", lease_seconds: 600 }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, coordinator, "claim.acquire", { id: "lane-coordinator", target_ref: "esp:canopy/lane/claim-pointer-lane", mode: "coordinator", lease_seconds: 600 }))).toMatchObject({ accepted: true });
    expect(core.requireEntity("canopy", "lane", "claim-pointer-lane")).toMatchObject({ claim_ref: "espalier://canopy/claim/lane-primary" });
    expect(core.execute(command(core, observer, "claim.release", { claim_ref: "esp:canopy/claim/lane-observer" }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, coordinator, "claim.release", { claim_ref: "esp:canopy/claim/lane-coordinator" }))).toMatchObject({ accepted: true });
    expect(core.requireEntity("canopy", "lane", "claim-pointer-lane")).toMatchObject({ claim_ref: "espalier://canopy/claim/lane-primary" });
  });

  it("merges stale additive annotations but rejects stale versioned transitions", () => {
    const core = seededCore();
    const staleRevision = core.getProjectRevision("canopy");
    const work = core.requireEntity("canopy", "work", "sound-resolution");
    expect(core.execute(command(core, worker, "claim.acquire", {
      id: "claim-example-worker",
      target_ref: "espalier://canopy/work/sound-resolution",
      mode: "primary",
      lease_seconds: 600,
    })).accepted).toBe(true);

    expect(core.execute(command(core, owner, "annotation.add", {
      id: "owner-note",
      anchor_ref: "espalier://canopy/work/sound-resolution",
      anchor_revision: staleRevision,
      kind: "concern",
      body: "Listening acceptance is still open",
    }, { base: staleRevision })).accepted).toBe(true);

    const staleTransition = core.execute(command(core, worker, "work.transition", {
      work_item_ref: "espalier://canopy/work/sound-resolution",
      work_state: "implemented",
      evidence_state: "tested",
      integration_state: "needs-integration",
    }, {
      base: staleRevision,
      versions: { "espalier://canopy/work/sound-resolution": work.entity_version - 1 },
    }));
    expect(staleTransition).toMatchObject({ accepted: false, code: "stale" });
  });

  it("rebuilds materialized state from the append-only event log", () => {
    const core = seededCore();
    core.store.database.prepare("INSERT INTO entity_search(project_id, type, id, ref, title, aliases, body) VALUES (?, ?, ?, ?, ?, ?, ?)").run("canopy", "work", "phantom", "espalier://canopy/work/phantom", "Phantom sentinel", "", "not in event history");
    expect(core.search("Phantom sentinel", "canopy")).toHaveLength(1);
    const before = core.listEntities("canopy").map((entity) => [entity.type, entity.id, entity.entity_version]);
    core.rebuildProject("canopy");
    const after = core.listEntities("canopy").map((entity) => [entity.type, entity.id, entity.entity_version]);
    expect(after).toEqual(before);
    expect(core.listEvents("canopy").length).toBeGreaterThanOrEqual(4);
    expect(core.search("Phantom sentinel", "canopy")).toEqual([]);
  });

  it("creates a consistent SQLite backup that passes restore verification", async () => {
    const root = mkdtempSync(join(tmpdir(), "espalier-backup-"));
    try {
      const core = seededCore();
      const destination = join(root, "snapshot.sqlite");
      expect(await core.backupTo(destination)).toBeGreaterThan(0);
      expect(SqliteStore.verifyDatabase(destination)).toEqual({ ok: true, integrity: "ok", schemaVersion: "4" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("holds binding goal and decision changes until the configured owner threshold is met", () => {
    const core = new EspalierCore(":memory:", { now: () => "2026-08-22T00:00:00.000Z" });
    expect(core.execute(command(core, owner, "project.create", {
      display_name: "Canopy",
      authority_domain: "canopy",
      repository_refs: [],
      owner_policy: { owners: ["example-owner", "kai"], approval: "threshold", threshold: 2 },
    })).accepted).toBe(true);

    expect(core.execute(command(core, owner, "goal.approve", {
      id: "goal-r1",
      purpose: "Shared owner programme",
      present_consumers: [],
      programme_order: ["Core first"],
      binding_constraints: [],
      trust_boundaries: [],
      explicit_non_goals: [],
      source_refs: [],
    })).accepted).toBe(true);
    expect(core.requireEntity("canopy", "goal", "goal-r1")).toMatchObject({ approval: "proposed" });
    expect(core.requireEntity("canopy", "project", "canopy")).not.toHaveProperty("current_goal_revision_id");

    expect(core.execute(command(core, secondOwner, "goal.approve", { goal_ref: "esp:canopy/goal/goal-r1" })).accepted).toBe(true);
    expect(core.requireEntity("canopy", "goal", "goal-r1")).toMatchObject({ approval: "approved" });
    expect(core.requireEntity("canopy", "project", "canopy")).toMatchObject({ current_goal_revision_id: "goal-r1" });

    const openEpochPayload = { id: "epoch-1", goal_revision_id: "goal-r1", title: "Shared epoch", baseline_ref: "git:shared" };
    expect(core.execute(command(core, owner, "decision.propose", {
      id: "authorize-open",
      question: "Open the shared epoch?",
      proposal: "Open epoch-1",
      scope: "epoch.open",
      authorizes: { command_type: "epoch.open", payload: openEpochPayload },
    })).accepted).toBe(true);
    expect(core.execute(command(core, owner, "decision.resolve", { decision_ref: "esp:canopy/decision/authorize-open", decision_state: "approved" })).accepted).toBe(true);
    expect(core.execute(command(core, secondOwner, "decision.resolve", { decision_ref: "esp:canopy/decision/authorize-open", decision_state: "approved" })).accepted).toBe(true);
    expect(core.execute(command(core, owner, "epoch.open", { ...openEpochPayload, approval_decision_ref: "esp:canopy/decision/authorize-open" })).accepted).toBe(true);
    expect(core.execute(command(core, owner, "epoch.freeze", { epoch_ref: "esp:canopy/epoch/epoch-1" }))).toMatchObject({ accepted: false, code: "authority" });
    expect(core.execute(command(core, owner, "decision.propose", {
      id: "authorize-freeze",
      question: "Freeze the shared epoch?",
      proposal: "Freeze epoch-1",
      scope: "epoch.freeze",
      rationale: "boundary reached",
      authorizes: { command_type: "epoch.freeze", target_ref: "esp:canopy/epoch/epoch-1", payload: { epoch_ref: "esp:canopy/epoch/epoch-1" } },
    })).accepted).toBe(true);
    expect(core.execute(command(core, owner, "decision.resolve", { decision_ref: "esp:canopy/decision/authorize-freeze", decision_state: "approved" })).accepted).toBe(true);
    expect(core.execute(command(core, secondOwner, "decision.resolve", { decision_ref: "esp:canopy/decision/authorize-freeze", decision_state: "approved" })).accepted).toBe(true);
    expect(core.execute(command(core, owner, "epoch.freeze", { epoch_ref: "esp:canopy/epoch/epoch-1", approval_decision_ref: "esp:canopy/decision/authorize-freeze", unexpected: "payload mismatch" }))).toMatchObject({ accepted: false, code: "authority" });
    expect(core.execute(command(core, owner, "epoch.freeze", { epoch_ref: "esp:canopy/epoch/epoch-1", approval_decision_ref: "esp:canopy/decision/authorize-freeze" })).accepted).toBe(true);
    expect(core.requireEntity("canopy", "decision", "authorize-freeze")).toMatchObject({ consumed_by_command_id: expect.any(String) });
    expect(core.execute(command(core, owner, "epoch.freeze", { epoch_ref: "esp:canopy/epoch/epoch-1", approval_decision_ref: "esp:canopy/decision/authorize-freeze" }))).toMatchObject({ accepted: false, code: "authority", reason: expect.stringContaining("consumed") });

    expect(core.execute(command(core, owner, "decision.propose", {
      id: "decision-1",
      question: "Bind the production target?",
      proposal: "Adopt target A",
      scope: "production",
      rationale: "tested",
    })).accepted).toBe(true);
    const firstVote = core.execute(command(core, owner, "decision.resolve", {
      decision_ref: "esp:canopy/decision/decision-1",
      decision_state: "approved",
    }));
    expect(firstVote.accepted).toBe(true);
    expect(core.requireEntity("canopy", "decision", "decision-1")).toMatchObject({ decision_state: "proposed" });
    expect(core.execute(command(core, secondOwner, "decision.resolve", {
      decision_ref: "esp:canopy/decision/decision-1",
      decision_state: "approved",
    })).accepted).toBe(true);
    expect(core.requireEntity("canopy", "decision", "decision-1")).toMatchObject({ decision_state: "approved" });
  });

  it("applies threshold owner policy to binding annotations, subjective evidence, and another owner's resolution", () => {
    const core = new EspalierCore(":memory:", { now: () => "2026-08-22T00:00:00.000Z" });
    expect(core.execute(command(core, owner, "project.create", {
      display_name: "Canopy",
      authority_domain: "canopy",
      repository_refs: [],
      owner_policy: { owners: ["example-owner", "kai"], approval: "threshold", threshold: 2 },
    }))).toMatchObject({ accepted: true });

    const authorize = (id: string, commandType: CommandEnvelope["type"], payload: Record<string, unknown>) => {
      expect(core.execute(command(core, owner, "decision.propose", {
        id,
        question: `Authorize ${commandType}?`,
        proposal: `Execute ${commandType}`,
        scope: commandType,
        authorizes: { command_type: commandType, payload },
      }))).toMatchObject({ accepted: true });
      expect(core.execute(command(core, owner, "decision.resolve", { decision_ref: `esp:canopy/decision/${id}`, decision_state: "approved" }))).toMatchObject({ accepted: true });
      expect(core.execute(command(core, secondOwner, "decision.resolve", { decision_ref: `esp:canopy/decision/${id}`, decision_state: "approved" }))).toMatchObject({ accepted: true });
      return `esp:canopy/decision/${id}`;
    };

    const directive = {
      id: "binding-direction",
      anchor_ref: "esp:canopy/project/canopy",
      anchor_revision: core.getProjectRevision("canopy"),
      kind: "directive",
      body: "Adopt this as the binding direction",
    };
    expect(core.execute(command(core, owner, "annotation.add", directive))).toMatchObject({ accepted: false, code: "authority" });
    const directiveDecision = authorize("authorize-directive", "annotation.add", directive);
    expect(core.execute(command(core, owner, "annotation.add", { ...directive, approval_decision_ref: directiveDecision }))).toMatchObject({ accepted: true });

    const acceptance = {
      id: "owner-listening",
      target_refs: ["esp:canopy/project/canopy"],
      kind: "listening-acceptance",
      origin: "owner-confirmed",
      ref: "owner:listening",
      summary: "Listening target accepted",
      verification_state: "verified",
    };
    expect(core.execute(command(core, owner, "evidence.attach", acceptance))).toMatchObject({ accepted: false, code: "authority" });
    const acceptanceDecision = authorize("authorize-listening", "evidence.attach", acceptance);
    expect(core.execute(command(core, owner, "evidence.attach", { ...acceptance, approval_decision_ref: acceptanceDecision }))).toMatchObject({ accepted: true });
    expect(core.requireEntity("canopy", "evidence", "owner-listening")).toMatchObject({ provenance: { authority: "owner-approved" } });

    expect(core.execute(command(core, secondOwner, "annotation.add", {
      id: "kai-concern",
      anchor_ref: "esp:canopy/project/canopy",
      anchor_revision: core.getProjectRevision("canopy"),
      kind: "concern",
      body: "Keep the second owner's concern unresolved until both owners agree",
    }))).toMatchObject({ accepted: true });
    const resolution = { annotation_ref: "esp:canopy/annotation/kai-concern", response_refs: [] };
    expect(core.execute(command(core, owner, "annotation.resolve", resolution))).toMatchObject({ accepted: false, code: "authority" });
    const resolutionDecision = authorize("authorize-resolution", "annotation.resolve", resolution);
    expect(core.execute(command(core, owner, "annotation.resolve", { ...resolution, approval_decision_ref: resolutionDecision }))).toMatchObject({ accepted: true });

    expect(core.execute(command(core, owner, "annotation.add", {
      id: "example-owner-note",
      anchor_ref: "esp:canopy/project/canopy",
      anchor_revision: core.getProjectRevision("canopy"),
      kind: "note",
      body: "Author-owned non-binding note",
    }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, owner, "annotation.resolve", { annotation_ref: "esp:canopy/annotation/example-owner-note", response_refs: [] }))).toMatchObject({ accepted: true });
  });

  it("coordinates batch lanes, reports repo overlap, returns lane evidence, and integrates only when ready", () => {
    const core = seededCore();
    const created = core.execute(command(core, coordinator, "batch.create", {
      id: "batch-audio",
      title: "Audio integration batch",
      parent_work_item_ref: "esp:canopy/work/sound-resolution",
      lanes: [
        { id: "lane-browser", title: "Browser lane", outcome: "Browser playback", scope: "Implement browser path", context_refs: [], authority: "within approved scope", return_contract: "tests and evidence", semantic_surfaces: ["audio:browser"], repo_surfaces: ["packages/audio"] },
        { id: "lane-headless", title: "Headless lane", outcome: "Headless playback", scope: "Implement headless path", context_refs: [], authority: "within approved scope", return_contract: "tests and evidence", semantic_surfaces: ["audio:headless"], repo_surfaces: ["packages/audio/src"] },
      ],
    }));
    expect(created).toMatchObject({ accepted: true, warnings: [expect.objectContaining({ code: "repo-surface-overlap" })] });
    expect(core.listEntities("canopy", "lane")).toHaveLength(2);

    const browserWorker = { ...worker, principal_id: "browser-worker", session_id: "browser-lane" };
    const headlessWorker = { ...worker, principal_id: "headless-worker", session_id: "headless-lane" };
    expect(core.execute(command(core, browserWorker, "claim.acquire", { id: "claim-browser", target_ref: "esp:canopy/lane/lane-browser", mode: "primary", lease_seconds: 600 })).accepted).toBe(true);
    const overlappingClaim = core.execute(command(core, headlessWorker, "claim.acquire", { id: "claim-headless", target_ref: "esp:canopy/lane/lane-headless", mode: "primary", lease_seconds: 600 }));
    expect(overlappingClaim).toMatchObject({ accepted: true, warnings: [expect.objectContaining({ code: "repo-surface-overlap" })] });

    expect(core.execute(command(core, browserWorker, "lane.return", {
      lane_ref: "esp:canopy/lane/lane-browser",
      result_id: "result-browser",
      summary: "Browser tests passed",
      evidence_ref: "test:browser",
    })).accepted).toBe(true);
    const notReady = core.execute(command(core, coordinator, "batch.integrate" as CommandEnvelope["type"], { batch_ref: "esp:canopy/batch/batch-audio" }));
    expect(notReady).toMatchObject({ accepted: false, code: "transition" });

    expect(core.execute(command(core, headlessWorker, "lane.return", {
      lane_ref: "esp:canopy/lane/lane-headless",
      result_id: "result-headless",
      summary: "Headless tests passed",
      evidence_ref: "test:headless",
    })).accepted).toBe(true);
    expect(core.execute(command(core, coordinator, "batch.integrate" as CommandEnvelope["type"], { batch_ref: "esp:canopy/batch/batch-audio" })).accepted).toBe(true);
    expect(core.requireEntity("canopy", "batch", "batch-audio")).toMatchObject({ integration_state: "integrated" });
    expect(core.requireEntity("canopy", "work", "sound-resolution")).toMatchObject({ integration_state: "integrated" });
  });

  it("rejects foreign authority-domain refs except explicit cross-project relations", () => {
    const core = seededCore();
    expect(core.execute({
      ...command(core, owner, "project.create", {
        display_name: "Orchard",
        authority_domain: "orchard",
        repository_refs: ["repo:orchard"],
        owner_policy: { owners: ["example-owner"], approval: "any-one" },
      }),
      project_id: "orchard",
      base_project_revision: 0,
    }).accepted).toBe(true);

    expect(core.execute(command(core, worker, "annotation.add", {
      id: "foreign-anchor",
      anchor_ref: "esp:orchard/project/orchard",
      anchor_revision: 1,
      kind: "note",
      body: "must not cross the project boundary",
    }))).toMatchObject({ accepted: false, code: "authority" });

    expect(core.execute(command(core, coordinator, "batch.create", {
      id: "foreign-context-batch",
      parent_work_item_ref: "esp:canopy/work/sound-resolution",
      lanes: [{
        id: "foreign-context-lane",
        outcome: "Do not leak context",
        scope: "Boundary test",
        context_refs: ["esp:orchard/project/orchard"],
        authority: "within approved scope",
        return_contract: "rejection",
        semantic_surfaces: [],
        repo_surfaces: [],
      }],
    }))).toMatchObject({ accepted: false, code: "authority" });

    expect(core.execute(command(core, owner, "relation.create", {
      id: "canopy-observes-orchard",
      source_ref: "esp:canopy/work/sound-resolution",
      target_ref: "esp:orchard/project/orchard",
      relation_type: "observes",
      authority_state: "within_scope",
    }))).toMatchObject({ accepted: true });
  });

  it("validates untrusted command envelopes and payload enums before canonical mutation", () => {
    const core = seededCore();
    const before = core.getProjectRevision("canopy");
    expect(core.execute(command(core, worker, "work.create", {
      id: "invalid-kind",
      epoch_id: "epoch-03",
      kind: "magic",
      title: "Invalid work",
      scope: "Must not enter canonical state",
      semantic_surfaces: [],
      repo_surfaces: [],
      verification_policy: "none",
    } as never))).toMatchObject({ accepted: false, code: "invalid" });
    expect(core.getProjectRevision("canopy")).toBe(before);
    expect(core.listEntities("canopy", "work").map((item) => item.id)).not.toContain("invalid-kind");

    expect(core.execute(command(core, worker, "claim.acquire", { id: "validated-claim", target_ref: "esp:canopy/work/sound-resolution", mode: "primary", lease_seconds: 600 }))).toMatchObject({ accepted: true });
    const lease = core.requireEntity("canopy", "claim", "validated-claim");
    expect(core.execute(command(core, worker, "claim.renew", { claim_ref: "esp:canopy/claim/validated-claim", lease_seconds: -1 }))).toMatchObject({ accepted: false, code: "invalid" });
    expect(core.requireEntity("canopy", "claim", "validated-claim")).toMatchObject({ entity_version: lease.entity_version });

    const forgedCapability = { ...worker, capabilities: ["read", "write", "root"] } as unknown as ActorIdentity;
    expect(core.execute(command(core, forgedCapability, "annotation.add", {
      id: "forged-capability-note",
      anchor_ref: "esp:canopy/work/sound-resolution",
      anchor_revision: core.getProjectRevision("canopy"),
      kind: "note",
      body: "Must be rejected before mutation",
    }))).toMatchObject({ accepted: false, code: "invalid" });
  });

  it("searches canonical text and round-trips a portable project export without losing event history", () => {
    const source = seededCore();
    const annotationCommand = command(source, owner, "annotation.add", {
      id: "listening-note",
      anchor_ref: "esp:canopy/work/sound-resolution",
      anchor_revision: source.getProjectRevision("canopy"),
      kind: "concern",
      body: "需要猫猫确认 listening acceptance",
    });
    expect(source.execute(annotationCommand).accepted).toBe(true);
    expect(source.search("猫猫 listening", "canopy")).toEqual([expect.objectContaining({ id: "listening-note", type: "annotation", ref: "espalier://canopy/annotation/listening-note" })]);
    expect(source.search("spectral", "canopy")).toEqual([expect.objectContaining({ id: "sound-resolution" })]);

    const exported = source.exportProject("canopy");
    const restored = new EspalierCore(":memory:", { now: () => "2026-08-22T01:00:00.000Z" });
    restored.restoreProject(exported);
    expect(restored.getProjectRevision("canopy")).toBe(source.getProjectRevision("canopy"));
    expect(restored.listEntities("canopy")).toEqual(source.listEntities("canopy"));
    expect(restored.listEvents("canopy").map((event) => event.event_id)).toEqual(source.listEvents("canopy").map((event) => event.event_id));
    expect(restored.search("猫猫", "canopy")).toHaveLength(1);
    expect(restored.execute(annotationCommand)).toMatchObject({ accepted: true, idempotent_replay: true });
    expect(() => restored.restoreProject(exported)).toThrow("already exists");
  });

  it("omits rejected command identities from portable exports so restore cannot poison a future command ID", () => {
    const source = seededCore();
    const rejectedId = "reusable-after-restore";
    expect(source.execute(command(source, worker, "work.create", {
      id: "invalid-work",
      epoch_id: "epoch-03",
      kind: "not-a-kind",
      title: "Invalid",
      scope: "Must not be restored as command history",
      semantic_surfaces: [],
      repo_surfaces: [],
    } as never, { id: rejectedId }))).toMatchObject({ accepted: false, code: "invalid" });

    const exported = source.exportProject("canopy");
    expect(exported.command_receipts.every((receipt) => receipt.accepted)).toBe(true);
    expect(exported.command_fingerprints).not.toHaveProperty(rejectedId);

    const restored = new EspalierCore(":memory:");
    restored.restoreProject(exported);
    expect(restored.execute(command(restored, worker, "annotation.add", {
      id: "post-restore-note",
      anchor_ref: "esp:canopy/work/sound-resolution",
      anchor_revision: restored.getProjectRevision("canopy"),
      kind: "note",
      body: "The rejected source command ID is reusable after portable restore",
    }, { id: rejectedId }))).toMatchObject({ accepted: true });
  });

  it("rejects a restore package whose snapshot, history, or authority domain is inconsistent", () => {
    const source = seededCore();
    const exported = source.exportProject("canopy");

    const divergent = structuredClone(exported);
    divergent.entities.find((entity) => entity.type === "work")!.title = "Tampered title";
    const divergentTarget = new EspalierCore(":memory:");
    expect(() => divergentTarget.restoreProject(divergent)).toThrow("materialized state does not match event replay");
    expect(divergentTarget.listProjects()).toHaveLength(0);

    const discontinuous = structuredClone(exported);
    discontinuous.events[1]!.project_revision = discontinuous.events[0]!.project_revision;
    const discontinuousTarget = new EspalierCore(":memory:");
    expect(() => discontinuousTarget.restoreProject(discontinuous)).toThrow("event revisions are not contiguous");
    expect(discontinuousTarget.listProjects()).toHaveLength(0);

    const mixed = structuredClone(exported);
    mixed.command_receipts[0]!.project_id = "orchard";
    const mixedTarget = new EspalierCore(":memory:");
    expect(() => mixedTarget.restoreProject(mixed)).toThrow("mixes authority domains");
    expect(mixedTarget.listProjects()).toHaveLength(0);

    const reversed = structuredClone(exported);
    reversed.events.reverse();
    const reversedTarget = new EspalierCore(":memory:");
    reversedTarget.restoreProject(reversed);
    expect(reversedTarget.listEvents("canopy").map((event) => event.project_revision)).toEqual(Array.from({ length: exported.project_revision }, (_, index) => index + 1));
    expect(reversedTarget.resolve("espalier://canopy/project/canopy?rev=1")).toMatchObject({ entity_version: 1, project_revision: 1 });

    const foreignNested = structuredClone(exported);
    const work = foreignNested.entities.find((entity) => entity.type === "work") as WorkItem;
    work.parent_id = "foreign-parent";
    const workUpsert = foreignNested.events.flatMap((event) => event.payload.upserts as typeof foreignNested.entities).find((entity) => entity.type === "work" && entity.id === work.id) as WorkItem;
    workUpsert.parent_id = "foreign-parent";
    const foreignNestedTarget = new EspalierCore(":memory:");
    expect(() => foreignNestedTarget.restoreProject(foreignNested)).toThrow("missing parent");
    expect(foreignNestedTarget.listProjects()).toHaveLength(0);

    const wrongReceipt = structuredClone(exported);
    const acceptedReceipt = wrongReceipt.command_receipts.find((receipt) => receipt.accepted)!;
    acceptedReceipt.new_project_revision = Math.min(exported.project_revision, acceptedReceipt.new_project_revision + 1);
    const wrongReceiptTarget = new EspalierCore(":memory:");
    expect(() => wrongReceiptTarget.restoreProject(wrongReceipt)).toThrow("receipt does not match its event");
    expect(wrongReceiptTarget.listProjects()).toHaveLength(0);

    const missingFingerprints = structuredClone(exported) as unknown as { command_fingerprints?: Record<string, string> };
    delete missingFingerprints.command_fingerprints;
    const missingFingerprintTarget = new EspalierCore(":memory:");
    expect(() => missingFingerprintTarget.restoreProject(missingFingerprints as typeof exported)).toThrow("command fingerprints");
    expect(missingFingerprintTarget.listProjects()).toHaveLength(0);
  });

  it("applies live owner-policy, Goal, and primary-Claim invariants during portable restore", () => {
    const ownerPolicySource = seededCore();
    for (const ownerPolicy of [
      { owners: ["example-owner", "kai"], approval: "threshold" as const, threshold: 0 },
      { owners: ["example-owner", "example-owner"], approval: "any-one" as const },
      { owners: ["example-owner", "kai"], approval: "threshold" as const },
      { owners: ["example-owner", "kai"], approval: "threshold" as const, threshold: 3 },
    ]) {
      const invalidPolicy = ownerPolicySource.exportProject("canopy");
      rewriteExportEntity(invalidPolicy, "project", "canopy", (entity) => {
        if (entity.type === "project") entity.owner_policy = ownerPolicy;
      });
      expect(() => new EspalierCore(":memory:").restoreProject(invalidPolicy)).toThrow("schema-invalid Project authority");
    }

    const lifecycleSource = seededCore();
    const supersededCurrentGoal = lifecycleSource.exportProject("canopy");
    rewriteExportEntity(supersededCurrentGoal, "goal", "goal-r4", (entity) => {
      if (entity.type === "goal") entity.approval = "superseded";
    });
    expect(() => new EspalierCore(":memory:").restoreProject(supersededCurrentGoal)).toThrow("current Goal");

    const claimSource = seededCore();
    expect(claimSource.execute(command(claimSource, worker, "work.create", {
      id: "second-claim-target",
      epoch_id: "epoch-03",
      kind: "task",
      title: "Second claim target",
      scope: "Restore invariant fixture",
      semantic_surfaces: ["audio:secondary"],
      repo_surfaces: [],
    }))).toMatchObject({ accepted: true });
    expect(claimSource.execute(command(claimSource, worker, "claim.acquire", { id: "restore-primary-one", target_ref: "esp:canopy/work/sound-resolution", mode: "primary", semantic_surfaces: ["audio:resolution"], lease_seconds: 600 }))).toMatchObject({ accepted: true });
    expect(claimSource.execute(command(claimSource, secondOwner, "claim.acquire", { id: "restore-primary-two", target_ref: "esp:canopy/work/second-claim-target", mode: "primary", semantic_surfaces: ["audio:secondary"], lease_seconds: 600 }))).toMatchObject({ accepted: true });

    const overlappingClaims = claimSource.exportProject("canopy");
    rewriteExportEntity(overlappingClaims, "claim", "restore-primary-two", (entity) => {
      if (entity.type === "claim") entity.semantic_surfaces = ["audio:resolution"];
    });
    expect(() => new EspalierCore(":memory:").restoreProject(overlappingClaims)).toThrow("overlapping active primary Claims");

    const missingPointer = claimSource.exportProject("canopy");
    rewriteExportEntity(missingPointer, "work", "second-claim-target", (entity) => {
      if (entity.type === "work") delete entity.current_claim_id;
    });
    expect(() => new EspalierCore(":memory:").restoreProject(missingPointer)).toThrow("not the target's current pointer");

    const releasedPointer = claimSource.exportProject("canopy");
    rewriteExportEntity(releasedPointer, "claim", "restore-primary-two", (entity) => {
      if (entity.type === "claim") entity.released_at = entity.updated_at;
    });
    expect(() => new EspalierCore(":memory:").restoreProject(releasedPointer)).toThrow("invalid primary Claim pointer");

    claimSource.setClock(() => "2026-08-22T00:11:00.000Z");
    const expiredPointer = claimSource.exportProject("canopy");
    const expiredRestore = new EspalierCore(":memory:", { now: () => "2026-08-22T00:11:00.000Z" });
    expect(() => expiredRestore.restoreProject(expiredPointer)).not.toThrow();
    expect(expiredRestore.requireEntity("canopy", "claim", "restore-primary-two")).not.toHaveProperty("released_at");
    expect(expiredRestore.requireEntity("canopy", "work", "second-claim-target")).toMatchObject({ current_claim_id: "restore-primary-two" });
    expect(expiredRestore.execute(command(expiredRestore, owner, "claim.acquire", { id: "restore-takeover", target_ref: "esp:canopy/work/second-claim-target", mode: "primary", semantic_surfaces: ["audio:secondary"], lease_seconds: 600 }))).toMatchObject({ accepted: true });
    expect(expiredRestore.requireEntity("canopy", "claim", "restore-primary-two")).toHaveProperty("released_at");
    expect(expiredRestore.requireEntity("canopy", "work", "second-claim-target")).toMatchObject({ current_claim_id: "restore-takeover" });

    const frozenEpochPointer = seededCore().exportProject("canopy");
    rewriteExportEntity(frozenEpochPointer, "epoch", "epoch-03", (entity) => {
      if (entity.type === "epoch") entity.state = "frozen";
    });
    expect(() => new EspalierCore(":memory:").restoreProject(frozenEpochPointer)).toThrow("current Epoch pointer");
  });

  it("freezes, compacts, carries unresolved work into a clean epoch, and archives without deleting history", () => {
    const core = seededCore();
    const beforeEvents = core.listEvents("canopy").length;
    expect(core.execute(command(core, worker, "epoch.freeze", { epoch_ref: "esp:canopy/epoch/epoch-03" })).accepted).toBe(false);
    expect(core.execute(command(core, owner, "epoch.freeze", { epoch_ref: "esp:canopy/epoch/epoch-03" })).accepted).toBe(true);
    expect(core.execute(command(core, owner, "epoch.compact", {
      epoch_ref: "esp:canopy/epoch/epoch-03",
      receipt_id: "compact-epoch-03",
      next_epoch: { id: "epoch-04", title: "Integrated audio", baseline_ref: "git:canopy@next" },
    })).accepted).toBe(true);
    expect(core.requireEntity("canopy", "epoch", "epoch-03")).toMatchObject({ state: "frozen", compaction_receipt_ref: "espalier://canopy/evidence/compact-epoch-03" });
    expect(core.requireEntity("canopy", "epoch", "epoch-04")).toMatchObject({ state: "active" });
    expect(core.requireEntity("canopy", "work", "sound-resolution")).toMatchObject({ epoch_id: "epoch-04" });
    expect(core.requireEntity("canopy", "project", "canopy")).toMatchObject({ current_epoch_id: "epoch-04" });
    expect(core.listEvents("canopy")).toHaveLength(beforeEvents + 2);
    expect(core.execute(command(core, owner, "epoch.archive", { epoch_ref: "esp:canopy/epoch/epoch-03" })).accepted).toBe(true);
    expect(core.requireEntity("canopy", "epoch", "epoch-03")).toMatchObject({ state: "archived" });
    expect(core.listEvents("canopy")).toHaveLength(beforeEvents + 3);
  });

  it("rejects compaction of a frozen historical Epoch when another Epoch is already active", () => {
    const core = seededCore();
    expect(core.execute(command(core, owner, "epoch.freeze", { epoch_ref: "esp:canopy/epoch/epoch-03" }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, owner, "epoch.open", {
      id: "epoch-04",
      goal_revision_id: "goal-r4",
      title: "Already active",
      baseline_ref: "git:canopy@epoch-04",
    }))).toMatchObject({ accepted: true });

    expect(core.execute(command(core, owner, "epoch.compact", {
      epoch_ref: "esp:canopy/epoch/epoch-03",
      receipt_id: "late-compaction",
      next_epoch: { id: "epoch-05", title: "Must not coexist", baseline_ref: "git:canopy@epoch-05" },
    }))).toMatchObject({ accepted: false, code: "transition" });
    expect((core.listEntities("canopy", "epoch") as Array<{ state: string }>).filter((epoch) => epoch.state === "active")).toHaveLength(1);
  });

  it("carries the complete ancestor chain when an unresolved child crosses an Epoch boundary", () => {
    const core = seededCore();
    expect(core.execute(command(core, owner, "work.create", {
      id: "resolved-parent",
      epoch_id: "epoch-03",
      kind: "workstream",
      title: "Resolved parent",
      scope: "Parent that would otherwise compact",
      semantic_surfaces: [],
      repo_surfaces: [],
    }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, worker, "claim.acquire", {
      id: "resolved-parent-claim",
      target_ref: "esp:canopy/work/resolved-parent",
      mode: "primary",
      lease_seconds: 600,
    }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, worker, "work.transition", {
      work_item_ref: "esp:canopy/work/resolved-parent",
      work_state: "closed",
    }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, worker, "claim.release", {
      claim_ref: "esp:canopy/claim/resolved-parent-claim",
    }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, worker, "work.create", {
      id: "unresolved-child",
      epoch_id: "epoch-03",
      parent_id: "resolved-parent",
      kind: "task",
      title: "Unresolved child",
      scope: "Keeps its parent structurally reachable",
      semantic_surfaces: [],
      repo_surfaces: [],
    }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, owner, "epoch.freeze", { epoch_ref: "esp:canopy/epoch/epoch-03" }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, owner, "epoch.compact", {
      epoch_ref: "esp:canopy/epoch/epoch-03",
      receipt_id: "ancestor-closed-compaction",
      next_epoch: { id: "epoch-04", title: "Ancestor closed", baseline_ref: "git:canopy@ancestor-closed" },
    }))).toMatchObject({ accepted: true });

    expect(core.requireEntity("canopy", "work", "resolved-parent")).toMatchObject({ epoch_id: "epoch-04" });
    expect(core.requireEntity("canopy", "work", "unresolved-child")).toMatchObject({ epoch_id: "epoch-04", parent_id: "resolved-parent" });
    const restored = new EspalierCore(":memory:");
    expect(() => restored.restoreProject(core.exportProject("canopy"))).not.toThrow();
  });

  it("restricts ordinary Work creation to safe unverified and isolated initialization", () => {
    const core = seededCore();
    expect(core.execute(command(core, owner, "work.create", {
      id: "born-accepted",
      epoch_id: "epoch-03",
      kind: "task",
      title: "Born accepted",
      scope: "Must cross explicit verification and integration commands",
      semantic_surfaces: [],
      repo_surfaces: [],
      work_state: "closed",
      evidence_state: "verified",
      integration_state: "integrated",
    }))).toMatchObject({ accepted: false, code: "transition" });
    expect(core.listEntities("canopy", "work").map((work) => work.id)).not.toContain("born-accepted");
  });

  it("requires canonical Evidence for every Work evidence-state transition", () => {
    const core = seededCore();
    expect(core.execute(command(core, worker, "claim.acquire", {
      id: "evidence-axis-claim",
      target_ref: "esp:canopy/work/sound-resolution",
      mode: "primary",
      lease_seconds: 600,
    }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, worker, "work.transition", {
      work_item_ref: "esp:canopy/work/sound-resolution",
      evidence_state: "tested",
    }))).toMatchObject({ accepted: false, code: "authority" });
    expect(core.requireEntity("canopy", "work", "sound-resolution")).toMatchObject({ evidence_state: "none" });
  });

  it("does not supersede the current Goal while its Epoch is still active", () => {
    const core = seededCore();
    expect(core.execute(command(core, owner, "goal.approve", {
      id: "goal-r5",
      purpose: "A later programme",
      present_consumers: [],
      programme_order: [],
      binding_constraints: ["Keep Goal and active Epoch aligned"],
      trust_boundaries: [],
      explicit_non_goals: [],
      source_refs: [],
    }))).toMatchObject({ accepted: false, code: "transition" });
    expect(core.requireEntity("canopy", "project", "canopy")).toMatchObject({ current_goal_revision_id: "goal-r4", current_epoch_id: "epoch-03" });
    expect(core.requireEntity("canopy", "epoch", "epoch-03")).toMatchObject({ state: "active", goal_revision_id: "goal-r4" });
  });

  it("clears an expired primary pointer when another Claim triggers lease cleanup", () => {
    let now = "2026-08-22T00:00:00.000Z";
    const core = seededCore();
    core.setClock(() => now);
    expect(core.execute(command(core, worker, "claim.acquire", {
      id: "expiring-primary",
      target_ref: "esp:canopy/work/sound-resolution",
      mode: "primary",
      lease_seconds: 60,
    }))).toMatchObject({ accepted: true });
    now = "2026-08-22T00:02:00.000Z";
    expect(core.execute(command(core, worker, "claim.acquire", {
      id: "observer-after-expiry",
      target_ref: "esp:canopy/work/sound-resolution",
      mode: "observer",
      lease_seconds: 60,
    }))).toMatchObject({ accepted: true });
    expect(core.requireEntity("canopy", "claim", "expiring-primary")).toHaveProperty("released_at");
    expect(core.requireEntity("canopy", "work", "sound-resolution")).not.toHaveProperty("current_claim_id");
  });

  it("compares Claim leases as instants and rejects renewal after lease loss", () => {
    let now = "2026-08-22T08:00:00+08:00";
    const core = seededCore();
    core.setClock(() => now);
    expect(core.execute(command(core, worker, "claim.acquire", {
      id: "offset-primary",
      target_ref: "esp:canopy/work/sound-resolution",
      mode: "primary",
      lease_seconds: 60,
    }))).toMatchObject({ accepted: true });
    const claim = core.requireEntity("canopy", "claim", "offset-primary");
    expect(claim).toMatchObject({ type: "claim", lease_until: "2026-08-22T00:01:00.000Z" });
    expect(claim.type === "claim" && core.isClaimActive(claim)).toBe(true);

    now = "2026-08-22T08:02:00+08:00";
    expect(core.execute(command(core, worker, "claim.renew", { claim_ref: "esp:canopy/claim/offset-primary", lease_seconds: 60 }))).toMatchObject({ accepted: false, code: "claim-conflict" });
    expect(core.requireEntity("canopy", "claim", "offset-primary")).toMatchObject({ lease_until: "2026-08-22T00:01:00.000Z" });
  });

  it.each([2, 3])("fails closed on a literal legacy schema-%s store instead of relabelling it", (legacySchema) => {
    const root = mkdtempSync(join(tmpdir(), "espalier-migration-"));
    const filename = join(root, "espalier.sqlite");
    try {
      const legacy = new DatabaseSync(filename);
      legacy.exec(`
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO meta(key, value) VALUES ('schema_version', '${legacySchema}');
        CREATE TABLE commands (command_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, receipt_json TEXT NOT NULL);
      `);
      legacy.close();

      expect(() => new EspalierCore(filename)).toThrow(`Schema ${legacySchema} requires an explicit migration`);
      const unchanged = new DatabaseSync(filename, { readOnly: true });
      expect(unchanged.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: String(legacySchema) });
      expect((unchanged.prepare("PRAGMA table_info(commands)").all() as unknown as Array<{ name: string }>).map((column) => column.name)).not.toContain("command_fingerprint");
      unchanged.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("imports handoff material as provenance-bearing non-binding draft content", () => {
    const core = seededCore();
    expect(core.execute(command(core, worker, "annotation.add", {
      id: "imported-handoff",
      anchor_ref: "esp:canopy/work/sound-resolution",
      anchor_revision: core.getProjectRevision("canopy"),
      kind: "proposal",
      body: "Old note that still needs review",
      origin: "imported",
      source_refs: ["file:HANDOFF.md@baseline"],
    })).accepted).toBe(true);
    expect(core.requireEntity("canopy", "annotation", "imported-handoff")).toMatchObject({ provenance: { authority: "imported", source_refs: ["file:HANDOFF.md@baseline"] }, kind: "proposal", state: "open" });
    expect(core.execute(command(core, owner, "annotation.add", {
      id: "unsafe-import",
      anchor_ref: "esp:canopy/work/sound-resolution",
      anchor_revision: core.getProjectRevision("canopy"),
      kind: "directive",
      body: "Imported words",
      origin: "imported",
    }))).toMatchObject({ accepted: false, code: "authority" });
  });

  it("marks annotations stale in the same revision when their canonical anchor changes", () => {
    const core = seededCore();
    expect(core.execute(command(core, owner, "annotation.add", {
      id: "scope-note",
      anchor_ref: "esp:canopy/work/sound-resolution",
      anchor_revision: core.getProjectRevision("canopy"),
      kind: "concern",
      body: "Keep this scoped",
    })).accepted).toBe(true);
    expect(core.execute(command(core, worker, "claim.acquire", { id: "claim-stale-test", target_ref: "esp:canopy/work/sound-resolution", mode: "primary", lease_seconds: 600 })).accepted).toBe(true);
    expect(core.requireEntity("canopy", "annotation", "scope-note")).toMatchObject({ state: "stale", entity_version: 2 });

    expect(core.execute(command(core, owner, "annotation.reanchor", {
      annotation_ref: "esp:canopy/annotation/scope-note",
      anchor_revision: core.getProjectRevision("canopy"),
    })).accepted).toBe(true);
    expect(core.requireEntity("canopy", "annotation", "scope-note")).toMatchObject({ state: "reanchored" });
    expect(core.deriveAttentionRefs("canopy")).toContain("espalier://canopy/annotation/scope-note");
    expect(core.execute(command(core, worker, "work.transition", {
      work_item_ref: "esp:canopy/work/sound-resolution",
      work_state: "implemented",
    })).accepted).toBe(true);
    expect(core.requireEntity("canopy", "annotation", "scope-note")).toMatchObject({ state: "stale", entity_version: 4 });
  });

  it("prevents stable-ID replacement and worker authority escalation", () => {
    const core = seededCore();
    const goalBefore = structuredClone(core.requireEntity("canopy", "goal", "goal-r4"));
    const revisionBefore = core.getProjectRevision("canopy");
    expect(core.execute(command(core, worker, "goal.propose", { id: "goal-r4", purpose: "Overwrite accepted goal" }))).toMatchObject({ accepted: false, code: "invalid" });
    expect(core.getProjectRevision("canopy")).toBe(revisionBefore);
    expect(core.requireEntity("canopy", "goal", "goal-r4")).toEqual(goalBefore);

    expect(core.execute(command(core, worker, "work.create", {
      id: "scope-drift",
      epoch_id: "epoch-03",
      kind: "investigation",
      title: "Scope drift",
      scope: "Needs owner review",
      semantic_surfaces: ["scope:drift"],
      repo_surfaces: [],
      authority_state: "owner_pending",
      goal_integrity: "diverges",
    })).accepted).toBe(true);
    expect(core.execute(command(core, worker, "claim.acquire", { id: "scope-drift-claim", target_ref: "esp:canopy/work/scope-drift", mode: "primary", lease_seconds: 600 })).accepted).toBe(true);
    expect(core.execute(command(core, worker, "work.transition", {
      work_item_ref: "esp:canopy/work/scope-drift",
      work_state: "implemented",
      evidence_state: "verified",
      authority_state: "within_scope",
      goal_integrity: "advances",
      integration_state: "integrated",
    }))).toMatchObject({ accepted: false, code: "authority" });
    expect(core.requireEntity("canopy", "work", "scope-drift")).toMatchObject({ work_state: "active", evidence_state: "none", authority_state: "owner_pending", goal_integrity: "diverges", integration_state: "isolated" });
    expect(core.execute(command(core, worker, "epoch.open", { id: "worker-epoch", goal_revision_id: "goal-r4", title: "Worker epoch", baseline_ref: "git:unsafe" }))).toMatchObject({ accepted: false, code: "authority" });
    expect(core.execute(command(core, worker, "relation.create", { id: "worker-approved-relation", source_ref: "esp:canopy/work/sound-resolution", target_ref: "esp:canopy/work/scope-drift", relation_type: "depends_on", authority_state: "approved" }))).toMatchObject({ accepted: false, code: "authority" });
    expect(core.execute(command(core, worker, "relation.create", { id: "ordinary-relation", source_ref: "esp:canopy/work/sound-resolution", target_ref: "esp:canopy/work/scope-drift", relation_type: "relates_to", authority_state: "within_scope" })).accepted).toBe(true);
    expect(core.execute(command(core, worker, "relation.supersede", { relation_ref: "esp:canopy/relation/ordinary-relation" }))).toMatchObject({ accepted: false, code: "authority" });
  });

  it("keeps committed outcomes accepted when a live subscriber fails and replays historical refs", () => {
    const core = seededCore();
    core.onEvent(() => { throw new Error("subscriber failed"); });
    const envelope = command(core, worker, "annotation.add", {
      id: "listener-note",
      anchor_ref: "esp:canopy/work/sound-resolution",
      anchor_revision: core.getProjectRevision("canopy"),
      kind: "note",
      body: "durable despite subscriber failure",
    });
    expect(core.execute(envelope)).toMatchObject({ accepted: true });
    expect(core.execute(envelope)).toMatchObject({ accepted: true, idempotent_replay: true });
    expect(core.execute(command(core, worker, "claim.acquire", { id: "history-claim", target_ref: "esp:canopy/work/sound-resolution", mode: "primary", lease_seconds: 600 })).accepted).toBe(true);
    expect(core.execute(command(core, worker, "work.transition", { work_item_ref: "esp:canopy/work/sound-resolution", work_state: "implemented" })).accepted).toBe(true);
    expect(core.resolve("espalier://canopy/work/sound-resolution?rev=4")).toMatchObject({ entity_version: 1, work_state: "active" });
    expect(core.resolve("espalier://canopy/work/sound-resolution")).toMatchObject({ entity_version: 3, work_state: "implemented" });
    expect(() => core.resolve("espalier://canopy/work/sound-resolution?rev=999")).toThrow("outside project");
  });

  it("blocks compaction on descendant lane claims and carries verified work that still needs integration", () => {
    const core = seededCore();
    expect(core.execute(command(core, owner, "work.create", {
      id: "verified-unintegrated",
      epoch_id: "epoch-03",
      kind: "integration",
      title: "Verified but not integrated",
      scope: "Must cross the integration boundary",
      semantic_surfaces: [],
      repo_surfaces: [],
    })).accepted).toBe(true);
    expect(core.execute(command(core, worker, "evidence.attach", { id: "verified-unintegrated-proof", target_refs: ["esp:canopy/work/verified-unintegrated"], kind: "test", origin: "observed", ref: "test:verified-unintegrated", summary: "Deterministic tests passed", verification_state: "verified" }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, owner, "work.verify", { work_item_ref: "esp:canopy/work/verified-unintegrated", evidence_refs: ["esp:canopy/evidence/verified-unintegrated-proof"], outcome: "verified", rationale: "Verification policy satisfied" }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, worker, "claim.acquire", { id: "verified-unintegrated-claim", target_ref: "esp:canopy/work/verified-unintegrated", mode: "primary", lease_seconds: 600 }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, worker, "work.transition", { work_item_ref: "esp:canopy/work/verified-unintegrated", work_state: "implemented" }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, worker, "claim.release", { claim_ref: "esp:canopy/claim/verified-unintegrated-claim" }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, coordinator, "batch.create", {
      id: "compaction-batch",
      parent_work_item_ref: "esp:canopy/work/sound-resolution",
      lanes: [{ id: "compaction-lane", outcome: "Return later", scope: "Active lane", authority: "bounded", return_contract: "evidence", context_refs: [], semantic_surfaces: ["audio:lane"], repo_surfaces: [] }],
    })).accepted).toBe(true);
    expect(core.execute(command(core, worker, "claim.acquire", { id: "compaction-lane-claim", target_ref: "esp:canopy/lane/compaction-lane", mode: "primary", lease_seconds: 600 })).accepted).toBe(true);
    expect(core.execute(command(core, owner, "epoch.freeze", { epoch_ref: "esp:canopy/epoch/epoch-03" })).accepted).toBe(true);
    expect(core.execute(command(core, owner, "epoch.compact", { epoch_ref: "esp:canopy/epoch/epoch-03", receipt_id: "blocked-compaction", next_epoch: { id: "epoch-04", title: "Next", baseline_ref: "git:next" } }))).toMatchObject({ accepted: false, code: "claim-conflict" });
    expect(core.execute(command(core, worker, "claim.release", { claim_ref: "esp:canopy/claim/compaction-lane-claim" })).accepted).toBe(true);
    expect(core.execute(command(core, owner, "epoch.compact", { epoch_ref: "esp:canopy/epoch/epoch-03", receipt_id: "accepted-compaction", next_epoch: { id: "epoch-04", title: "Next", baseline_ref: "git:next" } })).accepted).toBe(true);
    expect(core.requireEntity("canopy", "work", "verified-unintegrated")).toMatchObject({ epoch_id: "epoch-04" });
    expect(core.requireEntity("canopy", "work", "sound-resolution")).toMatchObject({ epoch_id: "epoch-04" });
  });

  it.each([
    { id: "owner-pending-complete", authority_state: "owner_pending", goal_integrity: "advances" },
    { id: "diverging-complete", authority_state: "within_scope", goal_integrity: "diverges" },
    { id: "unclear-complete", authority_state: "within_scope", goal_integrity: "authority-unclear" },
    { id: "proposal-complete", authority_state: "proposal", goal_integrity: "advances" },
  ])("carries compaction work while an orthogonal authority axis remains unresolved: $id", (state) => {
    const core = seededCore();
    expect(core.execute(command(core, owner, "work.create", {
      id: state.id,
      epoch_id: "epoch-03",
      kind: "task",
      title: state.id,
      scope: "Completion axes do not erase authority questions",
      semantic_surfaces: [],
      repo_surfaces: [],
      authority_state: state.authority_state,
      goal_integrity: state.goal_integrity,
    }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, owner, "epoch.freeze", { epoch_ref: "esp:canopy/epoch/epoch-03" }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, owner, "epoch.compact", { epoch_ref: "esp:canopy/epoch/epoch-03", receipt_id: `receipt-${state.id}`, next_epoch: { id: "epoch-04", title: "Next", baseline_ref: "git:next" } }))).toMatchObject({ accepted: true });
    expect(core.requireEntity("canopy", "work", state.id)).toMatchObject({ epoch_id: "epoch-04" });
  });

  it("rejects a stale second-process writer with the actual current revision", () => {
    const root = mkdtempSync(join(tmpdir(), "espalier-cas-"));
    const filename = join(root, "espalier.sqlite");
    const first = seededCore(filename);
    const second = new EspalierCore(filename, { now: () => "2026-08-22T00:00:00.000Z" });
    try {
      const staleRevision = second.getProjectRevision("canopy");
      const staleCommand = command(second, worker, "annotation.add", { id: "second-writer", anchor_ref: "esp:canopy/work/sound-resolution", anchor_revision: staleRevision, kind: "note", body: "must lose CAS" }, { base: staleRevision });
      expect(first.execute(command(first, worker, "annotation.add", { id: "first-writer", anchor_ref: "esp:canopy/work/sound-resolution", anchor_revision: staleRevision, kind: "note", body: "wins CAS" }))).toMatchObject({ accepted: true });
      const actualRevision = first.getProjectRevision("canopy");
      const actualGetRevision = second.getProjectRevision.bind(second);
      let firstRead = true;
      second.getProjectRevision = (projectId: string) => {
        if (firstRead) { firstRead = false; return staleRevision; }
        return actualGetRevision(projectId);
      };
      expect(second.execute(staleCommand)).toMatchObject({ accepted: false, code: "stale", current_project_revision: actualRevision });
      expect(first.listEntities("canopy", "annotation").map((item) => item.id)).toEqual(["first-writer"]);
      expect(first.listEvents("canopy").map((event) => event.project_revision)).toEqual(Array.from({ length: actualRevision }, (_, index) => index + 1));
    } finally {
      second.close();
      first.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("routes agent scope drift to owner attention and keeps owner-confirmed evidence owner-only", () => {
    const core = seededCore();
    expect(core.execute(command(core, worker, "work.create", {
      id: "general-platform",
      epoch_id: "epoch-03",
      kind: "investigation",
      title: "General audio platform",
      scope: "Replace the accepted path with generalized infrastructure",
      semantic_surfaces: ["audio:platform"],
      repo_surfaces: ["packages/platform"],
      goal_integrity: "diverges",
      verification_policy: "research",
    })).accepted).toBe(true);
    expect(core.requireEntity("canopy", "work", "general-platform")).toMatchObject({ authority_state: "owner_pending", goal_integrity: "diverges", provenance: { authority: "agent-proposed" } });
    expect(core.deriveAttentionRefs("canopy")).toContain("espalier://canopy/work/general-platform");
    expect(core.execute(command(core, owner, "work.authority.resolve", { work_item_ref: "esp:canopy/work/general-platform", authority_state: "approved", goal_integrity: "research-only" })).accepted).toBe(true);
    expect(core.requireEntity("canopy", "work", "general-platform")).toMatchObject({ authority_state: "approved", goal_integrity: "research-only" });
    expect(core.execute(command(core, worker, "evidence.attach", { id: "false-owner-evidence", target_refs: ["esp:canopy/work/general-platform"], kind: "acceptance", origin: "owner-confirmed", ref: "chat:unknown", summary: "Owner accepted" }))).toMatchObject({ accepted: false, code: "authority" });
  });

  it("enforces Epoch, Work parentage, and Annotation revision invariants", () => {
    const core = seededCore();
    expect(core.execute(command(core, worker, "goal.propose", { id: "goal-proposed", purpose: "Not approved yet" }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, owner, "epoch.open", { id: "epoch-proposed", goal_revision_id: "goal-proposed", title: "Invalid", baseline_ref: "git:invalid" }))).toMatchObject({ accepted: false, code: "transition" });
    expect(core.execute(command(core, owner, "epoch.open", { id: "epoch-second", goal_revision_id: "goal-r4", title: "Second active", baseline_ref: "git:second" }))).toMatchObject({ accepted: false, code: "transition" });
    expect(core.execute(command(core, worker, "work.create", {
      id: "missing-parent",
      epoch_id: "epoch-03",
      parent_id: "does-not-exist",
      kind: "task",
      title: "Missing parent",
      scope: "Must fail",
      semantic_surfaces: [],
      repo_surfaces: [],
    }))).toMatchObject({ accepted: false, code: "not-found" });
    expect(core.execute(command(core, worker, "work.create", {
      id: "self-parent",
      epoch_id: "epoch-03",
      parent_id: "self-parent",
      kind: "task",
      title: "Self parent",
      scope: "Must fail",
      semantic_surfaces: [],
      repo_surfaces: [],
    }))).toMatchObject({ accepted: false, code: "invalid" });
    expect(core.execute(command(core, worker, "annotation.add", {
      id: "future-anchor",
      anchor_ref: "esp:canopy/work/sound-resolution",
      anchor_revision: core.getProjectRevision("canopy") + 10,
      kind: "note",
      body: "Cannot anchor the future",
    }))).toMatchObject({ accepted: false, code: "invalid" });

    expect(core.execute(command(core, owner, "epoch.freeze", { epoch_ref: "esp:canopy/epoch/epoch-03" }))).toMatchObject({ accepted: true });
    expect(core.requireEntity("canopy", "project", "canopy")).not.toHaveProperty("current_epoch_id");
    expect(() => new EspalierCore(":memory:").restoreProject(core.exportProject("canopy"))).not.toThrow();
    expect(core.execute(command(core, worker, "work.create", {
      id: "frozen-work",
      epoch_id: "epoch-03",
      kind: "task",
      title: "Frozen work",
      scope: "Must fail",
      semantic_surfaces: [],
      repo_surfaces: [],
    }))).toMatchObject({ accepted: false, code: "transition" });
  });

  it("protects the current Handoff pointer and validates its Evidence refs", () => {
    const core = seededCore();
    const intruder = { ...worker, principal_id: "mallory", session_id: "mallory-session" };
    const handoffPayload = {
      id: "handoff-current",
      work_item_ref: "esp:canopy/work/sound-resolution",
      completed: ["Implemented the bounded path"],
      current_state: "Ready for review",
      open_questions: [],
      blockers: [],
      next_safe_action: "Inspect evidence",
      evidence_refs: ["esp:canopy/evidence/work-proof"],
    };
    expect(core.execute(command(core, intruder, "handoff.record", handoffPayload))).toMatchObject({ accepted: false, code: "claim-conflict" });
    expect(core.execute(command(core, worker, "claim.acquire", { id: "handoff-primary", target_ref: "esp:canopy/work/sound-resolution", mode: "primary", lease_seconds: 600 }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, worker, "handoff.record", handoffPayload))).toMatchObject({ accepted: false, code: "not-found" });
    expect(core.execute(command(core, worker, "evidence.attach", { id: "work-proof", target_refs: ["esp:canopy/work/sound-resolution"], kind: "test", origin: "observed", ref: "test:work", summary: "Tests passed", verification_state: "verified" }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, intruder, "handoff.record", handoffPayload))).toMatchObject({ accepted: false, code: "claim-conflict" });
    expect(core.execute(command(core, worker, "handoff.record", handoffPayload))).toMatchObject({ accepted: true });
    expect(core.requireEntity("canopy", "work", "sound-resolution")).toMatchObject({ handoff_ref: "espalier://canopy/handoff/handoff-current" });
  });

  it("provides an owner-authorized Evidence path to verify and reopen Work", () => {
    const core = seededCore();
    expect(core.execute(command(core, worker, "evidence.attach", { id: "verified-proof", target_refs: ["esp:canopy/work/sound-resolution"], kind: "test", origin: "observed", ref: "test:verified", summary: "Deterministic tests passed", verification_state: "verified" }))).toMatchObject({ accepted: true });
    const verifyPayload = { work_item_ref: "esp:canopy/work/sound-resolution", evidence_refs: ["esp:canopy/evidence/verified-proof"], outcome: "verified", rationale: "Verification policy satisfied" };
    expect(core.execute(command(core, worker, "work.verify" as CommandEnvelope["type"], verifyPayload))).toMatchObject({ accepted: false, code: "authority" });
    expect(core.execute(command(core, owner, "work.verify" as CommandEnvelope["type"], verifyPayload))).toMatchObject({ accepted: true });
    expect(core.requireEntity("canopy", "work", "sound-resolution")).toMatchObject({ evidence_state: "verified", provenance: { authority: "owner-approved" } });

    expect(core.execute(command(core, worker, "evidence.attach", { id: "contradiction", target_refs: ["esp:canopy/work/sound-resolution"], kind: "regression", origin: "observed", ref: "test:regression", summary: "A later regression invalidated verification", verification_state: "rejected" }))).toMatchObject({ accepted: true });
    expect(core.execute(command(core, owner, "work.verify" as CommandEnvelope["type"], { work_item_ref: "esp:canopy/work/sound-resolution", evidence_refs: ["esp:canopy/evidence/contradiction"], outcome: "reopen", rationale: "Contradictory evidence" }))).toMatchObject({ accepted: true });
    expect(core.requireEntity("canopy", "work", "sound-resolution")).toMatchObject({ evidence_state: "tested" });
  });

  it("preflights through the canonical command path without recording state", () => {
    const core = seededCore();
    const beforeRevision = core.getProjectRevision("canopy");
    const beforeEvents = core.listEvents("canopy").length;
    const payload = { work_item_ref: "esp:canopy/work/sound-resolution", authority_state: "approved" };
    const candidate = command(core, owner, "work.authority.resolve", payload, {
      versions: { "espalier://canopy/work/sound-resolution": 1 },
    });

    expect(core.preflight(candidate)).toMatchObject({
      executable: true,
      command_type: "work.authority.resolve",
      current_project_revision: beforeRevision,
      projected_entity_versions: { "espalier://canopy/work/sound-resolution": 2 },
    });
    expect(core.getProjectRevision("canopy")).toBe(beforeRevision);
    expect(core.listEvents("canopy")).toHaveLength(beforeEvents);
    expect(core.store.getReceipt(candidate.command_id)).toBeUndefined();

    const denied = command(core, worker, "work.authority.resolve", payload);
    expect(core.preflight(denied)).toMatchObject({ executable: false, code: "authority" });
    expect(core.store.getReceipt(denied.command_id)).toBeUndefined();
    expect(core.preflight(command(core, worker, "work.create", { id: "sound-resolution", epoch_id: "epoch-03", kind: "task", title: "Duplicate", scope: "Duplicate", semantic_surfaces: [], repo_surfaces: [] }))).toMatchObject({ executable: false, code: "invalid", reason: "Work sound-resolution already exists" });
  });
});
