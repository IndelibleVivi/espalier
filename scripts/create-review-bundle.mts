import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { readZipComment, sha256, summarizeCoverageJson, summarizeVitestJson } from "./lib/ci-foundation.mjs";

const options = parseArguments(process.argv.slice(2));
const root = resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
const commit = execFileSync("git", ["rev-parse", `${options.commit ?? "HEAD"}^{commit}`], { cwd: root, encoding: "utf8" }).trim();
const tree = execFileSync("git", ["rev-parse", `${commit}^{tree}`], { cwd: root, encoding: "utf8" }).trim();
const sourceHead = execFileSync("git", ["rev-parse", `${options.sourceHead ?? commit}^{commit}`], { cwd: root, encoding: "utf8" }).trim();
const sourceBase = options.sourceBase && !/^0+$/.test(options.sourceBase)
  ? execFileSync("git", ["rev-parse", `${options.sourceBase}^{commit}`], { cwd: root, encoding: "utf8" }).trim()
  : null;
const shortCommit = commit.slice(0, 12);
const outputDirectory = resolve(options.outputDirectory ?? "artifacts/review-bundle");
mkdirSync(outputDirectory, { recursive: true });
const archiveName = `espalier-${shortCommit}.zip`;
const archivePath = join(outputDirectory, archiveName);
const manifestPath = join(outputDirectory, `espalier-${shortCommit}.review-manifest.json`);
const temporaryArchivePath = `${archivePath}.tmp`;
if (existsSync(archivePath) || existsSync(manifestPath) || existsSync(temporaryArchivePath)) throw new Error(`review bundle output already exists for ${commit}`);
execFileSync("git", ["archive", "--format=zip", `--output=${temporaryArchivePath}`, commit], { cwd: root, stdio: "inherit" });
const archive = readFileSync(temporaryArchivePath);
const zipComment = readZipComment(archive);
if (zipComment !== commit) throw new Error(`review archive comment '${zipComment}' does not match tested commit '${commit}'`);
renameSync(temporaryArchivePath, archivePath);

const protocolSource = execFileSync("git", ["show", `${commit}:packages/protocol/src/index.ts`], { cwd: root, encoding: "utf8" });
const packageLock = execFileSync("git", ["show", `${commit}:package-lock.json`], { cwd: root });
const protocolVersion = requiredMatch(protocolSource, /export const PROTOCOL_VERSION = "([^"]+)";/, "protocol version");
const schemaVersion = Number(requiredMatch(protocolSource, /export const SCHEMA_VERSION = (\d+);/, "schema version"));
const testSummaries = options.testSummaries.map((path) => ({ source: basename(path), ...summarizeVitestJson(JSON.parse(readFileSync(path, "utf8")) as unknown) }));
const coverageSummary = options.coverageSummary
  ? summarizeCoverageJson(JSON.parse(readFileSync(options.coverageSummary, "utf8")) as unknown)
  : undefined;
const requiredJobs = parseRequiredJobs(process.env.CI_REQUIRED_JOBS_JSON);
const publicSurfaceSummary = options.publicSurfaceSummary ? readJsonReceipt(options.publicSurfaceSummary, "public-surface summary") : undefined;
const browserSummary = options.browserSummary ? readJsonReceipt(options.browserSummary, "browser summary") : undefined;
const managedServiceSummaries = options.managedServiceSummaries.map((path) => readJsonReceipt(path, "managed-service summary"));
const securitySummary = options.securitySummary ? readJsonReceipt(options.securitySummary, "security-tool summary") : undefined;
const manifest = {
  format: "espalier.review-manifest/2",
  source: { base_sha: sourceBase, head_sha: sourceHead },
  tested: {
    commit_sha: commit,
    tree_sha: tree,
    event: options.event ?? process.env.GITHUB_EVENT_NAME ?? "local",
  },
  source_archive: { file: archiveName, sha256: sha256(archive), zip_comment: zipComment },
  package_lock_sha256: sha256(packageLock),
  runtime: { os: process.platform, arch: process.arch, node: process.version, npm: execFileSync("npm", ["--version"], { cwd: root, encoding: "utf8" }).trim() },
  protocol: { version: protocolVersion, schema_version: schemaVersion },
  required_jobs: requiredJobs,
  test_summaries: testSummaries,
  ...(coverageSummary ? { coverage_summary: coverageSummary } : {}),
  ...(publicSurfaceSummary ? { public_surface_summary: publicSurfaceSummary } : {}),
  ...(browserSummary ? { browser_summary: browserSummary } : {}),
  ...(managedServiceSummaries.length > 0 ? { managed_service_summaries: managedServiceSummaries } : {}),
  ...(securitySummary ? { security_tool_summary: securitySummary } : {}),
  github: {
    run_id: process.env.GITHUB_RUN_ID ?? null,
    run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    workflow_ref: process.env.GITHUB_WORKFLOW_REF ?? null,
  },
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${archivePath}\n${manifestPath}\n`);

interface ReviewOptions {
  commit?: string;
  sourceBase?: string;
  sourceHead?: string;
  event?: string;
  outputDirectory?: string;
  coverageSummary?: string;
  publicSurfaceSummary?: string;
  browserSummary?: string;
  securitySummary?: string;
  testSummaries: string[];
  managedServiceSummaries: string[];
}

function parseArguments(arguments_: string[]): ReviewOptions {
  const parsed: ReviewOptions = { testSummaries: [], managedServiceSummaries: [] };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--commit" && value) { parsed.commit = value; index += 1; }
    else if (argument === "--source-base" && value) { parsed.sourceBase = value; index += 1; }
    else if (argument === "--source-head" && value) { parsed.sourceHead = value; index += 1; }
    else if (argument === "--event" && value) { parsed.event = value; index += 1; }
    else if (argument === "--output-dir" && value) { parsed.outputDirectory = value; index += 1; }
    else if (argument === "--coverage-summary" && value) { parsed.coverageSummary = value; index += 1; }
    else if (argument === "--public-surface-summary" && value) { parsed.publicSurfaceSummary = value; index += 1; }
    else if (argument === "--browser-summary" && value) { parsed.browserSummary = value; index += 1; }
    else if (argument === "--managed-service-summary" && value) { parsed.managedServiceSummaries.push(value); index += 1; }
    else if (argument === "--security-summary" && value) { parsed.securitySummary = value; index += 1; }
    else if (argument === "--test-summary" && value) { parsed.testSummaries.push(value); index += 1; }
    else throw new Error(`Unknown or incomplete argument '${argument}'`);
  }
  return parsed;
}

function readJsonReceipt(path: string, label: string): Record<string, unknown> {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
}

function requiredMatch(source: string, pattern: RegExp, label: string): string {
  const value = pattern.exec(source)?.[1];
  if (!value) throw new Error(`Unable to read ${label} from tested commit`);
  return value;
}

function parseRequiredJobs(value: string | undefined): Record<string, string> {
  if (!value) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("CI_REQUIRED_JOBS_JSON must be a JSON object");
  const jobs: Record<string, string> = {};
  for (const [name, result] of Object.entries(parsed)) {
    if (typeof result !== "string") throw new Error(`required job '${name}' has a non-string result`);
    jobs[name] = result;
  }
  return jobs;
}
