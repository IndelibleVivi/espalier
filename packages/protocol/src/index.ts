export const SCHEMA_VERSION = 4;
export const PROTOCOL_VERSION = "0.2";

export type ActorRole = "owner" | "collaborator" | "coordinator" | "worker" | "observer";
export type Capability = "read" | "write" | "claim" | "evidence" | "owner-update" | "coordinate";

export interface ActorIdentity {
  principal_id: string;
  runtime_id: string;
  device_id: string;
  session_id: string;
  role: ActorRole;
  capabilities: Capability[];
}

export type AuthorityState =
  | "owner-approved"
  | "owner-directive"
  | "coordinator-approved"
  | "agent-proposed"
  | "agent-reported"
  | "observed"
  | "imported"
  | "authority-unclear"
  | "superseded";

export interface Provenance {
  authority: AuthorityState;
  actor: ActorIdentity;
  source_refs: string[];
}

export type EntityType =
  | "project"
  | "goal"
  | "epoch"
  | "work"
  | "relation"
  | "decision"
  | "hypothesis"
  | "claim"
  | "evidence"
  | "annotation"
  | "handoff"
  | "batch"
  | "lane";

export interface BaseEntity {
  id: string;
  project_id: string;
  type: EntityType;
  title: string;
  body?: string;
  aliases: string[];
  provenance: Provenance;
  created_at: string;
  updated_at: string;
  entity_version: number;
  valid_from_revision: number;
  valid_to_revision?: number;
  supersedes_ref?: string;
}

export interface OwnerPolicy {
  owners: string[];
  approval: "any-one" | "all" | "threshold";
  threshold?: number;
}

export interface OwnerApproval {
  principal_id: string;
  action: "approve" | "reject" | "supersede";
  recorded_at: string;
  source_refs: string[];
}

export interface Project extends BaseEntity {
  type: "project";
  display_name: string;
  authority_domain: string;
  repository_refs: string[];
  current_goal_revision_id?: string;
  current_epoch_id?: string;
  status: "active" | "frozen" | "archived";
  owner_policy: OwnerPolicy;
  owner_policy_version: number;
  project_revision: number;
}

export interface GoalRevision extends BaseEntity {
  type: "goal";
  revision_number: number;
  purpose: string;
  present_consumers: string[];
  programme_order: string[];
  binding_constraints: string[];
  trust_boundaries: string[];
  explicit_non_goals: string[];
  source_refs: string[];
  approval: "approved" | "proposed" | "superseded";
  approval_records: OwnerApproval[];
  supersedes_goal_revision_id?: string;
  approved_at?: string;
}

export interface Epoch extends BaseEntity {
  type: "epoch";
  goal_revision_id: string;
  baseline_ref: string;
  state: "active" | "frozen" | "archived";
  opened_at: string;
  closed_at?: string;
  compaction_receipt_ref?: string;
}

export type WorkKind = "workstream" | "task" | "investigation" | "integration" | "milestone";
export type WorkState = "proposed" | "active" | "blocked" | "implemented" | "closed";
export type EvidenceState = "none" | "partial" | "tested" | "verified";
export type WorkAuthorityState = "within_scope" | "proposal" | "owner_pending" | "approved" | "superseded";
export type GoalIntegrity = "advances" | "research-only" | "diverges" | "authority-unclear";
export type IntegrationState = "isolated" | "ready" | "needs-integration" | "integrated";

export interface WorkItem extends BaseEntity {
  type: "work";
  epoch_id: string;
  parent_id?: string;
  kind: WorkKind;
  scope: string;
  semantic_surfaces: string[];
  repo_surfaces: string[];
  priority: number;
  work_state: WorkState;
  evidence_state: EvidenceState;
  authority_state: WorkAuthorityState;
  goal_integrity: GoalIntegrity;
  integration_state: IntegrationState;
  verification_policy: string;
  verification_evidence_refs?: string[];
  verification_rationale?: string;
  current_claim_id?: string;
  owner_refs: string[];
  handoff_ref?: string;
}

export const RELATION_TYPES = [
  "contains",
  "depends_on",
  "blocks",
  "implements",
  "changes",
  "verifies",
  "supersedes",
  "provides_capability_to",
  "shares_contract_with",
  "exports_snapshot_to",
  "observes",
  "relates_to",
] as const;
export type RelationType = (typeof RELATION_TYPES)[number] | `${string}:${string}`;

export interface Relation extends BaseEntity {
  type: "relation";
  source_ref: string;
  target_ref: string;
  relation_type: RelationType;
  authority_state: WorkAuthorityState;
}

export interface Decision extends BaseEntity {
  type: "decision";
  question: string;
  proposal: string;
  decision_state: "proposed" | "approved" | "rejected" | "superseded";
  authority: AuthorityState;
  scope: string;
  rationale: string;
  source_refs: string[];
  approval_records: OwnerApproval[];
  authorizes?: {
    command_type: CommandType;
    target_ref?: string;
    payload_digest: string;
    owner_policy_version: number;
    max_uses: 1;
  };
  consumed_by_command_id?: string;
  consumed_at?: string;
  decided_at?: string;
  supersedes_decision_id?: string;
}

export interface Hypothesis extends BaseEntity {
  type: "hypothesis";
  statement: string;
  state: "open" | "supported" | "rejected" | "inconclusive";
  tests: string[];
  evidence_refs: string[];
  owner_or_worker: string;
  opened_at: string;
  resolved_at?: string;
}

export interface Claim extends BaseEntity {
  type: "claim";
  target_ref: string;
  principal_id: string;
  runtime_id: string;
  device_id: string;
  session_id: string;
  mode: "primary" | "coordinator" | "observer";
  semantic_surfaces: string[];
  repo_surfaces: string[];
  repo_overlap_refs: string[];
  claimed_at: string;
  lease_until: string;
  released_at?: string;
  handoff_required: boolean;
}

