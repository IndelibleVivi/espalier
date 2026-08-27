import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  AcceptedReceipt,
  ActorIdentity,
  Annotation,
  AnnotationKind,
  Batch,
  CanonicalEntity,
  Claim,
  CommandEnvelope,
  CommandReceipt,
  CommandWarning,
  Decision,
  EntityType,
  Epoch,
  Evidence,
  GoalRevision,
  Handoff,
  Hypothesis,
  Lane,
  OwnerApproval,
  Project,
  ProjectExport,
  Provenance,
  RejectedReceipt,
  Relation,
  SearchHit,
  StoredEvent,
  WorkItem,
} from "@espalier/protocol";
import { COMMAND_TYPES, PROTOCOL_VERSION, RELATION_TYPES, SCHEMA_VERSION } from "@espalier/protocol";
import { canonicalRef, entityRef, parseRef, withoutRevision } from "./refs.js";
import { SqliteStore, StoreConflictError } from "./store.js";
import { instant, instantIsAfter, instantIsAtOrBefore, normalizeInstant, systemInstant } from "./time.js";

export interface CoreOptions { now?: () => string }

export type CommandPreflight =
  | {
      executable: true;
      command_id: string;
      project_id: string;
      command_type: CommandEnvelope["type"];
      current_project_revision: number;
      projected_entity_versions: Record<string, number>;
      warnings: CommandWarning[];
    }
  | {
      executable: false;
      command_id: string;
      project_id: string;
      command_type: CommandEnvelope["type"];
      current_project_revision: number;
      code: RejectedReceipt["code"];
      reason: string;
      stale_entity?: string;
      recovery: string[];
    };

class CommandError extends Error {
  constructor(
    readonly code: RejectedReceipt["code"],
    message: string,
    readonly staleEntity?: string,
    readonly recovery: string[] = [],
  ) {
    super(message);
  }
}

const ownerOnly = new Set([
  "project.owner-policy.update",
  "goal.approve",
  "decision.resolve",
  "work.authority.resolve",
  "work.verify",
  "claim.force-release",
  "epoch.open",
  "epoch.freeze",
  "epoch.compact",
  "epoch.archive",
  "relation.supersede",
]);

const versionedCommands = new Set([
  "project.owner-policy.update",
  "goal.approve",
  "epoch.freeze",
  "epoch.compact",
  "epoch.archive",
  "work.transition",
  "work.verify",
  "work.authority.resolve",
  "relation.supersede",
  "decision.resolve",
  "annotation.resolve",
  "annotation.reanchor",
  "claim.renew",
  "claim.release",
  "lane.return",
  "batch.integrate",
]);

const coordinatorCommands = new Set(["batch.create", "batch.integrate"]);
const commandTypes = new Set<string>(COMMAND_TYPES);
const actorRoles = new Set(["owner", "collaborator", "coordinator", "worker", "observer"]);
const actorCapabilities = new Set(["read", "write", "claim", "evidence", "owner-update", "coordinate"]);
const workKinds = new Set(["workstream", "task", "investigation", "integration", "milestone"]);
const workStates = new Set(["proposed", "active", "blocked", "implemented", "closed"]);
const evidenceStates = new Set(["none", "partial", "tested", "verified"]);
const workAuthorityStates = new Set(["within_scope", "proposal", "owner_pending", "approved", "superseded"]);
const goalIntegrityStates = new Set(["advances", "research-only", "diverges", "authority-unclear"]);
const integrationStates = new Set(["isolated", "ready", "needs-integration", "integrated"]);
const annotationKinds = new Set(["note", "question", "concern", "correction", "proposal", "directive", "decision"]);
const evidenceOrigins = new Set(["observed", "reported", "owner-confirmed", "imported"]);
const verificationStates = new Set(["unverified", "verified", "rejected"]);
const claimModes = new Set(["primary", "coordinator", "observer"]);
const hypothesisStates = new Set(["open", "supported", "rejected", "inconclusive"]);

const workTransitions: Record<WorkItem["work_state"], WorkItem["work_state"][]> = {
  proposed: ["active", "closed"],
  active: ["blocked", "implemented", "closed"],
  blocked: ["active", "implemented", "closed"],
  implemented: ["active", "closed"],
  closed: ["active"],
};

export class EspalierCore {
  readonly store: SqliteStore;
  private now: () => string;
  private listeners = new Set<(event: StoredEvent) => void>();

  constructor(filename: string, options: CoreOptions = {}) {
    this.store = new SqliteStore(filename);
    this.now = normalizedClock(options.now ?? systemInstant);
  }

