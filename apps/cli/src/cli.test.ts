import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { EspalierClient } from "@espalier/client";
import { EspalierCore } from "@espalier/core";
import { createEspalierServer } from "../../server/src/server.js";
import { runCli } from "./index.js";
import { EnrollmentRegistry } from "./registry.js";

const cleanup: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); for (const item of cleanup.splice(0).reverse()) item(); });

it("links a new thin seed and resumes it through a bounded join brief", async () => {
  const root = mkdtempSync(join(tmpdir(), "espalier-cli-"));
  const repo = join(root, "garden");
  mkdirSync(repo);
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const core = new EspalierCore(":memory:", { now: () => "2026-08-22T00:00:00.000Z" });
  const server = createEspalierServer({ core });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  cleanup.push(() => { server.close(); core.close(); });
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  const registry = join(root, "data", "registry.json");
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io = { out: (value: string) => stdout.push(value), error: (value: string) => stderr.push(value) };

  expect(await runCli(["link", repo, "--project", "garden", "--name", "Garden", "--purpose", "Grow a coherent project", "--url", url, "--registry", registry, "--principal", "example-owner"], io)).toBe(0);
  expect(core.getProjectRevision("garden")).toBe(3);
  const previous = process.cwd();
  process.chdir(repo);
  cleanup.push(() => process.chdir(previous));
  expect(await runCli(["join", "--registry", registry, "--principal", "example-worker"], io)).toBe(0);
  expect(stderr).toEqual([]);
  expect(stdout.at(-1)).toContain('"as_of_revision": 3');
  expect(stdout.at(-1)).toContain('"current_goal_revision"');
});

it("doctor follows the current repo enrollment to its service and verifies the project", async () => {
  const root = mkdtempSync(join(tmpdir(), "espalier-doctor-"));
  const repo = join(root, "canopy");
  mkdirSync(repo);
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const core = new EspalierCore(":memory:", { now: () => "2026-08-27T00:00:00.000Z" });
  const server = createEspalierServer({ core });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  cleanup.push(() => { server.close(); core.close(); });
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  const registry = join(root, "data", "registry.json");
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io = { out: (value: string) => stdout.push(value), error: (value: string) => stderr.push(value) };

  expect(await runCli(["link", repo, "--project", "canopy", "--name", "Canopy", "--purpose", "Keep host-authored audio work coherent", "--url", url, "--registry", registry, "--principal", "example-owner"], io)).toBe(0);
  const previous = process.cwd();
  process.chdir(repo);
  cleanup.push(() => process.chdir(previous));

  const exit = await runCli(["doctor", "--registry", registry], io);
  expect(stderr).toEqual([]);
  expect(exit).toBe(0);
  const report = JSON.parse(stdout.at(-1)!) as {
    ok: boolean;
    enrollment: { root: string; project_id: string; service_url: string };
    service: { url: string; health: { ok: boolean }; capabilities: { protocol_version: string }; negotiation: { compatible: boolean; protocol_version: string } };
    project: { project_id: string; project_revision: number };
  };
  expect(report).toMatchObject({
    ok: true,
    enrollment: { root: realpathSync(repo), project_id: "canopy", service_url: url },
    service: { url, health: { ok: true }, capabilities: { protocol_version: "0.2" }, negotiation: { compatible: true, protocol_version: "0.2" } },
    project: { project_id: "canopy", project_revision: 3 },
  });
});

it("gives the default presence brief enough bounded room for the authority core", async () => {
  const root = mkdtempSync(join(tmpdir(), "espalier-join-budget-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const registryPath = join(root, "registry.json");
  new EnrollmentRegistry(registryPath).link({ root: repo, project_id: "programme", service_url: "http://127.0.0.1:4317" });
  const brief = vi.spyOn(EspalierClient.prototype, "brief").mockResolvedValue({ as_of_revision: 12 });
  const previous = process.cwd();
  process.chdir(repo);
  cleanup.push(() => process.chdir(previous));

  expect(await runCli(["join", "--registry", registryPath], { out: () => {}, error: () => {} })).toBe(0);
  expect(brief).toHaveBeenCalledWith("programme", expect.objectContaining({ context_budget_tokens: 900, requested_projection: "presence" }));
});

it("passes a canonical stable ref from search through inspect unchanged", async () => {
  const root = mkdtempSync(join(tmpdir(), "espalier-inspect-ref-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const registryPath = join(root, "registry.json");
  new EnrollmentRegistry(registryPath).link({ root: repo, project_id: "canopy", service_url: "http://127.0.0.1:4317" });
  const focus = vi.spyOn(EspalierClient.prototype, "focus").mockResolvedValue({ as_of_revision: 25 });
  const previous = process.cwd();
  process.chdir(repo);
  cleanup.push(() => process.chdir(previous));
  const stableRef = "espalier://canopy/work/g-production-canvas";

  expect(await runCli(["inspect", stableRef, "--registry", registryPath], { out: () => {}, error: () => {} })).toBe(0);
  expect(focus).toHaveBeenCalledWith(stableRef);
});

it("releases a canonical Claim when the requested Work uses compact ref spelling", async () => {
  const root = mkdtempSync(join(tmpdir(), "espalier-release-ref-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const registryPath = join(root, "registry.json");
  new EnrollmentRegistry(registryPath).link({ root: repo, project_id: "orchard", service_url: "http://127.0.0.1:4317" });
  vi.spyOn(EspalierClient.prototype, "projection").mockResolvedValue({
    claims: [{ id: "claim-agent-onboarding", principal_id: "fresh-agent", entity_version: 1, target_ref: "espalier://orchard/work/public-onboarding" }],
  });
  vi.spyOn(EspalierClient.prototype, "projects").mockResolvedValue([{ project_id: "orchard", project_revision: 8 }]);
  const command = vi.spyOn(EspalierClient.prototype, "command").mockResolvedValue({ accepted: true, command_id: "release", project_id: "orchard", new_project_revision: 9, changed_entity_versions: {}, emitted_event_ids: [], attention_changes: { opened: [], resolved: [] }, next_brief_hint: "" });
  const previous = process.cwd();
  process.chdir(repo);
  cleanup.push(() => process.chdir(previous));

  expect(await runCli(["release", "public-onboarding", "--principal", "fresh-agent", "--registry", registryPath], { out: () => {}, error: () => {} })).toBe(0);
  expect(command).toHaveBeenCalledWith(expect.objectContaining({
    type: "claim.release",
    payload: { claim_ref: "esp:orchard/claim/claim-agent-onboarding" },
    base_entity_versions: { "espalier://orchard/claim/claim-agent-onboarding": 1 },
  }));
});
