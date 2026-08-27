import { execFileSync, spawnSync } from "node:child_process";
import { hostname } from "node:os";
import type { ActorIdentity, CapabilityManifest, CommandType } from "@espalier/protocol";

export type ActivationMode = "dormant" | "aware" | "participating";
export type DurableSignal = "tracked-work" | "binding-constraint" | "handoff" | "approved-spec" | "cross-session" | "multi-agent" | "migration" | "architecture" | "owner-decision" | "scope-risk";
export interface ActivationInput {
  enrolled: boolean;
  task_kind: "small-local" | "tracked" | "architecture" | "migration" | "batch" | "investigation";
  durable_signals: DurableSignal[];
  owner_override?: "dormant" | "track" | "final-only";
}
export interface ActivationResult { mode: ActivationMode; reasons: string[]; capture: "none" | "final-decisions" | "semantic-checkpoints" }

export function routeActivation(input: ActivationInput): ActivationResult {
  if (!input.enrolled) return { mode: "dormant", reasons: ["project is not enrolled"], capture: "none" };
  if (input.owner_override === "dormant") return { mode: "dormant", reasons: ["owner explicitly kept Espalier dormant"], capture: "none" };
  if (input.owner_override === "track") return { mode: "participating", reasons: ["owner explicitly requested tracking"], capture: "semantic-checkpoints" };
  if (input.owner_override === "final-only") return { mode: "aware", reasons: ["owner requested final decisions only"], capture: "final-decisions" };
  const participationSignals = new Set<DurableSignal>(["approved-spec", "cross-session", "multi-agent", "migration", "architecture", "owner-decision", "scope-risk"]);
  const participating = input.durable_signals.filter((signal) => participationSignals.has(signal));
  if (participating.length > 0 || ["architecture", "migration", "batch"].includes(input.task_kind)) {
    return { mode: "participating", reasons: participating.length > 0 ? participating : [`${input.task_kind} work is durable`], capture: "semantic-checkpoints" };
  }
  if (input.durable_signals.length > 0 || input.task_kind === "tracked") {
    return { mode: "aware", reasons: input.durable_signals.length > 0 ? input.durable_signals : ["task touches tracked work"], capture: "none" };
  }
  return { mode: "dormant", reasons: ["routine task has no durable semantic signal"], capture: "none" };
}

export interface ObservedGitEvidence {
  kind: "git";
  origin: "observed";
  ref: string;
  summary: string;
  branch: string;
  head: string;
  touched_paths: string[];
  collector: Pick<ActorIdentity, "principal_id" | "runtime_id" | "device_id" | "session_id">;
}

export function collectGitEvidence(root: string, actor: ActorIdentity): ObservedGitEvidence {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const branch = execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim() || "detached";
  const status = execFileSync("git", ["status", "--porcelain=v1"], { cwd: root, encoding: "utf8" });
  const touched = status.split("\n").filter(Boolean).map((line) => line.slice(3));
  return {
    kind: "git",
    origin: "observed",
    ref: `git:${branch}@${head}`,
    summary: touched.length === 0 ? `Clean ${branch} at ${head.slice(0, 12)}` : `${touched.length} touched path(s) on ${branch} at ${head.slice(0, 12)}`,
    branch,
    head,
    touched_paths: touched,
    collector: { principal_id: actor.principal_id, runtime_id: actor.runtime_id, device_id: actor.device_id || hostname(), session_id: actor.session_id },
  };
}

export interface AdapterDeclaration {
  runtime_id: string;
  supported_protocol_versions: string[];
  required_commands: CommandType[];
  required_features: string[];
}

export const CODEX_ADAPTER_DECLARATION = {
  runtime_id: "codex-app",
  supported_protocol_versions: ["0.2"],
  required_commands: ["claim.acquire", "claim.release", "annotation.add", "handoff.record"],
  required_features: ["bounded-brief", "stable-refs", "fts-cjk-search"],
} satisfies AdapterDeclaration;

export interface CapabilityNegotiation {
  compatible: boolean;
  protocol_version?: string;
  missing_commands: CommandType[];
  missing_features: string[];
  reason?: string;
}

export function negotiateCapabilities(manifest: CapabilityManifest, adapter: AdapterDeclaration): CapabilityNegotiation {
  const protocolVersion = adapter.supported_protocol_versions.find((version) => manifest.compatible_protocol_versions.includes(version));
  const missingCommands = adapter.required_commands.filter((command) => !manifest.commands.includes(command));
  const missingFeatures = adapter.required_features.filter((feature) => !manifest.features.includes(feature));
  const compatible = Boolean(protocolVersion) && missingCommands.length === 0 && missingFeatures.length === 0;
  return {
    compatible,
    ...(protocolVersion ? { protocol_version: protocolVersion } : {}),
    missing_commands: missingCommands,
    missing_features: missingFeatures,
    ...(!protocolVersion ? { reason: `No compatible protocol version for ${adapter.runtime_id}` } : !compatible ? { reason: `Espalier lacks required capabilities for ${adapter.runtime_id}` } : {}),
  };
}

export interface ObservedCommandEvidence {
  kind: "command";
  origin: "observed";
  ref: string;
  summary: string;
  display_command: string;
  exit_code: number | null;
  signal: string | null;
  duration_ms: number;
  stdout_tail: string;
  stderr_tail: string;
  collector: Pick<ActorIdentity, "principal_id" | "runtime_id" | "device_id" | "session_id">;
}

export function runObservedCommand(input: {
  root: string;
  executable: string;
  args: string[];
  display_command: string;
  actor: ActorIdentity;
  timeout_ms?: number;
}): ObservedCommandEvidence {
  const started = performance.now();
  const result = spawnSync(input.executable, input.args, {
    cwd: input.root,
    encoding: "utf8",
    shell: false,
    timeout: input.timeout_ms ?? 120_000,
  });
  const duration = Math.round(performance.now() - started);
  const stdout = (result.stdout ?? "").slice(-4_000);
  const stderr = (result.stderr ?? "").slice(-4_000);
  const exitCode = result.status;
  return {
    kind: "command",
    origin: "observed",
    ref: `command:${crypto.randomUUID()}`,
    summary: `${input.display_command} ${exitCode === 0 ? "exited successfully" : `exited ${exitCode ?? result.signal ?? "without status"}`} in ${duration} ms`,
    display_command: input.display_command,
    exit_code: exitCode,
    signal: result.signal,
    duration_ms: duration,
    stdout_tail: stdout,
    stderr_tail: stderr,
    collector: { principal_id: input.actor.principal_id, runtime_id: input.actor.runtime_id, device_id: input.actor.device_id || hostname(), session_id: input.actor.session_id },
  };
}
