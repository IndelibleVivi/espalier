import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");
const tsxLoader = createRequire(resolve(repositoryRoot, "scripts/create-review-bundle.test.ts")).resolve("tsx");

describe("review bundle provenance", () => {
  it("binds source range, tested commit and tested tree in manifest v2", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "espalier-review-manifest-"));
    try {
      const fixtureRepository = join(temporaryRoot, "repository");
      mkdirSync(join(fixtureRepository, "packages/protocol/src"), { recursive: true });
      writeFileSync(join(fixtureRepository, "package-lock.json"), `${JSON.stringify({ lockfileVersion: 3 })}\n`);
      writeFileSync(join(fixtureRepository, "packages/protocol/src/index.ts"), [
        'export const PROTOCOL_VERSION = "0.2";',
        "export const SCHEMA_VERSION = 4;",
        "",
      ].join("\n"));
      writeFileSync(join(fixtureRepository, "README.md"), "base\n");
      git(fixtureRepository, "init", "--initial-branch=main");
      git(fixtureRepository, "config", "user.name", "Fixture contributor");
      git(fixtureRepository, "config", "user.email", "fixture@users.noreply.github.com");
      git(fixtureRepository, "add", "package-lock.json", "packages/protocol/src/index.ts", "README.md");
      git(fixtureRepository, "commit", "-m", "create fixture");
      const base = git(fixtureRepository, "rev-parse", "HEAD^{commit}");
      writeFileSync(join(fixtureRepository, "README.md"), "tested\n");
      git(fixtureRepository, "add", "README.md");
      git(fixtureRepository, "commit", "-m", "change fixture");
      const commit = git(fixtureRepository, "rev-parse", "HEAD^{commit}");
      const tree = git(fixtureRepository, "rev-parse", "HEAD^{tree}");
      const publicSummaryPath = join(temporaryRoot, "public-surface.json");
      writeFileSync(publicSummaryPath, `${JSON.stringify({ format: "espalier.public-surface-receipt/1", finding_count: 0 })}\n`);
      const browserSummaryPath = join(temporaryRoot, "browser-summary.json");
      writeFileSync(browserSummaryPath, `${JSON.stringify({ format: "espalier.browser-smoke-receipt/2", status: "passed" })}\n`);
      const managedSummaryPath = join(temporaryRoot, "managed-service-macos.json");
      writeFileSync(managedSummaryPath, `${JSON.stringify({ format: "espalier.managed-service-receipt/1", status: "passed", platform: "macos" })}\n`);
      const outputDirectory = join(temporaryRoot, "bundle");
      execFileSync(process.execPath, [
        "--import", tsxLoader,
        resolve(repositoryRoot, "scripts/create-review-bundle.mts"),
        "--commit", commit,
        "--source-base", base,
        "--source-head", commit,
        "--event", "manifest-test",
        "--output-dir", outputDirectory,
        "--public-surface-summary", publicSummaryPath,
        "--browser-summary", browserSummaryPath,
        "--managed-service-summary", managedSummaryPath,
      ], { cwd: fixtureRepository, stdio: "pipe" });

      const manifestPath = join(outputDirectory, `espalier-${commit.slice(0, 12)}.review-manifest.json`);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      expect(manifest).toMatchObject({
        format: "espalier.review-manifest/2",
        source: { base_sha: base, head_sha: commit },
        tested: { commit_sha: commit, tree_sha: tree, event: "manifest-test" },
        source_archive: { zip_comment: commit },
        public_surface_summary: { format: "espalier.public-surface-receipt/1", finding_count: 0 },
        browser_summary: { format: "espalier.browser-smoke-receipt/2", status: "passed" },
        managed_service_summaries: [{ format: "espalier.managed-service-receipt/1", status: "passed", platform: "macos" }],
      });
      expect(manifest).not.toHaveProperty("commit_sha");
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});

function git(cwd: string, ...arguments_: string[]): string {
  return execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
}
