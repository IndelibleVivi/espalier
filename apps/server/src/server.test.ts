import { afterEach, describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { EspalierCore } from "@espalier/core";
import { EspalierClient } from "@espalier/client";
import type { ActorIdentity, CommandEnvelope } from "@espalier/protocol";
import { seedExampleFixture } from "./fixture.js";
import { createEspalierServer, eventMatchesProject } from "./server.js";

const servers: Array<{ close: () => void }> = [];
afterEach(() => { for (const server of servers.splice(0)) server.close(); });

const owner: ActorIdentity = { principal_id: "example-owner", runtime_id: "test", device_id: "test", session_id: "s", role: "owner", capabilities: ["read", "write", "claim", "owner-update", "coordinate"] };
const worker: ActorIdentity = { principal_id: "example-worker", runtime_id: "test", device_id: "test", session_id: "worker", role: "worker", capabilities: ["read", "write", "claim", "evidence"] };
function envelope(core: EspalierCore, type: CommandEnvelope["type"], payload: Record<string, unknown>, id: string = crypto.randomUUID()): CommandEnvelope {
  return { command_id: id, project_id: "espalier", actor: owner, base_project_revision: core.getProjectRevision("espalier"), base_entity_versions: {}, type, occurred_at: "2026-08-22T00:00:00Z", payload };
}

describe("HTTP canonical service", () => {
  it("keeps project-scoped event streams isolated", () => {
    expect(eventMatchesProject("espalier", "espalier")).toBe(true);
    expect(eventMatchesProject("espalier", "canopy")).toBe(false);
    expect(eventMatchesProject(undefined, "canopy")).toBe(true);
  });

  it("accepts commands, serves same-revision projections, briefs, changes, and idempotent receipts", async () => {
    const core = new EspalierCore(":memory:", { now: () => "2026-08-22T00:00:00.000Z" });
    const server = createEspalierServer({ core });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    servers.push(server);
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const session = await (await fetch(`${base}/api/session`)).json() as { local_token: string };
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-espalier-local-token": session.local_token }, body: JSON.stringify(body) });

    const create = envelope(core, "project.create", { display_name: "Espalier", authority_domain: "espalier", repository_refs: [], owner_policy: { owners: ["example-owner"], approval: "any-one" } }, "create-project");
    expect((await (await post("/api/commands", create)).json()) as object).toMatchObject({ accepted: true, new_project_revision: 1 });
    expect((await (await post("/api/commands", create)).json()) as object).toMatchObject({ accepted: true, idempotent_replay: true, new_project_revision: 1 });
    expect((await (await post("/api/commands", envelope(core, "goal.approve", { id: "goal-1", purpose: "Build Espalier", present_consumers: [], programme_order: [], binding_constraints: [], trust_boundaries: [], explicit_non_goals: [], source_refs: [] }))).json()) as object).toMatchObject({ accepted: true });
    expect((await (await post("/api/commands", envelope(core, "epoch.open", { id: "epoch-1", goal_revision_id: "goal-1", title: "First epoch", baseline_ref: "git:init" }))).json()) as object).toMatchObject({ accepted: true });

    const live = await (await fetch(`${base}/api/projects/espalier/projections/live`)).json() as { as_of_revision: number };
    const atlas = await (await fetch(`${base}/api/projects/espalier/projections/atlas`)).json() as { as_of_revision: number };
    expect(live.as_of_revision).toBe(3);
    expect(atlas.as_of_revision).toBe(3);

    const humanSurface = await (await post("/api/projects/espalier/human-surface", { actor: owner, mode: "live", since_revision: 1 })).json() as { schema_version: string; as_of_revision: number; diagnostics: { canonical_route_objects: number; geometry_fields: number } };
    expect(humanSurface).toMatchObject({ schema_version: "espalier.human-surface@0", as_of_revision: 3, diagnostics: { canonical_route_objects: 0, geometry_fields: 0 } });

    const briefResponse = await post("/api/projects/espalier/brief", { actor: owner, last_seen_revision: 0, context_budget_tokens: 700, requested_projection: "presence", language: "zh-CN" });
    const brief = await briefResponse.json() as { as_of_revision: number; estimated_tokens: number };
    expect(brief).toMatchObject({ as_of_revision: 3 });
    expect(brief.estimated_tokens).toBeLessThanOrEqual(700);

    const changes = await (await fetch(`${base}/api/projects/espalier/changes?since=1`)).json() as unknown[];
    expect(changes).toHaveLength(2);
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ ok: true, schema_version: 4, protocol_version: "0.2" });
    expect(await (await fetch(`${base}/api/capabilities`)).json()).toMatchObject({ schema_version: 4, protocol_version: "0.2", deployment_boundary: "localhost-local-token", commands: expect.arrayContaining(["batch.create", "batch.integrate"]), projections: expect.arrayContaining(["human-surface"]), features: expect.arrayContaining(["human-surface@0", "projection-only-routes"]) });
    expect(await (await fetch(`${base}/api/search?q=Build&project_id=espalier`)).json()).toEqual([expect.objectContaining({ id: "goal-1", type: "goal" })]);
    expect(await (await fetch(`${base}/api/projects/espalier/export`)).json()).toMatchObject({ format: "espalier.project-export/1", project_id: "espalier", project_revision: 3, attachments_manifest: [] });
    expect(await (await fetch(`${base}/api/projects/espalier/metrics`)).json()).toMatchObject({ as_of_revision: 3, semantic_event_count: 3, rejected_write_count: 0 });
    expect(await (await fetch(`${base}/api/dca?project_id=espalier&ref=esp%3Aespalier%2Fgoal%2Fgoal-1`)).json()).toMatchObject({ format: "espalier.dca-snapshot/1", source_revision: 3, focus_ref: "espalier://espalier/goal/goal-1" });
    expect(await (await fetch(`${base}/api/portfolio`)).json()).toMatchObject({ schema_version: "espalier.human-portfolio@0", mode: "portfolio", projects: [expect.objectContaining({ project_id: "espalier", as_of_revision: 3, owner_policy: { owners: ["example-owner"], approval: "any-one" } })] });
  });

  it("enforces loopback listen, Host/Origin, JSON, and the local mutation token", async () => {
    const core = new EspalierCore(":memory:");
    const forbidden = createEspalierServer({ core });
    expect(() => forbidden.listen(0, "0.0.0.0")).toThrow("refuses non-loopback binding");
    forbidden.close();

    const server = createEspalierServer({ core });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    servers.push(server);
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const command = envelope(core, "project.create", { display_name: "Espalier", authority_domain: "espalier", repository_refs: [], owner_policy: { owners: ["example-owner"], approval: "any-one" } }, "contained-create");

    expect((await fetch(`${base}/api/session`, { headers: { origin: "https://attacker.example" } })).status).toBe(403);
    expect(await rawStatus(port, "/api/health", { host: "attacker.example" })).toBe(403);
    expect((await fetch(`${base}/api/commands`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(command) })).status).toBe(415);
    expect((await fetch(`${base}/api/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) })).status).toBe(403);
    expect((await fetch(`${base}/api/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: "RESTORE_PROJECT", project: {} }) })).status).toBe(403);
    const session = await (await fetch(`${base}/api/session`)).json() as { local_token: string };
    expect(session.local_token.length).toBeGreaterThanOrEqual(32);
    expect((await fetch(`${base}/api/commands`, { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.example", "x-espalier-local-token": session.local_token }, body: JSON.stringify(command) })).status).toBe(403);
    expect((await fetch(`${base}/api/commands`, { method: "POST", headers: { "content-type": "application/json", "x-espalier-local-token": session.local_token }, body: JSON.stringify(command) })).status).toBe(200);
  });

  it("seeds the neutral example fixture through canonical verification and integration paths", () => {
    const core = new EspalierCore(":memory:", { now: () => "2026-08-23T00:00:00.000Z" });
    const result = seedExampleFixture(core);

    expect(result).toMatchObject({ seeded: true, revision: expect.any(Number) });
    expect(core.requireEntity("orchard", "work", "source-contract")).toMatchObject({ evidence_state: "verified", integration_state: "integrated" });
    expect(core.requireEntity("orchard", "work", "reader-onboarding")).toMatchObject({ work_state: "implemented", evidence_state: "none", integration_state: "needs-integration" });
    expect(core.requireEntity("orchard", "evidence", "onboarding-tests")).toMatchObject({ verification_state: "verified", target_refs: ["espalier://orchard/work/reader-onboarding"] });
    expect(seedExampleFixture(core)).toEqual({ seeded: false, revision: result.revision });
  });

  it("preserves typed budget failures through HTTP and the reusable client", async () => {
    const core = new EspalierCore(":memory:", { now: () => "2026-08-22T00:00:00.000Z" });
    accept(core, owner, "project.create", { display_name: "Espalier", authority_domain: "espalier", repository_refs: [], owner_policy: { owners: ["example-owner"], approval: "any-one" } });
    accept(core, owner, "goal.approve", { id: "goal-1", purpose: "Build Espalier", present_consumers: [], programme_order: [], binding_constraints: [], trust_boundaries: [], explicit_non_goals: [], source_refs: [] });
    accept(core, owner, "epoch.open", { id: "epoch-1", goal_revision_id: "goal-1", title: "First epoch", baseline_ref: "git:init" });
    accept(core, worker, "work.create", { id: "root", epoch_id: "epoch-1", kind: "workstream", title: "Root", scope: "Root", semantic_surfaces: ["root"], repo_surfaces: [], priority: 1, verification_policy: "test" });
    let parentId = "root";
    for (let depth = 2; depth <= 20; depth += 1) {
      const id = `deep-${depth}`;
      accept(core, worker, "work.create", { id, epoch_id: "epoch-1", parent_id: parentId, kind: "task", title: `Deep ${depth}`, scope: `Depth ${depth}`, semantic_surfaces: [`deep:${depth}`], repo_surfaces: [], priority: depth, verification_policy: "test" });
      parentId = id;
    }
    accept(core, owner, "batch.create", { id: "tight-batch", parent_work_item_ref: "esp:espalier/work/root", lanes: [{ id: "tight-lane", outcome: `Outcome ${"o".repeat(2000)}`, scope: `Scope ${"s".repeat(2000)}`, authority: `Authority ${"a".repeat(2000)}`, return_contract: `Return ${"r".repeat(2000)}`, context_refs: [], semantic_surfaces: [], repo_surfaces: [] }] });
    accept(core, worker, "claim.acquire", { id: "tight-claim", target_ref: "esp:espalier/lane/tight-lane", mode: "primary", lease_seconds: 600 });

    accept(core, owner, "project.create", { display_name: "Oversized", authority_domain: "oversized", repository_refs: [], owner_policy: { owners: ["example-owner"], approval: "any-one" } }, "oversized");
    accept(core, owner, "goal.approve", { id: "huge-goal", purpose: "Large authority", present_consumers: [], programme_order: [], binding_constraints: Array.from({ length: 1000 }, (_, index) => `Binding constraint ${index}`), trust_boundaries: [], explicit_non_goals: [], source_refs: [] }, "oversized");

    const server = createEspalierServer({ core });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    servers.push(server);
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const client = new EspalierClient(base);

    const focusError = await rejected(client.humanSurface("espalier", { actor: owner, mode: "focus", focus_ref: "esp:espalier/work/deep-20", visible_node_budget: 3 }));
    expect(focusError).toMatchObject({ name: "EspalierApiError", status: 422, code: "visible-node-budget-too-small-for-focus", details: { visible_node_budget: 3, required_node_count: 20, focus_ref: "espalier://espalier/work/deep-20", required_refs: expect.any(Array) } });

    const surfaceByteError = await rejected(client.humanSurface("espalier", { actor: owner, response_byte_budget: 64 }));
    expect(surfaceByteError).toMatchObject({ status: 422, code: "response-budget-too-small-for-mandatory-surface", details: { budget_bytes: 64, required_bytes: expect.any(Number), expansion_ref: "espalier://espalier/goal/goal-1" } });

    const taskError = await rejected(client.brief("espalier", { actor: worker, current_claim_ref: "esp:espalier/claim/tight-claim", requested_task_ref: "esp:espalier/lane/tight-lane", last_seen_revision: core.getProjectRevision("espalier"), context_budget_tokens: 500, requested_projection: "normal", language: "en" }));
    expect(taskError).toMatchObject({ status: 422, code: "budget-too-small-for-required-task-contract", details: { budget_tokens: 500, required_tokens: expect.any(Number), required_refs: expect.arrayContaining(["espalier://espalier/lane/tight-lane"]) } });

    const authorityError = await rejected(client.brief("oversized", { actor: owner, last_seen_revision: core.getProjectRevision("oversized"), context_budget_tokens: 320, requested_projection: "presence", language: "en" }));
    expect(authorityError).toMatchObject({ status: 422, code: "budget-too-small-for-authority-core", details: { budget_tokens: 320, required_tokens: expect.any(Number), required_refs: expect.arrayContaining(["espalier://oversized/goal/huge-goal"]) } });

    const portfolioResponse = await fetch(`${base}/api/portfolio?response_byte_budget=64`);
    expect(portfolioResponse.status).toBe(422);
    expect(await portfolioResponse.json()).toMatchObject({ error: { code: "response-budget-too-small-for-mandatory-portfolio", message: expect.any(String), budget_bytes: 64, required_bytes: expect.any(Number), expansion_refs: expect.any(Array) } });

    const portfolioError = await rejected(client.portfolio({ response_byte_budget: 64 }));
    expect(portfolioError).toMatchObject({ status: 422, code: "response-budget-too-small-for-mandatory-portfolio", details: { budget_bytes: 64, required_bytes: expect.any(Number), expansion_refs: expect.any(Array) } });
  });
});

function accept(core: EspalierCore, actor: ActorIdentity, type: CommandEnvelope["type"], payload: Record<string, unknown>, projectId = "espalier"): void {
  const receipt = core.execute({ command_id: crypto.randomUUID(), project_id: projectId, actor, base_project_revision: core.getProjectRevision(projectId), base_entity_versions: {}, type, occurred_at: core.currentTime(), payload });
  if (!receipt.accepted) throw new Error(receipt.reason);
}

async function rejected(promise: Promise<unknown>): Promise<Record<string, unknown>> {
  try { await promise; }
  catch (error) { return error as Record<string, unknown>; }
  throw new Error("Expected request rejection");
}

function rawStatus(port: number, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, headers }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end();
  });
}
