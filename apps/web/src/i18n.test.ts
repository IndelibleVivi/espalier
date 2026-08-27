import { describe, expect, it } from "vitest";
import type { RouteProjection } from "@espalier/projections";
import { canvasStatePresentation, changeReasonLabel, displayRouteCaption, displayRouteTitle, stateLabel } from "./i18n.js";

describe("generic live-sidecar state presentation", () => {
  it("keeps expected work quiet while preserving meaningful evidence and owner states", () => {
    expect(canvasStatePresentation("route", "proposed", "zh")).toBeNull();
    expect(canvasStatePresentation("work", "proposed", "en")).toBeNull();
    expect(canvasStatePresentation("evidence", "verified", "zh")).toEqual({ visual: "✓", accessible: "已验证" });
    expect(canvasStatePresentation("evidence", "unverified", "zh")).toEqual({ visual: "未验证", accessible: "未验证" });
    expect(canvasStatePresentation("decision", "proposed", "zh")).toEqual({ visual: "待判断", accessible: "待 owner 判断" });
  });

  it("keeps source-authored Route identity and wording unchanged across UI locales", () => {
    const route = { route_key: "route:canopy:g-production-canvas", title: "G — Production Canvas" } as RouteProjection;
    const source = "Deferred: implement the owner-approved visual direction in the shared Canopy renderer";
    expect(displayRouteTitle(route, "zh")).toBe(route.title);
    expect(displayRouteTitle(route, "en")).toBe(route.title);
    expect(displayRouteCaption(route, source, "zh")).toBe(source);
    expect(displayRouteCaption(route, source, "en")).toBe(source);
    expect(displayRouteTitle({ ...route, title: "G — Renamed" }, "zh")).toBe("G — Renamed");
    expect(stateLabel("proposed", "zh")).toBe("拟议中");
    expect(changeReasonLabel("relation-materially-changed", "zh")).toBe("Relation 已实质变化");
  });
});
