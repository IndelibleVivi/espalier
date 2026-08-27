import { useCallback, useEffect, useRef, useState } from "react";
import { EspalierClient } from "@espalier/client";
import type { HumanSurfaceProjection } from "@espalier/projections";
import type { CanonicalEntity, Relation } from "@espalier/protocol";
import { TrailingRefreshRunner, acceptFocusAtRevision, liveSurfaceRequest, type LiveViewState } from "./liveRuntime.js";

function cacheKey(projectId: string): string { return `espalier:${projectId}:live-sidecar:last-known`; }
export interface LiveSurfaceState {
  projection: HumanSurfaceProjection | null;
  connection: "loading" | "live" | "stale" | "offline";
  error: string | null;
  updatedAt: string | null;
  refresh: () => Promise<void>;
}

interface CachedProjection { saved_at: string; projection: HumanSurfaceProjection }

export function useLiveSurface(projectId: string, view: Pick<LiveViewState, "density" | "last_seen_revision">): LiveSurfaceState {
  const clientRef = useRef(new EspalierClient(window.location.origin));
  const [projection, setProjection] = useState<HumanSurfaceProjection | null>(null);
  const [connection, setConnection] = useState<LiveSurfaceState["connection"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const performRef = useRef<() => Promise<void>>(async () => {});
  const runnerRef = useRef<TrailingRefreshRunner | null>(null);
  if (!runnerRef.current) runnerRef.current = new TrailingRefreshRunner(() => performRef.current());

  performRef.current = async () => {
    try {
      const next = await clientRef.current.humanSurface<HumanSurfaceProjection>(projectId, liveSurfaceRequest(projectId, viewRef.current));
      const savedAt = new Date().toISOString();
      localStorage.setItem(cacheKey(projectId), JSON.stringify({ saved_at: savedAt, projection: next } satisfies CachedProjection));
      setProjection(next);
      setUpdatedAt(savedAt);
      setConnection(next.stale_state ? "stale" : "live");
      setError(next.stale_state?.reason ?? null);
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      setError(reason);
      setConnection("stale");
      setProjection((current) => {
        if (current) return current;
        const cached = localStorage.getItem(cacheKey(projectId));
        if (!cached) return null;
        try {
          const value = JSON.parse(cached) as CachedProjection;
          setUpdatedAt(value.saved_at);
          return value.projection;
        } catch {
          return null;
        }
      });
    }
  };

  const refresh = useCallback(() => runnerRef.current!.request(), []);

  useEffect(() => { void refresh(); }, [refresh, projectId, view.density, view.last_seen_revision]);
  useEffect(() => {
    const events = new EventSource(`/api/events?project_id=${encodeURIComponent(projectId)}`);
    events.addEventListener("ready", () => setConnection((current) => current === "stale" ? current : "live"));
    events.addEventListener("project-event", () => void refresh());
    events.onerror = () => {
      setConnection((current) => current === "stale" ? current : "offline");
      setError((current) => current ?? "Live invalidation stream disconnected; showing last known projection");
    };
    return () => events.close();
  }, [projectId, refresh]);
  return { projection, connection, error, updatedAt, refresh };
}

export interface FocusDetail {
  project_id: string;
  as_of_revision: number;
  selected: CanonicalEntity;
  relations: Relation[];
  neighbors: CanonicalEntity[];
  anchored: CanonicalEntity[];
}

export function useFocusDetail(ref: string | null, projectionRevision: number | null): { detail: FocusDetail | null; error: string | null } {
  const [detail, setDetail] = useState<FocusDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!ref || !ref.startsWith("espalier://") || projectionRevision === null) return;
    let active = true;
    const client = new EspalierClient(window.location.origin);
    client.focus<FocusDetail>(ref).then((next) => {
      if (active) { setDetail(acceptFocusAtRevision(next, projectionRevision)); setError(null); }
    }).catch((caught) => {
      if (active) { setDetail(null); setError(caught instanceof Error ? caught.message : String(caught)); }
    });
    return () => { active = false; };
  }, [ref, projectionRevision]);
  return { detail, error };
}
