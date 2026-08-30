import { createHash } from "node:crypto";

const ALLOWED_SKILL_KEYS = new Set(["name", "description", "license", "allowed-tools", "metadata"]);
const MAX_SKILL_NAME_LENGTH = 64;
const MAX_SKILL_DESCRIPTION_LENGTH = 1024;

export interface SkillValidationResult {
  errors: string[];
  frontmatter?: Record<string, string>;
}

export interface PublicSurfaceEntry {
  path: string;
  content: Buffer;
  symbolicLink?: boolean;
}

export type PublicSurfaceProfile = "incubator" | "public";
export type PublicSurfaceCheck = "paths" | "text_privacy" | "publication_state" | "commit_identities";

export interface PublicSurfaceFinding {
  path: string;
  reason: string;
  check: PublicSurfaceCheck;
}

export type CommitIdentityRole = "author" | "committer";

const OWNER_PUBLIC_NOREPLY_EMAIL = "184336378+indeliblevivi@users.noreply.github.com";

export function validateSkillMarkdown(filePath: string, content: string): SkillValidationResult {
  const errors: string[] = [];
  if (!filePath.endsWith("/SKILL.md") && filePath !== "SKILL.md") errors.push("canonical skill file must be named SKILL.md");

  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return { errors: [...errors, "missing or malformed YAML front matter"] };

  const frontmatterText = match[1] ?? "";
  const frontmatter: Record<string, string> = {};
  let activeKey: string | undefined;
  for (const [index, line] of frontmatterText.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (/^[ \t]/.test(line)) {
      if (!activeKey) errors.push(`front matter line ${index + 1} is indented without a parent key`);
      continue;
    }
    const field = /^([A-Za-z0-9_-]+):(?:[ \t]*(.*))?$/.exec(line);
    if (!field) {
      errors.push(`front matter line ${index + 1} is not a top-level YAML field`);
      activeKey = undefined;
      continue;
    }
    const key = field[1] ?? "";
    const rawValue = field[2] ?? "";
    activeKey = key;
    if (Object.hasOwn(frontmatter, key)) errors.push(`front matter repeats '${key}'`);
    if (!ALLOWED_SKILL_KEYS.has(key)) errors.push(`front matter contains unsupported key '${key}'`);
    frontmatter[key] = parseYamlScalar(rawValue, key, errors);
  }

  const name = frontmatter.name?.trim() ?? "";
  const description = frontmatter.description?.trim() ?? "";
  if (!Object.hasOwn(frontmatter, "name")) errors.push("front matter is missing 'name'");
  if (!Object.hasOwn(frontmatter, "description")) errors.push("front matter is missing 'description'");
  if (!name) errors.push("skill name must not be empty");
  if (name && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) errors.push("skill name must use lowercase hyphen-case");
  if (name.length > MAX_SKILL_NAME_LENGTH) errors.push(`skill name exceeds ${MAX_SKILL_NAME_LENGTH} characters`);
  if (!description) errors.push("skill description must not be empty");
  if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) errors.push(`skill description exceeds ${MAX_SKILL_DESCRIPTION_LENGTH} characters`);
  if (/[<>]/.test(description)) errors.push("skill description must not contain angle brackets");
  if (/^\[TODO:/i.test(description)) errors.push("skill description contains a TODO placeholder");

  const directoryName = filePath.replace(/\\/g, "/").split("/").at(-2);
  if (directoryName && directoryName !== "skills" && name && directoryName !== name) {
    errors.push(`skill directory '${directoryName}' does not match front matter name '${name}'`);
  }

  const body = content.slice(match[0].length);
  if (!/^#\s+\S/m.test(body)) errors.push("skill body must contain a level-one heading");
  if (containsUnfencedTodo(body)) errors.push("skill body contains an unfinished TODO placeholder");

  return { errors, frontmatter };
}

function parseYamlScalar(rawValue: string, key: string, errors: string[]): string {
  const value = rawValue.trim();
  if (!value) return "";
  if (value.startsWith("\"") || value.endsWith("\"")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed !== "string") throw new Error("not a string");
      return parsed;
    } catch {
      errors.push(`front matter '${key}' has an invalid quoted string`);
      return value;
    }
  }
  if (value.startsWith("'") || value.endsWith("'")) {
    if (!(value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
      errors.push(`front matter '${key}' has an invalid quoted string`);
      return value;
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (/^(?:\{|\[|[&*!]|>|\|)/.test(value)) errors.push(`front matter '${key}' must use a scalar value`);
  return value;
}

function containsUnfencedTodo(body: string): boolean {
  let fenceMarker: "`" | "~" | undefined;
  let fenceLength = 0;
  for (const line of body.split(/\r?\n/)) {
    const fence = /^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1]?.[0] as "`" | "~";
      const markerLength = fence[1]?.length ?? 0;
      if (!fenceMarker) {
        fenceMarker = marker;
        fenceLength = markerLength;
      } else if (marker === fenceMarker && markerLength >= fenceLength && !(fence[2] ?? "").trim()) {
        fenceMarker = undefined;
        fenceLength = 0;
      }
      continue;
    }
    if (!fenceMarker && /^[ ]{0,3}\[TODO:[^\n]*\][ \t]*$/i.test(line)) return true;
  }
  return false;
}

export function scanPublicSurface(entries: PublicSurfaceEntry[], profile: PublicSurfaceProfile = "incubator"): PublicSurfaceFinding[] {
  const findings: PublicSurfaceFinding[] = [];
  const forbiddenPaths: Array<[RegExp, string]> = [
    [/(^|\/)\.(?:codex|claude)(?:\/|$)/i, "provider-specific private state is tracked"],
    [/(^|\/)\.env(?:\.|$)/i, "environment file is tracked"],
    [/(^|\/)registry[.]json$/i, "runtime enrollment registry is tracked"],
    [/\.(?:sqlite|sqlite-shm|sqlite-wal)$/i, "runtime SQLite state is tracked"],
    [/\.(?:log|trace|har)$/i, "raw runtime log or trace is tracked"],
    [/(^|\/)(?:runtime-dumps?|raw-exports?)(?:\/|$)/i, "raw runtime dump or export is tracked"],
  ];
  const allowedBinaryExtensions = new Set([".gif", ".ico", ".jpeg", ".jpg", ".pdf", ".png", ".webp", ".woff", ".woff2"]);

  for (const entry of entries) {
    const normalizedPath = entry.path.replace(/\\/g, "/");
    if (entry.symbolicLink) findings.push({ path: normalizedPath, reason: "tracked symbolic links are not portable public-source artifacts", check: "paths" });
    for (const [pattern, reason] of forbiddenPaths) {
      if (normalizedPath === ".env.example" && pattern.source.includes("env")) continue;
      if (pattern.test(normalizedPath)) findings.push({ path: normalizedPath, reason, check: "paths" });
    }
    if (entry.content.byteLength > 1_000_000) findings.push({ path: normalizedPath, reason: `tracked file exceeds 1,000,000 bytes (${entry.content.byteLength})`, check: "paths" });

    const hasNul = entry.content.includes(0);
    if (hasNul) {
      const dot = normalizedPath.lastIndexOf(".");
      const extension = dot >= 0 ? normalizedPath.slice(dot).toLowerCase() : "";
      if (!allowedBinaryExtensions.has(extension)) findings.push({ path: normalizedPath, reason: "unexpected binary file is tracked", check: "paths" });
      continue;
    }

    const text = entry.content.toString("utf8");
    for (const match of text.matchAll(/\/(?:Users|home)\/([A-Za-z0-9._-]+)(?=\/|\b)/g)) {
      findings.push({ path: normalizedPath, reason: `machine-specific home path exposes local account '${match[1]}'`, check: "text_privacy" });
    }
    for (const match of text.matchAll(/[A-Za-z]:\\Users\\([^\\\s]+)/gi)) {
      findings.push({ path: normalizedPath, reason: `machine-specific Windows path exposes local account '${match[1]}'`, check: "text_privacy" });
    }
    const generatedDependencyMetadata = /(^|\/)(?:package-lock|npm-shrinkwrap)[.]json$/i.test(normalizedPath);
    if (!generatedDependencyMetadata) {
      for (const match of text.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi)) {
        const domain = (match[1] ?? "").toLowerCase();
        if (!isAllowedPublicEmailDomain(domain)) findings.push({ path: normalizedPath, reason: `email address uses non-public domain '${domain}'`, check: "text_privacy" });
      }
    }
    for (const match of text.matchAll(/\b(?:[a-z0-9-]+\.)+(local|internal|lan)\b/gi)) {
      findings.push({ path: normalizedPath, reason: `private hostname is embedded in tracked text ('${match[0]}')`, check: "text_privacy" });
    }
    if (profile === "public") {
      if (/\bprivate GitHub repository\b/i.test(text)) findings.push({ path: normalizedPath, reason: "public profile still describes the repository as private", check: "publication_state" });
      if (/^\|\s*Public(?: source)? repository\s*\|\s*(?:Not released\b|未\s*release\b)[^|]*\|/im.test(text)) {
        findings.push({ path: normalizedPath, reason: "public profile still marks the public repository as unpublished", check: "publication_state" });
      }
      if (/\bPublication still requires\b/i.test(text) || /\bProduce a clean public tree\b/i.test(text) || /生成\s+clean public tree/i.test(text)) {
        findings.push({ path: normalizedPath, reason: "public profile still describes initial publication as a future gate", check: "publication_state" });
      }
      if (/\bHosted Node 24\/26 first run\b/i.test(text)) {
        findings.push({ path: normalizedPath, reason: "public profile still describes hosted CI as an unrun gate", check: "publication_state" });
      }
    }
  }

  return deduplicateFindings(findings);
}

function isAllowedPublicEmailDomain(domain: string): boolean {
  return domain === "example.com" || domain === "example.org" || domain === "users.noreply.github.com" || domain === "noreply.github.com";
}

export function validatePublicCommitIdentity(role: CommitIdentityRole, name: string | undefined, email: string | undefined): string[] {
  const errors: string[] = [];
  if (!name?.trim()) errors.push(`${role} name is empty`);
  else if (containsControlCharacters(name)) errors.push(`${role} name contains control characters`);

  if (!email || !/^(?:[^@]+@users[.]noreply[.]github[.]com|noreply@github[.]com)$/i.test(email)) {
    errors.push(`${role} email is not a GitHub noreply identity`);
  } else if (email.toLowerCase() === OWNER_PUBLIC_NOREPLY_EMAIL && !/^(?:Faye|Faye Fang)$/.test(name ?? "")) {
    errors.push(`${role} name does not use the established owner attribution`);
  }
  return errors;
}

function containsControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint >= 0x7f && codePoint <= 0x9f;
  });
}

