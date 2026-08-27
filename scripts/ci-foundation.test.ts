import { describe, expect, it } from "vitest";
import { readZipComment, scanPublicSurface, sha256, summarizeCoverageJson, summarizeVitestJson, validateSkillMarkdown } from "./lib/ci-foundation.mjs";

describe("repo-local CI foundation parsers", () => {
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

  it("rejects pre-public publication state only in the public profile", () => {
    const staleEntries = [
      { path: "docs/status.md", content: Buffer.from(["| Public repository |", "Not released", "| Publication gate remains |"].join(" ")) },
      { path: "docs/zh-CN/status.md", content: Buffer.from(["| Public repository |", "未 release", "| publication gate 未闭合 |"].join(" ")) },
      { path: "PUBLIC_SOURCE.md", content: Buffer.from(["Publication", "still requires", "a clean-tree review."].join(" ")) },
    ];

    expect(scanPublicSurface(staleEntries, "incubator")).toEqual([]);
    expect(scanPublicSurface(staleEntries, "public").map((finding) => finding.reason)).toEqual(expect.arrayContaining([
      "public profile still marks the public repository as unpublished",
      "public profile still describes initial publication as a future gate",
    ]));

    expect(scanPublicSurface([
      { path: "docs/status.md", content: Buffer.from("| Public source repository | Published developer preview | No tagged product release |") },
      { path: "PUBLIC_SOURCE.md", content: Buffer.from("Future public updates remain subject to the same boundary.") },
    ], "public")).toEqual([]);
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
