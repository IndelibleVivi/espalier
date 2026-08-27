import { describe, expect, it } from "vitest";
import { createHumanSurfaceFixtures } from "@espalier/projections";
import { boxesOverlap, cameraForNodes, cameraShowsAnyNode, cameraWithNodeVisible, compileLiveLayout, nodeDisclosureLevel } from "./compileLiveLayout.js";

describe("generic live sidecar layout", () => {
  it("keeps routes, owner calls, evidence, operators, and meaningful relations distinct", () => {
    const projection = createHumanSurfaceFixtures()["canopy-meaningful-delta"].projection;
    const work = projection.entities.find((entity) => entity.kind === "work")!;
    const relation = projection.relations[0]!;
    const signaled = {
      ...projection,
      entities: projection.entities.map((entity) => entity.ref === work.ref ? {
        ...entity,
        claim: { ref: `${entity.ref}/claim/test`, principal_id: "example-agent", mode: "primary" as const, lease_until: "2026-08-28T00:00:00.000Z", stale: false },
        change_reasons: ["work-state-changed" as const],
      } : entity),
      relations: projection.relations.map((candidate) => candidate.ref === relation.ref ? { ...candidate, change_reasons: ["relation-materially-changed" as const] } : candidate),
    };

    const layout = compileLiveLayout(signaled);
    expect(layout.routes.length).toBeGreaterThan(0);
    expect(layout.home_anchor_route).not.toBeNull();
    expect(layout.diagnostics.has_verified_evidence).toBe(true);
    expect(layout.nodes.find((node) => node.ref === work.ref)).toMatchObject({ operator: { principal_id: "example-agent" }, change_reasons: ["work-state-changed"] });
    expect(layout.edges.find((edge) => edge.ref === relation.ref)?.change_reasons).toEqual(["relation-materially-changed"]);
    expect(layout.nodes.some((node) => node.kind === "decision" && node.shelf_lane === "owner")).toBe(true);
    expect(layout.nodes.some((node) => node.kind === "evidence")).toBe(true);
    const cards = layout.nodes.filter((node) => node.subtitle);
    for (let left = 0; left < cards.length; left += 1) for (let right = left + 1; right < cards.length; right += 1) {
      expect(boxesOverlap(cards[left]!, cards[right]!)).toBe(false);
    }
  }, 15_000);

  it("degrades node content from full to identity to contour as zoom and viewport support fall away", () => {
    const node = { x: 160, y: 100, width: 200, height: 100 };
    const viewport = { width: 320, height: 200 };
    expect(nodeDisclosureLevel(node, { x: 0, y: 0, k: 1 }, viewport)).toBe("full");
    expect(nodeDisclosureLevel(node, { x: -70, y: 0, k: 1 }, viewport)).toBe("identity");
    expect(nodeDisclosureLevel(node, { x: -210, y: 0, k: 1 }, viewport)).toBe("contour");
    expect(nodeDisclosureLevel(node, { x: 0, y: 0, k: 0.74 }, viewport)).toBe("identity");
    expect(nodeDisclosureLevel(node, { x: 0, y: 0, k: 0.5 }, viewport)).toBe("contour");
    expect(cameraShowsAnyNode([node], { x: 0, y: 0, k: 1 }, viewport)).toBe(true);
    expect(cameraShowsAnyNode([node], { x: 400, y: 0, k: 1 }, viewport)).toBe(false);
  });

  it("fits the current programme into desktop and mobile home cameras", () => {
    const nodes = [
      { x: 220, y: 415, width: 236, height: 136 },
      { x: 520, y: 785, width: 236, height: 136 },
      { x: 820, y: 415, width: 236, height: 136 },
      { x: 1120, y: 785, width: 236, height: 136 },
    ];
    const viewport = { width: 1280, height: 652 };
    const camera = cameraForNodes(nodes, viewport, { padding: 54, maximumScale: 0.9, minimumScale: 0.28 });
    expect(camera.k).toBeCloseTo(0.9);
    for (const node of nodes) {
      expect(camera.x + (node.x - node.width / 2) * camera.k).toBeGreaterThanOrEqual(54);
      expect(camera.x + (node.x + node.width / 2) * camera.k).toBeLessThanOrEqual(viewport.width - 54);
    }
    const mobile = cameraForNodes(nodes, { width: 390, height: 776 }, { padding: 24, maximumScale: 0.9, minimumScale: 0.28 });
    expect(mobile.k).toBeGreaterThanOrEqual(0.28);
    expect(mobile.k).toBeLessThan(0.32);
  });

  it("moves the camera only enough to keep a selected Work clear of a side rail", () => {
    const node = { x: 1120, y: 785, width: 236, height: 136 };
    const camera = { x: 37, y: -214, k: 0.9 };
    const viewport = { width: 950, height: 652 };
    const visible = cameraWithNodeVisible(node, camera, viewport, 28);
    expect(visible).toMatchObject({ k: camera.k, y: camera.y });
    expect(visible.x).toBeLessThan(camera.x);
    expect(visible.x + (node.x + node.width / 2) * visible.k).toBeLessThanOrEqual(viewport.width - 28);
  });
});
