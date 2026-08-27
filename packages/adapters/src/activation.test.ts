import { describe, expect, it } from "vitest";
import type { ActorIdentity, CapabilityManifest } from "@espalier/protocol";
import { CODEX_ADAPTER_DECLARATION, negotiateCapabilities, routeActivation, runObservedCommand } from "./index.js";

const actor: ActorIdentity = { principal_id: "example-worker", runtime_id: "test", device_id: "test", session_id: "test", role: "worker", capabilities: ["read", "write", "evidence"] };

describe("sparse activation", () => {
  it("keeps small untracked tasks Dormant and produces no capture intent", () => {
    expect(routeActivation({ enrolled: true, task_kind: "small-local", durable_signals: [] })).toEqual({ mode: "dormant", reasons: ["routine task has no durable semantic signal"], capture: "none" });
  });

  it("uses Aware for relevant tracked context and Participating for approved spec work", () => {
    expect(routeActivation({ enrolled: true, task_kind: "tracked", durable_signals: ["tracked-work"] }).mode).toBe("aware");
    expect(routeActivation({ enrolled: true, task_kind: "architecture", durable_signals: ["approved-spec", "cross-session"] }).mode).toBe("participating");
  });

  it("obeys explicit owner overrides", () => {
    expect(routeActivation({ enrolled: true, task_kind: "architecture", durable_signals: ["approved-spec"], owner_override: "dormant" }).mode).toBe("dormant");
    expect(routeActivation({ enrolled: true, task_kind: "small-local", durable_signals: [], owner_override: "track" }).mode).toBe("participating");
    expect(routeActivation({ enrolled: false, task_kind: "tracked", durable_signals: ["tracked-work"] }).mode).toBe("dormant");
  });
});

describe("adapter boundary", () => {
  const manifest: CapabilityManifest = {
    schema_version: 1,
    protocol_version: "0.2",
    compatible_protocol_versions: ["0.2"],
    commands: ["claim.acquire", "handoff.record"],
    projections: ["live", "focus"],
    transports: ["http-json", "sse"],
    features: ["bounded-brief", "stable-refs"],
    deployment_boundary: "localhost-local-token",
  };

  it("fails capability negotiation closed when a runtime requires unsupported behavior", () => {
    expect(negotiateCapabilities(manifest, { runtime_id: "codex", supported_protocol_versions: ["0.2"], required_commands: ["claim.acquire"], required_features: ["bounded-brief"] })).toMatchObject({ compatible: true, protocol_version: "0.2" });
    expect(negotiateCapabilities(manifest, { runtime_id: "future-agent", supported_protocol_versions: ["0.3"], required_commands: ["batch.integrate"], required_features: ["private-auth"] })).toMatchObject({ compatible: false, missing_commands: ["batch.integrate"], missing_features: ["private-auth"] });
  });

  it("declares the exact capabilities required by the installed Codex harness", () => {
    expect(CODEX_ADAPTER_DECLARATION).toEqual({
      runtime_id: "codex-app",
      supported_protocol_versions: ["0.2"],
      required_commands: ["claim.acquire", "claim.release", "annotation.add", "handoff.record"],
      required_features: ["bounded-brief", "stable-refs", "fts-cjk-search"],
    });
  });

  it("records command exit evidence without promoting it to semantic acceptance", () => {
    const evidence = runObservedCommand({ root: process.cwd(), executable: process.execPath, args: ["-e", "process.stdout.write('ok')"], display_command: "node smoke", actor });
    expect(evidence).toMatchObject({ kind: "command", origin: "observed", exit_code: 0, stdout_tail: "ok", display_command: "node smoke" });
    expect(evidence.summary).toContain("exited successfully");
    expect(evidence).not.toHaveProperty("verification_state");
  });
});
