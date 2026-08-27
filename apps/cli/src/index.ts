#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EspalierClient } from "@espalier/client";
import { compactRef, parseRef } from "@espalier/core";
import type { ActorIdentity, CommandEnvelope, CommandType, ProjectExport } from "@espalier/protocol";
import { CODEX_ADAPTER_DECLARATION, negotiateCapabilities } from "@espalier/adapters";
import { harnessIdentity } from "./identity.js";
import { EnrollmentRegistry, defaultRegistryPath, type Enrollment } from "./registry.js";

interface Parsed { command?: string; positionals: string[]; flags: Record<string, string | boolean> }
interface Io { out(value: string): void; error(value: string): void }
const io: Io = { out: (value) => process.stdout.write(`${value}\n`), error: (value) => process.stderr.write(`${value}\n`) };

export async function runCli(argv: string[], output: Io = io): Promise<number> {
  const parsed = parse(argv);
  if (!parsed.command || parsed.flags.help) { output.out(help()); return 0; }
  const registry = new EnrollmentRegistry(stringFlag(parsed, "registry") ?? defaultRegistryPath());
  try {
    if (parsed.command === "link") return await link(parsed, registry, output);
    if (parsed.command === "doctor") {
      const explicitProject = stringFlag(parsed, "project");
      const discovered = explicitProject
        ? { root: process.cwd(), project_id: explicitProject, service_url: stringFlag(parsed, "url") ?? "http://127.0.0.1:4317", linked_at: "direct" }
        : registry.discover(process.cwd());
      const serviceUrl = stringFlag(parsed, "url") ?? discovered?.service_url ?? "http://127.0.0.1:4317";
      const client = new EspalierClient(serviceUrl);
      const [health, capabilities, projects] = await Promise.all([
        client.health(),
        client.capabilities(),
        client.projects<Array<{ project_id: string; project_revision: number }>>(),
      ]);
      const project = discovered ? projects.find((item) => item.project_id === discovered.project_id) : undefined;
      if (discovered && !project) throw new Error(`Enrolled project ${discovered.project_id} is absent from ${serviceUrl}`);
      const negotiation = negotiateCapabilities(capabilities, CODEX_ADAPTER_DECLARATION);
      if (!negotiation.compatible) throw new Error(negotiation.reason ?? `Capability mismatch for ${CODEX_ADAPTER_DECLARATION.runtime_id}`);
      output.out(format({ ok: true, enrollment: discovered ?? null, service: { url: serviceUrl, health, capabilities, negotiation }, project: project ?? null }, parsed));
      return 0;
    }
    if (parsed.command === "restore") {
      const source = requiredPositional(parsed, 0, "restore requires an Espalier project export file");
      if (requiredFlag(parsed, "confirm", "restore requires --confirm RESTORE_PROJECT") !== "RESTORE_PROJECT") throw new Error("restore confirmation must be RESTORE_PROJECT");
      const project = JSON.parse(readFileSync(resolve(source), "utf8")) as ProjectExport;
      const client = new EspalierClient(stringFlag(parsed, "url") ?? "http://127.0.0.1:4317");
      output.out(format(await client.restoreProject(project, "RESTORE_PROJECT"), parsed));
      return 0;
    }
    const enrollment = resolveEnrollment(parsed, registry);
    const client = new EspalierClient(enrollment.service_url);
    const actor = makeActor(parsed, parsed.command === "pending" || parsed.command === "inspect" ? "observer" : "worker");
    if (parsed.command === "join" || parsed.command === "brief") {
      const brief = await client.brief(enrollment.project_id, {
        actor,
        last_seen_revision: numberFlag(parsed, "since", 0),
        context_budget_tokens: numberFlag(parsed, "budget", parsed.command === "join" ? 900 : 1400),
        requested_projection: parsed.command === "join" ? "presence" : stringFlag(parsed, "type") ?? "normal",
        language: stringFlag(parsed, "language") ?? "zh-CN",
        ...(parsed.positionals[0] ? { requested_task_ref: normalizeRef(enrollment.project_id, parsed.positionals[0]) } : {}),
      });
      output.out(format(brief, parsed));
      return 0;
    }
    if (parsed.command === "inspect") {
      const ref = requiredPositional(parsed, 0, "inspect requires a stable ref");
      output.out(format(await client.focus(normalizeRef(enrollment.project_id, ref)), parsed));
      return 0;
    }
    if (parsed.command === "changes") {
      output.out(format(await client.changes(enrollment.project_id, numberFlag(parsed, "since", 0)), parsed));
      return 0;
    }
    if (parsed.command === "search") {
      const query = parsed.positionals.join(" ").trim();
      if (!query) throw new Error("search requires a query");
      output.out(format(await client.search(query, enrollment.project_id, numberFlag(parsed, "limit", 30)), parsed));
      return 0;
    }
    if (parsed.command === "pending") {
      const projection = await client.projection<{ attention: unknown[] }>(enrollment.project_id, "decisions");
      output.out(format(projection.attention, parsed));
      return 0;
    }
    if (parsed.command === "metrics") {
      output.out(format(await client.metrics(enrollment.project_id), parsed));
      return 0;
    }
    if (parsed.command === "snapshot") {
      const snapshot = stringFlag(parsed, "type") === "dca"
        ? await client.dca(enrollment.project_id, parsed.positionals[0] ? normalizeRef(enrollment.project_id, parsed.positionals[0]) : undefined)
        : await client.projection(enrollment.project_id, "atlas");
      const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
      const destination = stringFlag(parsed, "out");
      if (destination) { writeFileSync(resolve(destination), serialized); output.out(`Wrote ${resolve(destination)}`); }
      else output.out(serialized.trimEnd());
      return 0;
    }
    if (parsed.command === "export") {
      const project = await client.exportProject(enrollment.project_id);
      const serialized = `${JSON.stringify(project, null, 2)}\n`;
      const destination = stringFlag(parsed, "out");
      if (destination) { writeFileSync(resolve(destination), serialized); output.out(`Wrote ${resolve(destination)}`); }
      else output.out(serialized.trimEnd());
      return 0;
    }
    if (parsed.command === "emit") {
      const source = stringFlag(parsed, "json") ?? (parsed.positionals[0] ? readFileSync(resolve(parsed.positionals[0]), "utf8") : undefined);
      if (!source) throw new Error("emit requires --json or a JSON file path");
      const value = JSON.parse(source) as CommandEnvelope | { type: CommandType; payload: Record<string, unknown> };
      const command = "command_id" in value ? value : await wrapCommand(client, enrollment.project_id, actor, value.type, value.payload);
      output.out(format(await client.command(command), parsed));
      return 0;
    }
    if (parsed.command === "claim") {
      const target = normalizeRef(enrollment.project_id, requiredPositional(parsed, 0, "claim requires a work item ref or id"));
      const result = await client.command(await wrapCommand(client, enrollment.project_id, actor, "claim.acquire", {
        id: stringFlag(parsed, "id") ?? `claim-${actor.principal_id}-${Date.now()}`,
        target_ref: target,
        mode: stringFlag(parsed, "mode") ?? "primary",
        lease_seconds: numberFlag(parsed, "lease", 900),
      }));
      output.out(format(result, parsed)); return result.accepted ? 0 : 1;
    }
    if (parsed.command === "annotate") {
      const target = normalizeRef(enrollment.project_id, requiredPositional(parsed, 0, "annotate requires a stable ref"));
      const live = await client.projection<{ as_of_revision: number }>(enrollment.project_id, "live");
      const result = await client.command(await wrapCommand(client, enrollment.project_id, actor, "annotation.add", {
        id: stringFlag(parsed, "id") ?? `annotation-${Date.now()}`,
        anchor_ref: target,
        anchor_revision: live.as_of_revision,
        kind: stringFlag(parsed, "kind") ?? "note",
        body: requiredFlag(parsed, "body", "annotate requires --body"),
        ...(stringFlag(parsed, "action") ? { requested_action: stringFlag(parsed, "action") } : {}),
      }));
      output.out(format(result, parsed)); return result.accepted ? 0 : 1;
    }
    if (parsed.command === "import-handoff") {
      const sourceFile = requiredPositional(parsed, 0, "import-handoff requires a Markdown or text file");
      const anchor = normalizeRef(enrollment.project_id, requiredFlag(parsed, "anchor", "import-handoff requires --anchor <stable-ref>"));
      const body = readFileSync(resolve(sourceFile), "utf8");
      const live = await client.projection<{ as_of_revision: number }>(enrollment.project_id, "live");
      const result = await client.command(await wrapCommand(client, enrollment.project_id, actor, "annotation.add", {
        id: stringFlag(parsed, "id") ?? `import-${Date.now()}`,
        anchor_ref: anchor,
        anchor_revision: live.as_of_revision,
        kind: "proposal",
        body,
        origin: "imported",
        source_refs: [stringFlag(parsed, "source") ?? `file:${basename(sourceFile)}`],
        requested_action: "Review and promote only the still-valid durable content",
      }));
      output.out(format(result, parsed)); return result.accepted ? 0 : 1;
    }
    if (parsed.command === "handoff") {
      const target = normalizeRef(enrollment.project_id, requiredPositional(parsed, 0, "handoff requires a work item ref"));
      const result = await client.command(await wrapCommand(client, enrollment.project_id, actor, "handoff.record", {
        id: stringFlag(parsed, "id") ?? `handoff-${Date.now()}`,
        work_item_ref: target,
        current_state: requiredFlag(parsed, "state", "handoff requires --state"),
        next_safe_action: requiredFlag(parsed, "next", "handoff requires --next"),
        completed: csvFlag(parsed, "completed"),
        blockers: csvFlag(parsed, "blockers"),
        open_questions: csvFlag(parsed, "questions"),
        evidence_refs: csvFlag(parsed, "evidence"),
        narrative: stringFlag(parsed, "narrative") ?? "",
      }));
      output.out(format(result, parsed)); return result.accepted ? 0 : 1;
    }
    if (parsed.command === "release") {
      const live = await client.projection<{ claims: Array<{ id: string; principal_id: string; entity_version: number; target_ref: string }> }>(enrollment.project_id, "live");
      const requested = parsed.positionals[0];
      const requestedRef = requested ? normalizeRef(enrollment.project_id, requested) : undefined;
      const claim = live.claims.find((item) => item.principal_id === actor.principal_id && (!requested || item.id === requested || sameObjectRef(item.target_ref, requestedRef!)));
      if (!claim) throw new Error("No active matching claim");
      const claimRef = compactRef(enrollment.project_id, "claim", claim.id);
      const command = await wrapCommand(client, enrollment.project_id, actor, "claim.release", { claim_ref: claimRef });
      command.base_entity_versions = { [`espalier://${enrollment.project_id}/claim/${claim.id}`]: claim.entity_version };
      const result = await client.command(command);
      output.out(format(result, parsed)); return result.accepted ? 0 : 1;
    }
    throw new Error(`Unknown command: ${parsed.command}`);
  } catch (error) {
    output.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function link(parsed: Parsed, registry: EnrollmentRegistry, output: Io): Promise<number> {
  const root = resolve(parsed.positionals[0] ?? process.cwd());
  const projectId = requiredFlag(parsed, "project", "link requires --project <id>");
  const serviceUrl = stringFlag(parsed, "url") ?? "http://127.0.0.1:4317";
  const client = new EspalierClient(serviceUrl);
  await client.health();
  const projects = await client.projects<Array<{ project_id: string }>>();
  if (!projects.some((project) => project.project_id === projectId)) {
    const purpose = stringFlag(parsed, "purpose");
    if (!purpose) throw new Error(`Project ${projectId} does not exist; pass --purpose to create its owner-approved seed`);
    const actor = makeActor(parsed, "owner");
    const name = stringFlag(parsed, "name") ?? projectId;
    const create = await client.command({ command_id: crypto.randomUUID(), project_id: projectId, actor, base_project_revision: 0, base_entity_versions: {}, type: "project.create", occurred_at: new Date().toISOString(), payload: { display_name: name, authority_domain: stringFlag(parsed, "authority-domain") ?? projectId, repository_refs: [`path:${root}`], owner_policy: { owners: [actor.principal_id], approval: "any-one" } } });
    if (!create.accepted) throw new Error(create.reason);
    const goal = await client.command({ command_id: crypto.randomUUID(), project_id: projectId, actor, base_project_revision: 1, base_entity_versions: {}, type: "goal.approve", occurred_at: new Date().toISOString(), payload: { id: "goal-1", purpose, present_consumers: csvFlag(parsed, "consumers"), programme_order: csvFlag(parsed, "programme"), binding_constraints: csvFlag(parsed, "constraints"), trust_boundaries: csvFlag(parsed, "trust"), explicit_non_goals: csvFlag(parsed, "non-goals"), source_refs: csvFlag(parsed, "sources") } });
    if (!goal.accepted) throw new Error(goal.reason);
    const epoch = await client.command({ command_id: crypto.randomUUID(), project_id: projectId, actor, base_project_revision: 2, base_entity_versions: {}, type: "epoch.open", occurred_at: new Date().toISOString(), payload: { id: "epoch-1", goal_revision_id: "goal-1", title: stringFlag(parsed, "epoch") ?? "Initial epoch", baseline_ref: stringFlag(parsed, "baseline") ?? `baseline_as_of:${new Date().toISOString()}` } });
    if (!epoch.accepted) throw new Error(epoch.reason);
  }
  const enrollment = registry.link({ root, project_id: projectId, service_url: serviceUrl });
  output.out(JSON.stringify(enrollment, null, 2));
  return 0;
}

async function wrapCommand(client: EspalierClient, projectId: string, actor: ActorIdentity, type: CommandType, payload: Record<string, unknown>): Promise<CommandEnvelope> {
  const projects = await client.projects<Array<{ project_id: string; project_revision: number }>>();
  const project = projects.find((item) => item.project_id === projectId);
  if (!project) throw new Error(`Unknown project ${projectId}`);
  return { command_id: crypto.randomUUID(), project_id: projectId, actor, base_project_revision: project.project_revision, base_entity_versions: {}, type, occurred_at: new Date().toISOString(), payload };
}

function resolveEnrollment(parsed: Parsed, registry: EnrollmentRegistry): Enrollment {
  const explicit = stringFlag(parsed, "project");
  if (explicit) return { root: process.cwd(), project_id: explicit, service_url: stringFlag(parsed, "url") ?? "http://127.0.0.1:4317", linked_at: "direct" };
  const enrollment = registry.discover(process.cwd());
  if (!enrollment) throw new Error("Current path is not enrolled. Run `espalier link` first or pass --project.");
  return enrollment;
}

function makeActor(parsed: Parsed, fallbackRole: ActorIdentity["role"]): ActorIdentity {
  const role = (stringFlag(parsed, "role") ?? process.env.ESPALIER_ROLE ?? fallbackRole) as ActorIdentity["role"];
  const capabilities: ActorIdentity["capabilities"] = role === "owner"
    ? ["read", "write", "claim", "evidence", "owner-update", "coordinate"]
    : role === "observer" ? ["read"] : role === "coordinator" ? ["read", "write", "claim", "evidence", "coordinate"] : ["read", "write", "claim", "evidence"];
  const harness = harnessIdentity(process.env);
  return {
    principal_id: stringFlag(parsed, "principal") ?? process.env.ESPALIER_PRINCIPAL_ID ?? userInfo().username,
    runtime_id: harness.runtime_id,
    device_id: process.env.ESPALIER_DEVICE_ID ?? hostname(),
    session_id: harness.session_id ?? crypto.randomUUID(),
    role,
    capabilities,
  };
}

function parse(argv: string[]): Parsed {
  const command = argv[0]?.startsWith("--") ? undefined : argv[0];
  const rest = command ? argv.slice(1) : argv;
  const result: Parsed = { ...(command ? { command } : {}), positionals: [], flags: {} };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index]!;
    if (!value.startsWith("--")) { result.positionals.push(value); continue; }
    const key = value.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) result.flags[key] = true;
    else { result.flags[key] = next; index += 1; }
  }
  return result;
}
function stringFlag(parsed: Parsed, key: string): string | undefined { const value = parsed.flags[key]; return typeof value === "string" ? value : undefined; }
function requiredFlag(parsed: Parsed, key: string, message: string): string { const value = stringFlag(parsed, key); if (!value) throw new Error(message); return value; }
function numberFlag(parsed: Parsed, key: string, fallback: number): number { const value = stringFlag(parsed, key); if (!value) return fallback; const number = Number(value); if (!Number.isFinite(number)) throw new Error(`--${key} must be a number`); return number; }
function csvFlag(parsed: Parsed, key: string): string[] { return (stringFlag(parsed, key) ?? "").split(",").map((item) => item.trim()).filter(Boolean); }
function requiredPositional(parsed: Parsed, index: number, message: string): string { const value = parsed.positionals[index]; if (!value) throw new Error(message); return value; }
function normalizeRef(projectId: string, value: string): string {
  return value.startsWith("esp:") || value.startsWith("espalier://")
    ? value
    : compactRef(projectId, "work", value);
}
function sameObjectRef(left: string, right: string): boolean {
  const a = parseRef(left);
  const b = parseRef(right);
  return a.projectId === b.projectId && a.type === b.type && a.id === b.id;
}
function format(value: unknown, parsed: Parsed): string { return parsed.flags.compact ? JSON.stringify(value) : JSON.stringify(value, null, 2); }

function help(): string {
  return `Espalier CLI

Usage:
  espalier link [path] --project <id> [--purpose <text>]
  espalier doctor [--url http://127.0.0.1:4317] [--project <id>]
  espalier join [work-ref] [--budget 900]
  espalier brief [work-ref] [--budget 1400] [--since 0]
  espalier inspect <ref>
  espalier search <query> [--limit 30]
  espalier changes --since <revision>
  espalier claim <work-ref> [--lease 900]
  espalier emit --json '{"type":"...","payload":{}}'
  espalier annotate <ref> --kind note --body <text>
  espalier import-handoff note.md --anchor <ref> [--source <provenance-ref>]
  espalier handoff <work-ref> --state <text> --next <text>
  espalier release [claim-id|work-ref]
  espalier pending
  espalier metrics
  espalier snapshot [work-ref] [--type atlas|dca] [--out project.json]
  espalier export [--out project-export.json]
  espalier restore project-export.json --confirm RESTORE_PROJECT [--url ...]

Identity flags: --principal, --role, --url, --project, --registry`;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  process.exitCode = await runCli(process.argv.slice(2));
}
