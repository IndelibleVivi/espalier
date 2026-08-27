import { entityRef, instantIsAfter, instantIsAtOrBefore } from "@espalier/core";
import type { CanonicalEntity } from "@espalier/protocol";

export type AttentionCategory = "owner-decision" | "scope-drift" | "authority-conflict" | "stale-claim" | "blocked" | "lane-ready" | "stale-annotation" | "goal-integrity";

export interface AttentionItem {
  ref: string;
  category: AttentionCategory;
  title: string;
  detail: string;
  priority: number;
}

export function deriveAttention(entities: CanonicalEntity[], now: string): AttentionItem[] {
  return entities.flatMap<AttentionItem>((entity) => {
    const ref = entityRef(entity);
    if (entity.type === "goal" && entity.approval === "proposed") return [{ ref, category: "owner-decision", title: entity.title, detail: "Owner approval policy is not yet satisfied", priority: 1 }];
    if (entity.type === "decision" && entity.decision_state === "proposed") return [{ ref, category: "owner-decision", title: entity.question, detail: entity.proposal, priority: 1 }];
    if (entity.type === "work" && entity.work_state === "blocked") return [{ ref, category: "blocked", title: entity.title, detail: entity.scope, priority: 1 }];
    if (entity.type === "work" && entity.authority_state === "owner_pending") return [{ ref, category: "scope-drift", title: entity.title, detail: "Owner approval is pending", priority: 1 }];
    if (entity.type === "work" && entity.integration_state === "needs-integration") return [{ ref, category: "lane-ready", title: entity.title, detail: "Implementation is waiting for integration", priority: 2 }];
    if (entity.type === "work" && (entity.goal_integrity === "diverges" || entity.goal_integrity === "authority-unclear")) return [{ ref, category: "goal-integrity", title: entity.title, detail: entity.goal_integrity, priority: 1 }];
    if (entity.type === "batch" && entity.integration_state === "needs-integration") return [{ ref, category: "lane-ready", title: entity.title, detail: "Returned lanes are waiting for coordinator integration", priority: 2 }];
    if (entity.type === "lane" && entity.integration_state === "ready") return [{ ref, category: "lane-ready", title: entity.title, detail: "Lane result is ready for integration", priority: 2 }];
    if (entity.type === "claim" && !entity.released_at && instantIsAtOrBefore(entity.lease_until, now)) return [{ ref, category: "stale-claim", title: entity.title, detail: `Lease expired at ${entity.lease_until}`, priority: 2 }];
    if (entity.type === "claim" && !entity.released_at && entities.some((candidate) => candidate.type === "claim" && candidate.id !== entity.id && !candidate.released_at && instantIsAfter(candidate.lease_until, now) && candidate.mode === "primary" && entity.mode === "primary" && repoSurfacesOverlap(candidate.repo_surfaces, entity.repo_surfaces))) return [{ ref, category: "authority-conflict", title: entity.title, detail: "Primary semantic claims overlap a repo surface; Git integration needs coordination", priority: 1 }];
    if (entity.type === "annotation" && entity.state === "stale") return [{ ref, category: "stale-annotation", title: entity.title, detail: entity.body ?? "Anchor changed", priority: 2 }];
    if (entity.type === "annotation" && ["open", "reanchored"].includes(entity.state) && ["concern", "question", "directive"].includes(entity.kind)) return [{ ref, category: entity.kind === "directive" ? "owner-decision" : "scope-drift", title: entity.title, detail: entity.body ?? "Open annotation", priority: 2 }];
    return [];
  }).sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));
}

function repoSurfacesOverlap(first: string[], second: string[]): boolean {
  return first.some((left) => second.some((right) => left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)));
}