export interface Evidence extends BaseEntity {
  type: "evidence";
  target_refs: string[];
  kind: string;
  origin: "observed" | "reported" | "owner-confirmed" | "imported";
  ref: string;
  summary: string;
  occurred_at: string;
  recorded_at: string;
  verification_state: "unverified" | "verified" | "rejected";
  collector: ActorIdentity;
}

export type AnnotationKind = "note" | "question" | "concern" | "correction" | "proposal" | "directive" | "decision";
export interface Annotation extends BaseEntity {
  type: "annotation";
  anchor_ref: string;
  anchor_revision: number;
  kind: AnnotationKind;
  author: ActorIdentity;
  state: "open" | "resolved" | "stale" | "reanchored";
  requested_action?: string;
  response_refs: string[];
}

export interface Handoff extends BaseEntity {
  type: "handoff";
  work_item_ref: string;
  from_actor: ActorIdentity;
  to_actor?: string;
  as_of_revision: number;
  completed: string[];
  current_state: string;
  open_questions: string[];
  blockers: string[];
  next_safe_action: string;
  evidence_refs: string[];
  narrative: string;
}

export interface Batch extends BaseEntity {
  type: "batch";
  parent_work_item_ref: string;
  coordinator: ActorIdentity;
  lane_refs: string[];
  integration_state: IntegrationState;
  integrated_at?: string;
}

export interface Lane extends BaseEntity {
  type: "lane";
  batch_ref: string;
  outcome: string;
  scope: string;
  context_refs: string[];
  authority: string;
  return_contract: string;
  semantic_surfaces: string[];
  repo_surfaces: string[];
  claim_ref?: string;
  result_ref?: string;
  integration_state: IntegrationState;
  returned_at?: string;
}

export type CanonicalEntity =
  | Project
  | GoalRevision
  | Epoch
  | WorkItem
  | Relation
  | Decision
  | Hypothesis
  | Claim
  | Evidence
  | Annotation
  | Handoff
  | Batch
  | Lane;

export const COMMAND_TYPES = [
  "project.create",
  "project.owner-policy.update",
  "goal.approve",
  "goal.propose",
  "epoch.open",
  "epoch.freeze",
  "epoch.archive",
  "work.create",
  "work.transition",
  "work.verify",
  "work.authority.resolve",
  "relation.create",
  "relation.supersede",
  "decision.propose",
  "decision.resolve",
  "hypothesis.record",
  "evidence.attach",
  "annotation.add",
  "annotation.resolve",
  "annotation.reanchor",
  "claim.acquire",
  "claim.renew",
  "claim.release",
  "claim.force-release",
  "handoff.record",
  "batch.create",
  "lane.return",
  "batch.integrate",
  "epoch.compact",
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export interface CapabilityManifest {
  schema_version: number;
  protocol_version: string;
  compatible_protocol_versions: string[];
  commands: CommandType[];
  projections: Array<"human-surface" | "live" | "focus" | "decisions" | "atlas" | "portfolio">;
  transports: Array<"http-json" | "sse">;
  features: string[];
  deployment_boundary: "localhost-local-token";
}

export interface SearchHit {
  project_id: string;
  type: EntityType;
  id: string;
  ref: string;
  title: string;
  excerpt: string;
  rank: number;
}

export interface ProjectExport {
  format: "espalier.project-export/1";
  schema_version: number;
  protocol_version: string;
  exported_at: string;
  project_id: string;
  project_revision: number;
  entities: CanonicalEntity[];
  events: StoredEvent[];
  command_receipts: CommandReceipt[];
  command_fingerprints: Record<string, string>;
  attachments_manifest: Array<{ ref: string; media_type?: string; byte_length?: number }>;
}

export interface DcaSnapshot {
  format: "espalier.dca-snapshot/1";
  project_id: string;
  source_revision: number;
  focus_ref?: string;
  nodes: Array<{ ref: string; type: EntityType; title: string; state: Record<string, string> }>;
  edges: Array<{ ref: string; source_ref: string; target_ref: string; relation_type: RelationType; authority_state: WorkAuthorityState }>;
}

export interface CommandWarning {
  code: "repo-surface-overlap";
  message: string;
  entity_refs: string[];
  surfaces: string[];
}

export interface CommandEnvelope<TPayload = Record<string, unknown>> {
  command_id: string;
  project_id: string;
  actor: ActorIdentity;
  base_project_revision: number;
  base_entity_versions: Record<string, number>;
  type: CommandType;
  occurred_at: string;
  payload: TPayload;
}

export interface AcceptedReceipt {
  accepted: true;
  command_id: string;
  project_id: string;
  new_project_revision: number;
  changed_entity_versions: Record<string, number>;
  emitted_event_ids: string[];
  attention_changes: { opened: string[]; resolved: string[] };
  next_brief_hint?: string;
  warnings?: CommandWarning[];
  idempotent_replay?: boolean;
}

export interface RejectedReceipt {
  accepted: false;
  command_id: string;
  project_id: string;
  reason: string;
  code: "invalid" | "not-found" | "authority" | "capability" | "stale" | "claim-conflict" | "transition";
  current_project_revision: number;
  stale_entity?: string;
  intervening_delta: string[];
  recovery: string[];
}
export type CommandReceipt = AcceptedReceipt | RejectedReceipt;

export interface StoredEvent {
  event_sequence: number;
  event_id: string;
  command_id: string;
  project_id: string;
  project_revision: number;
  type: string;
  occurred_at: string;
  recorded_at: string;
  entity_ref?: string;
  payload: Record<string, unknown>;
}
