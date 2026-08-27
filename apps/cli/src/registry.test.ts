import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { EnrollmentRegistry } from "./registry.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("discovers the longest explicitly enrolled repo root without writing inside it", () => {
  const root = mkdtempSync(join(tmpdir(), "espalier-registry-"));
  roots.push(root);
  const repo = join(root, "repo");
  const nested = join(repo, "packages", "audio");
  mkdirSync(nested, { recursive: true });
  const registryPath = join(root, "app-data", "registry.json");
  const registry = new EnrollmentRegistry(registryPath);
  registry.link({ root: repo, project_id: "canopy", service_url: "http://127.0.0.1:4317" });
  expect(registry.discover(nested)).toMatchObject({ project_id: "canopy", root: realpathSync(repo) });
  expect(readFileSync(registryPath, "utf8")).toContain('"canopy"');
  expect(() => readFileSync(join(repo, ".espalier", "project.json"), "utf8")).toThrow();
});

it("keeps multiple repo roots for one project authority domain", () => {
  const root = mkdtempSync(join(tmpdir(), "espalier-multi-repo-"));
  roots.push(root);
  const first = join(root, "repo-a");
  const second = join(root, "repo-b");
  mkdirSync(first);
  mkdirSync(second);
  const registry = new EnrollmentRegistry(join(root, "data", "registry.json"));
  registry.link({ root: first, project_id: "programme", service_url: "http://127.0.0.1:4317" });
  registry.link({ root: second, project_id: "programme", service_url: "http://127.0.0.1:4317" });
  expect(registry.list()).toHaveLength(2);
  expect(registry.discover(first)?.project_id).toBe("programme");
  expect(registry.discover(second)?.project_id).toBe("programme");
});
