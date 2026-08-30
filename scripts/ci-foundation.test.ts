import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readZipComment, scanPublicSurface, sha256, summarizeCoverageJson, summarizeVitestJson, validatePublicCommitIdentity, validateSkillMarkdown } from "./lib/ci-foundation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

describe("repo-local CI foundation parsers", () => {
  it("bootstraps the supported npm from one checksum-pinned local action", () => {
    const workflows = [".github/workflows/ci.yml", ".github/workflows/maintenance.yml"]
      .map((path) => readFileSync(resolve(repositoryRoot, path), "utf8"))
      .join("\n");
    const setupNodeCount = workflows.match(/uses: actions\/setup-node@/g)?.length ?? 0;
    const setupNpmCount = workflows.match(/uses: \.\/\.github\/actions\/setup-npm/g)?.length ?? 0;
    const setupNpmAction = readFileSync(resolve(repositoryRoot, ".github/actions/setup-npm/action.yml"), "utf8");

    expect(setupNodeCount).toBeGreaterThan(0);
    expect(setupNpmCount).toBe(setupNodeCount);
    expect(workflows).not.toMatch(/npm install --global/);
    expect(setupNpmAction).toContain('ESPALIER_NPM_VERSION: "11.19.1"');
    expect(setupNpmAction).toContain('ESPALIER_NPM_SHA256: "9f58bff01604cb1b14008fef14dceb14d836a49225e45c6c2e37de3be3e707f0"');
    expect(setupNpmAction).toContain("https://registry.npmjs.org/npm/-/npm-${ESPALIER_NPM_VERSION}.tgz");
    expect(setupNpmAction).not.toContain("GITHUB_PATH");
    expect(setupNpmAction).toContain('node_bin="$(dirname "$(command -v node)")"');
  });

  it("accepts the canonical skill shape and rejects authority-breaking metadata or TODOs", () => {
    const valid = validateSkillMarkdown("skills/espalier/SKILL.md", `---\nname: espalier\ndescription: Keep coordination sparse and repo authority intact.\n---\n\n# Espalier\n\nAct only at durable boundaries.\n`);
    expect(valid.errors).toEqual([]);

    const invalid = validateSkillMarkdown("skills/other/SKILL.md", `---\nname: Espalier\ndescription: <replace me>\ncommand: hidden\n---\n\n# Espalier\n\n[TODO: invent authority]\n`);
    expect(invalid.errors).toEqual(expect.arrayContaining([
      "front matter contains unsupported key 'command'",
      "skill name must use lowercase hyphen-case",
      "skill description must not contain angle brackets",
      "skill body contains an unfinished TODO placeholder",
    ]));
    expect(invalid.errors.some((error) => error.includes("does not match"))).toBe(true);
  });

  it("finds tracked runtime artifacts, local paths, private emails, and unexplained binaries", () => {
    const privateHome = ["", "Users", "alice", "work"].join("/");
    const privateEmail = ["alice", "private.invalid"].join("@");
    const findings = scanPublicSurface([
      { path: ".env", content: Buffer.from("TOKEN=secret") },
      { path: "docs/note.md", content: Buffer.from(`${privateHome} and ${privateEmail}`) },
      { path: "dump.bin", content: Buffer.from([0, 1, 2]) },
      { path: "docs/public.md", content: Buffer.from("maintainer@example.com") },
      { path: "docs/outside.md", content: Buffer.from("../../outside"), symbolicLink: true },
    ]);
    expect(findings.map((finding) => finding.reason)).toEqual(expect.arrayContaining([
      "environment file is tracked",
      "machine-specific home path exposes local account 'alice'",
      "email address uses non-public domain 'private.invalid'",
      "unexpected binary file is tracked",
      "tracked symbolic links are not portable public-source artifacts",
    ]));
    expect(findings.some((finding) => finding.path === "docs/public.md")).toBe(false);
  });

  it("accepts the real canonical status files and rejects unpublished canonical rows in both languages", () => {
    const canonicalEntries = [
      { path: "docs/status.md", content: readFileSync(resolve(repositoryRoot, "docs/status.md")) },
      { path: "docs/zh-CN/status.md", content: readFileSync(resolve(repositoryRoot, "docs/zh-CN/status.md")) },
    ];
    expect(scanPublicSurface(canonicalEntries, "public")).toEqual([]);

    const staleEntries = canonicalEntries.map((entry) => ({
      ...entry,
      content: Buffer.from(replacePublicationState(entry.content.toString("utf8"), entry.path.includes("zh-CN") ? "未 release" : "Not released")),
    }));
    expect(scanPublicSurface(staleEntries, "incubator")).toEqual([]);
    expect(scanPublicSurface(staleEntries, "public").map((finding) => finding.reason)).toEqual(expect.arrayContaining([
      "public profile still marks the public repository as unpublished",
    ]));
  });

  it("retains the legacy publication row label and future-gate regressions", () => {
    expect(scanPublicSurface([
      { path: "docs/status.md", content: Buffer.from("| Public repository | Not released | Publication gate remains |") },
      { path: "PUBLIC_SOURCE.md", content: Buffer.from(["Publication", "still requires", "a clean-tree review."].join(" ")) },
    ], "public").map((finding) => finding.reason)).toEqual(expect.arrayContaining([
      "public profile still marks the public repository as unpublished",
      "public profile still describes initial publication as a future gate",
    ]));
  });

  it("runs the exact public-ready command against a temporary tree and observes the canonical row", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "espalier-public-ready-"));
    try {
      cpSync(resolve(repositoryRoot, "package.json"), resolve(temporaryRoot, "package.json"));
      cpSync(resolve(repositoryRoot, ".gitignore"), resolve(temporaryRoot, ".gitignore"));
      cpSync(resolve(repositoryRoot, "scripts/check-public-surface.mts"), resolve(temporaryRoot, "scripts/check-public-surface.mts"), { recursive: true });
      cpSync(resolve(repositoryRoot, "scripts/lib"), resolve(temporaryRoot, "scripts/lib"), { recursive: true });
      cpSync(resolve(repositoryRoot, "docs/status.md"), resolve(temporaryRoot, "docs/status.md"), { recursive: true });
      cpSync(resolve(repositoryRoot, "docs/zh-CN/status.md"), resolve(temporaryRoot, "docs/zh-CN/status.md"), { recursive: true });
      execFileSync("git", ["init", "--quiet"], { cwd: temporaryRoot });
      execFileSync("git", ["config", "user.name", "Faye"], { cwd: temporaryRoot });
      execFileSync("git", ["config", "user.email", "184336378+IndelibleVivi@users.noreply.github.com"], { cwd: temporaryRoot });
      execFileSync("git", ["add", "."], { cwd: temporaryRoot });
      execFileSync("git", ["commit", "--quiet", "-m", "build public-ready fixture"], { cwd: temporaryRoot });

      const receiptPath = resolve(temporaryRoot, "artifacts/public-surface.json");
      runPublicReady(temporaryRoot, receiptPath);
      expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toMatchObject({
        format: "espalier.public-surface-receipt/1",
        profile: "public",
        candidate_file_count: 6,
        finding_count: 0,
        commit_identity_count: 1,
        checks: { paths: "passed", text_privacy: "passed", publication_state: "passed", commit_identities: "passed" },
      });
      const statusPath = resolve(temporaryRoot, "docs/status.md");
      const publishedStatus = readFileSync(statusPath, "utf8");
      writeFileSync(statusPath, replacePublicationState(publishedStatus, "Not released"));
      expect(() => runPublicReady(temporaryRoot, receiptPath)).toThrow(/public profile still marks the public repository as unpublished/);
      expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toMatchObject({
        finding_count: 1,
        checks: { publication_state: "failed" },
      });
      writeFileSync(statusPath, publishedStatus);
      runPublicReady(temporaryRoot, receiptPath);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("accepts external GitHub noreply contributors while rejecting private email and malformed names", () => {
    const privateCommitEmail = ["alice", "example.net"].join("@");
    expect(validatePublicCommitIdentity("author", "Alice Example", "123456+alice@users.noreply.github.com")).toEqual([]);
    expect(validatePublicCommitIdentity("committer", "github-actions[bot]", "41898282+github-actions[bot]@users.noreply.github.com")).toEqual([]);
    expect(validatePublicCommitIdentity("author", "Alice\u0007Example", "123456+alice@users.noreply.github.com")).toContain("author name contains control characters");
    expect(validatePublicCommitIdentity("author", "Alice Example", privateCommitEmail)).toContain("author email is not a GitHub noreply identity");
    expect(validatePublicCommitIdentity("author", "Alice Example", "184336378+IndelibleVivi@users.noreply.github.com")).toContain("author name does not use the established owner attribution");
    expect(validatePublicCommitIdentity("author", "Faye Fang", "184336378+IndelibleVivi@users.noreply.github.com")).toEqual([]);
  });

  it("reads and binds the exact ZIP comment", () => {
    const comment = "b83dbd605a2597785a5251f2d7f7eedf899ffeb9";
    const header = Buffer.alloc(22);
    header.writeUInt32LE(0x06054b50, 0);
    header.writeUInt16LE(Buffer.byteLength(comment), 20);
    const archive = Buffer.concat([Buffer.from("payload"), header, Buffer.from(comment)]);
    expect(readZipComment(archive)).toBe(comment);
    expect(sha256(Buffer.from("espalier"))).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reduces Vitest and coverage receipts to stable numeric summaries", () => {
    expect(summarizeVitestJson({ numTotalTestSuites: 2, numPassedTestSuites: 2, numFailedTestSuites: 0, numTotalTests: 3, numPassedTests: 3, numFailedTests: 0, numPendingTests: 0 })).toMatchObject({ numTotalTests: 3, numPassedTests: 3 });
    const metric = { total: 10, covered: 9, skipped: 0, pct: 90 };
    expect(summarizeCoverageJson({ total: { lines: metric, statements: metric, functions: metric, branches: metric } })).toMatchObject({ branches: { pct: 90 } });
  });
});

function replacePublicationState(source: string, state: string): string {
  const pattern = /^(\|\s*Public source repository\s*\|)\s*[^|]*(\|)/m;
  if (!pattern.test(source)) throw new Error("canonical Public source repository row is missing");
  return source.replace(pattern, `$1 ${state} $2`);
}

function runPublicReady(cwd: string, outputPath?: string): void {
  execFileSync("npm", ["run", "check:public-ready", ...(outputPath ? ["--", "--output", outputPath] : [])], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, PATH: `${resolve(repositoryRoot, "node_modules/.bin")}:${process.env.PATH ?? ""}` },
  });
}
