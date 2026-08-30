import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  scanPublicSurface,
  validatePublicCommitIdentity,
  type PublicSurfaceCheck,
  type PublicSurfaceEntry,
  type PublicSurfaceFinding,
  type PublicSurfaceProfile,
} from "./lib/ci-foundation.mjs";

const profileArgument = process.argv.find((argument) => argument.startsWith("--profile="))?.split("=")[1];
if (profileArgument && profileArgument !== "incubator" && profileArgument !== "public") throw new Error(`Unknown public-surface profile '${profileArgument}'`);
const profile: PublicSurfaceProfile = profileArgument === "public" ? "public" : "incubator";
const outputArgumentIndex = process.argv.indexOf("--output");
const outputArgument = outputArgumentIndex >= 0 ? process.argv[outputArgumentIndex + 1] : undefined;
if (outputArgumentIndex >= 0 && !outputArgument) throw new Error("--output requires a receipt path");

const root = resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
const testedCommitSha = execFileSync("git", ["rev-parse", "HEAD^{commit}"], { cwd: root, encoding: "utf8" }).trim();
const testedTreeSha = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
const trackedPaths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root }).toString("utf8").split("\u0000").filter(Boolean);
const entries: PublicSurfaceEntry[] = trackedPaths.map((path) => {
  const absolutePath = resolve(root, path);
  const stat = lstatSync(absolutePath);
  const symbolicLink = stat.isSymbolicLink();
  return { path, content: symbolicLink ? Buffer.from(readlinkSync(absolutePath), "utf8") : readFileSync(absolutePath), symbolicLink };
});
const surfaceFindings = scanPublicSurface(entries, profile);
const identityResult = checkCommitIdentities(root, testedCommitSha);
const findings = [...surfaceFindings, ...identityResult.findings];
const checks = Object.fromEntries(
  (["paths", "text_privacy", "publication_state", "commit_identities"] satisfies PublicSurfaceCheck[])
    .map((check) => [check, findings.some((finding) => finding.check === check) ? "failed" : "passed"]),
);

const receipt = {
  format: "espalier.public-surface-receipt/1",
  profile,
  tested_commit_sha: testedCommitSha,
  tested_tree_sha: testedTreeSha,
  source_base_sha: identityResult.sourceBaseSha,
  source_head_sha: identityResult.sourceHeadSha,
  candidate_file_count: trackedPaths.length,
  finding_count: findings.length,
  commit_identity_count: identityResult.commitCount,
  checks,
  findings,
};
if (outputArgument) {
  const outputPath = resolve(root, outputArgument);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

if (findings.length > 0) {
  process.stderr.write(`Public-surface validation failed (${profile} profile):\n${findings.map((finding) => `- ${finding.path}: ${finding.reason}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Public-surface validation passed for ${trackedPaths.length} candidate files (${profile} profile).\n`);
}

interface CommitIdentityResult {
  findings: PublicSurfaceFinding[];
  commitCount: number;
  sourceBaseSha: string | null;
  sourceHeadSha: string;
}

function checkCommitIdentities(cwd: string, currentHead: string): CommitIdentityResult {
  const requestedHead = process.env.PUBLIC_SURFACE_HEAD_SHA?.trim();
  const headIsUsable = !requestedHead || isFullCommitSha(requestedHead) && commitExists(cwd, requestedHead);
  if (!headIsUsable) {
    return {
      findings: [{ path: ".git", reason: "requested source head is not an available full commit SHA", check: "commit_identities" }],
      commitCount: 0,
      sourceBaseSha: null,
      sourceHeadSha: requestedHead ?? currentHead,
    };
  }
  const head = requestedHead ?? currentHead;
  const requestedBase = process.env.PUBLIC_SURFACE_BASE_SHA?.trim();
  const requestedBaseIsUsable = requestedBase && isFullCommitSha(requestedBase) && !/^0+$/.test(requestedBase) && commitExists(cwd, requestedBase);
  const revisionRange = requestedBaseIsUsable
    ? `${requestedBase}..${head}`
    : commitExists(cwd, `${head}^`) ? `${head}^..${head}` : head;
  const records = execFileSync("git", ["log", "--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1e", revisionRange], { cwd, encoding: "utf8" })
    .split("\u001e")
    .map((value) => value.trim())
    .filter(Boolean);
  const findings: PublicSurfaceFinding[] = [];
  for (const record of records) {
    const [commit, authorName, authorEmail, committerName, committerEmail] = record.split("\u001f");
    for (const [role, name, email] of [["author", authorName, authorEmail], ["committer", committerName, committerEmail]] as const) {
      for (const reason of validatePublicCommitIdentity(role, name, email)) findings.push({ path: commit ?? "commit", reason, check: "commit_identities" });
    }
  }
  return { findings, commitCount: records.length, sourceBaseSha: requestedBaseIsUsable ? requestedBase : null, sourceHeadSha: head };
}

function isFullCommitSha(value: string): boolean {
  return /^[a-f0-9]{40}$/i.test(value);
}

function commitExists(cwd: string, commit: string): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
