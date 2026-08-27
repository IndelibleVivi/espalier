#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface CodexSkillInstallOptions {
  source: string;
  codexHome: string;
  installedAt?: string;
  nonce?: string;
}

export interface CodexSkillInstallResult {
  target_path: string;
  manifest_path: string;
  backup_path?: string;
  files: Array<{ path: string; sha256: string }>;
}

interface InstallCliOptions {
  codexHome?: string;
  dryRun?: boolean;
  skipCli?: boolean;
}

export function installCodexSkill(options: CodexSkillInstallOptions): CodexSkillInstallResult {
  const source = realpathSync(resolve(options.source));
  if (!existsSync(join(source, "SKILL.md"))) throw new Error(`Missing canonical SKILL.md in ${source}`);
  const codexHome = resolve(options.codexHome);
  const skillsRoot = join(codexHome, "skills");
  const target = join(skillsRoot, "espalier");
  const manifestPath = join(skillsRoot, ".espalier-current-manifest.json");
  const installedAt = options.installedAt ?? new Date().toISOString();
  const nonce = options.nonce ?? `${process.pid}-${randomUUID()}`;
  const staging = join(skillsRoot, `.espalier-stage-${nonce}`);
  const backupRoot = join(skillsRoot, ".espalier-backups");
  const backup = join(backupRoot, `${installedAt.replaceAll(":", "-")}-${nonce}`);
  mkdirSync(skillsRoot, { recursive: true, mode: 0o700 });
  if (existsSync(staging)) throw new Error(`Refusing to reuse install staging path ${staging}`);

  let backupPath: string | undefined;
  let installed = false;
  try {
    cpSync(source, staging, { recursive: true, errorOnExist: true, force: false });
    if (existsSync(target)) {
      mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
      renameSync(target, backup);
      backupPath = backup;
    }
    renameSync(staging, target);
    installed = true;
    const files = manifestFiles(target);
    const manifest = {
      schema_version: 1,
      skill: "espalier",
      installed_at: installedAt,
      source_path: source,
      target_path: target,
      ...(backupPath ? { backup_path: backupPath } : {}),
      files,
    };
    const temporaryManifest = `${manifestPath}.tmp-${nonce}`;
    writeFileSync(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryManifest, manifestPath);
    return { target_path: target, manifest_path: manifestPath, ...(backupPath ? { backup_path: backupPath } : {}), files };
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    if (installed && existsSync(target)) rmSync(target, { recursive: true, force: true });
    if (backupPath && existsSync(backupPath) && !existsSync(target)) renameSync(backupPath, target);
    throw error;
  }
}

function manifestFiles(root: string): Array<{ path: string; sha256: string }> {
  const paths: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const absolute = join(directory, entry);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Skill install does not accept symlinks: ${absolute}`);
      if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile()) paths.push(relative(root, absolute));
    }
  };
  visit(root);
  return paths.sort().map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(join(root, path))).digest("hex"),
  }));
}

export function installCodexHarness(options: InstallCliOptions = {}): CodexSkillInstallResult | { dry_run: true; source: string; target: string; cli: string } {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const codexHome = resolve(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"));
  const source = join(repoRoot, "skills", "espalier");
  if (options.dryRun) return { dry_run: true, source, target: join(codexHome, "skills", "espalier"), cli: options.skipCli ? "skipped" : `npm link (${repoRoot})` };
  if (!options.skipCli) {
    const linked = spawnSync("npm", ["link"], { cwd: repoRoot, encoding: "utf8" });
    if (linked.status !== 0) throw new Error(`Could not link the espalier CLI: ${(linked.stderr || linked.stdout || "npm link failed").trim()}`);
  }
  return installCodexSkill({ source, codexHome });
}

function parseInstallArgs(argv: string[]): InstallCliOptions {
  const options: InstallCliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === "--dry-run") options.dryRun = true;
    else if (value === "--skip-cli") options.skipCli = true;
    else if (value === "--codex-home") {
      const next = argv[index + 1];
      if (!next) throw new Error("--codex-home requires a path");
      options.codexHome = next;
      index += 1;
    } else throw new Error(`Unknown install option: ${value}`);
  }
  return options;
}

if (basename(process.argv[1] ?? "") === "codex-install.ts") {
  try {
    const result = installCodexHarness(parseInstallArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!("dry_run" in result)) process.stdout.write("Open a fresh Codex task before expecting the installed Skill to appear.\n");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