  setClock(clock: () => string): void { this.now = normalizedClock(clock); }
  close(): void { this.store.close(); }
  onEvent(listener: (event: StoredEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getProjectRevision(projectId: string): number { return this.store.getProjectRevision(projectId); }
  currentTime(): string { return this.now(); }
  isClaimActive(claim: Claim): boolean { return !claim.released_at && instantIsAfter(claim.lease_until, this.now()); }
  listEntities(projectId: string, type?: EntityType): CanonicalEntity[] { return this.store.listEntities(projectId, type); }
  listProjects(): Project[] { return this.store.listProjects() as Project[]; }
  listEvents(projectId: string, sinceRevision = 0): StoredEvent[] { return this.store.listEvents(projectId, sinceRevision); }
  rebuildProject(projectId: string): void { this.store.rebuildProject(projectId); }
  backupTo(destination: string): Promise<number> { return this.store.backupTo(destination); }
  search(query: string, projectId?: string, limit = 30): SearchHit[] { return this.store.search(query, projectId, limit); }
  exportProject(projectId: string): ProjectExport {
    const revision = this.getProjectRevision(projectId);
    if (revision === 0) throw new Error(`Unknown project ${projectId}`);
    const exportedAt = this.now();
    const entities = this.listEntities(projectId);
    validateCanonicalGraph(new Map(entities.map((entity) => [`${entity.type}:${entity.id}`, entity])), projectId, revision, exportedAt);
    const commandReceipts = this.store.listReceipts(projectId).filter((receipt): receipt is AcceptedReceipt => receipt.accepted);
    const storedFingerprints = this.store.listCommandFingerprints(projectId);
    return {
      format: "espalier.project-export/1",
      schema_version: SCHEMA_VERSION,
      protocol_version: PROTOCOL_VERSION,
      exported_at: exportedAt,
      project_id: projectId,
      project_revision: revision,
      entities,
      events: this.listEvents(projectId),
      command_receipts: commandReceipts,
      command_fingerprints: Object.fromEntries(commandReceipts.map((receipt) => [receipt.command_id, storedFingerprints[receipt.command_id]!])),
      attachments_manifest: [],
    };
  }
  restoreProject(project: ProjectExport): void {
    if (!project || typeof project !== "object") throw new Error("Project export must be an object");
    if (project.format !== "espalier.project-export/1") throw new Error("Unsupported Espalier project export format");
    if (project.protocol_version !== PROTOCOL_VERSION) throw new Error(`Export protocol ${project.protocol_version} is not compatible with ${PROTOCOL_VERSION}`);
    if (project.schema_version !== SCHEMA_VERSION) throw new Error(`Export schema ${project.schema_version} requires an explicit migration to schema ${SCHEMA_VERSION}`);
    if (!Number.isInteger(project.project_revision) || project.project_revision < 1) throw new Error("Project export revision must be a positive integer");
    if (!Array.isArray(project.events) || !Array.isArray(project.entities) || !Array.isArray(project.command_receipts) || !Array.isArray(project.attachments_manifest)) {
      throw new Error("Project export collections are malformed");
    }
    if (!record(project.command_fingerprints)) throw new Error("Project export command fingerprints are malformed or missing");
    if (project.events.some((event) => event.project_id !== project.project_id) || project.entities.some((entity) => entity.project_id !== project.project_id) || project.command_receipts.some((receipt) => receipt.project_id !== project.project_id)) {
      throw new Error("Project export mixes authority domains");
    }
    const highestRevision = Math.max(0, ...project.events.map((event) => event.project_revision));
    if (highestRevision !== project.project_revision) throw new Error("Project export revision does not match its event history");
    const orderedEvents = [...project.events].sort((left, right) => left.project_revision - right.project_revision);
    if (orderedEvents.length !== project.project_revision || orderedEvents.some((event, index) => event.project_revision !== index + 1)) {
      throw new Error("Project export event revisions are not contiguous");
    }
    if (new Set(orderedEvents.map((event) => event.event_id)).size !== orderedEvents.length || new Set(orderedEvents.map((event) => event.command_id)).size !== orderedEvents.length) {
      throw new Error("Project export contains duplicate event or accepted-command identities");
    }
    const replayed = new Map<string, CanonicalEntity>();
    for (const event of orderedEvents) {
      const upserts = event.payload?.upserts;
      if (!Array.isArray(upserts) || upserts.length === 0) throw new Error(`Event revision ${event.project_revision} has no canonical upserts`);
      const upsertKeys = new Set<string>();
      for (const candidate of upserts) {
        if (!candidate || typeof candidate !== "object") throw new Error(`Event revision ${event.project_revision} contains a malformed upsert`);
        const entity = candidate as CanonicalEntity;
        validateCanonicalEntityShape(entity, project.project_id, event.project_revision);
        const key = `${entity.type}:${entity.id}`;
        if (upsertKeys.has(key)) throw new Error(`Event revision ${event.project_revision} contains duplicate upserts for ${key}`);
        upsertKeys.add(key);
        const previous = replayed.get(key);
        if ((!previous && entity.entity_version !== 1) || (previous && entity.entity_version !== previous.entity_version + 1)) {
          throw new Error(`Project export entity version history is not contiguous for ${key}`);
        }
        if (previous && previous.created_at !== entity.created_at) throw new Error(`Project export changes immutable creation identity for ${key}`);
        replayed.set(key, entity);
      }
      validateCanonicalGraph(replayed, project.project_id, event.project_revision, event.recorded_at);
    }
    const materialized = new Map(project.entities.map((entity) => [`${entity.type}:${entity.id}`, entity]));
    if (materialized.size !== project.entities.length || replayed.size !== materialized.size || [...replayed].some(([key, entity]) => !isDeepStrictEqual(materialized.get(key), entity))) {
      throw new Error("Project export materialized state does not match event replay");
    }
    validateCanonicalGraph(replayed, project.project_id, project.project_revision, project.exported_at);
    const projectEntity = materialized.get(`project:${project.project_id}`);
    if (!projectEntity || projectEntity.type !== "project" || projectEntity.project_revision !== project.project_revision) {
      throw new Error("Project export has no matching current project authority record");
    }
    const eventsByCommand = new Map(orderedEvents.map((event) => [event.command_id, event]));
    const eventCommandIds = new Set(eventsByCommand.keys());
    const receiptIds = new Set<string>();
    for (const receipt of project.command_receipts) {
      if (receiptIds.has(receipt.command_id)) throw new Error("Project export contains duplicate command receipts");
      if (!receipt.accepted) throw new Error("Portable project exports may contain only accepted command receipts");
      receiptIds.add(receipt.command_id);
      const event = eventsByCommand.get(receipt.command_id);
      const upserts = (event?.payload.upserts ?? []) as CanonicalEntity[];
      const changed = Object.fromEntries(upserts.map((entity) => [entityRef(entity), entity.entity_version]));
      if (!event || receipt.new_project_revision !== event.project_revision || !isDeepStrictEqual(receipt.emitted_event_ids, [event.event_id]) || !isDeepStrictEqual(receipt.changed_entity_versions, changed)) {
        throw new Error("Project export accepted receipt does not match its event");
      }
    }
    if ([...eventCommandIds].some((commandId) => !receiptIds.has(commandId))) throw new Error("Project export event is missing its command receipt");
    const fingerprintEntries = Object.entries(project.command_fingerprints);
    if (fingerprintEntries.length !== receiptIds.size || fingerprintEntries.some(([commandId, fingerprint]) => !receiptIds.has(commandId) || !/^[a-f0-9]{64}$/.test(fingerprint))) {
      throw new Error("Project export command fingerprints do not match its receipts");
    }
    const normalized: ProjectExport = {
      ...project,
      events: orderedEvents,
      entities: [...replayed.values()].sort((left, right) => left.type.localeCompare(right.type) || left.id.localeCompare(right.id)),
    };
    this.store.restoreProject(normalized);
  }

  requireEntity(projectId: string, type: EntityType, id: string): CanonicalEntity {
    const entity = this.store.getEntity(projectId, type, id);
    if (!entity) throw new Error(`Missing ${type} ${id} in project ${projectId}`);
    return entity;
  }

  resolve(ref: string): CanonicalEntity {
    const parsed = parseRef(ref);
    if (parsed.revision !== undefined) return this.resolveAtRevision(parsed.projectId, parsed.type, parsed.id, parsed.revision);
    return this.requireEntity(parsed.projectId, parsed.type, parsed.id);
  }

  resolveAtRevision(projectId: string, type: EntityType, id: string, revision: number): CanonicalEntity {
    const currentRevision = this.getProjectRevision(projectId);
    if (!Number.isInteger(revision) || revision < 1 || revision > currentRevision) throw new Error(`Revision ${revision} is outside project ${projectId} history`);
    let resolved: CanonicalEntity | undefined;
    for (const event of this.listEvents(projectId)) {
      if (event.project_revision > revision) break;
      const upsert = ((event.payload.upserts ?? []) as CanonicalEntity[]).find((entity) => entity.type === type && entity.id === id);
      if (upsert) resolved = upsert;
    }
    if (!resolved) throw new Error(`Missing ${type} ${id} in project ${projectId} at revision ${revision}`);
    return resolved;
  }

  resolveInProject(projectId: string, ref: string): CanonicalEntity {
    const parsed = parseRef(ref);
    if (parsed.revision !== undefined) throw new CommandError("invalid", "Revision-qualified refs are read-only and cannot be used for canonical mutation");
    if (parsed.projectId !== projectId) {
      throw new CommandError("authority", `Reference ${withoutRevision(ref)} belongs to another project authority domain`);
    }
    return this.requireEntity(projectId, parsed.type, parsed.id);
  }

  preflight(command: CommandEnvelope): CommandPreflight {
    const currentRevision = this.getProjectRevision(command.project_id);
    try {
      const authorization = this.validateEnvelope(command, currentRevision);
      const nextRevision = currentRevision + 1;
      const changed = this.applyCommand(command, nextRevision);
      if (authorization) changed.push(this.bump(authorization, nextRevision, { consumed_by_command_id: command.command_id, consumed_at: this.now() }));
      this.cleanupExpiredClaims(command.project_id, nextRevision, changed);
      changed.push(...this.staleAnchoredAnnotations(command.project_id, nextRevision, changed));
      for (const entity of changed) if (entity.entity_version === 1 && this.store.getEntity(entity.project_id, entity.type, entity.id)) {
        throw new CommandError("invalid", `Stable identity ${entity.type}:${entity.id} already exists`);
      }
      validateCanonicalGraph(this.overlayEntities(command.project_id, changed), command.project_id, nextRevision, this.now());
      return {
        executable: true,
        command_id: command.command_id,
        project_id: command.project_id,
        command_type: command.type,
        current_project_revision: currentRevision,
        projected_entity_versions: Object.fromEntries(changed.map((entity) => [entityRef(entity), entity.entity_version])),
        warnings: this.deriveWarnings(command, changed),
      };
    } catch (error) {
      const commandError = error instanceof CommandError
        ? error
        : error instanceof StoreConflictError
          ? new CommandError("stale", error.message)
          : new CommandError("invalid", error instanceof Error ? error.message : String(error));
      return {
        executable: false,
        command_id: command.command_id,
        project_id: command.project_id,
        command_type: command.type,
        current_project_revision: this.getProjectRevision(command.project_id),
        code: commandError.code,
        reason: commandError.message,
        ...(commandError.staleEntity ? { stale_entity: commandError.staleEntity } : {}),
        recovery: commandError.recovery.length > 0 ? commandError.recovery : ["refresh", "rebase", "propose", "escalate"],
      };
    }
  }

  execute(command: CommandEnvelope): CommandReceipt {
    const commandFingerprint = commandDigest(command);
    const prior = this.store.getReceipt(command.command_id);
    if (prior) {
      if (this.store.getCommandFingerprint(command.command_id) !== commandFingerprint || prior.project_id !== command.project_id) {
        return {
          accepted: false,
          command_id: command.command_id,
          project_id: command.project_id,
          reason: "command_id is already bound to a different command envelope",
          code: "invalid",
          current_project_revision: this.getProjectRevision(command.project_id),
          intervening_delta: [],
          recovery: ["submit with a fresh command_id"],
        };
      }
      return prior.accepted ? { ...prior, idempotent_replay: true } : prior;
    }

    const currentRevision = this.getProjectRevision(command.project_id);
    const attentionBefore = this.deriveAttentionRefs(command.project_id);
    try {
      const authorization = this.validateEnvelope(command, currentRevision);
      const nextRevision = currentRevision + 1;
      const changed = this.applyCommand(command, nextRevision);
      if (authorization) changed.push(this.bump(authorization, nextRevision, { consumed_by_command_id: command.command_id, consumed_at: this.now() }));
      this.cleanupExpiredClaims(command.project_id, nextRevision, changed);
      changed.push(...this.staleAnchoredAnnotations(command.project_id, nextRevision, changed));
      for (const entity of changed) if (entity.entity_version === 1 && this.store.getEntity(entity.project_id, entity.type, entity.id)) {
        throw new CommandError("invalid", `Stable identity ${entity.type}:${entity.id} already exists`);
      }
      validateCanonicalGraph(this.overlayEntities(command.project_id, changed), command.project_id, nextRevision, this.now());
      const warnings = this.deriveWarnings(command, changed);
      const changedMap = Object.fromEntries(changed.map((entity) => [entityRef(entity), entity.entity_version]));
      const eventId = randomUUID();
      const attentionAfter = this.deriveAttentionRefsFromOverlay(command.project_id, changed);
      const receipt: AcceptedReceipt = {
        accepted: true,
        command_id: command.command_id,
        project_id: command.project_id,
        new_project_revision: nextRevision,
        changed_entity_versions: changedMap,
        emitted_event_ids: [eventId],
        attention_changes: {
          opened: attentionAfter.filter((ref) => !attentionBefore.includes(ref)),
          resolved: attentionBefore.filter((ref) => !attentionAfter.includes(ref)),
        },
        next_brief_hint: changed.length > 1 ? `Inspect ${changed.length} changed objects` : entityRef(changed[0]!),
        ...(warnings.length > 0 ? { warnings } : {}),
      };
      const event: Omit<StoredEvent, "event_sequence"> = {
        event_id: eventId,
        command_id: command.command_id,
        project_id: command.project_id,
        project_revision: nextRevision,
        type: `${command.type}.accepted`,
        occurred_at: command.occurred_at,
        recorded_at: this.now(),
        ...(changed.length === 1 ? { entity_ref: entityRef(changed[0]!) } : {}),
        payload: { upserts: changed, command_type: command.type, ...(warnings.length > 0 ? { warnings } : {}) },
      };
      this.store.commit({
        commandId: command.command_id,
        commandFingerprint,
        projectId: command.project_id,
        expectedProjectRevision: currentRevision,
        projectRevision: nextRevision,
        event,
        entities: changed,
        receipt,
      });
      const storedEvent: StoredEvent = { event_sequence: this.listEvents(command.project_id, nextRevision - 1).at(-1)?.event_sequence ?? 0, ...event };
      for (const listener of this.listeners) {
        try { listener(storedEvent); } catch { /* A projection subscriber cannot change a committed command outcome. */ }
      }
      return receipt;
    } catch (error) {
      const commandError = error instanceof CommandError
        ? error
        : error instanceof StoreConflictError
          ? new CommandError("stale", error.message)
        : new CommandError("invalid", error instanceof Error ? error.message : String(error));
      const receipt: RejectedReceipt = {
        accepted: false,
        command_id: command.command_id,
        project_id: command.project_id,
        reason: commandError.message,
        code: commandError.code,
        current_project_revision: error instanceof StoreConflictError ? this.getProjectRevision(command.project_id) : currentRevision,
        ...(commandError.staleEntity ? { stale_entity: commandError.staleEntity } : {}),
        intervening_delta: this.listEvents(command.project_id, command.base_project_revision).map((event) => event.event_id),
        recovery: commandError.recovery.length > 0 ? commandError.recovery : ["refresh", "rebase", "propose", "escalate"],
      };
      this.store.recordRejected(command.command_id, command.project_id, commandFingerprint, receipt);
      return receipt;
    }
  }

  private validateEnvelope(command: CommandEnvelope, currentRevision: number): Decision | undefined {
    if (!command || typeof command !== "object" || !nonEmptyString(command.command_id) || !nonEmptyString(command.project_id) || !command.actor || typeof command.actor !== "object" || !nonEmptyString(command.type)) {
      throw new CommandError("invalid", "Command envelope is incomplete");
    }
    if (!commandTypes.has(command.type)) throw new CommandError("invalid", `Unknown command type ${command.type}`);
    if (!nonEmptyString(command.actor.principal_id) || !nonEmptyString(command.actor.runtime_id) || !nonEmptyString(command.actor.device_id) || !nonEmptyString(command.actor.session_id)) {
      throw new CommandError("invalid", "Actor identity is incomplete");
    }
    if (!actorRoles.has(command.actor.role)) throw new CommandError("invalid", "Actor role is invalid");
    if (!stringArray(command.actor.capabilities) || command.actor.capabilities.some((capability) => !actorCapabilities.has(capability)) || new Set(command.actor.capabilities).size !== command.actor.capabilities.length) {
      throw new CommandError("invalid", "Actor capabilities are invalid");
    }
    if (!Number.isInteger(command.base_project_revision) || command.base_project_revision < 0) throw new CommandError("invalid", "Base project revision must be a non-negative integer");
    if (!record(command.base_entity_versions) || Object.values(command.base_entity_versions).some((version) => !Number.isInteger(version) || version < 0)) {
      throw new CommandError("invalid", "Base entity versions are invalid");
    }
    if (!nonEmptyString(command.occurred_at) || !Number.isFinite(Date.parse(command.occurred_at))) throw new CommandError("invalid", "Command occurred_at is invalid");
    if (!record(command.payload)) throw new CommandError("invalid", "Command payload must be an object");
    this.validatePayload(command);
    if (command.base_project_revision > currentRevision) {
      throw new CommandError("stale", "Command is based on a future project revision");
    }
    if (command.type === "project.create") {
      if (currentRevision !== 0) throw new CommandError("invalid", `Project ${command.project_id} already exists`);
      if (command.actor.role !== "owner") throw new CommandError("authority", "Only an owner can enroll a project");
      this.validateOwnerPolicy((command.payload as Record<string, any>).owner_policy, command.actor);
      return undefined;
    }
    if (currentRevision === 0) throw new CommandError("not-found", `Project ${command.project_id} is not enrolled`);
    if (!command.actor.capabilities.includes("write")) throw new CommandError("capability", "Actor lacks write capability");
    if (command.type === "evidence.attach" && !command.actor.capabilities.includes("evidence")) throw new CommandError("capability", "Actor lacks evidence capability");
    const exactOwnerAuthorization = this.requiresExactOwnerAuthorization(command);
    const requiresOwner = ownerOnly.has(command.type) || exactOwnerAuthorization;
    if (requiresOwner && !this.isOwner(command.project_id, command.actor)) {
      throw new CommandError("authority", `${command.type} requires owner authority`, undefined, ["submit proposal", "request owner decision"]);
    }
    if (requiresOwner && !command.actor.capabilities.includes("owner-update")) throw new CommandError("capability", "Actor lacks owner-update capability");
    let authorization: Decision | undefined;
    if (exactOwnerAuthorization) authorization = this.requireOwnerPolicyAuthorization(command);
    if (coordinatorCommands.has(command.type) && !this.canCoordinate(command.project_id, command.actor)) {
      throw new CommandError("authority", `${command.type} requires coordinator or owner authority`, undefined, ["request coordinator", "submit lane result"]);
    }
    return authorization;
  }

  private overlayEntities(projectId: string, changed: CanonicalEntity[]): Map<string, CanonicalEntity> {
    const overlay = new Map(this.listEntities(projectId).map((entity) => [`${entity.type}:${entity.id}`, entity]));
    for (const entity of changed) overlay.set(`${entity.type}:${entity.id}`, entity);
    return overlay;
  }

  private cleanupExpiredClaims(projectId: string, nextRevision: number, changed: CanonicalEntity[]): void {
    const now = this.now();
    const overlay = this.overlayEntities(projectId, changed);
    const changedByKey = new Map(changed.map((entity) => [`${entity.type}:${entity.id}`, entity]));
    for (const current of overlay.values()) {
      if (current.type !== "claim" || current.released_at || instantIsAfter(current.lease_until, now)) continue;
      const claimKey = `claim:${current.id}`;
      if (!changedByKey.has(claimKey)) {
        const released = this.bump(current, nextRevision, { released_at: now });
        changed.push(released);
        changedByKey.set(claimKey, released);
        overlay.set(claimKey, released);
      }
      if (current.mode !== "primary") continue;
      const parsedTarget = parseRef(current.target_ref);
      const targetKey = `${parsedTarget.type}:${parsedTarget.id}`;
      const target = (changedByKey.get(targetKey) ?? overlay.get(targetKey)) as WorkItem | Lane | undefined;
      if (!target || (target.type !== "work" && target.type !== "lane")) continue;
      const pointsToExpiredClaim = target.type === "work" ? target.current_claim_id === current.id : target.claim_ref === entityRef(current);
      if (!pointsToExpiredClaim) continue;
      const changedTarget = changedByKey.has(targetKey) ? target : this.bump(target, nextRevision, {});
      if (changedTarget.type === "work") delete changedTarget.current_claim_id;
      else delete changedTarget.claim_ref;
      if (!changedByKey.has(targetKey)) changed.push(changedTarget);
      changedByKey.set(targetKey, changedTarget);
      overlay.set(targetKey, changedTarget);
    }
  }

  private validatePayload(command: CommandEnvelope): void {
    const payload = command.payload as Record<string, unknown>;
    const strings = (name: string, required = false) => {
      const value = payload[name];
      if ((required || value !== undefined) && !stringArray(value)) throw new CommandError("invalid", `${command.type} ${name} must be an array of strings`);
    };
    const text = (name: string, required = true) => {
      const value = payload[name];
      if ((required && !nonEmptyString(value)) || (!required && value !== undefined && !nonEmptyString(value))) throw new CommandError("invalid", `${command.type} ${name} must be a non-empty string`);
    };
    const choice = (name: string, choices: Set<string>, required = false) => {
      const value = payload[name];
      if ((required || value !== undefined) && (typeof value !== "string" || !choices.has(value))) throw new CommandError("invalid", `${command.type} ${name} is invalid`);
    };
    const ref = (name: string) => text(name);

    switch (command.type) {
      case "project.create":
        text("display_name"); text("authority_domain"); strings("repository_refs");
        break;
      case "project.owner-policy.update":
        if (!record(payload.owner_policy)) throw new CommandError("invalid", "project.owner-policy.update owner_policy must be an object");
        break;
      case "goal.approve":
        if (payload.goal_ref !== undefined) ref("goal_ref");
        else { text("id"); text("purpose"); strings("present_consumers"); strings("programme_order"); strings("binding_constraints"); strings("trust_boundaries"); strings("explicit_non_goals"); }
        strings("source_refs");
        break;
      case "goal.propose":
        text("id");
        if (!nonEmptyString(payload.purpose) && !nonEmptyString(payload.proposal)) throw new CommandError("invalid", "goal.propose requires purpose or proposal");
        strings("present_consumers"); strings("programme_order"); strings("binding_constraints"); strings("trust_boundaries"); strings("explicit_non_goals"); strings("source_refs");
        break;
      case "epoch.open":
        text("id"); text("goal_revision_id"); text("title"); text("baseline_ref");
        break;
      case "epoch.freeze": case "epoch.archive":
        ref("epoch_ref");
        break;
      case "epoch.compact": {
        ref("epoch_ref"); text("receipt_id");
        if (!record(payload.next_epoch)) throw new CommandError("invalid", "epoch.compact next_epoch must be an object");
        for (const field of ["id", "title", "baseline_ref"]) if (!nonEmptyString(payload.next_epoch[field])) throw new CommandError("invalid", `epoch.compact next_epoch.${field} must be a non-empty string`);
        break;
      }
      case "work.create":
        text("id"); text("epoch_id"); choice("kind", workKinds, true); text("title"); text("scope");
        strings("semantic_surfaces"); strings("repo_surfaces"); strings("owner_refs"); text("verification_policy", false);
        if (payload.priority !== undefined && (typeof payload.priority !== "number" || !Number.isFinite(payload.priority))) throw new CommandError("invalid", "work.create priority must be a finite number");
        choice("work_state", workStates); choice("evidence_state", evidenceStates); choice("authority_state", workAuthorityStates); choice("goal_integrity", goalIntegrityStates); choice("integration_state", integrationStates);
        break;
      case "work.transition":
        ref("work_item_ref"); choice("work_state", workStates); choice("evidence_state", evidenceStates); choice("authority_state", workAuthorityStates); choice("goal_integrity", goalIntegrityStates); choice("integration_state", integrationStates);
        if (!["work_state", "evidence_state", "authority_state", "goal_integrity", "integration_state"].some((field) => payload[field] !== undefined)) throw new CommandError("invalid", "work.transition requires a state change");
        break;
      case "work.verify":
        ref("work_item_ref"); strings("evidence_refs", true); choice("outcome", new Set(["verified", "reopen"]), true); text("rationale");
        if ((payload.evidence_refs as string[]).length === 0) throw new CommandError("invalid", "work.verify requires at least one Evidence ref");
        break;
      case "work.authority.resolve":
        ref("work_item_ref"); choice("authority_state", workAuthorityStates); choice("goal_integrity", goalIntegrityStates);
        break;
      case "relation.create":
        text("id"); ref("source_ref"); ref("target_ref"); text("relation_type"); choice("authority_state", workAuthorityStates);
        if (parseRef(String(payload.source_ref)).revision !== undefined || parseRef(String(payload.target_ref)).revision !== undefined) throw new CommandError("invalid", "Relation endpoints must use current-object refs; preserve historical anchors with annotation anchor_revision");
        break;
      case "relation.supersede": ref("relation_ref"); break;
      case "decision.propose":
        text("id"); text("question"); text("proposal"); text("scope"); text("rationale", false); strings("source_refs");
        if (payload.authorizes !== undefined) {
          if (!record(payload.authorizes) || !nonEmptyString(payload.authorizes.command_type) || !commandTypes.has(payload.authorizes.command_type)) throw new CommandError("invalid", "decision.propose authorizes.command_type is invalid");
          if (payload.authorizes.target_ref !== undefined && !nonEmptyString(payload.authorizes.target_ref)) throw new CommandError("invalid", "decision.propose authorizes.target_ref is invalid");
          if (!record(payload.authorizes.payload)) throw new CommandError("invalid", "decision.propose authorizes.payload must be the exact command payload");
        }
        break;
      case "decision.resolve":
        ref("decision_ref"); choice("decision_state", new Set(["approved", "rejected", "superseded"]), true); text("rationale", false); strings("source_refs");
        break;
      case "hypothesis.record":
        text("id"); text("statement"); choice("state", hypothesisStates); strings("tests"); strings("evidence_refs");
        break;
      case "evidence.attach":
        text("id"); strings("target_refs", true); text("kind"); choice("origin", evidenceOrigins, true); text("ref"); text("summary"); choice("verification_state", verificationStates);
        break;
      case "annotation.add":
        text("id"); ref("anchor_ref"); choice("kind", annotationKinds, true); text("body"); strings("source_refs"); text("requested_action", false);
        if (!Number.isInteger(payload.anchor_revision) || (payload.anchor_revision as number) < 1) throw new CommandError("invalid", "annotation.add anchor_revision must be a positive integer");
        if (payload.origin !== undefined && payload.origin !== "imported") throw new CommandError("invalid", "annotation.add origin must be imported when supplied");
        break;
      case "annotation.resolve":
        ref("annotation_ref"); strings("response_refs");
        break;
      case "annotation.reanchor":
        ref("annotation_ref");
        if (!Number.isInteger(payload.anchor_revision) || (payload.anchor_revision as number) < 1) throw new CommandError("invalid", "annotation.reanchor anchor_revision must be a positive integer");
        break;
      case "claim.acquire":
        text("id"); ref("target_ref"); choice("mode", claimModes); strings("semantic_surfaces"); strings("repo_surfaces");
        if (payload.lease_seconds !== undefined && (typeof payload.lease_seconds !== "number" || !Number.isFinite(payload.lease_seconds) || payload.lease_seconds <= 0)) throw new CommandError("invalid", "claim.acquire lease_seconds must be positive");
        break;
      case "claim.renew":
        ref("claim_ref");
        if (payload.lease_seconds !== undefined && (typeof payload.lease_seconds !== "number" || !Number.isFinite(payload.lease_seconds) || payload.lease_seconds <= 0)) throw new CommandError("invalid", "claim.renew lease_seconds must be positive");
        break;
      case "claim.release": case "claim.force-release": ref("claim_ref"); break;
      case "handoff.record":
        text("id"); ref("work_item_ref"); text("current_state"); text("next_safe_action"); text("narrative", false); text("to_actor", false);
        strings("completed"); strings("open_questions"); strings("blockers"); strings("evidence_refs");
        break;
      case "batch.create": {
        text("id"); ref("parent_work_item_ref"); text("title", false);
        if (!Array.isArray(payload.lanes) || payload.lanes.length === 0) throw new CommandError("invalid", "batch.create lanes must be a non-empty array");
        for (const lane of payload.lanes) {
          if (!record(lane)) throw new CommandError("invalid", "batch.create lane must be an object");
          for (const field of ["id", "outcome", "scope", "authority", "return_contract"]) if (!nonEmptyString(lane[field])) throw new CommandError("invalid", `batch.create lane.${field} must be a non-empty string`);
          for (const field of ["context_refs", "semantic_surfaces", "repo_surfaces"]) if (lane[field] !== undefined && !stringArray(lane[field])) throw new CommandError("invalid", `batch.create lane.${field} must be an array of strings`);
          if (lane.title !== undefined && !nonEmptyString(lane.title)) throw new CommandError("invalid", "batch.create lane.title must be a non-empty string");
        }
        break;
      }
      case "lane.return":
        ref("lane_ref"); text("result_id"); text("summary"); text("evidence_ref"); choice("verification_state", verificationStates);
        if (payload.origin !== undefined && !new Set(["observed", "reported"]).has(String(payload.origin))) throw new CommandError("invalid", "lane.return origin must be observed or reported");
        break;
      case "batch.integrate": ref("batch_ref"); break;
    }
  }

  private isOwner(projectId: string, actor: ActorIdentity): boolean {
    const project = this.store.getEntity(projectId, "project", projectId) as Project | undefined;
    return actor.role === "owner" && Boolean(project?.owner_policy.owners.includes(actor.principal_id));
  }

  private canCoordinate(projectId: string, actor: ActorIdentity): boolean {
    return this.isOwner(projectId, actor) || (actor.role === "coordinator" && actor.capabilities.includes("coordinate"));
  }

  private requiresExactOwnerAuthorization(command: CommandEnvelope): boolean {
    if (ownerOnly.has(command.type)) return !["goal.approve", "decision.resolve"].includes(command.type);
    const payload = command.payload as Record<string, any>;
    if (command.type === "work.create") return payload.authority_state === "approved";
    if (command.type === "relation.create") {
      const source = this.resolve(payload.source_ref);
      const target = this.resolve(payload.target_ref);
      return payload.authority_state === "approved" || (source.project_id !== target.project_id && payload.authority_state !== "proposal");
    }
    if (command.type === "annotation.add") return payload.kind === "directive" || payload.kind === "decision";
    if (command.type === "evidence.attach") return payload.origin === "owner-confirmed";
    if (command.type === "annotation.resolve" || command.type === "annotation.reanchor") {
      const annotation = this.resolveInProject(command.project_id, payload.annotation_ref) as Annotation;
      const bindingKind = annotation.kind === "directive" || annotation.kind === "decision";
      const otherOwnerConcern = annotation.kind === "concern" && annotation.author.role === "owner" && annotation.author.principal_id !== command.actor.principal_id;
      return bindingKind || otherOwnerConcern;
    }
    return false;
  }

  private validateOwnerPolicy(policy: Project["owner_policy"] | undefined, actor: ActorIdentity): void {
    const problem = ownerPolicyProblem(policy);
    if (problem) throw new CommandError("invalid", problem);
    if (!policy!.owners.includes(actor.principal_id)) throw new CommandError("authority", "Enrolling owner must belong to the owner policy");
  }

  private requireOwnerPolicyAuthorization(command: CommandEnvelope): Decision | undefined {
    const project = this.requireEntity(command.project_id, "project", command.project_id) as Project;
    if (project.owner_policy.approval === "any-one") return undefined;
    const payload = command.payload as Record<string, any>;
    if (!payload.approval_decision_ref) throw new CommandError("authority", `${command.type} requires an approved multi-owner authorization decision`, undefined, ["propose decision", "collect owner approvals"]);
    const decision = this.resolveInProject(command.project_id, payload.approval_decision_ref) as Decision;
    if (decision.type !== "decision" || decision.decision_state !== "approved" || decision.authorizes?.command_type !== command.type) {
      throw new CommandError("authority", "Authorization decision is not approved for this command");
    }
    if (decision.consumed_by_command_id) throw new CommandError("authority", "Authorization decision has already been consumed");
    if (decision.authorizes.owner_policy_version !== project.owner_policy_version) throw new CommandError("authority", "Authorization decision was approved under a different owner policy version");
    const targetRef = payload.project_ref ?? payload.epoch_ref ?? payload.claim_ref ?? payload.work_item_ref ?? payload.relation_ref ?? payload.annotation_ref ?? payload.anchor_ref ?? payload.decision_ref ?? payload.lane_ref ?? payload.batch_ref ?? payload.target_ref;
    if (decision.authorizes.target_ref && (!targetRef || withoutRevision(decision.authorizes.target_ref) !== withoutRevision(targetRef))) {
      throw new CommandError("authority", "Authorization decision targets a different canonical object");
    }
    if (decision.authorizes.payload_digest !== commandPayloadDigest(payload)) throw new CommandError("authority", "Authorization decision does not match the exact command payload");
    return decision;
  }

  private recordApproval(records: OwnerApproval[], actor: ActorIdentity, action: OwnerApproval["action"], sourceRefs: string[] = []): OwnerApproval[] {
    return [
      ...records.filter((record) => record.principal_id !== actor.principal_id),
      { principal_id: actor.principal_id, action, recorded_at: this.now(), source_refs: sourceRefs },
    ].sort((a, b) => a.principal_id.localeCompare(b.principal_id));
  }

  private approvalSatisfied(project: Project, records: OwnerApproval[], action: OwnerApproval["action"]): boolean {
    const voters = new Set(records.filter((record) => record.action === action).map((record) => record.principal_id));
    const matching = project.owner_policy.owners.filter((owner) => voters.has(owner)).length;
    if (project.owner_policy.approval === "any-one") return matching >= 1;
    if (project.owner_policy.approval === "all") return matching === project.owner_policy.owners.length;
    return matching >= project.owner_policy.threshold!;
  }

  private provenance(command: CommandEnvelope, authority?: Provenance["authority"]): Provenance {
    const fallback = this.isOwner(command.project_id, command.actor) ? "owner-approved" : "agent-reported";
    return { authority: authority ?? fallback, actor: command.actor, source_refs: [] };
  }

  private base(command: CommandEnvelope, nextRevision: number, type: EntityType, id: string, title: string, authority?: Provenance["authority"]): Omit<CanonicalEntity, never> & Record<string, unknown> {
    const timestamp = this.now();
    return {
      id,
      project_id: command.project_id,
      type,
      title,
      aliases: [],
      provenance: this.provenance(command, authority),
      created_at: timestamp,
      updated_at: timestamp,
      entity_version: 1,
      valid_from_revision: nextRevision,
    } as Omit<CanonicalEntity, never> & Record<string, unknown>;
  }

  private bump<T extends CanonicalEntity>(entity: T, nextRevision: number, patch: Partial<T>): T {
    return {
      ...entity,
      ...patch,
      updated_at: this.now(),
      entity_version: entity.entity_version + 1,
      valid_from_revision: nextRevision,
    };
  }

  private ensureVersion(command: CommandEnvelope, entity: CanonicalEntity): void {
    const ref = entityRef(entity);
    const supplied = command.base_entity_versions[ref] ?? command.base_entity_versions[`${entity.type}:${entity.id}`];
    if (supplied !== undefined && supplied !== entity.entity_version) {
      throw new CommandError("stale", `${ref} is at entity version ${entity.entity_version}, not ${supplied}`, ref);
    }
    if (supplied === undefined && versionedCommands.has(command.type) && command.base_project_revision !== this.getProjectRevision(command.project_id)) {
      throw new CommandError("stale", `${command.type} requires a current entity version`, ref);
    }
  }

  private applyCommand(command: CommandEnvelope, nextRevision: number): CanonicalEntity[] {
    const payload = command.payload as Record<string, any>;
    const project = command.type === "project.create" ? undefined : this.requireEntity(command.project_id, "project", command.project_id) as Project;

    switch (command.type) {
      case "project.create": {
        const created = {
          ...this.base(command, nextRevision, "project", command.project_id, payload.display_name, "owner-approved"),
          type: "project",
          display_name: payload.display_name,
          authority_domain: payload.authority_domain,
          repository_refs: payload.repository_refs ?? [],
          status: "active",
          owner_policy: payload.owner_policy,
          owner_policy_version: 1,
          project_revision: nextRevision,
        } as Project;
        return [created];
      }
      case "project.owner-policy.update": {
        this.ensureVersion(command, project!);
        this.validateOwnerPolicy(payload.owner_policy, command.actor);
        return [this.bump(project!, nextRevision, { owner_policy: payload.owner_policy, owner_policy_version: project!.owner_policy_version + 1, project_revision: nextRevision })];
      }
      case "goal.approve": {
        const existingGoals = this.listEntities(command.project_id, "goal") as GoalRevision[];
        const requestedGoal = payload.goal_ref
          ? this.resolveInProject(command.project_id, payload.goal_ref) as GoalRevision
          : existingGoals.find((item) => item.id === payload.id);
        if (requestedGoal) {
          if (requestedGoal.type !== "goal") throw new CommandError("invalid", "Target is not a goal revision");
          if (requestedGoal.approval !== "proposed") throw new CommandError("transition", `Goal ${requestedGoal.id} is already ${requestedGoal.approval}`);
          this.ensureVersion(command, requestedGoal);
          const approvalRecords = this.recordApproval(requestedGoal.approval_records ?? [], command.actor, "approve", payload.source_refs ?? []);
          const approved = this.approvalSatisfied(project!, approvalRecords, "approve");
          const activeEpoch = (this.listEntities(command.project_id, "epoch") as Epoch[]).find((candidate) => candidate.state === "active");
          if (approved && activeEpoch) throw new CommandError("transition", `Freeze the active Epoch ${activeEpoch.id} before approving a new Goal`, entityRef(activeEpoch));
          const changedGoal = this.bump(requestedGoal, nextRevision, {
            approval: approved ? "approved" : "proposed",
            approval_records: approvalRecords,
            ...(approved ? { approved_at: this.now(), provenance: this.provenance(command, "owner-approved") } : {}),
          });
          if (!approved) return [changedGoal, this.bump(project!, nextRevision, { project_revision: nextRevision })];
          const changed: CanonicalEntity[] = [changedGoal];
          if (project!.current_goal_revision_id && project!.current_goal_revision_id !== requestedGoal.id) {
            const previous = this.requireEntity(command.project_id, "goal", project!.current_goal_revision_id) as GoalRevision;
            changed.push(this.bump(previous, nextRevision, { approval: "superseded", valid_to_revision: nextRevision }));
          }
          changed.push(this.bump(project!, nextRevision, { current_goal_revision_id: requestedGoal.id, project_revision: nextRevision }));
          return changed;
        }
        if (!payload.id || !payload.purpose) throw new CommandError("invalid", "New goal approval requires id and purpose");
        const approvalRecords = this.recordApproval([], command.actor, "approve", payload.source_refs ?? []);
        const approved = this.approvalSatisfied(project!, approvalRecords, "approve");
        const activeEpoch = (this.listEntities(command.project_id, "epoch") as Epoch[]).find((candidate) => candidate.state === "active");
        if (approved && activeEpoch) throw new CommandError("transition", `Freeze the active Epoch ${activeEpoch.id} before approving a new Goal`, entityRef(activeEpoch));
        const goal = {
          ...this.base(command, nextRevision, "goal", payload.id, payload.purpose, approved ? "owner-approved" : "owner-directive"),
          type: "goal",
          revision_number: Math.max(0, ...existingGoals.map((item) => item.revision_number)) + 1,
          purpose: payload.purpose,
          present_consumers: payload.present_consumers ?? [],
          programme_order: payload.programme_order ?? [],
          binding_constraints: payload.binding_constraints ?? [],
          trust_boundaries: payload.trust_boundaries ?? [],
          explicit_non_goals: payload.explicit_non_goals ?? [],
          source_refs: payload.source_refs ?? [],
          approval: approved ? "approved" : "proposed",
          approval_records: approvalRecords,
          ...(approved ? { approved_at: this.now() } : {}),
          ...(project?.current_goal_revision_id ? { supersedes_goal_revision_id: project.current_goal_revision_id } : {}),
        } as GoalRevision;
        if (!approved) return [goal, this.bump(project!, nextRevision, { project_revision: nextRevision })];
        const changed: CanonicalEntity[] = [goal];
        if (project!.current_goal_revision_id) {
          const previous = this.requireEntity(command.project_id, "goal", project!.current_goal_revision_id) as GoalRevision;
          changed.push(this.bump(previous, nextRevision, { approval: "superseded", valid_to_revision: nextRevision }));
        }
        changed.push(this.bump(project!, nextRevision, { current_goal_revision_id: goal.id, project_revision: nextRevision }));
        return changed;
      }
      case "goal.propose": {
        const existingGoals = this.listEntities(command.project_id, "goal") as GoalRevision[];
        if (!payload.id) throw new CommandError("invalid", "Goal proposal requires id");
        const purpose = payload.purpose ?? payload.proposal;
        if (!purpose) throw new CommandError("invalid", "Goal proposal requires purpose");
        const goal = {
          ...this.base(command, nextRevision, "goal", payload.id, payload.question ?? purpose, "agent-proposed"),
          type: "goal",
          revision_number: Math.max(0, ...existingGoals.map((item) => item.revision_number)) + 1,
          purpose,
          present_consumers: payload.present_consumers ?? [],
          programme_order: payload.programme_order ?? [],
          binding_constraints: payload.binding_constraints ?? [],
          trust_boundaries: payload.trust_boundaries ?? [],
          explicit_non_goals: payload.explicit_non_goals ?? [],
          source_refs: payload.source_refs ?? [],
          approval: "proposed",
          approval_records: [],
          ...(project?.current_goal_revision_id ? { supersedes_goal_revision_id: project.current_goal_revision_id } : {}),
        } as GoalRevision;
        return [goal, this.bump(project!, nextRevision, { project_revision: nextRevision })];
      }
      case "decision.propose": {
        const decision = {
          ...this.base(command, nextRevision, "decision", payload.id, payload.question, "agent-proposed"),
          type: "decision",
          question: payload.question,
          proposal: payload.proposal,
          decision_state: "proposed",
          authority: "agent-proposed",
          scope: payload.scope,
          rationale: payload.rationale ?? "",
          source_refs: payload.source_refs ?? [],
          approval_records: [],
          ...(payload.authorizes ? { authorizes: {
            command_type: payload.authorizes.command_type,
            ...(payload.authorizes.target_ref ? { target_ref: withoutRevision(payload.authorizes.target_ref) } : {}),
            payload_digest: commandPayloadDigest(payload.authorizes.payload),
            owner_policy_version: project!.owner_policy_version,
            max_uses: 1,
          } } : {}),
        } as Decision;
        return [decision, this.bump(project!, nextRevision, { project_revision: nextRevision })];
      }
      case "decision.resolve": {
        const decision = this.resolveInProject(command.project_id, payload.decision_ref) as Decision;
        this.ensureVersion(command, decision);
        if (decision.type !== "decision") throw new CommandError("invalid", "Target is not a decision");
        if (decision.decision_state !== "proposed") throw new CommandError("transition", `Decision ${decision.id} is already ${decision.decision_state}`);
        if (!["approved", "rejected", "superseded"].includes(payload.decision_state)) throw new CommandError("invalid", "Decision resolution must approve, reject, or supersede");
        const action: OwnerApproval["action"] = payload.decision_state === "approved" ? "approve" : payload.decision_state === "rejected" ? "reject" : "supersede";
        const approvalRecords = this.recordApproval(decision.approval_records ?? [], command.actor, action, payload.source_refs ?? []);
        const resolved = this.approvalSatisfied(project!, approvalRecords, action);
        return [this.bump(decision, nextRevision, {
          decision_state: resolved ? payload.decision_state : "proposed",
          authority: resolved ? "owner-approved" : decision.authority,
          rationale: payload.rationale ?? decision.rationale,
          approval_records: approvalRecords,
          ...(resolved ? { decided_at: this.now(), provenance: this.provenance(command, "owner-approved") } : {}),
        }), this.bump(project!, nextRevision, { project_revision: nextRevision })];
      }
      case "epoch.open": {
        const goal = this.requireEntity(command.project_id, "goal", payload.goal_revision_id) as GoalRevision;
        if (goal.approval !== "approved" || project!.current_goal_revision_id !== goal.id) throw new CommandError("transition", "Epoch must use the current approved Goal revision");
        const activeEpoch = (this.listEntities(command.project_id, "epoch") as Epoch[]).find((candidate) => candidate.state === "active");
        if (activeEpoch) throw new CommandError("transition", `Project already has active Epoch ${activeEpoch.id}`, entityRef(activeEpoch), ["freeze the current epoch", "compact or archive it"]);
        const epoch = {
          ...this.base(command, nextRevision, "epoch", payload.id, payload.title),
          type: "epoch",
          goal_revision_id: payload.goal_revision_id,
          baseline_ref: payload.baseline_ref,
          state: "active",
          opened_at: this.now(),
        } as Epoch;
        return [epoch, this.bump(project!, nextRevision, { current_epoch_id: epoch.id, project_revision: nextRevision })];
      }
      case "epoch.freeze": {
        const epoch = this.resolveInProject(command.project_id, payload.epoch_ref) as Epoch;
        if (epoch.type !== "epoch") throw new CommandError("invalid", "Target is not an epoch");
        this.ensureVersion(command, epoch);
        if (epoch.state !== "active") throw new CommandError("transition", `Epoch ${epoch.id} is already ${epoch.state}`);
        const changedProject = this.bump(project!, nextRevision, { project_revision: nextRevision });
        delete changedProject.current_epoch_id;
        return [this.bump(epoch, nextRevision, { state: "frozen", closed_at: this.now() }), changedProject];
      }
      case "epoch.compact": {
        const epoch = this.resolveInProject(command.project_id, payload.epoch_ref) as Epoch;
        if (epoch.type !== "epoch") throw new CommandError("invalid", "Target is not an epoch");
        this.ensureVersion(command, epoch);
        if (epoch.state !== "frozen") throw new CommandError("transition", "Epoch must be frozen before compaction");
        const otherActiveEpoch = (this.listEntities(command.project_id, "epoch") as Epoch[]).find((candidate) => candidate.id !== epoch.id && candidate.state === "active");
        if (otherActiveEpoch) throw new CommandError("transition", `Project already has active Epoch ${otherActiveEpoch.id}`, entityRef(otherActiveEpoch));
        const newerPendingEpoch = (this.listEntities(command.project_id, "epoch") as Epoch[]).find((candidate) => candidate.id !== epoch.id && candidate.state !== "archived" && !candidate.compaction_receipt_ref && candidate.valid_from_revision > epoch.valid_from_revision);
        if (newerPendingEpoch) throw new CommandError("transition", `Epoch ${epoch.id} is not the current lifecycle Epoch`, entityRef(newerPendingEpoch));
        if (epoch.compaction_receipt_ref) throw new CommandError("transition", "Epoch is already compacted");
        if (!payload.receipt_id || !payload.next_epoch?.id || !payload.next_epoch?.title || !payload.next_epoch?.baseline_ref) throw new CommandError("invalid", "Compaction requires receipt_id and a complete next_epoch");
        if (this.store.getEntity(command.project_id, "epoch", payload.next_epoch.id)) throw new CommandError("invalid", `Epoch ${payload.next_epoch.id} already exists`);
        const epochWork = (this.listEntities(command.project_id, "work") as WorkItem[]).filter((work) => work.epoch_id === epoch.id);
        const epochWorkRefs = new Set(epochWork.map((work) => entityRef(work)));
        const epochBatches = (this.listEntities(command.project_id, "batch") as Batch[]).filter((batch) => epochWorkRefs.has(batch.parent_work_item_ref));
        const epochLaneRefs = new Set(epochBatches.flatMap((batch) => batch.lane_refs));
        const now = this.now();
        const activeClaims = (this.listEntities(command.project_id, "claim") as Claim[]).filter((claim) => !claim.released_at && instantIsAfter(claim.lease_until, now) && (epochWorkRefs.has(claim.target_ref) || epochLaneRefs.has(claim.target_ref)));
        if (activeClaims.length > 0) throw new CommandError("claim-conflict", "Release active epoch claims before compaction", entityRef(activeClaims[0]!), ["record handoff", "release claim", "force-release with owner authority"]);
        const unresolvedBatchParents = new Set(epochBatches.filter((batch) => batch.integration_state !== "integrated").map((batch) => batch.parent_work_item_ref));
        const carriedIds = new Set(epochWork.filter((work) => unresolvedBatchParents.has(entityRef(work)) || !isResolvedForCompaction(work)).map((work) => work.id));
        const workById = new Map(epochWork.map((work) => [work.id, work]));
        for (const initialId of [...carriedIds]) {
          let cursor = workById.get(initialId);
          while (cursor?.parent_id) {
            carriedIds.add(cursor.parent_id);
            cursor = workById.get(cursor.parent_id);
          }
        }
        const carried = epochWork.filter((work) => carriedIds.has(work.id));
        const compacted = epochWork.filter((work) => !carried.includes(work));
        const acceptedDecisions = (this.listEntities(command.project_id, "decision") as Decision[]).filter((decision) => decision.decision_state === "approved");
        const nextEpoch = {
          ...this.base(command, nextRevision, "epoch", payload.next_epoch.id, payload.next_epoch.title, "owner-approved"),
          type: "epoch",
          goal_revision_id: project!.current_goal_revision_id ?? epoch.goal_revision_id,
          baseline_ref: payload.next_epoch.baseline_ref,
          state: "active",
          opened_at: this.now(),
        } as Epoch;
        const receipt = {
          ...this.base(command, nextRevision, "evidence", payload.receipt_id, `Compaction: ${epoch.title}`, "owner-approved"),
          type: "evidence",
          body: JSON.stringify({
            source_epoch_ref: entityRef(epoch),
            next_epoch_ref: entityRef(nextEpoch),
            compacted_refs: compacted.map((entity) => entityRef(entity)),
            carried_refs: carried.map((entity) => entityRef(entity)),
            accepted_decision_refs: acceptedDecisions.map((entity) => entityRef(entity)),
          }),
          target_refs: [entityRef(epoch), ...epochWork.map((entity) => entityRef(entity))],
          kind: "compaction-receipt",
          origin: "owner-confirmed",
          ref: `compaction:${command.project_id}@${nextRevision}`,
          summary: `${compacted.length} completed branch(es) compacted; ${carried.length} unresolved item(s) carried into ${nextEpoch.title}`,
          occurred_at: command.occurred_at,
          recorded_at: this.now(),
          verification_state: "verified",
          collector: command.actor,
        } as Evidence;
        return [
          receipt,
          this.bump(epoch, nextRevision, { compaction_receipt_ref: entityRef(receipt) }),
          nextEpoch,
          ...carried.map((work) => this.bump(work, nextRevision, { epoch_id: nextEpoch.id })),
          this.bump(project!, nextRevision, { current_epoch_id: nextEpoch.id, project_revision: nextRevision }),
        ];
      }
      case "epoch.archive": {
        const epoch = this.resolveInProject(command.project_id, payload.epoch_ref) as Epoch;
        if (epoch.type !== "epoch") throw new CommandError("invalid", "Target is not an epoch");
        this.ensureVersion(command, epoch);
        if (epoch.state !== "frozen" || !epoch.compaction_receipt_ref) throw new CommandError("transition", "Only a compacted frozen epoch can be archived");
        return [this.bump(epoch, nextRevision, { state: "archived" }), this.bump(project!, nextRevision, { project_revision: nextRevision })];
      }
      case "work.create": {
        const epoch = this.store.getEntity(command.project_id, "epoch", payload.epoch_id) as Epoch | undefined;
        if (!epoch) throw new CommandError("not-found", `Work Epoch ${payload.epoch_id} does not exist`);
        if (epoch.state !== "active" || project!.current_epoch_id !== epoch.id) throw new CommandError("transition", "Work can only be created in the current active Epoch", entityRef(epoch));
        if (this.store.getEntity(command.project_id, "work", payload.id)) throw new CommandError("invalid", `Work ${payload.id} already exists`);
        if (payload.parent_id === payload.id) throw new CommandError("invalid", "Work cannot be its own parent");
        if (payload.parent_id) {
          const parent = this.store.getEntity(command.project_id, "work", payload.parent_id) as WorkItem | undefined;
          if (!parent) throw new CommandError("not-found", `Work parent ${payload.parent_id} does not exist`);
          if (parent.epoch_id !== epoch.id) throw new CommandError("invalid", "Work parent must belong to the same Epoch", entityRef(parent));
        }
        if (payload.evidence_state !== undefined && payload.evidence_state !== "none") throw new CommandError("transition", "Work Evidence state can advance only through work.verify with canonical Evidence");
        if (payload.integration_state !== undefined && payload.integration_state !== "isolated") throw new CommandError("transition", "Work integration state can advance only through the coordinator integration path");
        if (payload.work_state === "implemented" || payload.work_state === "closed") throw new CommandError("transition", "Ordinary Work creation cannot import completed state; use explicit lifecycle commands");
        if (payload.authority_state === "approved" && !this.isOwner(command.project_id, command.actor)) throw new CommandError("authority", "Only an owner can create approved-scope work");
        const requestedIntegrity = payload.goal_integrity ?? "advances";
        const proposedScope = !this.isOwner(command.project_id, command.actor) && (payload.authority_state === "proposal" || payload.authority_state === "owner_pending" || requestedIntegrity === "diverges" || requestedIntegrity === "authority-unclear");
        const authorityState = proposedScope ? "owner_pending" : payload.authority_state ?? "within_scope";
        const work = {
          ...this.base(command, nextRevision, "work", payload.id, payload.title, proposedScope ? "agent-proposed" : undefined),
          type: "work",
          epoch_id: payload.epoch_id,
          ...(payload.parent_id ? { parent_id: payload.parent_id } : {}),
          kind: payload.kind,
          scope: payload.scope,
          semantic_surfaces: payload.semantic_surfaces ?? [],
          repo_surfaces: payload.repo_surfaces ?? [],
          priority: payload.priority ?? 0,
          work_state: payload.work_state ?? "active",
          evidence_state: payload.evidence_state ?? "none",
          authority_state: authorityState,
          goal_integrity: requestedIntegrity,
          integration_state: payload.integration_state ?? "isolated",
          verification_policy: payload.verification_policy ?? "explicit evidence",
          owner_refs: payload.owner_refs ?? [],
        } as WorkItem;
        return [work, this.bump(project!, nextRevision, { project_revision: nextRevision })];
      }
      case "work.transition": {
        const work = this.resolveInProject(command.project_id, payload.work_item_ref) as WorkItem;
        if (work.type !== "work") throw new CommandError("invalid", "Target is not work");
        this.ensureVersion(command, work);
        this.requirePrimaryClaim(work, command.actor);
        if (payload.authority_state !== undefined || payload.goal_integrity !== undefined) throw new CommandError("authority", "Authority and goal-integrity changes require work.authority.resolve");
        if (payload.integration_state !== undefined) throw new CommandError("authority", "Integration state changes require the coordinator integration path");
        if (payload.evidence_state !== undefined) throw new CommandError("authority", "Work Evidence state changes require work.verify with canonical Evidence");
        if (payload.work_state && payload.work_state !== work.work_state && !workTransitions[work.work_state].includes(payload.work_state)) {
          throw new CommandError("transition", `${work.work_state} cannot transition to ${payload.work_state}`);
        }
        const changed = this.bump(work, nextRevision, {
          ...(payload.work_state ? { work_state: payload.work_state } : {}),
          ...(payload.authority_state ? { authority_state: payload.authority_state } : {}),
          ...(payload.goal_integrity ? { goal_integrity: payload.goal_integrity } : {}),
          ...(payload.integration_state ? { integration_state: payload.integration_state } : {}),
        });
        return [changed, this.bump(project!, nextRevision, { project_revision: nextRevision })];
      }
      case "work.verify": {
        const work = this.resolveInProject(command.project_id, payload.work_item_ref) as WorkItem;
        if (work.type !== "work") throw new CommandError("invalid", "Target is not work");
        this.ensureVersion(command, work);
        const evidence = (payload.evidence_refs as string[]).map((ref) => {
          const item = this.resolveInProject(command.project_id, ref);
          if (item.type !== "evidence") throw new CommandError("invalid", `${ref} is not Evidence`);
          if (!item.target_refs.includes(entityRef(work))) throw new CommandError("invalid", `Evidence ${item.id} does not target ${entityRef(work)}`);
          return item;
        });
        if (payload.outcome === "verified" && evidence.some((item) => item.verification_state !== "verified")) throw new CommandError("transition", "Verification requires canonical Evidence marked verified");
        if (payload.outcome === "reopen" && evidence.every((item) => item.verification_state !== "rejected")) throw new CommandError("transition", "Reopening verified Work requires contradictory rejected Evidence");
        return [this.bump(work, nextRevision, {
          evidence_state: payload.outcome === "verified" ? "verified" : "tested",
          verification_evidence_refs: evidence.map((item) => entityRef(item)),
          verification_rationale: payload.rationale,
          provenance: this.provenance(command, "owner-approved"),
        }), this.bump(project!, nextRevision, { project_revision: nextRevision })];
      }
      case "work.authority.resolve": {
        const work = this.resolveInProject(command.project_id, payload.work_item_ref) as WorkItem;
        if (work.type !== "work") throw new CommandError("invalid", "Target is not work");
        this.ensureVersion(command, work);
        if (!payload.authority_state && !payload.goal_integrity) throw new CommandError("invalid", "Authority resolution requires an authority or goal-integrity outcome");
        return [this.bump(work, nextRevision, {
          ...(payload.authority_state ? { authority_state: payload.authority_state } : {}),
          ...(payload.goal_integrity ? { goal_integrity: payload.goal_integrity } : {}),
          provenance: this.provenance(command, "owner-approved"),
        }), this.bump(project!, nextRevision, { project_revision: nextRevision })];
      }
      case "relation.create": {
        const source = this.resolve(payload.source_ref);
        const target = this.resolve(payload.target_ref);
        if (source.project_id !== command.project_id && target.project_id !== command.project_id) throw new CommandError("authority", "A project can only record relations attached to its own authority domain");
        const crossProject = source.project_id !== target.project_id;
        if (crossProject && payload.authority_state !== "proposal" && !this.isOwner(command.project_id, command.actor)) {
          throw new CommandError("authority", "Binding cross-project relations require owner authority", undefined, ["create proposal", "request owner decision"]);
        }
        if (!RELATION_TYPES.includes(payload.relation_type) && !String(payload.relation_type).includes(":")) {
          throw new CommandError("invalid", "Extension relation types must be namespaced");
        }
        const relation = {
          ...this.base(command, nextRevision, "relation", payload.id, payload.title ?? payload.relation_type, payload.authority_state === "proposal" ? "agent-proposed" : undefined),
          type: "relation",
          source_ref: withoutRevision(payload.source_ref),
          target_ref: withoutRevision(payload.target_ref),
          relation_type: payload.relation_type,
          authority_state: payload.authority_state ?? "within_scope",
        } as Relation;
        return [relation, this.bump(project!, nextRevision, { project_revision: nextRevision })];
      }
      case "relation.supersede": {
        const relation = this.resolveInProject(command.project_id, payload.relation_ref) as Relation;
        this.ensureVersion(command, relation);
        return [this.bump(relation, nextRevision, { authority_state: "superseded", valid_to_revision: nextRevision }), this.bump(project!, nextRevision, { project_revision: nextRevision })];
      }
      case "annotation.add": {
        const anchor = this.resolveInProject(command.project_id, payload.anchor_ref);
        this.validateAnnotationAnchorRevision(command.project_id, anchor, payload.anchor_revision);
        const kind = payload.kind as AnnotationKind;
        if (payload.origin === "imported" && (kind === "directive" || kind === "decision")) throw new CommandError("authority", "Imported material must remain a non-binding draft");
        if ((kind === "directive" || kind === "decision") && !this.isOwner(command.project_id, command.actor)) {
          throw new CommandError("authority", `${kind} annotations require owner authority`);
        }
        const annotationAuthority: Provenance["authority"] = payload.origin === "imported" ? "imported" : kind === "directive" || kind === "decision" ? "owner-directive" : this.isOwner(command.project_id, command.actor) ? "owner-approved" : "agent-reported";
        const annotation = {
          ...this.base(command, nextRevision, "annotation", payload.id, kind, annotationAuthority),
          type: "annotation",
          provenance: { authority: annotationAuthority, actor: command.actor, source_refs: payload.source_refs ?? [] },
          body: payload.body,
          anchor_ref: entityRef(anchor),
          anchor_revision: payload.anchor_revision,
          kind,
          author: command.actor,
          state: payload.anchor_revision < anchor.valid_from_revision ? "stale" : "open",
          ...(payload.requested_action ? { requested_action: payload.requested_action } : {}),
          response_refs: [],
        } as Annotation;
        return [annotation, this.bump(project!, nextRevision, { project_revision: nextRevision })];
      }
      case "annotation.resolve":
      case "annotation.reanchor": {
        const annotation = this.resolveInProject(command.project_id, payload.annotation_ref) as Annotation;
        this.ensureVersion(command, annotation);
        if (command.type === "annotation.reanchor") this.validateAnnotationAnchorRevision(command.project_id, this.resolveInProject(command.project_id, annotation.anchor_ref), payload.anchor_revision);
        const canEdit = this.isOwner(command.project_id, command.actor) || annotation.author.principal_id === command.actor.principal_id;
        if (!canEdit) throw new CommandError("authority", "Only the author or owner can update an annotation");
        const changed = this.bump(annotation, nextRevision, command.type === "annotation.resolve"
          ? { state: "resolved", response_refs: payload.response_refs ?? annotation.response_refs }
          : { state: "reanchored", anchor_revision: payload.anchor_revision });
        return [changed, this.bump(project!, nextRevision, { project_revision: nextRevision })];
      }
      case "evidence.attach": {
        for (const ref of payload.target_refs ?? []) this.resolveInProject(command.project_id, ref);
        if (payload.origin === "owner-confirmed" && !this.isOwner(command.project_id, command.actor)) throw new CommandError("authority", "Only an owner can attach owner-confirmed evidence");
        const evidenceAuthority: Provenance["authority"] = payload.origin === "observed"
          ? "observed"
          : payload.origin === "owner-confirmed"
            ? "owner-approved"
            : payload.origin === "imported"
              ? "imported"
              : "agent-reported";
        const evidence = {
          ...this.base(command, nextRevision, "evidence", payload.id, payload.summary, evidenceAuthority),
          type: "evidence",
          target_refs: (payload.target_refs ?? []).map(withoutRevision),
          kind: payload.kind,
          origin: payload.origin,
          ref: payload.ref,
          summary: payload.summary,
          occurred_at: payload.occurred_at ?? command.occurred_at,
          recorded_at: this.now(),
          verification_state: payload.verification_state ?? "unverified",
          collector: command.actor,
        } as Evidence;
        return [evidence, this.bump(project!, nextRevision, { project_revision: nextRevision })];
      }
      case "hypothesis.record": {
        const evidenceRefs = (payload.evidence_refs ?? []).map((ref: string) => {
          const evidence = this.resolveInProject(command.project_id, ref);
          if (evidence.type !== "evidence") throw new CommandError("invalid", `Hypothesis evidence ref ${ref} is not Evidence`);
          return entityRef(evidence);
        });
        const hypothesis = {
          ...this.base(command, nextRevision, "hypothesis", payload.id, payload.statement, "agent-reported"),
          type: "hypothesis",
          statement: payload.statement,
          state: payload.state ?? "open",
          tests: payload.tests ?? [],
          evidence_refs: evidenceRefs,
          owner_or_worker: command.actor.principal_id,
          opened_at: this.now(),
        } as Hypothesis;
        return [hypothesis, this.bump(project!, nextRevision, { project_revision: nextRevision })];
      }
      case "claim.acquire": {
        if (!command.actor.capabilities.includes("claim")) throw new CommandError("capability", "Actor lacks claim capability");
        const target = this.resolveInProject(command.project_id, payload.target_ref);
        if (target.type !== "work" && target.type !== "lane") throw new CommandError("invalid", "Claims target work or lane objects");
        const claimTarget = target as WorkItem | Lane;
        const now = this.now();
        const activeClaims = (this.listEntities(command.project_id, "claim") as Claim[]).filter((claim) => !claim.released_at && instantIsAfter(claim.lease_until, now));
        const surfaces = payload.semantic_surfaces ?? claimTarget.semantic_surfaces;
        const repoSurfaces = payload.repo_surfaces ?? claimTarget.repo_surfaces;
        const mode = payload.mode ?? "primary";
        const leaseSeconds = Number(payload.lease_seconds ?? 900);
        if (!Number.isFinite(leaseSeconds) || leaseSeconds <= 0) throw new CommandError("invalid", "Claim lease must be a positive number of seconds");
        const overlap = activeClaims.find((claim) => claim.mode === "primary" && mode === "primary" && (
          claim.target_ref === entityRef(claimTarget) || claim.semantic_surfaces.some((surface) => surfaces.includes(surface))
        ));
        if (overlap) throw new CommandError("claim-conflict", `Primary surface is held by ${overlap.principal_id}`, entityRef(overlap), ["observe", "annotate", "request handoff", "wait for lease"]);
        const repoOverlapRefs = activeClaims.filter((claim) => claim.mode === "primary" && mode === "primary" && repoSurfacesOverlap(claim.repo_surfaces, repoSurfaces).length > 0).map((entity) => entityRef(entity));
        const changed: CanonicalEntity[] = [];
        const changedTargets = new Map<string, WorkItem | Lane>();
        for (const claim of this.listEntities(command.project_id, "claim") as Claim[]) {
          if (!claim.released_at && instantIsAtOrBefore(claim.lease_until, now)) {
            changed.push(this.bump(claim, nextRevision, { released_at: now }));
            if (claim.mode === "primary") {
              const expiredTarget = this.resolveInProject(command.project_id, claim.target_ref) as WorkItem | Lane;
              const changedTarget = changedTargets.get(entityRef(expiredTarget)) ?? this.bump(expiredTarget, nextRevision, {});
              if (changedTarget.type === "work" && changedTarget.current_claim_id === claim.id) delete changedTarget.current_claim_id;
              if (changedTarget.type === "lane" && changedTarget.claim_ref === entityRef(claim)) delete changedTarget.claim_ref;
              changedTargets.set(entityRef(expiredTarget), changedTarget);
            }
          }
        }
        const leaseUntil = new Date(instant(now) + leaseSeconds * 1000).toISOString();
        const claim = {
          ...this.base(command, nextRevision, "claim", payload.id, `Claim: ${claimTarget.title}`, "agent-reported"),
          type: "claim",
          target_ref: entityRef(claimTarget),
          principal_id: command.actor.principal_id,
          runtime_id: command.actor.runtime_id,
          device_id: command.actor.device_id,
          session_id: command.actor.session_id,
          mode,
          semantic_surfaces: surfaces,
          repo_surfaces: repoSurfaces,
          repo_overlap_refs: repoOverlapRefs,
          claimed_at: now,
          lease_until: leaseUntil,
          handoff_required: payload.handoff_required ?? true,
        } as Claim;
        changed.push(claim);
        if (mode === "primary") {
          const changedTarget = changedTargets.get(entityRef(claimTarget)) ?? this.bump(claimTarget, nextRevision, {});
          if (changedTarget.type === "work") changedTarget.current_claim_id = claim.id;
          else changedTarget.claim_ref = entityRef(claim);
          changedTargets.set(entityRef(claimTarget), changedTarget);
        }
        changed.push(...changedTargets.values());
        changed.push(this.bump(project!, nextRevision, { project_revision: nextRevision }));
        return changed;
      }
      case "claim.renew":
      case "claim.release":
      case "claim.force-release": {
        const claim = this.resolveInProject(command.project_id, payload.claim_ref) as Claim;
        this.ensureVersion(command, claim);
        const owns = claim.principal_id === command.actor.principal_id;
        if (command.type === "claim.renew" && !owns) throw new CommandError("authority", "Only the claimant can renew a claim");
        if (command.type === "claim.release" && !owns) throw new CommandError("authority", "Use owner-authorized force-release for another principal's claim");
        const claimTarget = this.resolveInProject(command.project_id, claim.target_ref) as WorkItem | Lane;
        if (command.type === "claim.renew") {
          const now = this.now();
          if (claim.released_at || instantIsAtOrBefore(claim.lease_until, now)) throw new CommandError("claim-conflict", "Claim lease has expired; acquire a fresh Claim", entityRef(claim), ["acquire claim"]);
          const leaseUntil = new Date(instant(now) + Number(payload.lease_seconds ?? 900) * 1000).toISOString();
          return [this.bump(claim, nextRevision, { lease_until: leaseUntil }), this.bump(project!, nextRevision, { project_revision: nextRevision })];
        }
        const changed: CanonicalEntity[] = [this.bump(claim, nextRevision, { released_at: this.now() })];
        if (claim.mode === "primary") {
          const changedTarget = this.bump(claimTarget, nextRevision, {});
          if (changedTarget.type === "work" && changedTarget.current_claim_id === claim.id) delete changedTarget.current_claim_id;
          if (changedTarget.type === "lane" && changedTarget.claim_ref === entityRef(claim)) delete changedTarget.claim_ref;
          changed.push(changedTarget);
        }
        changed.push(this.bump(project!, nextRevision, { project_revision: nextRevision }));
        return changed;
      }
      case "handoff.record": {
        const work = this.resolveInProject(command.project_id, payload.work_item_ref) as WorkItem;
        if (work.type !== "work") throw new CommandError("invalid", "Handoff target is not Work");
        if (!this.canCoordinate(command.project_id, command.actor)) this.requirePrimaryClaim(work, command.actor);
        const evidenceRefs = (payload.evidence_refs ?? []).map((ref: string) => {
          const evidence = this.store.getEntity(command.project_id, parseRef(ref).type, parseRef(ref).id);
          if (!evidence) throw new CommandError("not-found", `Handoff Evidence ${ref} does not exist`);
          if (evidence.type !== "evidence") throw new CommandError("invalid", `Handoff ref ${ref} is not Evidence`);
          if (parseRef(ref).projectId !== command.project_id || parseRef(ref).revision !== undefined) throw new CommandError("authority", `Handoff Evidence ${ref} crosses its authority domain`);
          return entityRef(evidence);
        });
        const handoffAuthority: Provenance["authority"] = this.isOwner(command.project_id, command.actor) ? "owner-approved" : this.canCoordinate(command.project_id, command.actor) ? "coordinator-approved" : "agent-reported";
        const handoff = {
          ...this.base(command, nextRevision, "handoff", payload.id, `Handoff: ${work.title}`, handoffAuthority),
          type: "handoff",
          work_item_ref: entityRef(work),
          from_actor: command.actor,
          ...(payload.to_actor ? { to_actor: payload.to_actor } : {}),
          as_of_revision: this.getProjectRevision(command.project_id),
          completed: payload.completed ?? [],
          current_state: payload.current_state,
          open_questions: payload.open_questions ?? [],
          blockers: payload.blockers ?? [],
          next_safe_action: payload.next_safe_action,
          evidence_refs: evidenceRefs,
          narrative: payload.narrative ?? "",
        } as Handoff;
        return [handoff, this.bump(work, nextRevision, { handoff_ref: entityRef(handoff) }), this.bump(project!, nextRevision, { project_revision: nextRevision })];
      }
      case "batch.create": {
        const parent = this.resolveInProject(command.project_id, payload.parent_work_item_ref) as WorkItem;
        if (parent.type !== "work") throw new CommandError("invalid", "Batch parent must be a work item");
        if (this.store.getEntity(command.project_id, "batch", payload.id)) throw new CommandError("invalid", `Batch ${payload.id} already exists`);
        if (!Array.isArray(payload.lanes) || payload.lanes.length === 0) throw new CommandError("invalid", "Batch requires at least one lane");
        const laneIds = payload.lanes.map((lane: Record<string, any>) => lane.id);
        if (laneIds.some((id: unknown) => typeof id !== "string" || id.length === 0) || new Set(laneIds).size !== laneIds.length) {
          throw new CommandError("invalid", "Batch lane IDs must be non-empty and unique");
        }
        for (const input of payload.lanes as Array<Record<string, any>>) {
          for (const ref of input.context_refs ?? []) this.resolveInProject(command.project_id, ref);
        }
        const batchRef = canonicalRef(command.project_id, "batch", payload.id);
        const lanes = payload.lanes.map((input: Record<string, any>) => ({
          ...this.base(command, nextRevision, "lane", input.id, input.title ?? input.outcome, "coordinator-approved"),
          type: "lane",
          batch_ref: batchRef,
          outcome: input.outcome,
          scope: input.scope,
          context_refs: input.context_refs ?? [],
          authority: input.authority,
          return_contract: input.return_contract,
          semantic_surfaces: input.semantic_surfaces ?? [],
          repo_surfaces: input.repo_surfaces ?? [],
          integration_state: "isolated",
        } as Lane));
        const batch = {
          ...this.base(command, nextRevision, "batch", payload.id, payload.title ?? `Batch: ${parent.title}`, "coordinator-approved"),
          type: "batch",
          parent_work_item_ref: entityRef(parent),
          coordinator: command.actor,
          lane_refs: lanes.map((entity) => entityRef(entity)),
          integration_state: "isolated",
        } as Batch;
        return [batch, ...lanes, this.bump(project!, nextRevision, { project_revision: nextRevision })];
      }
      case "lane.return": {
        const lane = this.resolveInProject(command.project_id, payload.lane_ref) as Lane;
        if (lane.type !== "lane") throw new CommandError("invalid", "Target is not a lane");
        this.ensureVersion(command, lane);
        const claim = this.requirePrimaryClaim(lane, command.actor);
        const batch = this.resolveInProject(command.project_id, lane.batch_ref) as Batch;
        const parent = this.resolveInProject(command.project_id, batch.parent_work_item_ref) as WorkItem;
        if (!payload.result_id || !payload.summary || !payload.evidence_ref) throw new CommandError("invalid", "Lane return requires result_id, summary, and evidence_ref");
        if (payload.verification_state === "verified" && !this.isOwner(command.project_id, command.actor)) throw new CommandError("authority", "A lane worker cannot self-verify its return evidence");
        const evidence = {
          ...this.base(command, nextRevision, "evidence", payload.result_id, payload.summary, "observed"),
          type: "evidence",
          target_refs: [entityRef(lane), entityRef(parent)],
          kind: "lane-result",
          origin: payload.origin ?? "observed",
          ref: payload.evidence_ref,
          summary: payload.summary,
          occurred_at: payload.occurred_at ?? command.occurred_at,
          recorded_at: this.now(),
          verification_state: payload.verification_state ?? "unverified",
          collector: command.actor,
        } as Evidence;
        const changedLane = this.bump(lane, nextRevision, { result_ref: entityRef(evidence), integration_state: "ready", returned_at: this.now() });
        delete changedLane.claim_ref;
        return [
          evidence,
          changedLane,
          this.bump(claim, nextRevision, { released_at: this.now() }),
          this.bump(batch, nextRevision, { integration_state: "needs-integration" }),
          this.bump(parent, nextRevision, { integration_state: "needs-integration" }),
          this.bump(project!, nextRevision, { project_revision: nextRevision }),
        ];
      }
      case "batch.integrate": {
        const batch = this.resolveInProject(command.project_id, payload.batch_ref) as Batch;
        if (batch.type !== "batch") throw new CommandError("invalid", "Target is not a batch");
        this.ensureVersion(command, batch);
        if (batch.integration_state === "integrated") throw new CommandError("transition", "Batch is already integrated");
        const lanes = batch.lane_refs.map((ref) => this.resolveInProject(command.project_id, ref) as Lane);
        const unready = lanes.filter((lane) => lane.integration_state !== "ready" && lane.integration_state !== "integrated");
        if (unready.length > 0 || lanes.some((lane) => !lane.result_ref)) {
          throw new CommandError("transition", `Batch has ${unready.length || lanes.filter((lane) => !lane.result_ref).length} lanes without return evidence`, entityRef(batch), ["collect lane returns", "inspect ready lanes"]);
        }
        const parent = this.resolveInProject(command.project_id, batch.parent_work_item_ref) as WorkItem;
        return [
          ...lanes.map((lane) => lane.integration_state === "integrated" ? lane : this.bump(lane, nextRevision, { integration_state: "integrated" })),
          this.bump(batch, nextRevision, { integration_state: "integrated", integrated_at: this.now() }),
          this.bump(parent, nextRevision, { integration_state: "integrated" }),
          this.bump(project!, nextRevision, { project_revision: nextRevision }),
        ];
      }
      default:
        throw new CommandError("invalid", `${command.type} is not implemented yet`);
    }
  }

  private requirePrimaryClaim(target: WorkItem | Lane, actor: ActorIdentity): Claim {
    const claimId = target.type === "work" ? target.current_claim_id : target.claim_ref ? parseRef(target.claim_ref).id : undefined;
    if (!claimId) throw new CommandError("claim-conflict", `${target.title} has no active primary claim`, entityRef(target), ["claim work"]);
    const claim = this.requireEntity(target.project_id, "claim", claimId) as Claim;
    if (claim.released_at || instantIsAtOrBefore(claim.lease_until, this.now())) throw new CommandError("claim-conflict", "Primary claim is stale", entityRef(claim), ["acquire claim"]);
    if (claim.principal_id !== actor.principal_id || claim.mode !== "primary") throw new CommandError("claim-conflict", `Primary writer is ${claim.principal_id}`, entityRef(claim), ["observe", "annotate", "request handoff"]);
    return claim;
  }

  private validateAnnotationAnchorRevision(projectId: string, anchor: CanonicalEntity, anchorRevision: number): void {
    const currentRevision = this.getProjectRevision(projectId);
    const firstRevision = this.listEvents(projectId).find((event) => ((event.payload.upserts ?? []) as CanonicalEntity[]).some((entity) => entity.type === anchor.type && entity.id === anchor.id))?.project_revision;
    if (!firstRevision || anchorRevision < firstRevision || anchorRevision > currentRevision) {
      throw new CommandError("invalid", `Annotation anchor revision must be between ${firstRevision ?? "the anchor's creation"} and current Project revision ${currentRevision}`, entityRef(anchor));
    }
  }

  private deriveWarnings(command: CommandEnvelope, changed: CanonicalEntity[]): CommandWarning[] {
    const warnings: CommandWarning[] = [];
    if (command.type === "batch.create") {
      const lanes = changed.filter((entity): entity is Lane => entity.type === "lane");
      for (let left = 0; left < lanes.length; left += 1) {
        for (let right = left + 1; right < lanes.length; right += 1) {
          const first = lanes[left]!;
          const second = lanes[right]!;
          const surfaces = repoSurfacesOverlap(first.repo_surfaces, second.repo_surfaces);
          if (surfaces.length > 0) warnings.push({
            code: "repo-surface-overlap",
            message: `${first.title} and ${second.title} touch overlapping repo surfaces; Git integration remains coordinator-owned`,
            entity_refs: [entityRef(first), entityRef(second)],
            surfaces,
          });
        }
      }
    }
    if (command.type === "claim.acquire") {
      const claim = changed.find((entity): entity is Claim => entity.type === "claim" && entity.id === (command.payload as Record<string, any>).id);
      if (claim) {
        for (const overlapRef of claim.repo_overlap_refs) {
          const other = this.resolve(overlapRef) as Claim;
          const surfaces = repoSurfacesOverlap(claim.repo_surfaces, other.repo_surfaces);
          warnings.push({
            code: "repo-surface-overlap",
            message: `${claim.principal_id} and ${other.principal_id} hold separate semantic claims that touch the same repo surface; coordinate Git integration`,
            entity_refs: [entityRef(claim), entityRef(other)],
            surfaces,
          });
        }
      }
    }
    return warnings;
  }

  private staleAnchoredAnnotations(projectId: string, nextRevision: number, changed: CanonicalEntity[]): Annotation[] {
    const changedRefs = new Set(changed.filter((entity) => entity.type !== "annotation" && entity.type !== "project").map((entity) => entityRef(entity)));
    const changedAnnotationIds = new Set(changed.filter((entity) => entity.type === "annotation").map((entity) => entity.id));
    if (changedRefs.size === 0) return [];
    return (this.listEntities(projectId, "annotation") as Annotation[])
      .filter((annotation) => !changedAnnotationIds.has(annotation.id) && (annotation.state === "open" || annotation.state === "reanchored") && changedRefs.has(annotation.anchor_ref))
      .map((annotation) => this.bump(annotation, nextRevision, { state: "stale" }));
  }

  deriveAttentionRefs(projectId: string): string[] {
    return this.attentionFrom(this.listEntities(projectId));
  }

  private deriveAttentionRefsFromOverlay(projectId: string, changed: CanonicalEntity[]): string[] {
    const overlay = new Map(this.listEntities(projectId).map((entity) => [`${entity.type}:${entity.id}`, entity]));
    for (const entity of changed) overlay.set(`${entity.type}:${entity.id}`, entity);
    return this.attentionFrom([...overlay.values()]);
  }

  private attentionFrom(entities: CanonicalEntity[]): string[] {
    const now = this.now();
    return entities.flatMap((entity) => {
      if (entity.type === "goal" && entity.approval === "proposed") return [entityRef(entity)];
      if (entity.type === "decision" && entity.decision_state === "proposed") return [entityRef(entity)];
      if (entity.type === "work" && (
        entity.work_state === "blocked" || entity.authority_state === "owner_pending" ||
        entity.goal_integrity === "diverges" || entity.goal_integrity === "authority-unclear" ||
        entity.integration_state === "needs-integration"
      )) return [entityRef(entity)];
      if (entity.type === "batch" && entity.integration_state === "needs-integration") return [entityRef(entity)];
      if (entity.type === "lane" && entity.integration_state === "ready") return [entityRef(entity)];
      if (entity.type === "claim" && !entity.released_at && (
        instantIsAtOrBefore(entity.lease_until, now) || entities.some((candidate) => candidate.type === "claim" && candidate.id !== entity.id && !candidate.released_at && instantIsAfter(candidate.lease_until, now) && candidate.mode === "primary" && entity.mode === "primary" && repoSurfacesOverlap(candidate.repo_surfaces, entity.repo_surfaces).length > 0)
      )) return [entityRef(entity)];
      if (entity.type === "annotation" && (entity.state === "stale" || (["open", "reanchored"].includes(entity.state) && ["question", "concern", "directive"].includes(entity.kind)))) return [entityRef(entity)];
      return [];
    }).sort();
  }
}

function repoSurfacesOverlap(first: string[], second: string[]): string[] {
  return [...new Set(first.flatMap((left) => second.filter((right) => left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)).map((right) => left.length <= right.length ? left : right)))].sort();
}

function normalizedClock(clock: () => string): () => string {
  return () => normalizeInstant(clock());
}

function isResolvedForCompaction(work: WorkItem): boolean {
  if (work.authority_state === "superseded") return true;
  const authorityResolved = work.authority_state === "within_scope" || work.authority_state === "approved";
  const goalResolved = work.goal_integrity === "advances" || work.goal_integrity === "research-only";
  const completionResolved = work.work_state === "closed" || (work.work_state === "implemented" && work.evidence_state === "verified" && work.integration_state === "integrated");
  return authorityResolved && goalResolved && completionResolved;
}

const canonicalEntityTypes = new Set<EntityType>(["project", "goal", "epoch", "work", "relation", "decision", "hypothesis", "claim", "evidence", "annotation", "handoff", "batch", "lane"]);

function validateCanonicalEntityShape(entity: CanonicalEntity, projectId: string, expectedRevision: number): void {
  if (!record(entity) || !canonicalEntityTypes.has(entity.type) || !nonEmptyString(entity.id) || entity.project_id !== projectId) {
    throw new Error("Project export event upsert violates its authority domain or canonical identity");
  }
  if (!Number.isInteger(entity.entity_version) || entity.entity_version < 1 || entity.valid_from_revision !== expectedRevision) {
    throw new Error("Project export event upsert violates its entity version or revision");
  }
  if (!nonEmptyString(entity.title) || !stringArray(entity.aliases) || !nonEmptyString(entity.created_at) || !nonEmptyString(entity.updated_at) || !record(entity.provenance) || !record(entity.provenance.actor) || !stringArray(entity.provenance.source_refs)) {
    throw new Error(`Project export contains malformed canonical entity ${entity.type}:${entity.id}`);
  }
  if (!Number.isFinite(Date.parse(entity.created_at)) || !Number.isFinite(Date.parse(entity.updated_at))) throw new Error(`Project export contains invalid canonical timestamps for ${entity.type}:${entity.id}`);
  switch (entity.type) {
    case "project":
      if (ownerPolicyProblem(entity.owner_policy) || !Number.isInteger(entity.owner_policy_version) || entity.owner_policy_version < 1 || entity.project_revision !== expectedRevision) {
        throw new Error("Project export contains a schema-invalid Project authority record");
      }
      break;
    case "goal":
      if (!Number.isInteger(entity.revision_number) || !["approved", "proposed", "superseded"].includes(entity.approval) || !Array.isArray(entity.approval_records)) throw new Error(`Project export contains malformed Goal ${entity.id}`);
      break;
    case "epoch":
      if (!nonEmptyString(entity.goal_revision_id) || !["active", "frozen", "archived"].includes(entity.state)) throw new Error(`Project export contains malformed Epoch ${entity.id}`);
      break;
    case "work":
      if (!nonEmptyString(entity.epoch_id) || !workStates.has(entity.work_state) || !evidenceStates.has(entity.evidence_state) || !workAuthorityStates.has(entity.authority_state) || !goalIntegrityStates.has(entity.goal_integrity) || !integrationStates.has(entity.integration_state)) throw new Error(`Project export contains malformed Work ${entity.id}`);
      break;
    case "relation":
      if (!nonEmptyString(entity.source_ref) || !nonEmptyString(entity.target_ref) || !nonEmptyString(entity.relation_type)) throw new Error(`Project export contains malformed Relation ${entity.id}`);
      break;
    case "decision":
      if (!["proposed", "approved", "rejected", "superseded"].includes(entity.decision_state) || !Array.isArray(entity.approval_records)) throw new Error(`Project export contains malformed Decision ${entity.id}`);
      break;
    case "claim":
      if (!nonEmptyString(entity.target_ref) || !claimModes.has(entity.mode) || !nonEmptyString(entity.lease_until)) throw new Error(`Project export contains malformed Claim ${entity.id}`);
      break;
    case "evidence":
      if (!stringArray(entity.target_refs) || !evidenceOrigins.has(entity.origin) || !verificationStates.has(entity.verification_state)) throw new Error(`Project export contains malformed Evidence ${entity.id}`);
      break;
    case "annotation":
      if (!nonEmptyString(entity.anchor_ref) || !Number.isInteger(entity.anchor_revision) || entity.anchor_revision < 1 || !annotationKinds.has(entity.kind) || !["open", "resolved", "stale", "reanchored"].includes(entity.state)) throw new Error(`Project export contains malformed Annotation ${entity.id}`);
      break;
    case "handoff":
      if (!nonEmptyString(entity.work_item_ref) || !stringArray(entity.evidence_refs) || !Number.isInteger(entity.as_of_revision)) throw new Error(`Project export contains malformed Handoff ${entity.id}`);
      break;
    case "batch":
      if (!nonEmptyString(entity.parent_work_item_ref) || !stringArray(entity.lane_refs) || !integrationStates.has(entity.integration_state)) throw new Error(`Project export contains malformed Batch ${entity.id}`);
      break;
    case "lane":
      if (!nonEmptyString(entity.batch_ref) || !stringArray(entity.context_refs) || !integrationStates.has(entity.integration_state)) throw new Error(`Project export contains malformed Lane ${entity.id}`);
      break;
    case "hypothesis":
      if (!hypothesisStates.has(entity.state) || !stringArray(entity.evidence_refs)) throw new Error(`Project export contains malformed Hypothesis ${entity.id}`);
      break;
  }
}

function validateCanonicalGraph(entities: Map<string, CanonicalEntity>, projectId: string, revision: number, evaluatedAt: string): void {
  const local = (ref: string, expected: EntityType | EntityType[], label: string): CanonicalEntity => {
    const parsed = parseRef(ref);
    if (parsed.revision !== undefined || parsed.projectId !== projectId) throw new Error(`Project export ${label} crosses its authority domain`);
    const entity = entities.get(`${parsed.type}:${parsed.id}`);
    const expectedTypes = Array.isArray(expected) ? expected : [expected];
    if (!entity || !expectedTypes.includes(entity.type)) throw new Error(`Project export ${label} references missing ${expectedTypes.join("/")} ${parsed.id}`);
    return entity;
  };
  const project = entities.get(`project:${projectId}`);
  if (!project || project.type !== "project" || project.project_revision !== revision) throw new Error("Project export replay has no matching Project revision");
  if (!Number.isFinite(Date.parse(evaluatedAt))) throw new Error("Project export graph evaluation time is invalid");
  const approvedGoals = [...entities.values()].filter((entity): entity is GoalRevision => entity.type === "goal" && entity.approval === "approved");
  if (project.current_goal_revision_id) {
    const goal = entities.get(`goal:${project.current_goal_revision_id}`);
    if (!goal || goal.type !== "goal" || goal.approval !== "approved") throw new Error("Project export current Goal is missing or not the approved current Goal");
    if (approvedGoals.length !== 1 || approvedGoals[0]!.id !== goal.id) throw new Error("Project export must have exactly one approved current Goal");
  } else if (approvedGoals.length > 0) throw new Error("Project export has an approved Goal without Project.current_goal_revision_id");

  const activeEpochs = [...entities.values()].filter((entity): entity is Epoch => entity.type === "epoch" && entity.state === "active");
  if (activeEpochs.length > 1) throw new Error("Project export contains multiple active Epochs");
  if (activeEpochs.length === 1 && project.current_epoch_id !== activeEpochs[0]!.id) throw new Error("Project export active Epoch does not match Project.current_epoch_id");
  if (activeEpochs.length === 0 && project.current_epoch_id !== undefined) throw new Error("Project export current Epoch pointer must be absent when no Epoch is active");
  if (activeEpochs.length === 1 && activeEpochs[0]!.goal_revision_id !== project.current_goal_revision_id) throw new Error("Project export active Epoch does not use the current approved Goal");

  const activePrimaryClaims = [...entities.values()].filter((entity): entity is Claim => entity.type === "claim" && entity.mode === "primary" && !entity.released_at && instantIsAfter(entity.lease_until, evaluatedAt));

  for (const entity of entities.values()) {
    switch (entity.type) {
      case "project":
        break;
      case "goal":
        if (entity.supersedes_goal_revision_id && !entities.has(`goal:${entity.supersedes_goal_revision_id}`)) throw new Error(`Project export Goal ${entity.id} supersedes a missing Goal`);
        break;
      case "epoch": {
        const goal = entities.get(`goal:${entity.goal_revision_id}`);
        if (!goal || goal.type !== "goal" || goal.approval === "proposed") throw new Error(`Project export Epoch ${entity.id} references a missing or unapproved Goal`);
        if (entity.compaction_receipt_ref) local(entity.compaction_receipt_ref, "evidence", `Epoch ${entity.id} compaction receipt`);
        break;
      }
      case "work": {
        const epoch = entities.get(`epoch:${entity.epoch_id}`);
        if (!epoch || epoch.type !== "epoch") throw new Error(`Project export Work ${entity.id} references a missing Epoch`);
        if (entity.parent_id) {
          const parent = entities.get(`work:${entity.parent_id}`);
          if (!parent || parent.type !== "work") throw new Error(`Project export Work ${entity.id} references a missing parent`);
          if (parent.epoch_id !== entity.epoch_id) throw new Error(`Project export Work ${entity.id} parent belongs to another Epoch`);
        }
        if (entity.current_claim_id) {
          const claim = entities.get(`claim:${entity.current_claim_id}`);
          if (!claim || claim.type !== "claim" || claim.mode !== "primary" || claim.released_at || claim.target_ref !== entityRef(entity)) throw new Error(`Project export Work ${entity.id} has an invalid primary Claim pointer`);
        }
        if (entity.handoff_ref) {
          const handoff = local(entity.handoff_ref, "handoff", `Work ${entity.id} Handoff`);
          if ((handoff as Handoff).work_item_ref !== entityRef(entity)) throw new Error(`Project export Work ${entity.id} Handoff targets another Work`);
        }
        break;
      }
      case "relation": {
        const source = parseRef(entity.source_ref);
        const target = parseRef(entity.target_ref);
        if (source.revision !== undefined || target.revision !== undefined) throw new Error(`Project export Relation ${entity.id} has revision-qualified endpoints`);
        const localEndpoints = [source, target].filter((endpoint) => endpoint.projectId === projectId);
        if (localEndpoints.length === 0) throw new Error(`Project export Relation ${entity.id} is detached from its authority domain`);
        for (const endpoint of localEndpoints) if (!entities.has(`${endpoint.type}:${endpoint.id}`)) throw new Error(`Project export Relation ${entity.id} references a missing endpoint`);
        break;
      }
      case "decision":
        if (entity.authorizes?.target_ref) {
          const target = parseRef(entity.authorizes.target_ref);
          if (target.revision !== undefined || target.projectId !== projectId) throw new Error(`Project export Decision ${entity.id} authorization crosses its authority domain`);
        }
        break;
      case "hypothesis":
        for (const ref of entity.evidence_refs) local(ref, "evidence", `Hypothesis ${entity.id} evidence`);
        break;
      case "claim":
        local(entity.target_ref, ["work", "lane"], `Claim ${entity.id} target`);
        break;
      case "evidence":
        for (const ref of entity.target_refs) local(ref, [...canonicalEntityTypes], `Evidence ${entity.id} target`);
        break;
      case "annotation":
        local(entity.anchor_ref, [...canonicalEntityTypes], `Annotation ${entity.id} anchor`);
        if (entity.anchor_revision > revision) throw new Error(`Project export Annotation ${entity.id} anchors a future revision`);
        break;
      case "handoff":
        local(entity.work_item_ref, "work", `Handoff ${entity.id} Work`);
        for (const ref of entity.evidence_refs) local(ref, "evidence", `Handoff ${entity.id} evidence`);
        break;
      case "batch": {
        local(entity.parent_work_item_ref, "work", `Batch ${entity.id} parent`);
        for (const ref of entity.lane_refs) {
          const lane = local(ref, "lane", `Batch ${entity.id} Lane`) as Lane;
          if (lane.batch_ref !== entityRef(entity)) throw new Error(`Project export Batch ${entity.id} contains a Lane owned by another Batch`);
        }
        break;
      }
      case "lane":
        local(entity.batch_ref, "batch", `Lane ${entity.id} Batch`);
        for (const ref of entity.context_refs) local(ref, [...canonicalEntityTypes], `Lane ${entity.id} context`);
        if (entity.result_ref) local(entity.result_ref, "evidence", `Lane ${entity.id} result`);
        if (entity.claim_ref) {
          const claim = local(entity.claim_ref, "claim", `Lane ${entity.id} Claim`) as Claim;
          if (claim.mode !== "primary" || claim.released_at || claim.target_ref !== entityRef(entity)) throw new Error(`Project export Lane ${entity.id} has an invalid primary Claim pointer`);
        }
        break;
    }
  }

  for (const claim of activePrimaryClaims) {
    const target = local(claim.target_ref, ["work", "lane"], `active primary Claim ${claim.id} target`) as WorkItem | Lane;
    const pointer = target.type === "work" ? target.current_claim_id : target.claim_ref ? parseRef(target.claim_ref).id : undefined;
    if (pointer !== claim.id) throw new Error(`Project export active primary Claim ${claim.id} is not the target's current pointer`);
  }
  for (let left = 0; left < activePrimaryClaims.length; left += 1) {
    for (let right = left + 1; right < activePrimaryClaims.length; right += 1) {
      const first = activePrimaryClaims[left]!;
      const second = activePrimaryClaims[right]!;
      if (first.target_ref === second.target_ref || first.semantic_surfaces.some((surface) => second.semantic_surfaces.includes(surface))) {
        throw new Error(`Project export contains overlapping active primary Claims ${first.id} and ${second.id}`);
      }
    }
  }

  const workById = new Map([...entities.values()].filter((entity): entity is WorkItem => entity.type === "work").map((work) => [work.id, work]));
  for (const work of workById.values()) {
    const seen = new Set([work.id]);
    let cursor = work;
    while (cursor.parent_id) {
      if (seen.has(cursor.parent_id)) throw new Error(`Project export Work parent graph contains a cycle at ${cursor.parent_id}`);
      seen.add(cursor.parent_id);
      cursor = workById.get(cursor.parent_id)!;
    }
  }
}

function ownerPolicyProblem(policy: Project["owner_policy"] | undefined): string | undefined {
  if (!policy || !Array.isArray(policy.owners) || policy.owners.length === 0 || !policy.owners.every(nonEmptyString)) return "Owner policy requires at least one valid owner";
  if (new Set(policy.owners).size !== policy.owners.length) return "Owner policy contains duplicate owners";
  if (!(["any-one", "all", "threshold"] as string[]).includes(policy.approval)) return "Unknown owner approval policy";
  if (policy.approval === "threshold") {
    if (!Number.isInteger(policy.threshold) || policy.threshold! < 1 || policy.threshold! > policy.owners.length) return "Owner approval threshold must be between one and the owner count";
  } else if (policy.threshold !== undefined) return "Owner approval threshold is only valid for threshold policies";
  return undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function commandPayloadDigest(payload: Record<string, unknown>): string {
  const normalized = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "approval_decision_ref"));
  return createHash("sha256").update(stableJson(normalized)).digest("hex");
}

function commandDigest(command: CommandEnvelope): string {
  return createHash("sha256").update(stableJson(command)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function record(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
