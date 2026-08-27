import { backup, DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION, type CanonicalEntity, type CommandReceipt, type EntityType, type ProjectExport, type SearchHit, type StoredEvent } from "@espalier/protocol";

interface RevisionRow { revision: number }
interface JsonRow { state_json: string }
interface ReceiptRow { receipt_json: string }
interface CommandRow extends ReceiptRow { command_fingerprint: string | null }
interface CommandFingerprintRow { command_id: string; command_fingerprint: string | null }
interface SearchRow { project_id: string; type: EntityType; id: string; ref: string; title: string; excerpt: string; rank: number }
interface EventRow {
  event_sequence: number;
  event_id: string;
  command_id: string;
  project_id: string;
  project_revision: number;
  type: string;
  occurred_at: string;
  recorded_at: string;
  entity_ref: string | null;
  payload_json: string;
}

export class StoreConflictError extends Error {}

export class SqliteStore {
  readonly database: DatabaseSync;

  constructor(filename: string) {
    this.database = new DatabaseSync(filename);
    try {
      this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
      const existingTables = this.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as unknown as Array<{ name: string }>;
      const hasMeta = existingTables.some((table) => table.name === "meta");
      if (hasMeta) {
        const schema = this.database.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value?: string } | undefined;
        const schemaVersion = Number(schema?.value);
        if (!Number.isInteger(schemaVersion)) throw new Error("Espalier database has no valid schema version");
        if (schemaVersion < SCHEMA_VERSION) throw new Error(`Schema ${schemaVersion} requires an explicit migration to schema ${SCHEMA_VERSION}; automatic relabelling is refused`);
        if (schemaVersion > SCHEMA_VERSION) throw new Error(`Schema ${schemaVersion} is newer than supported schema ${SCHEMA_VERSION}`);
      } else if (existingTables.length > 0) {
        throw new Error("Existing database has no Espalier schema metadata; explicit migration is required");
      }

      this.database.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_revisions (
        project_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entities (
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        id TEXT NOT NULL,
        entity_version INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        PRIMARY KEY (project_id, type, id)
      );
      CREATE INDEX IF NOT EXISTS entities_project_type ON entities(project_id, type);
      CREATE TABLE IF NOT EXISTS events (
        event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        command_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        project_revision INTEGER NOT NULL,
        type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        entity_ref TEXT,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_project_revision ON events(project_id, project_revision);
      CREATE UNIQUE INDEX IF NOT EXISTS events_project_revision_unique ON events(project_id, project_revision);
      CREATE TABLE IF NOT EXISTS commands (
        command_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        command_fingerprint TEXT
      );
      CREATE INDEX IF NOT EXISTS commands_project ON commands(project_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS entity_search USING fts5(
        project_id UNINDEXED,
        type UNINDEXED,
        id UNINDEXED,
        ref UNINDEXED,
        title,
        aliases,
        body,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      `);
      this.database.prepare("INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
      const commandColumns = this.database.prepare("PRAGMA table_info(commands)").all() as unknown as Array<{ name: string }>;
      if (!commandColumns.some((column) => column.name === "command_fingerprint")) {
        throw new Error(`Schema ${SCHEMA_VERSION} commands table is missing command_fingerprint`);
      }
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  getProjectRevision(projectId: string): number {
    const row = this.database.prepare("SELECT revision FROM project_revisions WHERE project_id = ?").get(projectId) as RevisionRow | undefined;
    return row?.revision ?? 0;
  }

  getEntity(projectId: string, type: EntityType, id: string): CanonicalEntity | undefined {
    const row = this.database.prepare("SELECT state_json FROM entities WHERE project_id = ? AND type = ? AND id = ?").get(projectId, type, id) as JsonRow | undefined;
    return row ? JSON.parse(row.state_json) as CanonicalEntity : undefined;
  }

  listEntities(projectId: string, type?: EntityType): CanonicalEntity[] {
    const rows = (type
      ? this.database.prepare("SELECT state_json FROM entities WHERE project_id = ? AND type = ? ORDER BY id").all(projectId, type)
      : this.database.prepare("SELECT state_json FROM entities WHERE project_id = ? ORDER BY type, id").all(projectId)) as unknown as JsonRow[];
    return rows.map((row) => JSON.parse(row.state_json) as CanonicalEntity);
  }

  listProjects(): CanonicalEntity[] {
    const rows = this.database.prepare("SELECT state_json FROM entities WHERE type = 'project' ORDER BY id").all() as unknown as JsonRow[];
    return rows.map((row) => JSON.parse(row.state_json) as CanonicalEntity);
  }

  listEvents(projectId: string, sinceRevision = 0): StoredEvent[] {
    const rows = this.database.prepare("SELECT * FROM events WHERE project_id = ? AND project_revision > ? ORDER BY event_sequence").all(projectId, sinceRevision) as unknown as EventRow[];
    return rows.map((row) => ({
      event_sequence: row.event_sequence,
      event_id: row.event_id,
      command_id: row.command_id,
      project_id: row.project_id,
      project_revision: row.project_revision,
      type: row.type,
      occurred_at: row.occurred_at,
      recorded_at: row.recorded_at,
      ...(row.entity_ref ? { entity_ref: row.entity_ref } : {}),
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    }));
  }

  getReceipt(commandId: string): CommandReceipt | undefined {
    const row = this.database.prepare("SELECT receipt_json FROM commands WHERE command_id = ?").get(commandId) as ReceiptRow | undefined;
    return row ? JSON.parse(row.receipt_json) as CommandReceipt : undefined;
  }

  getCommandFingerprint(commandId: string): string | undefined {
    const row = this.database.prepare("SELECT receipt_json, command_fingerprint FROM commands WHERE command_id = ?").get(commandId) as CommandRow | undefined;
    return row?.command_fingerprint ?? undefined;
  }

  listReceipts(projectId: string): CommandReceipt[] {
    const rows = this.database.prepare("SELECT receipt_json FROM commands WHERE project_id = ? ORDER BY rowid").all(projectId) as unknown as ReceiptRow[];
    return rows.map((row) => JSON.parse(row.receipt_json) as CommandReceipt);
  }

  listCommandFingerprints(projectId: string): Record<string, string> {
    const rows = this.database.prepare("SELECT command_id, command_fingerprint FROM commands WHERE project_id = ? ORDER BY rowid").all(projectId) as unknown as CommandFingerprintRow[];
    return Object.fromEntries(rows.map((row) => {
      if (!row.command_fingerprint) throw new Error(`Command ${row.command_id} has no envelope fingerprint`);
      return [row.command_id, row.command_fingerprint];
    }));
  }

  search(query: string, projectId?: string, limit = 30): SearchHit[] {
    const tokens = query.match(/[\p{L}\p{N}_-]+/gu) ?? [];
    if (tokens.length === 0) return [];
    if (tokens.some((token) => /\p{Script=Han}/u.test(token))) {
      const clauses = tokens.map(() => "(title LIKE ? ESCAPE '\\' OR aliases LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR ref LIKE ? ESCAPE '\\')").join(" AND ");
      const values = tokens.flatMap((token) => {
        const pattern = `%${escapeLike(token)}%`;
        return [pattern, pattern, pattern, pattern];
      });
      const rows = (projectId
        ? this.database.prepare(`SELECT project_id, type, id, ref, title, COALESCE(NULLIF(substr(body, 1, 240), ''), title) AS excerpt, 0 AS rank FROM entity_search WHERE ${clauses} AND project_id = ? ORDER BY title, type, id LIMIT ?`).all(...values, projectId, limit)
        : this.database.prepare(`SELECT project_id, type, id, ref, title, COALESCE(NULLIF(substr(body, 1, 240), ''), title) AS excerpt, 0 AS rank FROM entity_search WHERE ${clauses} ORDER BY title, type, id LIMIT ?`).all(...values, limit)) as unknown as SearchRow[];
      return rows;
    }
    const match = tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND ");
    const rows = (projectId
      ? this.database.prepare(`
          SELECT project_id, type, id, ref, title,
            COALESCE(NULLIF(snippet(entity_search, 6, '[', ']', ' … ', 18), ''), title) AS excerpt,
            bm25(entity_search, 0, 0, 0, 0, 5, 2, 1) AS rank
          FROM entity_search WHERE entity_search MATCH ? AND project_id = ? ORDER BY rank LIMIT ?
        `).all(match, projectId, limit)
      : this.database.prepare(`
          SELECT project_id, type, id, ref, title,
            COALESCE(NULLIF(snippet(entity_search, 6, '[', ']', ' … ', 18), ''), title) AS excerpt,
            bm25(entity_search, 0, 0, 0, 0, 5, 2, 1) AS rank
          FROM entity_search WHERE entity_search MATCH ? ORDER BY rank LIMIT ?
        `).all(match, limit)) as unknown as SearchRow[];
    return rows;
  }

  recordRejected(commandId: string, projectId: string, commandFingerprint: string, receipt: CommandReceipt): void {
    this.database.prepare("INSERT OR IGNORE INTO commands(command_id, project_id, receipt_json, command_fingerprint) VALUES (?, ?, ?, ?)").run(commandId, projectId, JSON.stringify(receipt), commandFingerprint);
  }

  commit(input: {
    commandId: string;
    commandFingerprint: string;
    projectId: string;
    expectedProjectRevision: number;
    projectRevision: number;
    event: Omit<StoredEvent, "event_sequence">;
    entities: CanonicalEntity[];
    receipt: CommandReceipt;
  }): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (input.projectRevision !== input.expectedProjectRevision + 1) {
        throw new StoreConflictError("Project revision must advance by exactly one");
      }
      if (input.event.project_id !== input.projectId || input.event.project_revision !== input.projectRevision) {
        throw new StoreConflictError("Event violates the command project authority domain or revision");
      }
      if (input.entities.some((entity) => entity.project_id !== input.projectId)) {
        throw new StoreConflictError("Canonical mutation mixes project authority domains");
      }
      const revisionRow = this.database.prepare("SELECT revision FROM project_revisions WHERE project_id = ?").get(input.projectId) as RevisionRow | undefined;
      const actualRevision = revisionRow?.revision ?? 0;
      if (actualRevision !== input.expectedProjectRevision) {
        throw new StoreConflictError(`Project ${input.projectId} advanced from revision ${input.expectedProjectRevision} to ${actualRevision}`);
      }
      this.database.prepare(`
        INSERT INTO events(event_id, command_id, project_id, project_revision, type, occurred_at, recorded_at, entity_ref, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.event.event_id,
        input.event.command_id,
        input.event.project_id,
        input.event.project_revision,
        input.event.type,
        input.event.occurred_at,
        input.event.recorded_at,
        input.event.entity_ref ?? null,
        JSON.stringify(input.event.payload),
      );
      const insert = this.database.prepare("INSERT INTO entities(project_id, type, id, entity_version, state_json) VALUES (?, ?, ?, ?, ?)");
      const update = this.database.prepare("UPDATE entities SET entity_version = ?, state_json = ? WHERE project_id = ? AND type = ? AND id = ? AND entity_version = ?");
      for (const entity of input.entities) {
        if (entity.entity_version === 1) {
          try {
            insert.run(entity.project_id, entity.type, entity.id, entity.entity_version, JSON.stringify(entity));
          } catch {
            throw new StoreConflictError(`Stable identity ${entity.type}:${entity.id} already exists`);
          }
        } else {
          const result = update.run(entity.entity_version, JSON.stringify(entity), entity.project_id, entity.type, entity.id, entity.entity_version - 1);
          if (result.changes !== 1) throw new StoreConflictError(`Stale entity mutation for ${entity.type}:${entity.id}`);
        }
        this.indexEntity(entity);
      }
      if (revisionRow) {
        const result = this.database.prepare("UPDATE project_revisions SET revision = ? WHERE project_id = ? AND revision = ?").run(input.projectRevision, input.projectId, input.expectedProjectRevision);
        if (result.changes !== 1) throw new StoreConflictError(`Project ${input.projectId} revision compare-and-swap failed`);
      } else {
        this.database.prepare("INSERT INTO project_revisions(project_id, revision) VALUES (?, ?)").run(input.projectId, input.projectRevision);
      }
      this.database.prepare("INSERT INTO commands(command_id, project_id, receipt_json, command_fingerprint) VALUES (?, ?, ?, ?)").run(
        input.commandId,
        input.projectId,
        JSON.stringify(input.receipt),
        input.commandFingerprint,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  rebuildProject(projectId: string): void {
    const events = this.listEvents(projectId);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("DELETE FROM entities WHERE project_id = ?").run(projectId);
      this.database.prepare("DELETE FROM entity_search WHERE project_id = ?").run(projectId);
      const upsert = this.database.prepare(`
        INSERT INTO entities(project_id, type, id, entity_version, state_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id, type, id) DO UPDATE SET
          entity_version = excluded.entity_version,
          state_json = excluded.state_json
      `);
      for (const event of events) {
        const entities = (event.payload.upserts ?? []) as CanonicalEntity[];
        for (const entity of entities) {
          upsert.run(entity.project_id, entity.type, entity.id, entity.entity_version, JSON.stringify(entity));
          this.indexEntity(entity);
        }
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async backupTo(destination: string): Promise<number> {
    return backup(this.database, destination);
  }

  restoreProject(project: ProjectExport): void {
    if (this.getProjectRevision(project.project_id) !== 0) throw new Error(`Project ${project.project_id} already exists`);
    if (!project.entities.some((entity) => entity.type === "project" && entity.id === project.project_id)) throw new Error("Project export has no matching project entity");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const insertEvent = this.database.prepare(`
        INSERT INTO events(event_id, command_id, project_id, project_revision, type, occurred_at, recorded_at, entity_ref, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const event of project.events) insertEvent.run(event.event_id, event.command_id, event.project_id, event.project_revision, event.type, event.occurred_at, event.recorded_at, event.entity_ref ?? null, JSON.stringify(event.payload));
      const upsert = this.database.prepare("INSERT INTO entities(project_id, type, id, entity_version, state_json) VALUES (?, ?, ?, ?, ?)");
      for (const entity of project.entities) {
        upsert.run(entity.project_id, entity.type, entity.id, entity.entity_version, JSON.stringify(entity));
        this.indexEntity(entity);
      }
      const insertReceipt = this.database.prepare("INSERT INTO commands(command_id, project_id, receipt_json, command_fingerprint) VALUES (?, ?, ?, ?)");
      for (const receipt of project.command_receipts) insertReceipt.run(receipt.command_id, receipt.project_id, JSON.stringify(receipt), project.command_fingerprints[receipt.command_id]!);
      this.database.prepare("INSERT INTO project_revisions(project_id, revision) VALUES (?, ?)").run(project.project_id, project.project_revision);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private indexEntity(entity: CanonicalEntity): void {
    const ref = `espalier://${entity.project_id}/${entity.type}/${entity.id}`;
    this.database.prepare("DELETE FROM entity_search WHERE project_id = ? AND type = ? AND id = ?").run(entity.project_id, entity.type, entity.id);
    this.database.prepare("INSERT INTO entity_search(project_id, type, id, ref, title, aliases, body) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      entity.project_id,
      entity.type,
      entity.id,
      ref,
      entity.title,
      entity.aliases.join(" "),
      searchableBody(entity),
    );
  }

  static verifyDatabase(filename: string): { ok: boolean; integrity: string; schemaVersion?: string } {
    const database = new DatabaseSync(filename, { readOnly: true });
    try {
      const integrity = database.prepare("PRAGMA integrity_check").get() as Record<string, string>;
      const result = Object.values(integrity)[0] ?? "unknown";
      const schema = database.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value?: string } | undefined;
      return { ok: result === "ok", integrity: result, ...(schema?.value ? { schemaVersion: schema.value } : {}) };
    } finally {
      database.close();
    }
  }

  close(): void {
    this.database.close();
  }
}

function searchableBody(entity: CanonicalEntity): string {
  const values: unknown[] = [entity.body, entity.id, entity.provenance.source_refs];
  switch (entity.type) {
    case "project": values.push(entity.display_name, entity.authority_domain, entity.repository_refs); break;
    case "goal": values.push(entity.purpose, entity.present_consumers, entity.programme_order, entity.binding_constraints, entity.trust_boundaries, entity.explicit_non_goals, entity.source_refs); break;
    case "epoch": values.push(entity.baseline_ref, entity.state); break;
    case "work": values.push(entity.scope, entity.semantic_surfaces, entity.repo_surfaces, entity.verification_policy, entity.owner_refs); break;
    case "relation": values.push(entity.source_ref, entity.target_ref, entity.relation_type); break;
    case "decision": values.push(entity.question, entity.proposal, entity.scope, entity.rationale, entity.source_refs); break;
    case "hypothesis": values.push(entity.statement, entity.tests, entity.evidence_refs); break;
    case "claim": values.push(entity.target_ref, entity.principal_id, entity.semantic_surfaces, entity.repo_surfaces); break;
    case "evidence": values.push(entity.target_refs, entity.kind, entity.ref, entity.summary); break;
    case "annotation": values.push(entity.anchor_ref, entity.kind, entity.requested_action, entity.response_refs); break;
    case "handoff": values.push(entity.work_item_ref, entity.completed, entity.current_state, entity.open_questions, entity.blockers, entity.next_safe_action, entity.evidence_refs, entity.narrative); break;
    case "batch": values.push(entity.parent_work_item_ref, entity.lane_refs); break;
    case "lane": values.push(entity.batch_ref, entity.outcome, entity.scope, entity.context_refs, entity.authority, entity.return_contract, entity.semantic_surfaces, entity.repo_surfaces); break;
  }
  return values.flatMap((value) => Array.isArray(value) ? value : value == null ? [] : [value]).join(" ");
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
