import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";
import { scanPublicSurface, type PublicSurfaceEntry, type PublicSurfaceProfile } from "./lib/ci-foundation.mjs";

const profileArgument = process.argv.find((argument) => argument.startsWith("--profile="))?.split("=")[1];
if (profileArgument && profileArgument !== "incubator" && profileArgument !== "public") throw new Error(`Unknown public-surface profile '${profileArgument}'`);
const profile: PublicSurfaceProfile = profileArgument === "public" ? "public" : "incubator";
const root = resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
const trackedPaths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root }).toString("utf8").split("\u0000").filter(Boolean);
const entries: PublicSurfaceEntry[] = trackedPaths.map((path) => {
  const absolutePath = resolve(root, path);
  const stat = lstatSync(absolutePath);
  const symbolicLink = stat.isSymbolicLink();
  return { path, content: symbolicLink ? Buffer.from(readlinkSync(absolutePath), "utf8") : readFileSync(absolutePath), symbolicLink };
});
const findings = scanPublicSurface(entries, profile);
findings.push(...checkCommitIdentities(root));

if (findings.length > 0) {
  process.stderr.write(`Public-surface validation failed (${profile} profile):\n${findings.map((finding) => `- ${finding.path}: ${finding.reason}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Public-surface validation passed for ${trackedPaths.length} candidate files (${profile} profile).\n`);
}

function checkCommitIdentities(cwd: string): Array<{ path: string; reason: string }> {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  const requestedBase = process.env.PUBLIC_SURFACE_BASE_SHA?.trim();
  const requestedBaseIsUsable = requestedBase && /^[a-f0-9]{40}$/i.test(requestedBase) && !/^0+$/.test(requestedBase) && commitExists(cwd, requestedBase);
  const revisionRange = requestedBaseIsUsable
    ? `${requestedBase}..${head}`
    : commitExists(cwd, `${head}^`) ? `${head}^..${head}` : head;
  const output = execFileSync("git", ["log", "--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1e", revisionRange], { cwd, encoding: "utf8" });
  const findings: Array<{ path: string; reason: string }> = [];
  for (const record of output.split("\u001e").map((value) => value.trim()).filter(Boolean)) {
    const [commit, authorName, authorEmail, committerName, committerEmail] = record.split("\u001f");
    for (const [role, name, email] of [["author", authorName, authorEmail], ["committer", committerName, committerEmail]] as const) {
      if (!name || !/^(?:Faye(?: Fang)?|GitHub|web-flow|dependabot\[bot\]|github-actions\[bot\])$/.test(name)) findings.push({ path: commit ?? "commit", reason: `${role} name is not an approved public attribution` });
      if (!email || !/^(?:[^@]+@users[.]noreply[.]github[.]com|noreply@github[.]com)$/i.test(email)) findings.push({ path: commit ?? "commit", reason: `${role} email is not a GitHub noreply identity` });
    }
  }
  return findings;
}

function commitExists(cwd: string, commit: string): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