function deduplicateFindings(findings: PublicSurfaceFinding[]): PublicSurfaceFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.check}\u0000${finding.path}\u0000${finding.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function readZipComment(archive: Buffer): string {
  const eocdSignature = 0x06054b50;
  const minimumEocdLength = 22;
  const searchStart = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - minimumEocdLength; offset >= searchStart; offset -= 1) {
    if (archive.readUInt32LE(offset) !== eocdSignature) continue;
    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + minimumEocdLength + commentLength !== archive.length) continue;
    return archive.subarray(offset + minimumEocdLength).toString("utf8");
  }
  throw new Error("ZIP end-of-central-directory record is missing or malformed");
}

export function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function summarizeVitestJson(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") throw new Error("Vitest summary must be a JSON object");
  const input = value as Record<string, unknown>;
  const fields = ["numTotalTestSuites", "numPassedTestSuites", "numFailedTestSuites", "numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests"] as const;
  const summary: Record<string, number> = {};
  for (const field of fields) {
    const count = input[field];
    if (typeof count !== "number" || !Number.isFinite(count)) throw new Error(`Vitest summary is missing numeric '${field}'`);
    summary[field] = count;
  }
  return summary;
}

export function summarizeCoverageJson(value: unknown): Record<string, Record<string, number>> {
  if (!value || typeof value !== "object") throw new Error("coverage summary must be a JSON object");
  const total = (value as Record<string, unknown>).total;
  if (!total || typeof total !== "object") throw new Error("coverage summary is missing 'total'");
  const summary: Record<string, Record<string, number>> = {};
  for (const metric of ["lines", "statements", "functions", "branches"]) {
    const raw = (total as Record<string, unknown>)[metric];
    if (!raw || typeof raw !== "object") throw new Error(`coverage summary is missing '${metric}'`);
    const counts = raw as Record<string, unknown>;
    const normalized: Record<string, number> = {};
    for (const field of ["total", "covered", "skipped", "pct"]) {
      const count = counts[field];
      if (typeof count !== "number" || !Number.isFinite(count)) throw new Error(`coverage '${metric}.${field}' is not numeric`);
      normalized[field] = count;
    }
    summary[metric] = normalized;
  }
  return summary;
}
