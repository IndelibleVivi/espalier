import type { HumanSurfaceDensity, PersonalViewState } from "@espalier/projections";
import type { ActorIdentity } from "@espalier/protocol";
import type { Locale } from "../i18n.js";

export interface LiveCamera { x: number; y: number; k: number }

export interface LiveViewState extends Omit<PersonalViewState, "camera" | "density"> {
  camera: LiveCamera | null;
  density: HumanSurfaceDensity;
  selected_ref: string | null;
  locale: Locale;
  last_seen_revision: number | null;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredLiveViewState {
  layout_version: 1;
  state: LiveViewState;
}

function viewKey(projectId: string): string { return `espalier:view:${projectId}:local-observer:live-sidecar`; }

export function liveObserver(projectId: string): ActorIdentity { return {
  principal_id: "local-observer",
  runtime_id: "espalier-live-sidecar",
  device_id: "local-browser",
  session_id: `read-only-live-sidecar:${projectId}`,
  role: "observer",
  capabilities: ["read"],
}; }

export function defaultLiveViewState(projectId: string): LiveViewState {
  return {
    project_id: projectId,
    principal_id: "local-observer",
    device_or_saved_view: `local-browser:${projectId}:live-sidecar`,
    based_on_projection_revision: "",
    camera: null,
    node_positions: {},
    pinned_refs: [],
    collapsed_entity_refs: [],
    collapsed_route_keys: [],
    route_palette_slots: {},
    density: "working",
    theme_id: "paper-neutral",
    selected_ref: null,
    locale: "zh",
    last_seen_revision: null,
  };
}

export function loadLiveViewState(storage: StorageLike, projectId: string): LiveViewState {
  const saved = storage.getItem(viewKey(projectId));
  if (!saved) return defaultLiveViewState(projectId);
  try {
    const parsed = JSON.parse(saved) as Partial<StoredLiveViewState>;
    if (parsed.layout_version !== 1 || !parsed.state || parsed.state.project_id !== projectId) return defaultLiveViewState(projectId);
    return { ...defaultLiveViewState(projectId), ...parsed.state };
  } catch {
    return defaultLiveViewState(projectId);
  }
}

export function saveLiveViewState(storage: StorageLike, state: LiveViewState): void {
  storage.setItem(viewKey(state.project_id), JSON.stringify({ layout_version: 1, state } satisfies StoredLiveViewState));
}

export function liveSurfaceRequest(projectId: string, view: Pick<LiveViewState, "density" | "last_seen_revision">): Record<string, unknown> {
  return {
    actor: liveObserver(projectId),
    mode: "live",
    density: view.density,
    since_revision: view.last_seen_revision,
    route_budget: 16,
    visible_node_budget: 120,
    relation_budget: 80,
    collection_budget: 48,
    evidence_detail_budget: 32,
    expanded_depth_budget: 12,
    response_byte_budget: 524_288,
  };
}

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

export class TrailingRefreshRunner {
  private running = false;
  private pending: Waiter[] = [];

  constructor(private readonly run: () => Promise<void>) {}

  request(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject };
      if (!this.running) {
        this.running = true;
        void this.execute([waiter]);
        return;
      }
      this.pending.push(waiter);
    });
  }

  private async execute(waiters: Waiter[]): Promise<void> {
    try {
      await this.run();
      for (const waiter of waiters) waiter.resolve();
    } catch (error) {
      for (const waiter of waiters) waiter.reject(error);
    } finally {
      const next = this.pending;
      this.pending = [];
      if (next.length > 0) {
        void this.execute(next);
      } else {
        this.running = false;
      }
    }
  }
}

export class FocusRevisionMismatchError extends Error {
  constructor(readonly expected_revision: number, readonly received_revision: number) {
    super(`Focus detail revision r${received_revision} does not match live surface r${expected_revision}`);
    this.name = "FocusRevisionMismatchError";
  }
}

export function acceptFocusAtRevision<T extends { as_of_revision: number }>(detail: T, expectedRevision: number): T {
  if (detail.as_of_revision !== expectedRevision) throw new FocusRevisionMismatchError(expectedRevision, detail.as_of_revision);
  return detail;
}

export function formatConversationContext(input: { project_id: string; as_of_revision: number; ref: string; title: string }): string {
  const project = input.project_id.replace(/(^|[-_])([a-z])/g, (_match, _prefix, letter: string) => letter.toUpperCase());
  return `${project} r${input.as_of_revision} · ${input.title}\n${input.ref}`;
}
