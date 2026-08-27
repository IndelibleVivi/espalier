import { describe, expect, it } from "vitest";
import {
  FocusRevisionMismatchError,
  TrailingRefreshRunner,
  acceptFocusAtRevision,
  defaultLiveViewState,
  formatConversationContext,
  liveSurfaceRequest,
  loadLiveViewState,
  saveLiveViewState,
} from "./liveRuntime.js";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("generic live sidecar runtime", () => {
  it("requests meaningful delta from the locally acknowledged revision", () => {
    const request = liveSurfaceRequest("orchard", { ...defaultLiveViewState("orchard"), last_seen_revision: 41, density: "detail" });

    expect(request).toMatchObject({ mode: "live", density: "detail", since_revision: 41 });
  });

  it("persists personal camera, selection, locale, density, collapse, and seen state outside project authority", () => {
    const storage = new MemoryStorage();
    const state = {
      ...defaultLiveViewState("canopy"),
      based_on_projection_revision: "projection-r42",
      camera: { x: -120, y: 84, k: 0.75 },
      selected_ref: "espalier://canopy/work/d-transport-runtime",
      locale: "en" as const,
      density: "detail" as const,
      collapsed_route_keys: ["route:canopy:d-complete-piece"],
      last_seen_revision: 42,
    };

    saveLiveViewState(storage, state);

    expect(loadLiveViewState(storage, "canopy")).toEqual(state);
    expect([...storage.values.keys()]).toEqual(["espalier:view:canopy:local-observer:live-sidecar"]);
  });

  it("coalesces invalidations during an active refresh into one guaranteed trailing refresh", async () => {
    const releases: Array<() => void> = [];
    let runs = 0;
    const runner = new TrailingRefreshRunner(async () => {
      runs += 1;
      await new Promise<void>((resolve) => releases.push(resolve));
    });

    const first = runner.request();
    await Promise.resolve();
    const second = runner.request();
    const third = runner.request();
    expect(runs).toBe(1);

    releases.shift()?.();
    await first;
    await Promise.resolve();
    expect(runs).toBe(2);

    releases.shift()?.();
    await Promise.all([second, third]);
    expect(runs).toBe(2);
  });

  it("rejects Focus detail from a different canonical revision", () => {
    const matching = { as_of_revision: 8 };
    expect(acceptFocusAtRevision(matching, 8)).toBe(matching);
    expect(() => acceptFocusAtRevision({ as_of_revision: 9 }, 8)).toThrow(FocusRevisionMismatchError);
  });

  it("builds a compact stable-ref context handoff for ordinary conversation", () => {
    expect(formatConversationContext({
      project_id: "canopy",
      as_of_revision: 42,
      ref: "espalier://canopy/work/d-transport-runtime",
      title: "Transport + runtime",
    })).toBe("Canopy r42 · Transport + runtime\nespalier://canopy/work/d-transport-runtime");
  });
});
