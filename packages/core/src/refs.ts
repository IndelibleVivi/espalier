import type { CanonicalEntity, EntityType } from "@espalier/protocol";

const compactToType: Record<string, EntityType> = {
  project: "project",
  goal: "goal",
  epoch: "epoch",
  work: "work",
  rel: "relation",
  relation: "relation",
  decision: "decision",
  hypothesis: "hypothesis",
  claim: "claim",
  evidence: "evidence",
  annotation: "annotation",
  handoff: "handoff",
  batch: "batch",
  lane: "lane",
};

const typeToCompact: Record<EntityType, string> = {
  project: "project",
  goal: "goal",
  epoch: "epoch",
  work: "work",
  relation: "rel",
  decision: "decision",
  hypothesis: "hypothesis",
  claim: "claim",
  evidence: "evidence",
  annotation: "annotation",
  handoff: "handoff",
  batch: "batch",
  lane: "lane",
};

export interface ParsedRef {
  projectId: string;
  type: EntityType;
  id: string;
  revision?: number;
}

export function canonicalRef(projectId: string, type: EntityType, id: string, revision?: number): string {
  const base = `espalier://${encodeURIComponent(projectId)}/${type}/${encodeURIComponent(id)}`;
  return revision === undefined ? base : `${base}?rev=${revision}`;
}

export function compactRef(projectId: string, type: EntityType, id: string, revision?: number): string {
  const base = `esp:${projectId}/${typeToCompact[type]}/${id}`;
  return revision === undefined ? base : `${base}@${revision}`;
}

export function entityRef(entity: CanonicalEntity, revision?: number): string {
  return canonicalRef(entity.project_id, entity.type, entity.id, revision);
}

export function parseRef(value: string): ParsedRef {
  if (value.startsWith("espalier://")) {
    const parsed = new URL(value);
    const projectId = decodeURIComponent(parsed.hostname);
    const [rawType, ...rawId] = parsed.pathname.split("/").filter(Boolean);
    const type = rawType ? compactToType[rawType] : undefined;
    if (!projectId || !type || rawId.length === 0) throw new Error(`Invalid Espalier reference: ${value}`);
    const revisionValue = parsed.searchParams.get("rev");
    if (revisionValue !== null && (!/^\d+$/.test(revisionValue) || Number(revisionValue) < 1)) throw new Error(`Invalid Espalier reference revision: ${value}`);
    return {
      projectId,
      type,
      id: decodeURIComponent(rawId.join("/")),
      ...(revisionValue === null ? {} : { revision: Number(revisionValue) }),
    };
  }

  const match = /^esp:([^/]+)\/([^/]+)\/(.+?)(?:@(\d+))?$/.exec(value);
  if (!match) throw new Error(`Invalid Espalier reference: ${value}`);
  const type = compactToType[match[2] ?? ""];
  if (!type) throw new Error(`Unknown Espalier reference type: ${match[2]}`);
  return {
    projectId: match[1]!,
    type,
    id: match[3]!,
    ...(match[4] ? { revision: Number(match[4]) } : {}),
  };
}

export function withoutRevision(value: string): string {
  const parsed = parseRef(value);
  return canonicalRef(parsed.projectId, parsed.type, parsed.id);
}
